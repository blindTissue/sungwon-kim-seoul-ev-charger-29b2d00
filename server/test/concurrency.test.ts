import { afterEach, describe, expect, it } from "vitest";
import type { ErrorBody, LatLng, RouteSummary } from "@seoul-ev/shared";
import type { RoutingProvider } from "../src/providers/routing.js";
import { MockRoutingProvider } from "../src/providers/routing.js";
import { allAvailable, dev, fixtureSeed, GANGNAM, makeApp, offset, station, type TestCtx } from "./helpers.js";

/** Mock routing with random latency so concurrent requests interleave between the checks and the write. */
class JitterRouting implements RoutingProvider {
  readonly name = "mock" as const;
  private inner = new MockRoutingProvider();
  async route(a: LatLng, b: LatLng): Promise<RouteSummary> {
    await new Promise((r) => setTimeout(r, Math.random() * 20));
    return this.inner.route(a, b);
  }
}

const seed = fixtureSeed([station("RACE", offset(GANGNAM, 300, 0), [{}, {}])]);
let ctx: TestCtx;
afterEach(async () => ctx.close());

describe("concurrent reservation", () => {
  it("exactly one of many simultaneous requests for the same charger wins; the rest get 409 ALREADY_RESERVED", async () => {
    ctx = await makeApp({ seed, routing: new JitterRouting() });
    await allAvailable(ctx, seed);

    const N = 25;
    const results = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        ctx.app.inject({ method: "POST", url: "/reservations", headers: dev(i), payload: { charger_id: "RACE-C1", origin_lat: GANGNAM.lat, origin_lng: GANGNAM.lng } }),
      ),
    );
    const ok = results.filter((r) => r.statusCode === 201);
    const conflicts = results.filter((r) => r.statusCode === 409);
    expect(ok).toHaveLength(1);
    expect(conflicts).toHaveLength(N - 1);
    for (const r of conflicts) expect((r.json() as ErrorBody).code).toBe("ALREADY_RESERVED");

    // The other charger is untouched and the database holds exactly one active reservation.
    const st = (await ctx.app.inject({ url: "/stations/RACE" })).json();
    expect(st.summary.reserved).toBe(1);
    expect(st.summary.available).toBe(1);
  });

  it("one device racing for two chargers ends up with exactly one reservation", async () => {
    ctx = await makeApp({ seed, routing: new JitterRouting() });
    await allAvailable(ctx, seed);
    const results = await Promise.all(
      ["RACE-C1", "RACE-C2", "RACE-C1", "RACE-C2"].map((id) => ctx.app.inject({ method: "POST", url: "/reservations", headers: dev(7), payload: { charger_id: id } })),
    );
    expect(results.filter((r) => r.statusCode === 201)).toHaveLength(1);
    const st = (await ctx.app.inject({ url: "/stations/RACE" })).json();
    expect(st.summary.reserved).toBe(1);
  });
});
