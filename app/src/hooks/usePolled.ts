import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AppState } from "react-native";

export const POLL_MS = 15_000;

/**
 * Loads data, then re-polls every `intervalMs` while the screen is focused and the app is in the
 * foreground (§7.5). Keeps the previous data while refreshing so the UI doesn't flash.
 */
export function usePolled<T>(loader: () => Promise<T>, deps: unknown[], opts: { intervalMs?: number; enabled?: boolean } = {}) {
  const { intervalMs = POLL_MS, enabled = true } = opts;
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [focused, setFocused] = useState(true);
  const [active, setActive] = useState(AppState.currentState === "active" || AppState.currentState == null);
  const seq = useRef(0);
  const loaderRef = useRef(loader);
  useLayoutEffect(() => {
    loaderRef.current = loader;
  });

  const run = useCallback(async (initial: boolean) => {
    const my = ++seq.current;
    if (initial) setLoading(true);
    try {
      const v = await loaderRef.current();
      if (my === seq.current) {
        setData(v);
        setError(null);
      }
    } catch (e) {
      if (my === seq.current) setError(e);
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );

  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => setActive(s === "active"));
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!enabled) return;
    setData(null);
    void run(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, run, ...deps]);

  useEffect(() => {
    if (!enabled || !focused || !active) return;
    const timer = setInterval(() => void run(false), intervalMs);
    return () => clearInterval(timer);
  }, [enabled, focused, active, intervalMs, run]);

  const reload = useCallback(() => run(data === null), [run, data]);
  return { data, error, loading, reload, setData };
}

/** Re-renders every second; used for local countdowns. */
export function useNow(enabled = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [enabled]);
  return now;
}
