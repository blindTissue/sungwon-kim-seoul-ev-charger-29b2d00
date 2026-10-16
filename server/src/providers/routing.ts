import type { LatLng, RouteSummary } from "@seoul-ev/shared";
import { DomainError } from "../domain/errors.js";
import { haversineM } from "../domain/geo.js";

export interface RouteOptions {
  /** Include the polyline as `path` ([lat, lng] pairs). */
  geometry?: boolean;
}

export interface RoutingProvider {
  readonly name: "kakao" | "mock";
  route(from: LatLng, to: LatLng, opts?: RouteOptions): Promise<RouteSummary>;
}

/** Caps polyline size for the app/WebView bridge; keeps the first and last points. */
export const MAX_PATH_POINTS = 1500;
export function thinPath(path: [number, number][]): [number, number][] {
  if (path.length <= MAX_PATH_POINTS) return path;
  const step = (path.length - 1) / (MAX_PATH_POINTS - 1);
  return Array.from({ length: MAX_PATH_POINTS }, (_, i) => path[Math.round(i * step)]!);
}

/** §3: distance = haversine × 1.3, duration at an average of 22 km/h. */
export class MockRoutingProvider implements RoutingProvider {
  readonly name = "mock" as const;
  static readonly DETOUR = 1.3;
  static readonly SPEED_MPS = 22_000 / 3600;

  async route(from: LatLng, to: LatLng, opts: RouteOptions = {}): Promise<RouteSummary> {
    const distance_m = Math.round(haversineM(from, to) * MockRoutingProvider.DETOUR);
    const summary: RouteSummary = { distance_m, duration_s: Math.round(distance_m / MockRoutingProvider.SPEED_MPS), provider: "mock" };
    if (!opts.geometry) return summary;
    // A street-grid style "L": along the latitude first, then the longitude.
    const path: [number, number][] =
      distance_m === 0 ? [[from.lat, from.lng], [to.lat, to.lng]] : [[from.lat, from.lng], [from.lat, to.lng], [to.lat, to.lng]];
    return { ...summary, path };
  }
}

interface KakaoDirections {
  routes?: {
    result_code: number;
    result_msg?: string;
    summary?: { distance: number; duration: number };
    sections?: { roads?: { vertexes?: number[] }[] }[];
  }[];
}

/** Kakao vertexes are flat [x1, y1, x2, y2, …] = [lng, lat, …]; returns [lat, lng] pairs. */
export function kakaoPath(r: NonNullable<KakaoDirections["routes"]>[number]): [number, number][] {
  const out: [number, number][] = [];
  for (const section of r.sections ?? [])
    for (const road of section.roads ?? []) {
      const v = road.vertexes ?? [];
      for (let i = 0; i + 1 < v.length; i += 2) {
        const p: [number, number] = [v[i + 1]!, v[i]!];
        const last = out[out.length - 1];
        if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p);
      }
    }
  return thinPath(out);
}

/** Kakao Mobility Directions (car). https://developers.kakaomobility.com/docs/navi-api/directions/ */
export class KakaoRoutingProvider implements RoutingProvider {
  readonly name = "kakao" as const;
  private cache = new Map<string, { at: number; value: RouteSummary }>();

  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly ttlMs = 60_000,
  ) {}

  async route(from: LatLng, to: LatLng, opts: RouteOptions = {}): Promise<RouteSummary> {
    const geometry = !!opts.geometry;
    const key = [from.lat, from.lng, to.lat, to.lng].map((n) => n.toFixed(4)).join(",") + (geometry ? ":g" : "");
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < this.ttlMs) return hit.value;

    const url = new URL("https://apis-navi.kakaomobility.com/v1/directions");
    url.searchParams.set("origin", `${from.lng},${from.lat}`);
    url.searchParams.set("destination", `${to.lng},${to.lat}`);
    url.searchParams.set("priority", "RECOMMEND");
    url.searchParams.set("summary", geometry ? "false" : "true");
    let body: KakaoDirections;
    try {
      const res = await this.fetchImpl(url, { headers: { Authorization: `KakaoAK ${this.apiKey}` }, signal: AbortSignal.timeout(4000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      body = (await res.json()) as KakaoDirections;
    } catch (e) {
      throw new DomainError("UPSTREAM_ERROR", { provider: "kakao", reason: e instanceof Error ? e.message : String(e) });
    }
    const r = body.routes?.[0];
    if (!r) throw new DomainError("UPSTREAM_ERROR", { provider: "kakao", reason: "no route" });
    // result_code 104: origin and destination are too close (<5 m) — treat as zero.
    const value: RouteSummary =
      r.result_code === 0 && r.summary
        ? { distance_m: r.summary.distance, duration_s: r.summary.duration, provider: "kakao", ...(geometry ? { path: kakaoPath(r) } : {}) }
        : r.result_code === 104
          ? { distance_m: 0, duration_s: 0, provider: "kakao", ...(geometry ? { path: [[from.lat, from.lng], [to.lat, to.lng]] as [number, number][] } : {}) }
          : (() => {
              throw new DomainError("UPSTREAM_ERROR", { provider: "kakao", reason: r.result_msg ?? `result_code ${r.result_code}` });
            })();
    this.cache.set(key, { at: Date.now(), value });
    return value;
  }
}
