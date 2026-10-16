import type { RouteSummary, StationDetail } from "@seoul-ev/shared";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { api } from "@/api/client";
import { MapView } from "@/components/map/MapView";
import type { MapViewHandle } from "@/components/map/types";
import { colors, MIN_TOUCH } from "@/components/theme";
import { Banner, Button, ErrorState, Icon, MarkerBadge, Skeleton } from "@/components/ui";
import { useNavigateTo } from "@/hooks/useNavigateTo";
import { errorMessage, pick, useLang } from "@/i18n";
import { formatDistance, formatDuration } from "@/lib/format";
import { useLocation } from "@/state/location";

/** In-app route preview (no turn-by-turn): polyline from the user's location to the station. */
export default function RouteScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, lang } = useLang();
  const { user } = useLocation();
  const navigateTo = useNavigateTo();
  const map = useRef<MapViewHandle>(null);
  const [station, setStation] = useState<StationDetail | null>(null);
  const [route, setRoute] = useState<RouteSummary | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    (async () => {
      try {
        const s = await api.station(id);
        if (cancelled) return;
        setStation(s);
        if (user) {
          const r = await api.route(user, s, true);
          if (!cancelled) setRoute(r);
        }
      } catch (e) {
        if (!cancelled) setError(e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, user?.lat, user?.lng, attempt]);

  useEffect(() => {
    if (!station) return;
    const name = pick(station, "name", lang);
    map.current?.send({
      type: "setMarkers",
      markers: [
        {
          id: station.id,
          lat: station.lat,
          lng: station.lng,
          status: station.marker_status,
          label: String(station.summary.available),
          a11y: `${name}, ${t(`marker.${station.marker_status}`)}`,
          selected: true,
        },
      ],
    });
    map.current?.send({ type: "setUserLocation", lat: user?.lat ?? null, lng: user?.lng ?? null });
    if (route?.path) map.current?.send({ type: "setRoute", path: route.path, fit: true });
    else map.current?.send({ type: "setCenter", lat: station.lat, lng: station.lng, zoom: 15 });
  }, [station, route, user, lang, t]);

  const back = () => (router.canGoBack() ? router.back() : router.replace("/"));
  const name = station ? pick(station, "name", lang) : "";

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Pressable onPress={back} accessibilityRole="button" accessibilityLabel={t("common.close")} style={styles.iconBtn}>
          <Icon name="arrow-left" size={24} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {t("route.title")}
        </Text>
        <View style={styles.iconBtn} />
      </View>

      <View style={styles.mapWrap}>
        <MapView ref={map} lang={lang} onMessage={() => {}} style={StyleSheet.absoluteFill} accessibilityLabel={t("route.mapA11y", { name })} />
      </View>

      <View style={styles.card}>
        {error ? (
          <ErrorState message={errorMessage(error, lang)} onRetry={() => setAttempt((a) => a + 1)} />
        ) : !station ? (
          <Skeleton rows={2} />
        ) : (
          <>
            <Text style={styles.name} numberOfLines={2}>
              {name}
            </Text>
            <View style={styles.row}>
              <MarkerBadge status={station.marker_status} label={t("station.available", { available: station.summary.available, total: station.summary.total })} />
            </View>
            {!user ? (
              <Banner tone="warning" icon="crosshairs-off">
                {t("route.noLocation")}
              </Banner>
            ) : route ? (
              <View style={styles.summary} accessible accessibilityLabel={`${t("route.from")}: ${t("home.currentLocation")}. ${formatDuration(route.duration_s, lang)}, ${formatDistance(route.distance_m, lang)}`}>
                <Icon name="car" size={22} color={colors.primary} />
                <Text style={styles.eta}>{formatDuration(route.duration_s, lang)}</Text>
                <Text style={styles.dist}>· {formatDistance(route.distance_m, lang)}</Text>
                <Text style={styles.from} numberOfLines={1}>
                  {t("route.fromCurrent")}
                </Text>
              </View>
            ) : (
              <Skeleton rows={1} />
            )}
            <Text style={styles.note}>{route?.provider === "mock" ? t("route.mockNote") : t("route.previewNote")}</Text>
            <View style={styles.actions}>
              <Button
                label={t("station.navigate")}
                icon="navigation-variant"
                style={{ flex: 1 }}
                onPress={() => navigateTo({ name, lat: station.lat, lng: station.lng })}
              />
              <Button label={t("station.details")} variant="secondary" style={{ flex: 1 }} onPress={() => router.push(`/station/${station.id}`)} />
            </View>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: "row", alignItems: "center", backgroundColor: "#fff", borderBottomWidth: 1, borderColor: colors.border, minHeight: 52, paddingHorizontal: 4 },
  headerTitle: { flex: 1, fontSize: 17, fontWeight: "700", color: colors.text, textAlign: "center" },
  iconBtn: { width: MIN_TOUCH + 4, height: MIN_TOUCH + 4, alignItems: "center", justifyContent: "center" },
  mapWrap: { flex: 1, minHeight: 220 },
  card: { backgroundColor: "#fff", padding: 16, gap: 8, borderTopWidth: 1, borderColor: colors.border },
  name: { fontSize: 19, fontWeight: "800", color: colors.text },
  row: { flexDirection: "row", gap: 8, alignItems: "center" },
  summary: { flexDirection: "row", alignItems: "baseline", gap: 6, flexWrap: "wrap" },
  eta: { fontSize: 24, fontWeight: "800", color: colors.primary },
  dist: { fontSize: 17, fontWeight: "700", color: colors.text },
  from: { fontSize: 13, color: colors.textMuted, flexBasis: "100%" },
  note: { fontSize: 12, color: colors.textFaint },
  actions: { flexDirection: "row", gap: 8, marginTop: 4 },
});
