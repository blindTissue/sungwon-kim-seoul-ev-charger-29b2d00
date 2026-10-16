import { NO_SHOW_COOLDOWN_S, RESERVATION_DURATION_S, RESERVATION_MAX_ETA_S, type LatLng } from "@seoul-ev/shared";
import type { Clock } from "../domain/clock.js";
import { iso } from "../domain/clock.js";
import { DomainError } from "../domain/errors.js";
import type { RoutingProvider } from "../providers/routing.js";
import type { ReservationRecord, ReservationRepository, StationRepository } from "../repositories/types.js";

export interface ReservationEvents {
  onExpired?: (r: ReservationRecord) => void;
}

/** §5 reservation rules. Storage atomicity is delegated to ReservationRepository.create. */
export class ReservationService {
  constructor(
    private readonly reservations: ReservationRepository,
    private readonly stations: StationRepository,
    private readonly routing: RoutingProvider,
    private readonly clock: Clock,
    private readonly events: ReservationEvents = {},
  ) {}

  /** Expires due reservations and applies the no-show cooldown. Safe to call often. */
  async sweep(): Promise<ReservationRecord[]> {
    const now = this.clock.now();
    const expired = await this.reservations.expireDue(now);
    for (const r of expired) {
      await this.reservations.setCooldownUntil(r.device_id, r.expires_at + NO_SHOW_COOLDOWN_S * 1000);
      this.events.onExpired?.(r);
    }
    return expired;
  }

  async activeCooldown(deviceId: string): Promise<number | null> {
    const until = await this.reservations.getCooldownUntil(deviceId);
    return until !== null && until > this.clock.now() ? until : null;
  }

  async create(deviceId: string, chargerId: string, origin: LatLng | null): Promise<ReservationRecord> {
    await this.sweep();
    const now = this.clock.now();

    const cooldown = await this.activeCooldown(deviceId);
    if (cooldown !== null) {
      throw new DomainError("COOLDOWN_ACTIVE", { cooldown_until: iso(cooldown) }, { min: Math.ceil((cooldown - now) / 60_000) });
    }
    if (await this.reservations.getActiveByDevice(deviceId)) throw new DomainError("ACTIVE_RESERVATION_EXISTS");

    const charger = await this.stations.getCharger(chargerId);
    if (!charger) throw new DomainError("NOT_FOUND");
    if (charger.status === "reserved") {
      throw new DomainError("ALREADY_RESERVED", charger.reservation_expires_at ? { expires_at: iso(charger.reservation_expires_at) } : undefined);
    }
    if (charger.status !== "available") throw new DomainError("CHARGER_UNAVAILABLE", { status: charger.status });

    if (origin) {
      const station = await this.stations.getById(charger.station_id);
      const route = await this.routing.route(origin, station!.station);
      if (route.duration_s > RESERVATION_MAX_ETA_S) {
        throw new DomainError("ETA_TOO_LONG", { eta_s: route.duration_s, max_eta_s: RESERVATION_MAX_ETA_S }, { eta: Math.ceil(route.duration_s / 60) });
      }
    }

    // Re-read the clock: routing may have taken a moment.
    const createdAt = this.clock.now();
    return this.reservations.create({ chargerId, deviceId, now: createdAt, expiresAt: createdAt + RESERVATION_DURATION_S * 1000 });
  }

  async getById(id: string): Promise<ReservationRecord | null> {
    return this.reservations.getById(id);
  }

  private async owned(deviceId: string, id: string): Promise<ReservationRecord> {
    await this.sweep();
    const r = await this.reservations.getById(id);
    // Don't reveal other devices' reservations.
    if (!r || r.device_id !== deviceId) throw new DomainError("NOT_FOUND");
    return r;
  }

  async cancel(deviceId: string, id: string): Promise<ReservationRecord> {
    await this.owned(deviceId, id);
    return this.reservations.cancel(id, this.clock.now());
  }

  async arrive(deviceId: string, id: string): Promise<ReservationRecord> {
    await this.owned(deviceId, id);
    return this.reservations.arrive(id, this.clock.now());
  }

  async active(deviceId: string): Promise<{ reservation: ReservationRecord | null; cooldownUntil: number | null; lastEnded: ReservationRecord | null }> {
    await this.sweep();
    const reservation = await this.reservations.getActiveByDevice(deviceId);
    let lastEnded: ReservationRecord | null = null;
    if (!reservation) {
      const latest = await this.reservations.getLatestByDevice(deviceId);
      if (latest && latest.ended_at !== null && this.clock.now() - latest.ended_at < 120_000) lastEnded = latest;
    }
    return { reservation, cooldownUntil: await this.activeCooldown(deviceId), lastEnded };
  }
}
