import type { ChargerStatus, SimulatorState } from "@seoul-ev/shared";
import { iso, type Clock } from "../../domain/clock.js";
import { DomainError } from "../../domain/errors.js";
import type { DemoControl } from "../../debug/types.js";
import type { ChargerRecord, ReservationRecord } from "../types.js";
import { loadSeed, openDb, seedHash, writeSeed, type DB, type SeedData } from "./db.js";
import { MockReservationRepository } from "./reservation-repo.js";
import { Simulator } from "./simulator.js";
import { MockStationRepository } from "./station-repo.js";

export interface MockBackendOptions {
  dbPath: string;
  clock: Clock;
  simSeed: number;
  simSpeed: number;
  simTickMs: number;
  seed?: SeedData;
}

class MockDemoControl implements DemoControl {
  constructor(
    private readonly db: DB,
    private readonly sim: Simulator,
    private readonly seed: SeedData,
    private readonly clock: Clock,
    private readonly stations: MockStationRepository,
  ) {}

  async setChargerStatus(id: string, status: Exclude<ChargerStatus, "reserved">): Promise<ChargerRecord> {
    const current = await this.stations.getCharger(id);
    if (!current) throw new DomainError("NOT_FOUND");
    if (current.status === "reserved") throw new DomainError("ALREADY_RESERVED");
    const now = this.clock.now();
    const t = this.sim.now;
    const sessionEnd = status === "charging" ? this.sim.sessionEnd(current) : null;
    const faultUntil = status === "out_of_order" ? t + 2 * 3_600_000 : status === "unknown" ? t + 10 * 60_000 : null;
    this.db
      .prepare("UPDATE chargers SET status = ?, status_updated_at = ?, sim_session_end = ?, sim_fault_until = ? WHERE id = ?")
      .run(status, now, sessionEnd, faultUntil, id);
    return (await this.stations.getCharger(id))!;
  }

  async fastForwardReservation(id: string, seconds?: number): Promise<ReservationRecord> {
    const r = this.db.prepare("SELECT * FROM reservations WHERE id = ?").get(id) as ReservationRecord | undefined;
    if (!r) throw new DomainError("NOT_FOUND");
    const now = this.clock.now();
    const expiresAt = seconds === undefined ? now : Math.max(now, r.expires_at - seconds * 1000);
    if (r.state === "active") this.db.prepare("UPDATE reservations SET expires_at = ? WHERE id = ?").run(expiresAt, id);
    return { ...r, expires_at: r.state === "active" ? expiresAt : r.expires_at };
  }

  async clearCooldown(deviceId: string): Promise<void> {
    this.db.prepare("DELETE FROM device_cooldowns WHERE device_id = ?").run(deviceId);
  }

  async reset(): Promise<void> {
    writeSeed(this.db, this.seed, this.clock.now());
    this.sim.initialize();
  }

  simulatorState(): SimulatorState {
    return { speed: this.sim.speed, seed: this.sim.seed, tick_interval_s: this.sim.tickMs / 1000, sim_time: iso(this.sim.now), ticks: this.sim.ticks };
  }

  setSimulator(opts: { speed?: number; tick?: boolean }): SimulatorState {
    if (opts.speed !== undefined) this.sim.speed = opts.speed;
    if (opts.tick) this.sim.tick();
    return this.simulatorState();
  }
}

export function createMockBackend(opts: MockBackendOptions) {
  const seed = opts.seed ?? loadSeed();
  const db = openDb(opts.dbPath);
  const simulator = new Simulator(db, { seed: opts.simSeed, speed: opts.simSpeed, tickMs: opts.simTickMs, now: () => opts.clock.now() });
  if (seedHash(db) !== seed.hash) {
    writeSeed(db, seed, opts.clock.now());
    simulator.initialize();
  }
  const stations = new MockStationRepository(db, seed.districts);
  const reservations = new MockReservationRepository(db, simulator.sessionEnd);
  const control = new MockDemoControl(db, simulator, seed, opts.clock, stations);
  return {
    stations,
    reservations,
    control,
    simulator,
    db,
    close: () => {
      simulator.stop();
      db.close();
    },
  };
}
