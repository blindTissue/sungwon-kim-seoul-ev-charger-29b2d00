import type { ActiveReservationResponse, Reservation, ReservationEnvelope, StationBase } from "@seoul-ev/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Container } from "../container.js";
import { iso } from "../domain/clock.js";
import { DomainError } from "../domain/errors.js";
import type { ReservationRecord } from "../repositories/types.js";
import { toBase } from "../services/station-service.js";

export function toReservation(r: ReservationRecord): Reservation {
  return {
    id: r.id,
    charger_id: r.charger_id,
    station_id: r.station_id,
    device_id: r.device_id,
    created_at: iso(r.created_at),
    expires_at: iso(r.expires_at),
    state: r.state,
    ended_at: r.ended_at === null ? null : iso(r.ended_at),
  };
}

function deviceId(req: FastifyRequest): string {
  const raw = req.headers["x-device-id"];
  const id = Array.isArray(raw) ? raw[0] : raw;
  if (!id || id.length < 8 || id.length > 64 || !/^[A-Za-z0-9_-]+$/.test(id)) throw new DomainError("MISSING_DEVICE_ID");
  return id;
}

export function reservationRoutes(app: FastifyInstance, c: Container): void {
  const stationBase = async (stationId: string): Promise<StationBase | undefined> => {
    const d = await c.stations.detail(stationId).catch(() => null);
    return d ? toBase(d) : undefined;
  };
  const envelope = async (r: ReservationRecord): Promise<ReservationEnvelope> => ({
    reservation: toReservation(r),
    station: await stationBase(r.station_id),
    server_time: iso(c.clock.now()),
  });

  app.post<{ Body: { charger_id: string; origin_lat?: number; origin_lng?: number } }>(
    "/reservations",
    {
      schema: {
        body: {
          type: "object",
          required: ["charger_id"],
          properties: { charger_id: { type: "string", minLength: 1 }, origin_lat: { type: "number" }, origin_lng: { type: "number" } },
        },
      },
    },
    async (req, reply) => {
      const id = deviceId(req);
      const { charger_id, origin_lat, origin_lng } = req.body;
      const origin = origin_lat !== undefined && origin_lng !== undefined ? { lat: origin_lat, lng: origin_lng } : null;
      const r = await c.reservations.create(id, charger_id, origin);
      reply.code(201);
      return envelope(r);
    },
  );

  app.get("/reservations/active", async (req): Promise<ActiveReservationResponse> => {
    const id = deviceId(req);
    const { reservation, cooldownUntil, lastEnded } = await c.reservations.active(id);
    return {
      reservation: reservation ? toReservation(reservation) : null,
      station: reservation ? ((await stationBase(reservation.station_id)) ?? null) : null,
      cooldown_until: cooldownUntil === null ? null : iso(cooldownUntil),
      last_ended: lastEnded ? toReservation(lastEnded) : null,
      server_time: iso(c.clock.now()),
    };
  });

  app.post<{ Params: { id: string } }>("/reservations/:id/cancel", async (req) => envelope(await c.reservations.cancel(deviceId(req), req.params.id)));
  app.post<{ Params: { id: string } }>("/reservations/:id/arrive", async (req) => envelope(await c.reservations.arrive(deviceId(req), req.params.id)));
}
