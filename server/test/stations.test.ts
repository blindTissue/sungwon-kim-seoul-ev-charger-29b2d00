import { afterEach, describe, expect, it } from "vitest";
import type { LatLng, NearestResult, RouteSummary, StationList } from "@seoul-ev/shared";
import type { RoutingProvider } from "../src/providers/routing.js";
import { MockRoutingProvider } from "../src/providers/routing.js";
import { allAvailable, fixtureSeed, GANGNAM, makeApp, offset, station, type TestCtx } from "./helpers.js";

/** Routing stub with a fixed ETA per destination (lets ETA order differ from straight-line order). */
class TableRouting implements RoutingProvider {
  readonly name = "mock" as const;
  calls: LatLng[] = [];
  constructor(private readonly eta: Map<string, number>) {}
  async route(_from: LatLng, to: LatLng): Promise<RouteSummary> {
    this.calls.push(to);
    const key = `${to.lat.toFixed(6)},${to.lng.toFixed(6)}`;
    return { distance_m: 1000, duration_s: this.eta.get(key) ?? 3000, provider: "mock" };
  }
}

let ctx: TestCtx;
afterEach(async () => ctx.close());

describe("nearest-charger ranking", () => {
  // 12 stations on a line going east, 200 m apart. ETA is deliberately NOT monotonic with distance.
  const pts = Array.from({ length: 12 }, (_, i) => offset(GANGNAM, 200 * (i + 1), 0));
  const etas = [900, 300, 600, 120, 1500, 1200, 450, 800, 700, 1000, 10, 20];
  const seed = fixtureSeed([
    ...pts.map((p, i) => station(`S${String(i + 1).padStart(2, "0")}`, p, [i === 2 ? { speed: "DC", connector: "DC_COMBO", power_kw: 100 } : {}])),
    station("FULL", offset(GANGNAM, 50, 0), [{}]), // nearest, but will be fully occupied
  ]);
  const key = (p: LatLng) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;

  async function setup() {
    const routing = new TableRouting(new Map(pts.map((p, i) => [key(p), etas[i]!])));
    ctx = await makeApp({ seed, routing });
    await allAvailable(ctx, seed);
    await ctx.app.inject({ method: "POST", url: "/debug/chargers/FULL-C1/status", payload: { status: "charging" } });
    routing.calls = [];
    return routing;
  }

  it("routes only the 10 straight-line nearest available stations and returns the top 3 by ETA", async () => {
    const routing = await setup();
    const res = await ctx.app.inject({ url: `/stations/nearest?lat=${GANGNAM.lat}&lng=${GANGNAM.lng}&origin_lat=${GANGNAM.lat}&origin_lng=${GANGNAM.lng}` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as NearestResult;
    expect(body.ranked_by).toBe("eta");
    expect(body.searched).toBe(10);
    expect(routing.calls).toHaveLength(10);
    // S11/S12 have the best ETAs but are the 11th/12th nearest, so they are never considered.
    // FULL is nearest but has nothing available.
    expect(body.results.map((r) => r.station.id)).toEqual(["S04", "S02", "S07"]);
    expect(body.results.map((r) => r.route?.duration_s)).toEqual([120, 300, 450]);
    for (const r of body.results) {
      expect(r.station.available_matching).toBeGreaterThan(0);
      expect(r.station.distance_m).toBeGreaterThan(0);
    }
  });

  it("applies the speed filter before choosing candidates", async () => {
    await setup();
    const body = (await ctx.app.inject({ url: `/stations/nearest?lat=${GANGNAM.lat}&lng=${GANGNAM.lng}&origin_lat=${GANGNAM.lat}&origin_lng=${GANGNAM.lng}&speed=DC` })).json() as NearestResult;
    expect(body.results.map((r) => r.station.id)).toEqual(["S03"]);
  });

  it("falls back to straight-line ranking without an origin and hides ETA", async () => {
    await setup();
    const body = (await ctx.app.inject({ url: `/stations/nearest?lat=${GANGNAM.lat}&lng=${GANGNAM.lng}` })).json() as NearestResult;
    expect(body.ranked_by).toBe("distance");
    expect(body.results.map((r) => r.station.id)).toEqual(["S01", "S02", "S03"]);
    expect(body.results.every((r) => r.route === null)).toBe(true);
  });

  it("uses mock routing = haversine × 1.3 at 22 km/h", async () => {
    const r = await new MockRoutingProvider().route(GANGNAM, offset(GANGNAM, 1000, 0));
    expect(r.distance_m).toBeCloseTo(1300, -1);
    expect(r.duration_s).toBeCloseTo(1300 / (22000 / 3600), 0);
  });
});

describe("nearby list", () => {
  const seed = fixtureSeed([
    station("A", offset(GANGNAM, 0, 900), [{}]),
    station("B", offset(GANGNAM, 0, 400), [{ speed: "DC", connector: "CHADEMO", power_kw: 50 }]),
    station("C", offset(GANGNAM, 0, 2500), [{}]),
    station("D", offset(GANGNAM, 0, 4000), [{}]),
  ]);

  it("filters by radius, sorts by distance and honours available_only and connector filters", async () => {
    ctx = await makeApp({ seed });
    await allAvailable(ctx, seed);
    await ctx.app.inject({ method: "POST", url: "/debug/chargers/A-C1/status", payload: { status: "out_of_order" } });
    const q = `lat=${GANGNAM.lat}&lng=${GANGNAM.lng}`;

    let body = (await ctx.app.inject({ url: `/stations?${q}&radius_m=3000` })).json() as StationList;
    expect(body.stations.map((s) => s.id)).toEqual(["B", "C"]);

    body = (await ctx.app.inject({ url: `/stations?${q}&radius_m=3000&available_only=false` })).json() as StationList;
    expect(body.stations.map((s) => s.id)).toEqual(["B", "A", "C"]);
    expect(body.stations[1]!.marker_status).toBe("unavailable");

    body = (await ctx.app.inject({ url: `/stations?${q}&radius_m=5000&connector=CHADEMO` })).json() as StationList;
    expect(body.stations.map((s) => s.id)).toEqual(["B"]);

    body = (await ctx.app.inject({ url: `/stations?${q}&radius_m=1000` })).json() as StationList;
    expect(body.stations.map((s) => s.id)).toEqual(["B"]);
  });

  it("validates query parameters with the standard error shape", async () => {
    ctx = await makeApp({ seed });
    const res = await ctx.app.inject({ url: `/stations?lat=abc&lng=1` });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: "VALIDATION_ERROR", message_ko: expect.any(String), message_en: expect.any(String) });
    const bad = await ctx.app.inject({ url: `/stations?lat=37.5&lng=127&connector=TESLA` });
    expect(bad.json().code).toBe("VALIDATION_ERROR");
  });
});
