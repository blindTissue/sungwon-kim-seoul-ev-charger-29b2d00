import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ActiveReservationResponse, ErrorBody, ReservationEnvelope, StationDetail } from "@seoul-ev/shared";
import { allAvailable, dev, fixtureSeed, GANGNAM, makeApp, offset, station, type TestCtx } from "./helpers.js";

const NEAR = offset(GANGNAM, 500, 0); // ~500 m → ETA ≈ 1.8 min on mock routing
const seed = fixtureSeed([
  station("NEAR", NEAR, [{}, {}, { speed: "DC", connector: "DC_COMBO", power_kw: 100 }]),
  station("SOLO", offset(GANGNAM, 0, 800), [{}]),
]);
const FAR_ORIGIN = offset(GANGNAM, 0, -6000); // ~6 km → ETA ≈ 21 min

let ctx: TestCtx;
beforeEach(async () => {
  ctx = await makeApp({ seed });
  await allAvailable(ctx, seed);
});
afterEach(async () => ctx.close());

const reserve = (device: number, charger_id: string, origin: { lat: number; lng: number } | null = GANGNAM) =>
  ctx.app.inject({
    method: "POST",
    url: "/reservations",
    headers: dev(device),
    payload: { charger_id, ...(origin ? { origin_lat: origin.lat, origin_lng: origin.lng } : {}) },
  });
const active = async (device: number) => (await ctx.app.inject({ url: "/reservations/active", headers: dev(device) })).json() as ActiveReservationResponse;
const charger = async (id: string) => {
  const st = (await ctx.app.inject({ url: `/stations/${id.split("-")[0]}` })).json() as StationDetail;
  return st.chargers.find((c) => c.id === id)!;
};

describe("eligibility (ETA ≤ 10 min)", () => {
  it("allows a reservation when the ETA is within 10 minutes", async () => {
    const res = await reserve(1, "NEAR-C1");
    expect(res.statusCode).toBe(201);
    const body = res.json() as ReservationEnvelope;
    expect(body.reservation.state).toBe("active");
    expect(Date.parse(body.reservation.expires_at) - Date.parse(body.reservation.created_at)).toBe(600_000);
    expect(body.station?.name_ko).toBe("테스트 NEAR");
  });

  it("rejects with ETA_TOO_LONG (422) and reports the ETA when farther than 10 minutes", async () => {
    const res = await reserve(1, "NEAR-C1", FAR_ORIGIN);
    expect(res.statusCode).toBe(422);
    const body = res.json() as ErrorBody;
    expect(body.code).toBe("ETA_TOO_LONG");
    expect(body.details?.eta_s).toBeGreaterThan(600);
    expect(body.message_ko).toMatch(/분/);
    expect(body.message_en).toMatch(/min/);
    expect((await charger("NEAR-C1")).status).toBe("available");
  });

  it("allows the reservation when no origin is sent (ETA unknown)", async () => {
    expect((await reserve(1, "NEAR-C1", null)).statusCode).toBe(201);
  });
});

describe("one active reservation per device", () => {
  it("rejects a second reservation from the same device", async () => {
    expect((await reserve(1, "NEAR-C1")).statusCode).toBe(201);
    const res = await reserve(1, "NEAR-C2");
    expect(res.statusCode).toBe(409);
    expect((res.json() as ErrorBody).code).toBe("ACTIVE_RESERVATION_EXISTS");
  });

  it("requires X-Device-Id", async () => {
    const res = await ctx.app.inject({ method: "POST", url: "/reservations", payload: { charger_id: "NEAR-C1" } });
    expect(res.statusCode).toBe(400);
    expect((res.json() as ErrorBody).code).toBe("MISSING_DEVICE_ID");
  });
});

describe("visibility to others", () => {
  it("shows the charger as reserved with remaining time and blocks other devices", async () => {
    await reserve(1, "SOLO-C1");
    ctx.clock.advance(90_000);
    const c = await charger("SOLO-C1");
    expect(c.status).toBe("reserved");
    expect(c.reservation?.remaining_s).toBe(510);

    const st = (await ctx.app.inject({ url: "/stations/SOLO" })).json() as StationDetail;
    expect(st.marker_status).toBe("reserved");
    expect(st.summary.available).toBe(0);

    const res = await reserve(2, "SOLO-C1");
    expect(res.statusCode).toBe(409);
    const err = res.json() as ErrorBody;
    expect(err.code).toBe("ALREADY_RESERVED");
    expect(err.message_en).toMatch(/reserved/i);
  });

  it("does not let another device see or cancel my reservation", async () => {
    const r = (await reserve(1, "NEAR-C1")).json() as ReservationEnvelope;
    const res = await ctx.app.inject({ method: "POST", url: `/reservations/${r.reservation.id}/cancel`, headers: dev(2) });
    expect(res.statusCode).toBe(404);
    expect((await active(2)).reservation).toBeNull();
  });
});

describe("cancel", () => {
  it("frees the charger immediately with no penalty", async () => {
    const r = (await reserve(1, "NEAR-C1")).json() as ReservationEnvelope;
    const res = await ctx.app.inject({ method: "POST", url: `/reservations/${r.reservation.id}/cancel`, headers: dev(1) });
    expect(res.statusCode).toBe(200);
    expect((res.json() as ReservationEnvelope).reservation.state).toBe("cancelled");
    expect((await charger("NEAR-C1")).status).toBe("available");
    const a = await active(1);
    expect(a.reservation).toBeNull();
    expect(a.cooldown_until).toBeNull();
    expect((await reserve(1, "NEAR-C1")).statusCode).toBe(201);
  });
});

describe("arrive", () => {
  it("switches the charger to charging and ends the reservation", async () => {
    const r = (await reserve(1, "NEAR-C3")).json() as ReservationEnvelope;
    ctx.clock.advance(5 * 60_000);
    const res = await ctx.app.inject({ method: "POST", url: `/reservations/${r.reservation.id}/arrive`, headers: dev(1) });
    expect(res.statusCode).toBe(200);
    expect((res.json() as ReservationEnvelope).reservation.state).toBe("arrived");
    expect((await charger("NEAR-C3")).status).toBe("charging");
    expect((await active(1)).reservation).toBeNull();

    const again = await ctx.app.inject({ method: "POST", url: `/reservations/${r.reservation.id}/cancel`, headers: dev(1) });
    expect(again.statusCode).toBe(409);
    expect((again.json() as ErrorBody).code).toBe("RESERVATION_NOT_ACTIVE");
  });

  it("cannot arrive after expiry", async () => {
    const r = (await reserve(1, "NEAR-C1")).json() as ReservationEnvelope;
    ctx.clock.advance(600_000);
    const res = await ctx.app.inject({ method: "POST", url: `/reservations/${r.reservation.id}/arrive`, headers: dev(1) });
    expect(res.statusCode).toBe(409);
    expect((await charger("NEAR-C1")).status).toBe("available");
  });
});

describe("expiry and no-show cooldown", () => {
  it("stays active at 9:59 and expires at 10:00, freeing the charger", async () => {
    await reserve(1, "NEAR-C1");
    ctx.clock.advance(599_000);
    expect((await active(1)).reservation?.state).toBe("active");
    expect((await charger("NEAR-C1")).status).toBe("reserved");
    ctx.clock.advance(1_000);
    const a = await active(1);
    expect(a.reservation).toBeNull();
    expect(a.last_ended?.state).toBe("expired");
    expect((await charger("NEAR-C1")).status).toBe("available");
  });

  it("enforces a 15-minute cooldown after a no-show, then allows reserving again", async () => {
    await reserve(1, "NEAR-C1");
    ctx.clock.advance(600_000);
    const a = await active(1);
    expect(Date.parse(a.cooldown_until!) - ctx.clock.now()).toBe(900_000);

    const blocked = await reserve(1, "NEAR-C2");
    expect(blocked.statusCode).toBe(429);
    const err = blocked.json() as ErrorBody;
    expect(err.code).toBe("COOLDOWN_ACTIVE");
    expect(err.message_en).toContain("15 min");

    // Other devices are unaffected.
    expect((await reserve(2, "NEAR-C2")).statusCode).toBe(201);

    ctx.clock.advance(900_000);
    expect((await reserve(1, "NEAR-C1")).statusCode).toBe(201);
  });

  it("debug fast-forward expires the reservation and applies the cooldown", async () => {
    const r = (await reserve(1, "NEAR-C1")).json() as ReservationEnvelope;
    const ff = await ctx.app.inject({ method: "POST", url: `/debug/reservations/${r.reservation.id}/fast-forward`, payload: {} });
    expect(ff.statusCode).toBe(200);
    expect(ff.json().reservation.state).toBe("expired");
    expect((await charger("NEAR-C1")).status).toBe("available");
    expect((await reserve(1, "NEAR-C2")).json().code).toBe("COOLDOWN_ACTIVE");

    await ctx.app.inject({ method: "DELETE", url: `/debug/devices/${dev(1)["x-device-id"]}/cooldown` });
    expect((await reserve(1, "NEAR-C2")).statusCode).toBe(201);
  });

  it("accepts body-less POSTs that still send Content-Type: application/json", async () => {
    const r = (await reserve(1, "NEAR-C1")).json() as ReservationEnvelope;
    const headers = { ...dev(1), "content-type": "application/json" };
    const ff = await ctx.app.inject({ method: "POST", url: `/debug/reservations/${r.reservation.id}/fast-forward`, headers, payload: "" });
    expect(ff.statusCode).toBe(200);
    const bad = await ctx.app.inject({ method: "POST", url: "/reservations", headers, payload: "{nope" });
    expect(bad.statusCode).toBe(400);
  });

  it("partial fast-forward only shortens the window", async () => {
    const r = (await reserve(1, "NEAR-C1")).json() as ReservationEnvelope;
    await ctx.app.inject({ method: "POST", url: `/debug/reservations/${r.reservation.id}/fast-forward`, payload: { seconds: 540 } });
    expect((await charger("NEAR-C1")).reservation?.remaining_s).toBe(60);
  });
});

describe("unavailable chargers", () => {
  it("rejects out-of-order and charging chargers with CHARGER_UNAVAILABLE", async () => {
    await ctx.app.inject({ method: "POST", url: "/debug/chargers/NEAR-C1/status", payload: { status: "out_of_order" } });
    await ctx.app.inject({ method: "POST", url: "/debug/chargers/NEAR-C2/status", payload: { status: "charging" } });
    for (const id of ["NEAR-C1", "NEAR-C2"]) {
      const res = await reserve(1, id);
      expect(res.statusCode).toBe(409);
      expect((res.json() as ErrorBody).code).toBe("CHARGER_UNAVAILABLE");
    }
  });

  it("returns NOT_FOUND for an unknown charger", async () => {
    expect((await reserve(1, "NOPE-C1")).statusCode).toBe(404);
  });

  it("debug cannot override a reserved charger", async () => {
    await reserve(1, "NEAR-C1");
    const res = await ctx.app.inject({ method: "POST", url: "/debug/chargers/NEAR-C1/status", payload: { status: "charging" } });
    expect(res.statusCode).toBe(409);
  });
});
