import type {
  AvailabilitySummary,
  Charger,
  ChargerSpeed,
  ConnectorType,
  District,
  LatLng,
  MarkerStatus,
  NearestResult,
  StationBase,
  StationDetail,
  StationSummary,
} from "@seoul-ev/shared";
import type { Clock } from "../domain/clock.js";
import { iso } from "../domain/clock.js";
import { DomainError } from "../domain/errors.js";
import { haversineM } from "../domain/geo.js";
import type { RoutingProvider } from "../providers/routing.js";
import type { ChargerRecord, DistrictRecord, StationRecord, StationRepository, StationWithChargers } from "../repositories/types.js";

export interface ChargerFilter {
  speed?: ChargerSpeed;
  connectors?: ConnectorType[];
}

export const NEAREST_CANDIDATES = 10;
export const NEAREST_RESULTS = 3;

export function matchesFilter(c: Pick<ChargerRecord, "speed" | "connector">, f: ChargerFilter): boolean {
  if (f.speed && c.speed !== f.speed) return false;
  if (f.connectors?.length && !f.connectors.includes(c.connector)) return false;
  return true;
}

export function summarize(chargers: Pick<ChargerRecord, "speed" | "status">[]): AvailabilitySummary {
  const s: AvailabilitySummary = { total: 0, available: 0, reserved: 0, charging: 0, out_of_order: 0, unknown: 0, dc_total: 0, dc_available: 0, ac_total: 0, ac_available: 0 };
  for (const c of chargers) {
    s.total++;
    s[c.status]++;
    if (c.speed === "DC") {
      s.dc_total++;
      if (c.status === "available") s.dc_available++;
    } else {
      s.ac_total++;
      if (c.status === "available") s.ac_available++;
    }
  }
  return s;
}

export function addSummaries(a: AvailabilitySummary, b: AvailabilitySummary): AvailabilitySummary {
  const out = { ...a };
  for (const k of Object.keys(b) as (keyof AvailabilitySummary)[]) out[k] += b[k];
  return out;
}

/** §6: green if ≥1 available; amber if none available but ≥1 reserved; gray otherwise. */
export function markerStatus(s: AvailabilitySummary): MarkerStatus {
  if (s.available > 0) return "available";
  if (s.reserved > 0) return "reserved";
  return "unavailable";
}

export function toBase(s: StationRecord): StationBase {
  return {
    id: s.id,
    name_ko: s.name_ko,
    name_en: s.name_en,
    address_ko: s.address_ko,
    address_en: s.address_en,
    district_code: s.district_code,
    lat: s.lat,
    lng: s.lng,
    lot_type: s.lot_type,
    site_type: s.site_type,
  };
}

export class StationService {
  constructor(
    private readonly repo: StationRepository,
    private readonly routing: RoutingProvider,
    private readonly clock: Clock,
    /** Runs pending reservation expiries before reads so statuses are never stale. */
    private readonly beforeRead: () => Promise<void> = async () => {},
  ) {}

  toCharger(c: ChargerRecord): Charger {
    const now = this.clock.now();
    return {
      id: c.id,
      station_id: c.station_id,
      speed: c.speed,
      connector: c.connector,
      power_kw: c.power_kw,
      price_per_kwh_krw: c.price_per_kwh_krw,
      status: c.status,
      status_updated_at: iso(c.status_updated_at),
      reservation:
        c.status === "reserved" && c.reservation_expires_at !== null
          ? { expires_at: iso(c.reservation_expires_at), remaining_s: Math.max(0, Math.ceil((c.reservation_expires_at - now) / 1000)) }
          : null,
    };
  }

  toSummary(sw: StationWithChargers, filter: ChargerFilter = {}, from?: LatLng): StationSummary {
    const summary = summarize(sw.chargers);
    return {
      ...toBase(sw.station),
      summary,
      marker_status: markerStatus(summary),
      available_matching: sw.chargers.filter((c) => c.status === "available" && matchesFilter(c, filter)).length,
      connectors: [...new Set(sw.chargers.map((c) => c.connector))],
      max_power_kw: Math.max(0, ...sw.chargers.map((c) => c.power_kw)),
      distance_m: from ? Math.round(haversineM(from, sw.station)) : null,
    };
  }

  async nearby(center: LatLng, radiusM: number, filter: ChargerFilter, availableOnly: boolean): Promise<StationSummary[]> {
    await this.beforeRead();
    const found = await this.repo.findNear(center, radiusM);
    const hasFilter = Boolean(filter.speed || filter.connectors?.length);
    return found
      .filter((sw) => (hasFilter ? sw.chargers.some((c) => matchesFilter(c, filter)) : true))
      .map((sw) => this.toSummary(sw, filter, center))
      .filter((s) => !availableOnly || s.available_matching > 0)
      .sort((a, b) => a.distance_m! - b.distance_m!);
  }

  /**
   * §4.1: the 10 straight-line-nearest stations to `searchPoint` with ≥1 matching available
   * charger, routed from `origin` (user's location) and sorted by driving ETA; top 3.
   */
  async nearest(searchPoint: LatLng, origin: LatLng | null, filter: ChargerFilter): Promise<NearestResult> {
    await this.beforeRead();
    const all = await this.repo.findNear(searchPoint);
    const candidates = all
      .map((sw) => this.toSummary(sw, filter, searchPoint))
      .filter((s) => s.available_matching > 0)
      .sort((a, b) => a.distance_m! - b.distance_m!)
      .slice(0, NEAREST_CANDIDATES);

    if (!origin) {
      return { searched: candidates.length, ranked_by: "distance", results: candidates.slice(0, NEAREST_RESULTS).map((station) => ({ station, route: null })) };
    }
    const routes = await Promise.allSettled(candidates.map((s) => this.routing.route(origin, s)));
    const items = candidates.map((station, i) => {
      const r = routes[i]!;
      return { station, route: r.status === "fulfilled" ? r.value : null };
    });
    if (items.every((it) => it.route === null) && items.length > 0) {
      throw new DomainError("UPSTREAM_ERROR", { provider: this.routing.name });
    }
    items.sort((a, b) => {
      if (a.route && b.route) return a.route.duration_s - b.route.duration_s || a.station.distance_m! - b.station.distance_m!;
      if (a.route) return -1;
      if (b.route) return 1;
      return a.station.distance_m! - b.station.distance_m!;
    });
    return { searched: candidates.length, ranked_by: "eta", results: items.slice(0, NEAREST_RESULTS) };
  }

  async detail(id: string, from?: LatLng): Promise<StationDetail> {
    await this.beforeRead();
    const sw = await this.repo.getById(id);
    if (!sw) throw new DomainError("NOT_FOUND");
    const s = sw.station;
    return {
      ...this.toSummary(sw, {}, from),
      operator_note_ko: s.operator_note_ko,
      operator_note_en: s.operator_note_en,
      open_hours: s.open_hours,
      parking_fee_note_ko: s.parking_fee_note_ko,
      parking_fee_note_en: s.parking_fee_note_en,
      chargers: sw.chargers.map((c) => this.toCharger(c)),
    };
  }

  private toDistrict(d: DistrictRecord, stations: StationWithChargers[]): District {
    const summary = summarize(stations.flatMap((s) => s.chargers));
    return { code: d.code, name_ko: d.name_ko, name_en: d.name_en, center: d.center, bbox: d.bbox, station_count: stations.length, summary };
  }

  async districts(): Promise<District[]> {
    await this.beforeRead();
    const [districts, all] = await Promise.all([this.repo.listDistricts(), this.repo.listAll()]);
    return districts.map((d) => this.toDistrict(d, all.filter((s) => s.station.district_code === d.code)));
  }

  async districtStations(code: string): Promise<{ district: District; stations: StationSummary[] }> {
    await this.beforeRead();
    const d = (await this.repo.listDistricts()).find((x) => x.code === code);
    if (!d) throw new DomainError("NOT_FOUND");
    const stations = await this.repo.listByDistrict(code);
    return { district: this.toDistrict(d, stations), stations: stations.map((s) => this.toSummary(s)) };
  }
}
