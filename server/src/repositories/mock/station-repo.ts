import type { LatLng } from "@seoul-ev/shared";
import { haversineM } from "../../domain/geo.js";
import type { ChargerRecord, DistrictRecord, StationRecord, StationRepository, StationWithChargers } from "../types.js";
import type { DB } from "./db.js";

const CHARGER_SQL = `
  SELECT c.id, c.station_id, c.speed, c.connector, c.power_kw, c.price_per_kwh_krw, c.status, c.status_updated_at,
         r.expires_at AS reservation_expires_at
  FROM chargers c
  LEFT JOIN reservations r ON r.charger_id = c.id AND r.state = 'active'`;

export class MockStationRepository implements StationRepository {
  constructor(
    private readonly db: DB,
    private readonly districts: DistrictRecord[],
  ) {}

  private hydrate(stations: StationRecord[], chargers: ChargerRecord[]): StationWithChargers[] {
    const byStation = new Map<string, ChargerRecord[]>();
    for (const c of chargers) {
      const list = byStation.get(c.station_id) ?? [];
      list.push(c);
      byStation.set(c.station_id, list);
    }
    return stations.map((station) => ({
      station,
      chargers: (byStation.get(station.id) ?? []).sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true })),
    }));
  }

  async listAll(): Promise<StationWithChargers[]> {
    const stations = this.db.prepare("SELECT * FROM stations ORDER BY id").all() as StationRecord[];
    const chargers = this.db.prepare(CHARGER_SQL).all() as ChargerRecord[];
    return this.hydrate(stations, chargers);
  }

  async findNear(center: LatLng, radiusM?: number): Promise<StationWithChargers[]> {
    const all = await this.listAll();
    if (radiusM === undefined) return all;
    return all.filter((s) => haversineM(center, s.station) <= radiusM);
  }

  async getById(id: string): Promise<StationWithChargers | null> {
    const station = this.db.prepare("SELECT * FROM stations WHERE id = ?").get(id) as StationRecord | undefined;
    if (!station) return null;
    const chargers = this.db.prepare(`${CHARGER_SQL} WHERE c.station_id = ?`).all(id) as ChargerRecord[];
    return this.hydrate([station], chargers)[0]!;
  }

  async listByDistrict(code: string): Promise<StationWithChargers[]> {
    const stations = this.db.prepare("SELECT * FROM stations WHERE district_code = ? ORDER BY id").all(code) as StationRecord[];
    const chargers = this.db
      .prepare(`${CHARGER_SQL} JOIN stations s ON s.id = c.station_id WHERE s.district_code = ?`)
      .all(code) as ChargerRecord[];
    return this.hydrate(stations, chargers);
  }

  async getCharger(id: string): Promise<ChargerRecord | null> {
    return (this.db.prepare(`${CHARGER_SQL} WHERE c.id = ?`).get(id) as ChargerRecord | undefined) ?? null;
  }

  async listDistricts(): Promise<DistrictRecord[]> {
    return this.districts;
  }
}
