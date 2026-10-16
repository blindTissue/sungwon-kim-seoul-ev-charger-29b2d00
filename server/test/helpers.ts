import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createContainer, type Container, type ContainerOverrides } from "../src/container.js";
import { FakeClock } from "../src/domain/clock.js";
import type { SeedData, SeedStation } from "../src/repositories/mock/db.js";

export const GANGNAM = { lat: 37.49795, lng: 127.02762 };

/** Point `dx` metres east and `dy` metres north of `p`. */
export function offset(p: { lat: number; lng: number }, dx: number, dy: number) {
  return { lat: p.lat + dy / 111_320, lng: p.lng + dx / (111_320 * Math.cos((p.lat * Math.PI) / 180)) };
}

export function station(id: string, at: { lat: number; lng: number }, chargers: Partial<SeedStation["chargers"][number]>[], district = "11680"): SeedStation {
  return {
    id,
    name_ko: `테스트 ${id}`,
    name_en: `Test ${id}`,
    address_ko: "서울특별시 강남구",
    address_en: "Gangnam-gu, Seoul",
    district_code: district,
    lat: at.lat,
    lng: at.lng,
    lot_type: "public",
    site_type: "public_parking",
    operator_note_ko: "",
    operator_note_en: "",
    open_hours: "00:00-24:00",
    parking_fee_note_ko: "",
    parking_fee_note_en: "",
    chargers: chargers.map((c, i) => ({ id: `${id}-C${i + 1}`, speed: "AC", connector: "AC_TYPE1", power_kw: 7, price_per_kwh_krw: 255.7, ...c })),
  };
}

export function fixtureSeed(stations: SeedStation[]): SeedData {
  return {
    stations,
    districts: [
      { code: "11680", name_ko: "강남구", name_en: "Gangnam-gu", center: GANGNAM, bbox: { south: 37.46, west: 127.01, north: 37.54, east: 127.1 } },
      { code: "11650", name_ko: "서초구", name_en: "Seocho-gu", center: GANGNAM, bbox: { south: 37.43, west: 126.98, north: 37.52, east: 127.09 } },
    ],
    hash: `fixture-${Math.random()}`,
  };
}

export interface TestCtx {
  app: FastifyInstance;
  container: Container;
  clock: FakeClock;
  close: () => Promise<void>;
}

export async function makeApp(overrides: ContainerOverrides = {}, env: Record<string, string> = {}): Promise<TestCtx> {
  const config = loadConfig({ DEBUG_ENDPOINTS: "true", SIM_ENABLED: "false", DB_PATH: ":memory:", ...env });
  const clock = new FakeClock();
  const container = createContainer(config, clock, overrides);
  const app = await buildApp(config, container);
  return {
    app,
    container,
    clock,
    close: async () => {
      await app.close();
      container.close();
    },
  };
}

/** Forces every charger in the fixture to `available` (the simulator randomizes on seed load). */
export async function allAvailable(ctx: TestCtx, seed: SeedData): Promise<void> {
  for (const s of seed.stations) {
    for (const c of s.chargers) {
      const res = await ctx.app.inject({ method: "POST", url: `/debug/chargers/${c.id}/status`, payload: { status: "available" } });
      if (res.statusCode !== 200) throw new Error(`force status failed: ${res.body}`);
    }
  }
}

export function dev(n: number | string): Record<string, string> {
  return { "x-device-id": `device-${String(n).padStart(4, "0")}` };
}
