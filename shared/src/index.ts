// Friendly aliases over the types generated from docs/openapi.yaml.
// Regenerate with `npm run gen:types` after editing the spec; never edit generated/ by hand.
import type { components, operations, paths } from "./generated/openapi";

export type { components, operations, paths };

type S = components["schemas"];

export type ErrorBody = S["Error"];
export type ErrorCode = S["ErrorCode"];
export type LatLng = S["LatLng"];
export type Health = S["Health"];

export type ChargerSpeed = S["ChargerSpeed"];
export type ConnectorType = S["ConnectorType"];
export type ChargerStatus = S["ChargerStatus"];
export type MarkerStatus = S["MarkerStatus"];
export type LotType = S["LotType"];
export type SiteType = S["SiteType"];

export type Charger = S["Charger"];
export type ChargerReservationInfo = S["ChargerReservationInfo"];
export type AvailabilitySummary = S["AvailabilitySummary"];
export type StationBase = S["StationBase"];
export type StationSummary = S["StationSummary"];
export type StationDetail = S["StationDetail"];
export type StationList = S["StationList"];

export type RouteSummary = S["RouteSummary"];
export type PathPoint = S["PathPoint"];
export type NearestItem = S["NearestItem"];
export type NearestResult = S["NearestResult"];

export type District = S["District"];
export type DistrictList = S["DistrictList"];
export type DistrictStations = S["DistrictStations"];
export type BBox = S["District"]["bbox"];

export type ReservationState = S["ReservationState"];
export type Reservation = S["Reservation"];
export type ReservationEnvelope = S["ReservationEnvelope"];
export type ActiveReservationResponse = S["ActiveReservationResponse"];
export type CreateReservationRequest = S["CreateReservationRequest"];

export type Place = S["Place"];
export type PlaceSearchResult = S["PlaceSearchResult"];
export type SimulatorState = S["SimulatorState"];

export type MapMarker = S["MapMarker"];
export type MapInboundMessage = S["MapInboundMessage"];
export type MapOutboundMessage = S["MapOutboundMessage"];

export type ListStationsQuery = NonNullable<operations["listStations"]["parameters"]["query"]>;
export type NearestQuery = NonNullable<operations["getNearestStations"]["parameters"]["query"]>;

export const CHARGER_STATUSES: readonly ChargerStatus[] = ["available", "charging", "reserved", "out_of_order", "unknown"];
export const CONNECTOR_TYPES: readonly ConnectorType[] = ["DC_COMBO", "CHADEMO", "AC_TYPE1", "AC3"];
export const RESERVATION_DURATION_S = 600;
export const RESERVATION_MAX_ETA_S = 600;
export const NO_SHOW_COOLDOWN_S = 900;
