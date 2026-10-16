// Data-access contracts. Routes and services depend only on these interfaces.
// The SQLite mock (./mock) is one adapter; a RealBackendRepository implementing the same
// interfaces can replace it in src/container.ts without touching routes or the app.
import type { BBox, ChargerSpeed, ChargerStatus, ConnectorType, LatLng, LotType, ReservationState, SiteType } from "@seoul-ev/shared";

export interface StationRecord {
  id: string;
  name_ko: string;
  name_en: string;
  address_ko: string;
  address_en: string;
  district_code: string;
  lat: number;
  lng: number;
  lot_type: LotType;
  site_type: SiteType;
  operator_note_ko: string;
  operator_note_en: string;
  open_hours: string;
  parking_fee_note_ko: string;
  parking_fee_note_en: string;
}

export interface ChargerRecord {
  id: string;
  station_id: string;
  speed: ChargerSpeed;
  connector: ConnectorType;
  power_kw: number;
  price_per_kwh_krw: number;
  status: ChargerStatus;
  /** epoch ms */
  status_updated_at: number;
  /** Present while an active reservation holds the charger. epoch ms */
  reservation_expires_at: number | null;
}

export interface StationWithChargers {
  station: StationRecord;
  chargers: ChargerRecord[];
}

export interface DistrictRecord {
  code: string;
  name_ko: string;
  name_en: string;
  center: LatLng;
  bbox: BBox;
}

export interface StationRepository {
  /** Stations within `radiusM` of `center` (all stations when radiusM is undefined). Order unspecified. */
  findNear(center: LatLng, radiusM?: number): Promise<StationWithChargers[]>;
  getById(id: string): Promise<StationWithChargers | null>;
  listByDistrict(code: string): Promise<StationWithChargers[]>;
  listAll(): Promise<StationWithChargers[]>;
  getCharger(id: string): Promise<ChargerRecord | null>;
  listDistricts(): Promise<DistrictRecord[]>;
}

export interface ReservationRecord {
  id: string;
  charger_id: string;
  station_id: string;
  device_id: string;
  /** epoch ms */
  created_at: number;
  expires_at: number;
  state: ReservationState;
  ended_at: number | null;
}

export interface CreateReservationInput {
  chargerId: string;
  deviceId: string;
  now: number;
  expiresAt: number;
}

export interface ReservationRepository {
  /**
   * Atomically holds the charger. Must guarantee that, under concurrent calls, at most one
   * active reservation exists per charger and per device. Throws DomainError with
   * ALREADY_RESERVED, CHARGER_UNAVAILABLE, ACTIVE_RESERVATION_EXISTS or NOT_FOUND.
   */
  create(input: CreateReservationInput): Promise<ReservationRecord>;
  getById(id: string): Promise<ReservationRecord | null>;
  getActiveByDevice(deviceId: string): Promise<ReservationRecord | null>;
  getLatestByDevice(deviceId: string): Promise<ReservationRecord | null>;
  /** active -> cancelled; charger -> available. Throws RESERVATION_NOT_ACTIVE. */
  cancel(id: string, now: number): Promise<ReservationRecord>;
  /** active -> arrived; charger -> charging. Throws RESERVATION_NOT_ACTIVE. */
  arrive(id: string, now: number): Promise<ReservationRecord>;
  /** Expires every active reservation with expires_at <= now; chargers -> available. Returns the expired ones. */
  expireDue(now: number): Promise<ReservationRecord[]>;
  getCooldownUntil(deviceId: string): Promise<number | null>;
  setCooldownUntil(deviceId: string, until: number): Promise<void>;
}
