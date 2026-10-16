import type { Reservation, StationBase } from "@seoul-ev/shared";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import { api } from "@/api/client";
import { errorMessage, useLang } from "@/i18n";
import { POLL_MS } from "@/hooks/usePolled";
import { useDialog } from "./dialog";
import { useLocation } from "./location";

interface ReservationCtx {
  active: Reservation | null;
  station: StationBase | null;
  cooldownUntil: number | null;
  /** Server clock minus local clock, so countdowns match `expires_at` even with a skewed phone clock. */
  skewMs: number;
  /** Bumps after every reservation change so screens can refetch immediately. */
  version: number;
  busy: boolean;
  refresh: () => Promise<void>;
  reserve: (chargerId: string) => Promise<boolean>;
  cancel: () => Promise<void>;
  arrive: () => Promise<void>;
}

const Ctx = createContext<ReservationCtx | null>(null);

export function ReservationProvider({ children }: { children: ReactNode }) {
  const { t, lang } = useLang();
  const dialog = useDialog();
  const { user } = useLocation();
  const [active, setActive] = useState<Reservation | null>(null);
  const [station, setStation] = useState<StationBase | null>(null);
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const [skewMs, setSkewMs] = useState(0);
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const lastActiveId = useRef<string | null>(null);
  const alerted = useRef<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    try {
      const res = await api.activeReservation();
      setSkewMs(Date.parse(res.server_time) - Date.now());
      setActive(res.reservation);
      setStation(res.station);
      setCooldownUntil(res.cooldown_until ? Date.parse(res.cooldown_until) : null);
      const prev = lastActiveId.current;
      if (prev && !res.reservation && res.last_ended?.id === prev && res.last_ended.state === "expired" && !alerted.current.has(prev)) {
        alerted.current.add(prev);
        setVersion((v) => v + 1);
        void dialog.alert(t("reservation.expiredTitle"), t("reservation.expiredBody"));
      }
      lastActiveId.current = res.reservation?.id ?? null;
    } catch {
      // Polling errors are surfaced by the screens' own error states.
    }
  }, [dialog, t]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => AppState.currentState !== "background" && void refresh(), POLL_MS);
    const sub = AppState.addEventListener("change", (s) => s === "active" && void refresh());
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [refresh]);

  // Ask the server as soon as the local countdown reaches zero (it owns the expiry).
  useEffect(() => {
    if (!active) return;
    const ms = Date.parse(active.expires_at) - (Date.now() + skewMs);
    const timer = setTimeout(() => void refresh(), Math.max(0, ms) + 500);
    return () => clearTimeout(timer);
  }, [active, skewMs, refresh]);

  const reserve = useCallback(
    async (chargerId: string) => {
      setBusy(true);
      try {
        const res = await api.reserve(chargerId, user);
        setSkewMs(Date.parse(res.server_time) - Date.now());
        setActive(res.reservation);
        setStation(res.station ?? null);
        lastActiveId.current = res.reservation.id;
        setVersion((v) => v + 1);
        return true;
      } catch (e) {
        await dialog.alert(t("errors.generic"), errorMessage(e, lang));
        setVersion((v) => v + 1);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [dialog, lang, t, user],
  );

  const cancel = useCallback(async () => {
    if (!active) return;
    if (!(await dialog.confirm(t("reservation.cancel"), t("reservation.cancelConfirm"), { okLabel: t("reservation.cancel"), destructive: true }))) return;
    setBusy(true);
    try {
      await api.cancel(active.id);
      lastActiveId.current = null;
      setActive(null);
      setStation(null);
      setVersion((v) => v + 1);
    } catch (e) {
      await dialog.alert(t("errors.generic"), errorMessage(e, lang));
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [active, dialog, lang, refresh, t]);

  const arrive = useCallback(async () => {
    if (!active) return;
    setBusy(true);
    try {
      await api.arrive(active.id);
      lastActiveId.current = null;
      setActive(null);
      setStation(null);
      setVersion((v) => v + 1);
      await dialog.alert(t("reservation.arrivedTitle"), t("reservation.arrivedBody"));
    } catch (e) {
      await dialog.alert(t("errors.generic"), errorMessage(e, lang));
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [active, dialog, lang, refresh, t]);

  const value = useMemo(
    () => ({ active, station, cooldownUntil, skewMs, version, busy, refresh, reserve, cancel, arrive }),
    [active, station, cooldownUntil, skewMs, version, busy, refresh, reserve, cancel, arrive],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useReservation(): ReservationCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useReservation outside ReservationProvider");
  return v;
}
