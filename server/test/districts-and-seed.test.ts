import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AvailabilitySummary, DistrictList, DistrictStations, NearestResult, PlaceSearchResult, StationList } from "@seoul-ev/shared";
import { loadSeed } from "../src/repositories/mock/db.js";
import { GANGNAM, makeApp, type TestCtx } from "./helpers.js";

const ZERO: AvailabilitySummary = { total: 0, available: 0, reserved: 0, charging: 0, out_of_order: 0, unknown: 0, dc_total: 0, dc_available: 0, ac_total: 0, ac_available: 0 };
const add = (a: AvailabilitySummary, b: AvailabilitySummary) =>
  Object.fromEntries(Object.keys(a).map((k) => [k, a[k as keyof AvailabilitySummary] + b[k as keyof AvailabilitySummary]])) as unknown as AvailabilitySummary;

let ctx: TestCtx;
beforeAll(async () => {
  ctx = await makeApp();
  // Put some chargers in a reserved state so aggregation covers every status.
  await ctx.app.inject({ method: "POST", url: "/reservations", headers: { "x-device-id": "agg-device-1" }, payload: { charger_id: "ST11680-01-C1" } });
});
afterAll(async () => ctx.close());

describe("seed data", () => {
  const seed = loadSeed();

  it("has ~200 stations across all 25 districts with 2–8 chargers each and ~30% DC", () => {
    expect(seed.stations.length).toBeGreaterThanOrEqual(180);
    expect(seed.stations.length).toBeLessThanOrEqual(220);
    expect(new Set(seed.stations.map((s) => s.district_code)).size).toBe(25);
    expect(seed.districts).toHaveLength(25);
    for (const s of seed.stations) {
      expect(s.chargers.length).toBeGreaterThanOrEqual(2);
      expect(s.chargers.length).toBeLessThanOrEqual(8);
    }
    const all = seed.stations.flatMap((s) => s.chargers);
    const dc = all.filter((c) => c.speed === "DC").length / all.length;
    expect(dc).toBeGreaterThan(0.25);
    expect(dc).toBeLessThan(0.35);
  });

  it("has bilingual names/addresses and coordinates inside Seoul", () => {
    const ids = new Set<string>();
    for (const s of seed.stations) {
      expect(ids.has(s.id)).toBe(false);
      ids.add(s.id);
      for (const f of ["name_ko", "name_en", "address_ko", "address_en", "parking_fee_note_ko", "parking_fee_note_en"] as const) expect(s[f].length).toBeGreaterThan(0);
      expect(s.name_en).not.toMatch(/[가-힣]/);
      expect(s.address_en).not.toMatch(/[가-힣]/);
      expect(s.lat).toBeGreaterThan(37.41);
      expect(s.lat).toBeLessThan(37.72);
      expect(s.lng).toBeGreaterThan(126.76);
      expect(s.lng).toBeLessThan(127.19);
      const d = seed.districts.find((x) => x.code === s.district_code)!;
      expect(s.lat).toBeGreaterThanOrEqual(d.bbox.south);
      expect(s.lat).toBeLessThanOrEqual(d.bbox.north);
      expect(s.lng).toBeGreaterThanOrEqual(d.bbox.west);
      expect(s.lng).toBeLessThanOrEqual(d.bbox.east);
    }
  });
});

describe("district aggregation", () => {
  it("returns all 25 districts and each summary equals the sum of its stations", async () => {
    const { districts } = (await ctx.app.inject({ url: "/districts" })).json() as DistrictList;
    expect(districts).toHaveLength(25);
    let grand = ZERO;
    for (const d of districts) {
      const body = (await ctx.app.inject({ url: `/districts/${d.code}/stations` })).json() as DistrictStations;
      expect(body.stations.length).toBe(d.station_count);
      const sum = body.stations.reduce((acc, s) => add(acc, s.summary), ZERO);
      expect(sum).toEqual(d.summary);
      expect(d.summary.total).toBe(d.summary.dc_total + d.summary.ac_total);
      expect(d.summary.total).toBe(d.summary.available + d.summary.reserved + d.summary.charging + d.summary.out_of_order + d.summary.unknown);
      expect(d.summary.available).toBe(d.summary.dc_available + d.summary.ac_available);
      grand = add(grand, d.summary);
    }
    expect(grand.total).toBe(loadSeed().stations.reduce((n, s) => n + s.chargers.length, 0));
    expect(grand.reserved).toBeGreaterThanOrEqual(1);
  });

  it("returns 404 for an unknown district", async () => {
    expect((await ctx.app.inject({ url: "/districts/99999/stations" })).statusCode).toBe(404);
  });
});

describe("demo scenarios on the real seed (mock providers)", () => {
  it("finds a nearest station near 강남역 with ETA, distance and availability quickly", async () => {
    const t0 = performance.now();
    const res = await ctx.app.inject({ url: `/stations/nearest?lat=${GANGNAM.lat}&lng=${GANGNAM.lng}&origin_lat=${GANGNAM.lat}&origin_lng=${GANGNAM.lng}` });
    const ms = performance.now() - t0;
    const body = res.json() as NearestResult;
    expect(body.results.length).toBeGreaterThan(0);
    const top = body.results[0]!;
    expect(top.route!.duration_s).toBeLessThan(600);
    expect(top.station.available_matching).toBeGreaterThan(0);
    expect(ms).toBeLessThan(2000);
  });

  it("searching 서울역 and listing around it returns stations near Seoul Station", async () => {
    const places = (await ctx.app.inject({ url: `/places/search?q=${encodeURIComponent("서울역")}` })).json() as PlaceSearchResult;
    const p = places.places[0]!;
    expect(p.name_ko).toBe("서울역");
    const list = (await ctx.app.inject({ url: `/stations?lat=${p.lat}&lng=${p.lng}&radius_m=3000&available_only=false` })).json() as StationList;
    expect(list.stations.length).toBeGreaterThan(2);
    expect(list.stations[0]!.distance_m!).toBeLessThan(1500);
    expect(list.stations.every((s) => s.distance_m! <= 3000)).toBe(true);
  });

  it("mock place search matches English and partial queries", async () => {
    const en = (await ctx.app.inject({ url: `/places/search?q=gangnam` })).json() as PlaceSearchResult;
    expect(en.places[0]!.name_ko).toBe("강남역");
    const partial = (await ctx.app.inject({ url: `/places/search?q=${encodeURIComponent("홍대")}` })).json() as PlaceSearchResult;
    expect(partial.places[0]!.name_ko).toBe("홍대입구역");
  });
});
