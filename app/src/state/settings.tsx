import AsyncStorage from "@react-native-async-storage/async-storage";
import type { ChargerSpeed, ConnectorType, LatLng } from "@seoul-ev/shared";
import * as Crypto from "expo-crypto";
import { Platform } from "react-native";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { setApiBaseUrl, setDeviceId } from "@/api/client";
import i18n, { deviceLang, type Lang } from "@/i18n";

export interface Filters {
  speed: ChargerSpeed | null;
  connectors: ConnectorType[];
  availableOnly: boolean;
}

export const RADII = [1000, 3000, 5000] as const;
export type Radius = (typeof RADII)[number];

export interface DemoLocation {
  id: string;
  name_ko: string;
  name_en: string;
  point: LatLng;
}

/** Fixed demo locations for testing away from Seoul (Settings → Demo location). */
export const DEMO_LOCATIONS: DemoLocation[] = [
  { id: "gangnam", name_ko: "강남역", name_en: "Gangnam Station", point: { lat: 37.49795, lng: 127.02762 } },
  { id: "seoul-station", name_ko: "서울역", name_en: "Seoul Station", point: { lat: 37.55465, lng: 126.97059 } },
  { id: "hongik", name_ko: "홍대입구역", name_en: "Hongik Univ. Station", point: { lat: 37.55722, lng: 126.92458 } },
  { id: "jamsil", name_ko: "잠실역", name_en: "Jamsil Station", point: { lat: 37.51333, lng: 127.10013 } },
  { id: "yeouido", name_ko: "여의도공원", name_en: "Yeouido Park", point: { lat: 37.52569, lng: 126.92241 } },
  { id: "city-hall", name_ko: "서울시청", name_en: "Seoul City Hall", point: { lat: 37.5663, lng: 126.9779 } },
];

interface Persisted {
  lang: Lang | null;
  demoLocationId: string | null;
  serverUrl: string | null;
  favorites: string[];
  filters: Filters;
  radius: Radius;
  deviceId: string;
}

const KEY = "seoulev.settings.v1";
const DEFAULTS: Omit<Persisted, "deviceId"> = {
  lang: null,
  demoLocationId: null,
  serverUrl: null,
  favorites: [],
  filters: { speed: null, connectors: [], availableOnly: true },
  radius: 3000,
};

interface SettingsCtx extends Persisted {
  ready: boolean;
  effectiveLang: Lang;
  demoLocation: DemoLocation | null;
  update: (patch: Partial<Omit<Persisted, "deviceId">>) => void;
  toggleFavorite: (stationId: string) => void;
  isFavorite: (stationId: string) => boolean;
}

const Ctx = createContext<SettingsCtx | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Persisted | null>(null);

  useEffect(() => {
    (async () => {
      const raw = await AsyncStorage.getItem(KEY).catch(() => null);
      const saved = raw ? (JSON.parse(raw) as Partial<Persisted>) : {};
      const deviceId = saved.deviceId ?? Crypto.randomUUID();
      const next: Persisted = { ...DEFAULTS, ...saved, filters: { ...DEFAULTS.filters, ...saved.filters }, deviceId };
      // Configure the client before children mount: their effects run before this provider's.
      setDeviceId(next.deviceId);
      setApiBaseUrl(next.serverUrl);
      setState(next);
      if (!saved.deviceId) await AsyncStorage.setItem(KEY, JSON.stringify(next));
    })();
  }, []);

  useEffect(() => {
    if (!state) return;
    const lang = state.lang ?? deviceLang();
    if (i18n.language !== lang) void i18n.changeLanguage(lang);
    // Keeps <html lang> in sync on web so the browser doesn't offer to translate the UI.
    if (Platform.OS === "web" && typeof document !== "undefined") document.documentElement.lang = lang;
  }, [state]);

  const update = useCallback((patch: Partial<Omit<Persisted, "deviceId">>) => {
    setState((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...patch };
      setApiBaseUrl(next.serverUrl);
      void AsyncStorage.setItem(KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const value = useMemo<SettingsCtx | null>(() => {
    if (!state) return null;
    return {
      ...state,
      ready: true,
      effectiveLang: state.lang ?? deviceLang(),
      demoLocation: DEMO_LOCATIONS.find((d) => d.id === state.demoLocationId) ?? null,
      update,
      toggleFavorite: (id) => update({ favorites: state.favorites.includes(id) ? state.favorites.filter((f) => f !== id) : [...state.favorites, id] }),
      isFavorite: (id) => state.favorites.includes(id),
    };
  }, [state, update]);

  if (!value) return null;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSettings(): SettingsCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSettings outside SettingsProvider");
  return v;
}
