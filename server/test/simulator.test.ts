import { describe, expect, it } from "vitest";
import { FakeClock } from "../src/domain/clock.js";
import { createMockBackend } from "../src/repositories/mock/index.js";
import { targetOccupancy } from "../src/repositories/mock/simulator.js";

const statuses = (db: ReturnType<typeof createMockBackend>["db"]) =>
  db.prepare("SELECT id, status FROM chargers ORDER BY id").all() as { id: string; status: string }[];
const share = (rows: { status: string }[], s: string) => rows.filter((r) => r.status === s).length / rows.length;

// 2026-10-14 is a Wednesday. 09:00 KST = 00:00Z.
const WED_0900_KST = Date.parse("2026-10-14T00:00:00Z");
const WED_0300_KST = Date.parse("2026-10-13T18:00:00Z");

function backend(seed: number, start = WED_0900_KST) {
  const clock = new FakeClock(start);
  return createMockBackend({ dbPath: ":memory:", clock, simSeed: seed, simSpeed: 10, simTickMs: 30_000 });
}

describe("availability simulator", () => {
  it("is reproducible for the same SIM_SEED", () => {
    const a = backend(7);
    const b = backend(7);
    for (let i = 0; i < 50; i++) {
      a.simulator.tick();
      b.simulator.tick();
    }
    expect(statuses(a.db)).toEqual(statuses(b.db));
    const c = backend(8);
    for (let i = 0; i < 50; i++) c.simulator.tick();
    expect(statuses(c.db)).not.toEqual(statuses(a.db));
    [a, b, c].forEach((x) => x.close());
  });

  it("follows the time-of-day profile (busier at 09:00 than 03:00, business districts busier on weekdays)", () => {
    expect(targetOccupancy(WED_0900_KST, "11680")).toBeGreaterThan(targetOccupancy(WED_0900_KST, "11320"));
    expect(targetOccupancy(WED_0900_KST, "11320")).toBeGreaterThan(targetOccupancy(WED_0300_KST, "11320") * 3);
    const morning = backend(1, WED_0900_KST);
    const night = backend(1, WED_0300_KST);
    expect(share(statuses(morning.db), "charging")).toBeGreaterThan(share(statuses(night.db), "charging") + 0.25);
    morning.close();
    night.close();
  });

  it("keeps ~3% out_of_order and ~1% unknown over time", () => {
    const b = backend(3);
    let ooo = 0;
    let unk = 0;
    const N = 240;
    for (let i = 0; i < N; i++) {
      b.simulator.tick();
      const rows = statuses(b.db);
      ooo += share(rows, "out_of_order");
      unk += share(rows, "unknown");
    }
    expect(ooo / N).toBeGreaterThan(0.015);
    expect(ooo / N).toBeLessThan(0.05);
    expect(unk / N).toBeGreaterThan(0.003);
    expect(unk / N).toBeLessThan(0.025);
    b.close();
  });

  it("never changes a reserved charger", async () => {
    const clock = new FakeClock(WED_0900_KST);
    const b = createMockBackend({ dbPath: ":memory:", clock, simSeed: 5, simSpeed: 100, simTickMs: 30_000 });
    const free = b.db.prepare("SELECT id FROM chargers WHERE status = 'available' ORDER BY id LIMIT 5").all() as { id: string }[];
    for (const [i, c] of free.entries()) {
      await b.reservations.create({ chargerId: c.id, deviceId: `dev-sim-${i}`, now: clock.now(), expiresAt: clock.now() + 600_000 });
    }
    for (let i = 0; i < 300; i++) b.simulator.tick();
    for (const c of free) expect((await b.stations.getCharger(c.id))!.status).toBe("reserved");
    b.close();
  });

  it("ends DC sessions within ~25–60 simulated minutes", () => {
    const b = backend(11);
    const t0 = b.simulator.now;
    const ends = b.db.prepare("SELECT c.sim_session_end AS e FROM chargers c WHERE c.status = 'charging' AND c.speed = 'DC'").all() as { e: number }[];
    for (const { e } of ends) expect(e - t0).toBeLessThanOrEqual(60 * 60_000);
    b.close();
  });
});
