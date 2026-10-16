import { Ajv2020 } from "ajv/dist/2020.js";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { renderMapPage } from "../src/map/page.js";
import { KakaoRoutingProvider, MAX_PATH_POINTS, thinPath } from "../src/providers/routing.js";
import { GANGNAM, makeApp, offset, type TestCtx } from "./helpers.js";

const spec = parse(readFileSync(new URL("../../docs/openapi.yaml", import.meta.url), "utf8"));
const ajv = new Ajv2020({ strict: false, allErrors: true });
ajv.addSchema({ $id: "openapi.json", components: spec.components });
const validRoute = ajv.getSchema("openapi.json#/components/schemas/RouteSummary")!;

let ctx: TestCtx;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => ctx.close());

const TO = offset(GANGNAM, 1200, 800);
const q = `from=${GANGNAM.lat},${GANGNAM.lng}&to=${TO.lat},${TO.lng}`;

describe("GET /route geometry", () => {
  it("omits the path unless geometry=true", async () => {
    const r = (await ctx.app.inject({ url: `/route?${q}` })).json();
    expect(r.path).toBeUndefined();
    expect(validRoute(r)).toBe(true);
  });

  it("returns a [lat, lng] polyline from origin to destination (mock)", async () => {
    const r = (await ctx.app.inject({ url: `/route?${q}&geometry=true` })).json();
    expect(validRoute(r)).toBe(true);
    expect(r.path.length).toBeGreaterThanOrEqual(2);
    expect(r.path[0]).toEqual([GANGNAM.lat, GANGNAM.lng]);
    expect(r.path.at(-1)).toEqual([TO.lat, TO.lng]);
    // Same summary as the geometry-less call.
    const plain = (await ctx.app.inject({ url: `/route?${q}` })).json();
    expect([r.distance_m, r.duration_s]).toEqual([plain.distance_m, plain.duration_s]);
  });
});

describe("KakaoRoutingProvider geometry", () => {
  const body = {
    routes: [
      {
        result_code: 0,
        summary: { distance: 2100, duration: 420 },
        sections: [
          { roads: [{ vertexes: [127.0276, 37.4979, 127.03, 37.499] }, { vertexes: [127.03, 37.499, 127.035, 37.5007] }] },
          { roads: [{ vertexes: [127.036, 37.501] }] },
        ],
      },
    ],
  };

  it("flattens sections[].roads[].vertexes into deduplicated [lat, lng] pairs", async () => {
    const urls: string[] = [];
    const fake = (async (url: URL) => {
      urls.push(String(url));
      return new Response(JSON.stringify(body), { status: 200 });
    }) as unknown as typeof fetch;
    const p = new KakaoRoutingProvider("k", fake);
    const r = await p.route(GANGNAM, TO, { geometry: true });
    expect(r).toMatchObject({ distance_m: 2100, duration_s: 420, provider: "kakao" });
    expect(r.path).toEqual([
      [37.4979, 127.0276],
      [37.499, 127.03],
      [37.5007, 127.035],
      [37.501, 127.036],
    ]);
    expect(validRoute(r)).toBe(true);
    expect(urls[0]).toContain("summary=false");

    // Summary-only calls are cached separately and never carry a path.
    const s = await p.route(GANGNAM, TO);
    expect(s.path).toBeUndefined();
    expect(urls[1]).toContain("summary=true");
    await p.route(GANGNAM, TO, { geometry: true });
    expect(urls).toHaveLength(2);
  });

  it("caps very long polylines but keeps both ends", () => {
    const long = Array.from({ length: 5000 }, (_, i) => [37 + i / 1e5, 127 + i / 1e5] as [number, number]);
    const thin = thinPath(long);
    expect(thin).toHaveLength(MAX_PATH_POINTS);
    expect(thin[0]).toEqual(long[0]);
    expect(thin.at(-1)).toEqual(long.at(-1));
  });
});

describe("map page", () => {
  it("implements setRoute for both the Kakao and the mock (Leaflet) map", () => {
    for (const provider of ["kakao", "mock"] as const) {
      const html = renderMapPage({ provider, kakaoJsKey: "x", lang: "ko" });
      expect(html).toContain("setRoute:");
    }
    expect(renderMapPage({ provider: "kakao", kakaoJsKey: "x", lang: "ko" })).toContain("kakao.maps.Polyline");
    expect(renderMapPage({ provider: "mock", kakaoJsKey: null, lang: "ko" })).toContain("L.polyline");
  });
});
