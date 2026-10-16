import type { LatLng } from "@seoul-ev/shared";

export const CITY_HALL: LatLng = { lat: 37.5663, lng: 126.9779 };

// Generous bounding box of Seoul; used only for the "Seoul only" message.
const SEOUL = { south: 37.413, north: 37.716, west: 126.764, east: 127.184 };

export function isInSeoul(p: LatLng): boolean {
  return p.lat >= SEOUL.south && p.lat <= SEOUL.north && p.lng >= SEOUL.west && p.lng <= SEOUL.east;
}

export function haversineM(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

/** Rough web-map zoom that fits a radius on a phone screen. */
export function zoomForRadius(radiusM: number): number {
  if (radiusM <= 1000) return 15;
  if (radiusM <= 3000) return 14;
  return 13;
}
