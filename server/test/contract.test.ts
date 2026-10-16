import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { GANGNAM, makeApp, type TestCtx } from "./helpers.js";
import { renderMapPage } from "../src/map/page.js";

// Validates live responses against docs/openapi.yaml so the mock can't drift from the contract
// that a real backend will have to implement.
const spec = parse(readFileSync(new URL("../../docs/openapi.yaml", import.meta.url), "utf8"));
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats.default(ajv);
ajv.addSchema({ $id: "openapi.json", components: spec.components });
const check = (schema: string, data: unknown) => {
  const v = ajv.getSchema(`openapi.json#/components/schemas/${schema}`)!;
  const ok = v(data);
  if (!ok) throw new Error(`${schema}: ${ajv.errorsText(v.errors)}\n${JSON.stringify(data).slice(0, 500)}`);
};

let ctx: TestCtx;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => ctx.close());

const H = { "x-device-id": "contract-device-1" };

describe("responses conform to docs/openapi.yaml", () => {
  it("stations, nearest, detail, districts", async () => {
    const q = `lat=${GANGNAM.lat}&lng=${GANGNAM.lng}`;
    check("StationList", (await ctx.app.inject({ url: `/stations?${q}` })).json());
    const nearest = (await ctx.app.inject({ url: `/stations/nearest?${q}&origin_lat=${GANGNAM.lat}&origin_lng=${GANGNAM.lng}` })).json();
    check("NearestResult", nearest);
    check("StationDetail", (await ctx.app.inject({ url: `/stations/${nearest.results[0].station.id}` })).json());
    check("DistrictList", (await ctx.app.inject({ url: "/districts" })).json());
    check("DistrictStations", (await ctx.app.inject({ url: "/districts/11680/stations" })).json());
    check("Health", (await ctx.app.inject({ url: "/health" })).json());
  });

  it("reservations lifecycle and errors", async () => {
    const nearest = (await ctx.app.inject({ url: `/stations/nearest?lat=${GANGNAM.lat}&lng=${GANGNAM.lng}` })).json();
    const st = (await ctx.app.inject({ url: `/stations/${nearest.results[0].station.id}` })).json();
    const charger = st.chargers.find((c: { status: string }) => c.status === "available");
    const created = await ctx.app.inject({ method: "POST", url: "/reservations", headers: H, payload: { charger_id: charger.id } });
    expect(created.statusCode).toBe(201);
    check("ReservationEnvelope", created.json());
    check("ActiveReservationResponse", (await ctx.app.inject({ url: "/reservations/active", headers: H })).json());
    const detail = (await ctx.app.inject({ url: `/stations/${st.id}` })).json();
    check("StationDetail", detail);
    expect(detail.chargers.find((c: { id: string }) => c.id === charger.id).reservation).not.toBeNull();

    const conflict = await ctx.app.inject({ method: "POST", url: "/reservations", headers: { "x-device-id": "contract-device-2" }, payload: { charger_id: charger.id } });
    check("Error", conflict.json());
    const cancelled = await ctx.app.inject({ method: "POST", url: `/reservations/${created.json().reservation.id}/cancel`, headers: H });
    check("ReservationEnvelope", cancelled.json());
    check("ActiveReservationResponse", (await ctx.app.inject({ url: "/reservations/active", headers: H })).json());
    check("Error", (await ctx.app.inject({ url: "/stations/does-not-exist" })).json());
  });

  it("proxies and debug", async () => {
    check("PlaceSearchResult", (await ctx.app.inject({ url: `/places/search?q=${encodeURIComponent("잠실")}` })).json());
    check("RouteSummary", (await ctx.app.inject({ url: `/route?from=37.4979,127.0276&to=37.5133,127.1001` })).json());
    check("SimulatorState", (await ctx.app.inject({ url: "/debug/simulator" })).json());
    const map = await ctx.app.inject({ url: "/map?lang=en" });
    expect(map.headers["content-type"]).toMatch(/text\/html/);
    expect(map.body).toContain("leaflet");
    const leaflet = await ctx.app.inject({ url: "/static/leaflet/leaflet.js" });
    expect(leaflet.statusCode).toBe(200);
  });

  it("serves the Seoul district boundaries", async () => {
    const res = await ctx.app.inject({ url: "/static/geo/seoul-districts.geojson" });
    expect(res.statusCode).toBe(200);
    const geo = res.json();
    const seed = JSON.parse(readFileSync(new URL("../seed/districts.json", import.meta.url), "utf8")) as { districts: { code: string }[] };
    const codes = geo.features.map((f: { properties: { SIG_CD: string } }) => f.properties.SIG_CD);
    expect(new Set(codes)).toEqual(new Set(seed.districts.map((d) => d.code)));
    check("MapInboundMessage", {
      type: "setDistricts",
      fit: true,
      districts: [{ code: "11680", status: "available", selected: true, a11y: "Gangnam-gu, 3/10 available" }],
    });
    check("MapOutboundMessage", { type: "districtPress", code: "11680" });
  });

  it("map page moves the search pin on tap for both providers", () => {
    check("MapInboundMessage", { type: "setPin", lat: 37.5, lng: 127, a11y: "Search pin" });
    check("MapOutboundMessage", { type: "mapClick", lat: 37.5, lng: 127 });
    for (const provider of ["mock", "kakao"] as const) {
      const html = renderMapPage({ provider, kakaoJsKey: "k", lang: "ko" });
      const script = html.match(/<script>\n([\s\S]*?)<\/script>/)![1];
      expect(() => new Function(script)).not.toThrow();
      expect(script).toContain('"mapClick"');
      expect(script).not.toContain("draggable: true");
      expect(script).toContain('"districtPress"');
      expect(script).toContain(provider === "kakao" ? "kakao.maps.Polygon" : "L.geoJSON");
      expect(script).toContain(provider === "kakao" ? "overlay(pinHtml(m)" : "interactive: false");
      expect(script).toContain('fill="#2563eb"');
      expect(script).not.toContain("\\uD83D\\uDCCD");
      expect(script).not.toContain("kakao.maps.Marker");
      expect(html).toContain('aria-live="polite"');
    }
  });

  it("debug endpoints are disabled unless DEBUG_ENDPOINTS=true", async () => {
    const prod = await makeApp({}, { DEBUG_ENDPOINTS: "false" });
    expect((await prod.app.inject({ url: "/debug/simulator" })).statusCode).toBe(404);
    await prod.close();
  });
});
