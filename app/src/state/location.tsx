import type { LatLng } from "@seoul-ev/shared";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import { CITY_HALL, isInSeoul } from "@/lib/geo";
import { useSettings } from "./settings";

export type PermissionState = "pending" | "granted" | "denied";

/** The point that nearby/nearest searches are centered on (§4.3). */
export type Origin =
  | { kind: "current" }
  | { kind: "place"; point: LatLng; name_ko: string; name_en: string }
  | { kind: "pin"; point: LatLng }
  | { kind: "area"; point: LatLng };

interface LocationCtx {
  permission: PermissionState;
  /** Raw GPS fix (may be outside Seoul). */
  gps: LatLng | null;
  /** Location used for ETA: demo location, or GPS when inside Seoul; null hides ETA. */
  user: LatLng | null;
  outsideSeoul: boolean;
  origin: Origin;
  /** Where searches are centered: the chosen place, or the user (City Hall fallback). */
  searchCenter: LatLng;
  setOrigin: (o: Origin) => void;
  resetOrigin: () => void;
  requestPermission: () => Promise<void>;
}

const Ctx = createContext<LocationCtx | null>(null);
const ORIGIN_KEY = "seoulev.origin.v1";

function isOrigin(v: unknown): v is Origin {
  if (!v || typeof v !== "object") return false;
  const o = v as { kind?: string; point?: { lat?: unknown; lng?: unknown } };
  if (o.kind === "current") return true;
  return ["place", "pin", "area"].includes(o.kind ?? "") && typeof o.point?.lat === "number" && typeof o.point?.lng === "number";
}

export function LocationProvider({ children }: { children: ReactNode }) {
  const { demoLocation } = useSettings();
  const [permission, setPermission] = useState<PermissionState>("pending");
  const [gps, setGps] = useState<LatLng | null>(null);
  const [origin, setOriginState] = useState<Origin>({ kind: "current" });
  const [restored, setRestored] = useState(false);

  // The chosen search origin survives reloads (e.g. returning from the KakaoMap web link).
  useEffect(() => {
    AsyncStorage.getItem(ORIGIN_KEY)
      .then((raw) => {
        const saved = raw ? (JSON.parse(raw) as unknown) : null;
        if (isOrigin(saved)) setOriginState(saved);
      })
      .catch(() => {})
      .finally(() => setRestored(true));
  }, []);

  const setOrigin = useCallback((o: Origin) => {
    setOriginState(o);
    void AsyncStorage.setItem(ORIGIN_KEY, JSON.stringify(o)).catch(() => {});
  }, []);

  const readPosition = useCallback(async () => {
    try {
      const last = await Location.getLastKnownPositionAsync().catch(() => null);
      if (last) setGps({ lat: last.coords.latitude, lng: last.coords.longitude });
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setGps({ lat: pos.coords.latitude, lng: pos.coords.longitude });
    } catch {
      // Keep the last known fix; a missing fix just hides ETA.
    }
  }, []);

  const requestPermission = useCallback(async () => {
    try {
      const res = await Location.requestForegroundPermissionsAsync();
      setPermission(res.granted ? "granted" : "denied");
      if (res.granted) await readPosition();
    } catch {
      setPermission("denied");
    }
  }, [readPosition]);

  useEffect(() => {
    void requestPermission();
  }, [requestPermission]);

  useEffect(() => {
    if (permission !== "granted") return;
    const timer = setInterval(() => void readPosition(), 60_000);
    const sub = AppState.addEventListener("change", (s) => s === "active" && void readPosition());
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [permission, readPosition]);

  const value = useMemo<LocationCtx>(() => {
    const outsideSeoul = !demoLocation && gps !== null && !isInSeoul(gps);
    const user = demoLocation ? demoLocation.point : gps && !outsideSeoul ? gps : null;
    const searchCenter = origin.kind === "current" ? (user ?? CITY_HALL) : origin.point;
    return {
      permission: demoLocation ? "granted" : permission,
      gps,
      user,
      outsideSeoul,
      origin,
      searchCenter,
      setOrigin,
      resetOrigin: () => setOrigin({ kind: "current" }),
      requestPermission,
    };
  }, [demoLocation, gps, origin, permission, requestPermission, setOrigin]);

  if (!restored) return null;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLocation(): LocationCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useLocation outside LocationProvider");
  return v;
}
