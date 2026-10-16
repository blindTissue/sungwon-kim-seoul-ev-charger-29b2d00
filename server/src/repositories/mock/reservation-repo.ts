import { randomUUID } from "node:crypto";
import { DomainError } from "../../domain/errors.js";
import { iso } from "../../domain/clock.js";
import type { ChargerRecord, CreateReservationInput, ReservationRecord, ReservationRepository } from "../types.js";
import type { DB } from "./db.js";

/** Called when a driver arrives so the simulator knows when the charging session should end. */
export type SessionEndFn = (charger: Pick<ChargerRecord, "speed">) => number;

export class MockReservationRepository implements ReservationRepository {
  constructor(
    private readonly db: DB,
    private readonly sessionEnd: SessionEndFn,
  ) {}

  async create(input: CreateReservationInput): Promise<ReservationRecord> {
    const { chargerId, deviceId, now, expiresAt } = input;
    const tx = this.db.transaction((): ReservationRecord => {
      const charger = this.db.prepare("SELECT id, station_id, status FROM chargers WHERE id = ?").get(chargerId) as
        | { id: string; station_id: string; status: string }
        | undefined;
      if (!charger) throw new DomainError("NOT_FOUND");
      if (this.db.prepare("SELECT 1 FROM reservations WHERE device_id = ? AND state = 'active'").get(deviceId)) {
        throw new DomainError("ACTIVE_RESERVATION_EXISTS");
      }
      if (charger.status === "reserved") throw this.alreadyReserved(chargerId);
      if (charger.status !== "available") throw new DomainError("CHARGER_UNAVAILABLE", { status: charger.status });

      // Compare-and-set: only flips a charger that is still available.
      const upd = this.db
        .prepare("UPDATE chargers SET status = 'reserved', status_updated_at = ?, sim_session_end = NULL WHERE id = ? AND status = 'available'")
        .run(now, chargerId);
      if (upd.changes !== 1) throw this.alreadyReserved(chargerId);

      const rec: ReservationRecord = {
        id: randomUUID(),
        charger_id: chargerId,
        station_id: charger.station_id,
        device_id: deviceId,
        created_at: now,
        expires_at: expiresAt,
        state: "active",
        ended_at: null,
      };
      try {
        this.db
          .prepare("INSERT INTO reservations VALUES (@id, @charger_id, @station_id, @device_id, @created_at, @expires_at, @state, @ended_at)")
          .run(rec);
      } catch (e) {
        if (e instanceof Error && "code" in e && String((e as { code: unknown }).code).startsWith("SQLITE_CONSTRAINT")) {
          throw e.message.includes("device_id") ? new DomainError("ACTIVE_RESERVATION_EXISTS") : this.alreadyReserved(chargerId);
        }
        throw e;
      }
      return rec;
    });
    return tx.immediate();
  }

  private alreadyReserved(chargerId: string): DomainError {
    const r = this.db.prepare("SELECT expires_at FROM reservations WHERE charger_id = ? AND state = 'active'").get(chargerId) as
      | { expires_at: number }
      | undefined;
    return new DomainError("ALREADY_RESERVED", r ? { expires_at: iso(r.expires_at) } : undefined);
  }

  async getById(id: string): Promise<ReservationRecord | null> {
    return (this.db.prepare("SELECT * FROM reservations WHERE id = ?").get(id) as ReservationRecord | undefined) ?? null;
  }

  async getActiveByDevice(deviceId: string): Promise<ReservationRecord | null> {
    return (this.db.prepare("SELECT * FROM reservations WHERE device_id = ? AND state = 'active'").get(deviceId) as ReservationRecord | undefined) ?? null;
  }

  async getLatestByDevice(deviceId: string): Promise<ReservationRecord | null> {
    return (
      (this.db.prepare("SELECT * FROM reservations WHERE device_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1").get(deviceId) as
        | ReservationRecord
        | undefined) ?? null
    );
  }

  private end(id: string, now: number, state: "cancelled" | "arrived"): ReservationRecord {
    return this.db
      .transaction((): ReservationRecord => {
        const r = this.db.prepare("SELECT * FROM reservations WHERE id = ?").get(id) as ReservationRecord | undefined;
        if (!r) throw new DomainError("NOT_FOUND");
        if (r.state !== "active") throw new DomainError("RESERVATION_NOT_ACTIVE", { state: r.state });
        this.db.prepare("UPDATE reservations SET state = ?, ended_at = ? WHERE id = ?").run(state, now, id);
        if (state === "cancelled") {
          this.db.prepare("UPDATE chargers SET status = 'available', status_updated_at = ?, sim_session_end = NULL WHERE id = ?").run(now, r.charger_id);
        } else {
          const ch = this.db.prepare("SELECT speed FROM chargers WHERE id = ?").get(r.charger_id) as Pick<ChargerRecord, "speed">;
          this.db
            .prepare("UPDATE chargers SET status = 'charging', status_updated_at = ?, sim_session_end = ? WHERE id = ?")
            .run(now, this.sessionEnd(ch), r.charger_id);
        }
        return { ...r, state, ended_at: now };
      })
      .immediate();
  }

  async cancel(id: string, now: number): Promise<ReservationRecord> {
    return this.end(id, now, "cancelled");
  }

  async arrive(id: string, now: number): Promise<ReservationRecord> {
    return this.end(id, now, "arrived");
  }

  async expireDue(now: number): Promise<ReservationRecord[]> {
    return this.db
      .transaction((): ReservationRecord[] => {
        const due = this.db.prepare("SELECT * FROM reservations WHERE state = 'active' AND expires_at <= ?").all(now) as ReservationRecord[];
        for (const r of due) {
          this.db.prepare("UPDATE reservations SET state = 'expired', ended_at = ? WHERE id = ?").run(now, r.id);
          this.db.prepare("UPDATE chargers SET status = 'available', status_updated_at = ?, sim_session_end = NULL WHERE id = ?").run(now, r.charger_id);
        }
        return due.map((r) => ({ ...r, state: "expired" as const, ended_at: now }));
      })
      .immediate();
  }

  async getCooldownUntil(deviceId: string): Promise<number | null> {
    const row = this.db.prepare("SELECT until FROM device_cooldowns WHERE device_id = ?").get(deviceId) as { until: number } | undefined;
    return row?.until ?? null;
  }

  async setCooldownUntil(deviceId: string, until: number): Promise<void> {
    this.db.prepare("INSERT INTO device_cooldowns VALUES (?, ?) ON CONFLICT(device_id) DO UPDATE SET until = excluded.until").run(deviceId, until);
  }
}
