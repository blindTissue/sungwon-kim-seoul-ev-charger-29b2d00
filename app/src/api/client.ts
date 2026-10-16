import type {
  ActiveReservationResponse,
  ChargerSpeed,
  ConnectorType,
  DistrictList,
  DistrictStations,
  ErrorBody,
  Health,
  LatLng,
  NearestResult,
  PlaceSearchResult,
  ReservationEnvelope,
  RouteSummary,
  StationDetail,
  StationList,
} from "@seoul-ev/shared";
import Constants from "expo-constants";
import { Platform } from "react-native";

/** Thrown for non-2xx responses (body follows the API's Error shape) and for network failures. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: ErrorBody | null,
    readonly network = false,
  ) {
    super(body?.message_en ?? (network ? "Network error" : `HTTP ${status}`));
  }
}

let overrideBaseUrl: string | null = null;
let deviceId: string | null = null;

export function setApiBaseUrl(url: string | null): void {
  overrideBaseUrl = url ? url.replace(/\/+$/, "") : null;
}
export function setDeviceId(id: string): void {
  deviceId = id;
}

/**
 * Backend URL: Settings override > EXPO_PUBLIC_API_URL > same host as the Expo dev server on
 * port 3000 (works for Expo Go on the same LAN) > localhost.
 */
export function defaultApiBaseUrl(): string {
  const env = process.env.EXPO_PUBLIC_API_URL;
  if (env) return env.replace(/\/+$/, "");
  if (Platform.OS === "web" && typeof window !== "undefined") return `${window.location.protocol}//${window.location.hostname}:3000`;
  const hostUri = Constants.expoConfig?.hostUri;
  const host = hostUri?.split(":")[0];
  if (host && !host.includes("exp.direct")) return `http://${host}:3000`;
  return "http://localhost:3000";
}

export function apiBaseUrl(): string {
  return overrideBaseUrl ?? defaultApiBaseUrl();
}

type Query = Record<string, string | number | boolean | undefined | null>;

async function request<T>(method: "GET" | "POST" | "DELETE", path: string, opts: { query?: Query; body?: unknown } = {}): Promise<T> {
  const qs = Object.entries(opts.query ?? {})
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
  const url = `${apiBaseUrl()}${path}${qs ? `?${qs}` : ""}`;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (deviceId) headers["X-Device-Id"] = deviceId;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  let res: Response;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10_000);
    res = await fetch(url, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body), signal: ctrl.signal });
    clearTimeout(timer);
  } catch {
    throw new ApiError(0, null, true);
  }
  if (res.status === 204) return undefined as T;
  const json = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) throw new ApiError(res.status, (json as ErrorBody) ?? null);
  return json as T;
}

export interface FilterParams {
  speed?: ChargerSpeed;
  connectors?: ConnectorType[];
}
const filterQuery = (f: FilterParams) => ({ speed: f.speed, connector: f.connectors?.length ? f.connectors.join(",") : undefined });

export const api = {
  health: () => request<Health>("GET", "/health"),
  stations: (center: LatLng, radiusM: number, f: FilterParams, availableOnly: boolean) =>
    request<StationList>("GET", "/stations", { query: { lat: center.lat, lng: center.lng, radius_m: radiusM, available_only: availableOnly, ...filterQuery(f) } }),
  nearest: (center: LatLng, origin: LatLng | null, f: FilterParams) =>
    request<NearestResult>("GET", "/stations/nearest", {
      query: { lat: center.lat, lng: center.lng, origin_lat: origin?.lat, origin_lng: origin?.lng, ...filterQuery(f) },
    }),
  station: (id: string) => request<StationDetail>("GET", `/stations/${encodeURIComponent(id)}`),
  districts: () => request<DistrictList>("GET", "/districts"),
  districtStations: (code: string) => request<DistrictStations>("GET", `/districts/${encodeURIComponent(code)}/stations`),
  route: (from: LatLng, to: LatLng, geometry = false) =>
    request<RouteSummary>("GET", "/route", { query: { from: `${from.lat},${from.lng}`, to: `${to.lat},${to.lng}`, geometry: geometry || undefined } }),
  searchPlaces: (q: string) => request<PlaceSearchResult>("GET", "/places/search", { query: { q } }),
  reserve: (chargerId: string, origin: LatLng | null) =>
    request<ReservationEnvelope>("POST", "/reservations", { body: { charger_id: chargerId, ...(origin ? { origin_lat: origin.lat, origin_lng: origin.lng } : {}) } }),
  activeReservation: () => request<ActiveReservationResponse>("GET", "/reservations/active"),
  cancel: (id: string) => request<ReservationEnvelope>("POST", `/reservations/${encodeURIComponent(id)}/cancel`),
  arrive: (id: string) => request<ReservationEnvelope>("POST", `/reservations/${encodeURIComponent(id)}/arrive`),
  mapUrl: (lang: "ko" | "en") => `${apiBaseUrl()}/map?lang=${lang}`,
};
