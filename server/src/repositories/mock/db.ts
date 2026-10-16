import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { ChargerSpeed, ConnectorType } from "@seoul-ev/shared";
import type { DistrictRecord, StationRecord } from "../types.js";

export type DB = Database.Database;

export interface SeedCharger {
  id: string;
  speed: ChargerSpeed;
  connector: ConnectorType;
  power_kw: number;
  price_per_kwh_krw: number;
}
export interface SeedStation extends StationRecord {
  chargers: SeedCharger[];
}
export interface SeedData {
  stations: SeedStation[];
  districts: DistrictRecord[];
  hash: string;
}

const SEED_DIR = new URL("../../../seed/", import.meta.url);

export function loadSeed(): SeedData {
  const stationsRaw = readFileSync(new URL("stations.json", SEED_DIR), "utf8");
  const districtsRaw = readFileSync(new URL("districts.json", SEED_DIR), "utf8");
  const hash = createHash("sha256").update(stationsRaw).update(districtsRaw).digest("hex").slice(0, 16);
  return {
    stations: (JSON.parse(stationsRaw) as { stations: SeedStation[] }).stations,
    districts: (JSON.parse(districtsRaw) as { districts: DistrictRecord[] }).districts,
    hash,
  };
}

export function openDb(path: string): DB {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS stations (
      id TEXT PRIMARY KEY,
      name_ko TEXT NOT NULL, name_en TEXT NOT NULL,
      address_ko TEXT NOT NULL, address_en TEXT NOT NULL,
      district_code TEXT NOT NULL,
      lat REAL NOT NULL, lng REAL NOT NULL,
      lot_type TEXT NOT NULL, site_type TEXT NOT NULL,
      operator_note_ko TEXT NOT NULL, operator_note_en TEXT NOT NULL,
      open_hours TEXT NOT NULL,
      parking_fee_note_ko TEXT NOT NULL, parking_fee_note_en TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ix_stations_district ON stations(district_code);
    CREATE TABLE IF NOT EXISTS chargers (
      id TEXT PRIMARY KEY,
      station_id TEXT NOT NULL REFERENCES stations(id),
      speed TEXT NOT NULL, connector TEXT NOT NULL,
      power_kw REAL NOT NULL, price_per_kwh_krw REAL NOT NULL,
      status TEXT NOT NULL,
      status_updated_at INTEGER NOT NULL,
      -- simulator-only bookkeeping, in simulated time (epoch ms)
      sim_session_end INTEGER,
      sim_fault_until INTEGER
    );
    CREATE INDEX IF NOT EXISTS ix_chargers_station ON chargers(station_id);
    CREATE TABLE IF NOT EXISTS reservations (
      id TEXT PRIMARY KEY,
      charger_id TEXT NOT NULL REFERENCES chargers(id),
      station_id TEXT NOT NULL,
      device_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      state TEXT NOT NULL,
      ended_at INTEGER
    );
    -- These two partial unique indexes are the atomicity guarantee for §5:
    -- one active reservation per charger and per device, enforced by the database.
    CREATE UNIQUE INDEX IF NOT EXISTS ux_res_active_charger ON reservations(charger_id) WHERE state = 'active';
    CREATE UNIQUE INDEX IF NOT EXISTS ux_res_active_device ON reservations(device_id) WHERE state = 'active';
    CREATE INDEX IF NOT EXISTS ix_res_device ON reservations(device_id, created_at);
    CREATE INDEX IF NOT EXISTS ix_res_expiry ON reservations(state, expires_at);
    CREATE TABLE IF NOT EXISTS device_cooldowns (device_id TEXT PRIMARY KEY, until INTEGER NOT NULL);
  `);
  return db;
}

export function seedHash(db: DB): string | null {
  const row = db.prepare("SELECT value FROM meta WHERE key = 'seed_hash'").get() as { value: string } | undefined;
  return row?.value ?? null;
}

/** Wipes everything and loads the seed with every charger `available`. The simulator then randomizes. */
export function writeSeed(db: DB, seed: SeedData, now: number): void {
  const insStation = db.prepare(`INSERT INTO stations VALUES (@id, @name_ko, @name_en, @address_ko, @address_en, @district_code, @lat, @lng,
    @lot_type, @site_type, @operator_note_ko, @operator_note_en, @open_hours, @parking_fee_note_ko, @parking_fee_note_en)`);
  const insCharger = db.prepare(`INSERT INTO chargers (id, station_id, speed, connector, power_kw, price_per_kwh_krw, status, status_updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'available', ?)`);
  db.transaction(() => {
    db.exec("DELETE FROM reservations; DELETE FROM device_cooldowns; DELETE FROM chargers; DELETE FROM stations;");
    for (const s of seed.stations) {
      const { chargers, ...station } = s;
      insStation.run(pickStation(station));
      for (const c of chargers) insCharger.run(c.id, s.id, c.speed, c.connector, c.power_kw, c.price_per_kwh_krw, now);
    }
    db.prepare("INSERT OR REPLACE INTO meta VALUES ('seed_hash', ?)").run(seed.hash);
  })();
}

function pickStation(s: StationRecord): StationRecord {
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
    operator_note_ko: s.operator_note_ko,
    operator_note_en: s.operator_note_en,
    open_hours: s.open_hours,
    parking_fee_note_ko: s.parking_fee_note_ko,
    parking_fee_note_en: s.parking_fee_note_en,
  };
}
