import type { ConnectorType, District, LatLng, MapOutboundMessage, NearestResult, Place, StationSummary } from "@seoul-ev/shared";
import { CONNECTOR_TYPES } from "@seoul-ev/shared";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { api } from "@/api/client";
import { MapView } from "@/components/map/MapView";
import type { MapViewHandle } from "@/components/map/types";
import { SheetHandle } from "@/components/SheetHandle";
import { nearestSnap, sheetStops, type SheetSnap } from "@/components/sheet";
import { StationCard } from "@/components/StationCard";
import { colors, MIN_TOUCH } from "@/components/theme";
import { Banner, Button, Chip, EmptyState, ErrorState, Icon, Skeleton } from "@/components/ui";
import { usePolled } from "@/hooks/usePolled";
import { errorMessage, pick, useLang } from "@/i18n";
import { haversineM, zoomForRadius } from "@/lib/geo";
import { useNavigateTo } from "@/hooks/useNavigateTo";
import { useLocation } from "@/state/location";
import { useReservation } from "@/state/reservation";
import { RADII, useSettings } from "@/state/settings";

export default function MapScreen() {
  const { t, lang } = useLang();
  const settings = useSettings();
  const { filters, radius } = settings;
  const loc = useLocation();
  const { version } = useReservation();
  const navigateTo = useNavigateTo();
  const params = useLocalSearchParams<{ district?: string }>();
  const districtCode = typeof params.district === "string" && params.district ? params.district : null;

  const map = useRef<MapViewHandle>(null);
  const radiusRef = useRef(radius);
  useEffect(() => {
    radiusRef.current = radius;
  }, [radius]);
  const list = useRef<FlatList<StationSummary>>(null);
  const [mapCenter, setMapCenter] = useState(loc.searchCenter);
  const [draggedPin, setDraggedPin] = useState<LatLng | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [stageH, setStageH] = useState(0);
  const [headerH, setHeaderH] = useState(168);
  const [snap, setSnap] = useState<SheetSnap>("half");
  const [dragH, setDragH] = useState<number | null>(null);
  const [district, setDistrict] = useState<District | null>(null);

  const filterParams = useMemo(() => ({ speed: filters.speed ?? undefined, connectors: filters.connectors }), [filters.speed, filters.connectors]);
  const center = loc.searchCenter;

  const stations = usePolled<StationSummary[]>(
    async () => {
      if (districtCode) {
        const res = await api.districtStations(districtCode);
        setDistrict(res.district);
        return res.stations;
      }
      setDistrict(null);
      return (await api.stations(center, radius, filterParams, filters.availableOnly)).stations;
    },
    [districtCode, center.lat, center.lng, radius, filterParams, filters.availableOnly, version],
  );

  // ---- map sync
  useEffect(() => map.current?.send({ type: "setUserLocation", lat: loc.user?.lat ?? null, lng: loc.user?.lng ?? null }), [loc.user]);
  useEffect(() => setDraggedPin(null), [center.lat, center.lng, districtCode]);
  useEffect(() => {
    // Outside district mode the pin always marks where the next search happens: the dragged
    // position if the user moved it, otherwise the current search origin.
    const p = districtCode ? null : (draggedPin ?? center);
    map.current?.send({
      type: "setPin",
      lat: p?.lat ?? null,
      lng: p?.lng ?? null,
      a11y: t("home.pinA11y"),
    });
  }, [districtCode, draggedPin, center.lat, center.lng, t]);
  // A new search origin recenters the map. A radius change must not: it only redraws the circle
  // and the station query below refetches. Zoom for a new origin uses whatever radius is current.
  useEffect(() => {
    if (districtCode) return;
    map.current?.send({ type: "setCenter", lat: center.lat, lng: center.lng, zoom: zoomForRadius(radiusRef.current) });
    setMapCenter(center);
  }, [center.lat, center.lng, districtCode]);
  useEffect(() => {
    if (districtCode) return;
    map.current?.send({ type: "setRadius", radius_m: radius, lat: center.lat, lng: center.lng });
  }, [radius, center.lat, center.lng, districtCode]);
  useEffect(() => {
    if (!district) return;
    map.current?.send({ type: "setRadius", radius_m: 0, lat: 0, lng: 0 });
    map.current?.send({ type: "fitBounds", bbox: district.bbox });
  }, [district?.code]);
  useEffect(() => {
    const markers = (stations.data ?? []).map((s) => ({
      id: s.id,
      lat: s.lat,
      lng: s.lng,
      status: s.marker_status,
      label: String(s.summary.available),
      a11y: `${pick(s, "name", lang)}, ${t(`marker.${s.marker_status}`)}, ${t("station.available", { available: s.summary.available, total: s.summary.total })}`,
      selected: s.id === selectedId,
    }));
    map.current?.send({ type: "setMarkers", markers });
  }, [stations.data, selectedId, lang, t]);

  const [nearest, setNearest] = useState<NearestResult | null>(null);
  const [nearestError, setNearestError] = useState<string | null>(null);
  const [finding, setFinding] = useState(false);

  const onMapMessage = useCallback(
    (msg: MapOutboundMessage) => {
      if (msg.type === "regionChange") setMapCenter({ lat: msg.lat, lng: msg.lng });
      else if (msg.type === "mapClick") setDraggedPin({ lat: msg.lat, lng: msg.lng });
      else if (msg.type === "longPress") {
        if (districtCode) router.setParams({ district: "" });
        loc.setOrigin({ kind: "pin", point: { lat: msg.lat, lng: msg.lng } });
      } else if (msg.type === "markerPress") {
        setSelectedId(msg.id);
        const inNearest = (nearest?.results ?? []).some((r) => r.station.id === msg.id);
        if (inNearest) {
          list.current?.scrollToOffset({ offset: 0, animated: true });
          return;
        }
        const idx = (stations.data ?? []).filter((s) => !(nearest?.results ?? []).some((r) => r.station.id === s.id)).findIndex((s) => s.id === msg.id);
        if (idx >= 0) list.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0 });
      }
    },
    [districtCode, loc, stations.data, nearest],
  );

  const pinMoved = !districtCode && !!draggedPin && haversineM(draggedPin, center) > 30;
  const movedAway = pinMoved || (!districtCode && haversineM(mapCenter, center) > 300);

  const findNearest = async () => {
    setSnap("half");
    setFinding(true);
    setNearestError(null);
    try {
      setNearest(await api.nearest(center, loc.user, filterParams));
    } catch (e) {
      setNearestError(errorMessage(e, lang));
    } finally {
      setFinding(false);
    }
  };

  const originLabel = districtCode
    ? district
      ? pick(district, "name", lang)
      : "…"
    : loc.origin.kind === "current"
      ? loc.user
        ? t("home.currentLocation")
        : t("home.cityHall")
      : loc.origin.kind === "place"
        ? pick(loc.origin, "name", lang)
        : loc.origin.kind === "pin"
          ? t("home.droppedPin")
          : t("home.mapArea");
  const customOrigin = !!districtCode || loc.origin.kind !== "current";

  const nearestIds = useMemo(() => new Set((nearest?.results ?? []).map((r) => r.station.id)), [nearest]);
  const listData = useMemo(() => {
    const arr = (stations.data ?? []).filter((s) => !nearestIds.has(s.id));
    if (!selectedId || nearestIds.has(selectedId)) return arr;
    const sel = arr.find((s) => s.id === selectedId);
    return sel ? [sel, ...arr.filter((s) => s.id !== selectedId)] : arr;
  }, [stations.data, selectedId, nearestIds]);

  const stops = sheetStops(stageH, headerH);
  const height = dragH ?? (stageH > 0 ? stops[snap] : 300);
  const innerH = stageH > 0 ? stops.full : 300;
  const dragging = dragH != null;
  const commitSheet = useCallback(
    (current: number) => {
      setSnap(nearestSnap(current, stageH, headerH));
      setDragH(null);
    },
    [headerH, stageH],
  );
  // A tap with no move still cycles peek → half → full → peek. Drag is the main path.
  const cycleSnap = useCallback(() => {
    setSnap((s) => (s === "peek" ? "half" : s === "half" ? "full" : "peek"));
    setDragH(null);
  }, []);

  return (
    <View style={styles.screen}>
      <SearchBar
        onPick={(p) => {
          if (districtCode) router.setParams({ district: "" });
          loc.setOrigin({ kind: "place", point: { lat: p.lat, lng: p.lng }, name_ko: p.name_ko, name_en: p.name_en });
        }}
      />
      <View style={styles.originRow}>
        <Pressable
          style={[styles.originChip, customOrigin && styles.originChipCustom]}
          onPress={() => {
            if (districtCode) router.setParams({ district: "" });
            loc.resetOrigin();
          }}
          disabled={!customOrigin}
          accessibilityRole="button"
          accessibilityLabel={customOrigin ? `${originLabel}. ${t("home.resetOrigin")}` : originLabel}
        >
          <Icon name={customOrigin ? "map-marker" : "crosshairs-gps"} size={16} color={customOrigin ? "#fff" : colors.primary} />
          <Text style={[styles.originText, customOrigin && { color: "#fff" }]} numberOfLines={1}>
            {originLabel}
          </Text>
          {customOrigin ? <Icon name="close-circle" size={16} color="#fff" /> : null}
        </Pressable>
      </View>
      <FilterBar />

      {loc.outsideSeoul ? (
        <Banner tone="warning" icon="map-marker-off">
          {t("location.outsideSeoul")}
        </Banner>
      ) : loc.permission === "denied" ? (
        <Banner tone="warning" icon="crosshairs-off" action={<Button compact variant="secondary" label={t("location.enable")} onPress={() => void loc.requestPermission()} />}>
          {t("location.deniedBanner")}
        </Banner>
      ) : null}

      <View style={styles.stage} onLayout={(e) => setStageH(e.nativeEvent.layout.height)}>
        <View pointerEvents={dragging ? "none" : "auto"} style={StyleSheet.absoluteFill}>
          <MapView ref={map} lang={lang} onMessage={onMapMessage} style={StyleSheet.absoluteFill} accessibilityLabel={t("home.longPressHint")} />
        </View>
        {movedAway ? (
          <View style={styles.searchAreaWrap} pointerEvents="box-none">
            <Button
              compact
              icon="refresh"
              label={t("home.searchThisArea")}
              variant="secondary"
              style={styles.searchAreaBtn}
              onPress={() => loc.setOrigin(pinMoved && draggedPin ? { kind: "pin", point: draggedPin } : { kind: "area", point: mapCenter })}
            />
            {pinMoved ? (
              <Button
                compact
                iconOnly
                icon="backup-restore"
                label={t("home.backToSearch")}
                variant="secondary"
                style={styles.searchAreaIcon}
                onPress={() => setDraggedPin(null)}
              />
            ) : null}
          </View>
        ) : null}
        <View style={[styles.sheet, { height }]}>
          <View style={[styles.sheetInner, { height: innerH }]}>
          <View onLayout={(e) => setHeaderH(e.nativeEvent.layout.height)}>
            <SheetHandle
              height={height}
              stageH={stageH}
              headerH={headerH}
              snap={snap}
              label={t("home.sheetHandle", { snap: t(`home.snap.${snap}`) })}
              onDrag={setDragH}
              onCommit={commitSheet}
              onTap={cycleSnap}
            />
            <Text style={styles.sheetTitle}>{t("home.stationsCount", { count: stations.data?.length ?? 0 })}</Text>
            <Pressable
              onPress={findNearest}
              disabled={finding}
              accessibilityRole="button"
              accessibilityLabel={t("home.findNearest")}
              accessibilityHint={t("home.findNearestA11y")}
              style={({ pressed }) => [styles.findBtn, pressed && { opacity: 0.85 }]}
            >
              {finding ? <ActivityIndicator color="#fff" /> : <Icon name="lightning-bolt" size={18} color="#fff" />}
              <Text style={styles.findText} numberOfLines={1}>
                {t("home.findNearest")}
              </Text>
            </Pressable>
            {!districtCode ? (
              <View style={styles.radiusRow}>
                {RADII.map((r) => (
                  <Chip
                    key={r}
                    label={t("home.km", { n: r / 1000 })}
                    selected={radius === r}
                    onPress={() => settings.update({ radius: r })}
                    accessibilityLabel={`${t("home.radius")} ${t("home.km", { n: r / 1000 })}`}
                    style={styles.radiusChip}
                  />
                ))}
              </View>
            ) : null}
          </View>
          {stations.loading && !stations.data ? (
            <Skeleton rows={3} />
          ) : stations.error && !stations.data ? (
            <ErrorState message={errorMessage(stations.error, lang)} onRetry={() => void stations.reload()} />
          ) : (
            <FlatList
              ref={list}
              data={listData}
              keyExtractor={(s) => s.id}
              scrollEnabled={!dragging}
              style={styles.list}
              contentContainerStyle={{ paddingBottom: 16 }}
              onScrollToIndexFailed={() => {}}
              ListHeaderComponent={
                <NearestHeader
                  result={nearest}
                  error={nearestError}
                  showEta={!!loc.user}
                  selectedId={selectedId}
                  onClose={() => {
                    setNearest(null);
                    setNearestError(null);
                  }}
                  onNavigate={navigateTo}
                />
              }
              renderItem={({ item }) => (
                <StationCard station={item} highlight={item.id === selectedId} onPress={() => router.push(`/station/${item.id}`)} />
              )}
              ListEmptyComponent={
                nearest ? null : (
                  <EmptyState
                    message={t("home.emptyRadius", { km: radius / 1000 })}
                    action={
                      radius < 5000 ? (
                        <Button
                          label={t("home.expandRadius")}
                          icon="arrow-expand-all"
                          variant="secondary"
                          onPress={() => settings.update({ radius: RADII[RADII.indexOf(radius) + 1] ?? 5000 })}
                        />
                      ) : undefined
                    }
                  />
                )
              }
            />
          )}
          </View>
        </View>
      </View>
    </View>
  );
}

function SearchBar({ onPick }: { onPick: (p: Place) => void }) {
  const { t, lang } = useLang();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Place[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!q.trim()) {
      setResults(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await api.searchPlaces(q.trim());
        if (!cancelled) {
          setResults(res.places);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(errorMessage(e, lang));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q, lang]);

  return (
    <View style={styles.searchWrap}>
      <View style={styles.searchBox}>
        <Icon name="magnify" size={20} color={colors.textMuted} />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder={t("home.searchPlaceholder")}
          placeholderTextColor={colors.textFaint}
          style={styles.searchInput}
          returnKeyType="search"
          accessibilityLabel={t("home.searchPlaceholder")}
          onSubmitEditing={() => results?.[0] && (onPick(results[0]), setQ(""), Keyboard.dismiss())}
        />
        {loading ? <ActivityIndicator size="small" /> : null}
        {q ? (
          <Pressable onPress={() => setQ("")} accessibilityRole="button" accessibilityLabel={t("common.close")} hitSlop={12} style={styles.clearBtn}>
            <Icon name="close-circle" size={18} color={colors.textFaint} />
          </Pressable>
        ) : null}
      </View>
      {q.trim() && (results || error) ? (
        <View style={styles.results}>
          {error ? (
            <Text style={styles.resultEmpty}>{error}</Text>
          ) : results && results.length === 0 ? (
            <Text style={styles.resultEmpty}>{t("home.noPlaces")}</Text>
          ) : (
            results?.slice(0, 6).map((p) => (
              <Pressable
                key={p.id}
                style={({ pressed }) => [styles.result, pressed && { backgroundColor: colors.surfaceAlt }]}
                onPress={() => {
                  onPick(p);
                  setQ("");
                  Keyboard.dismiss();
                }}
                accessibilityRole="button"
              >
                <Icon name="map-marker-outline" size={18} color={colors.primary} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.resultName}>{pick(p, "name", lang)}</Text>
                  <Text style={styles.resultAddr} numberOfLines={1}>
                    {pick(p, "address", lang)}
                  </Text>
                </View>
              </Pressable>
            ))
          )}
        </View>
      ) : null}
    </View>
  );
}

function FilterBar() {
  const { t } = useLang();
  const { filters, update } = useSettings();
  const toggleConnector = (c: ConnectorType) =>
    update({ filters: { ...filters, connectors: filters.connectors.includes(c) ? filters.connectors.filter((x) => x !== c) : [...filters.connectors, c] } });
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll} contentContainerStyle={styles.filters} keyboardShouldPersistTaps="handled">
      <Chip
        label={t("home.availableOnly")}
        icon={filters.availableOnly ? "check" : undefined}
        selected={filters.availableOnly}
        onPress={() => update({ filters: { ...filters, availableOnly: !filters.availableOnly } })}
      />
      {(["DC", "AC"] as const).map((s) => (
        <Chip key={s} label={t(`speed.${s}`)} selected={filters.speed === s} onPress={() => update({ filters: { ...filters, speed: filters.speed === s ? null : s } })} />
      ))}
      <View style={styles.sep} />
      {CONNECTOR_TYPES.map((c) => (
        <Chip key={c} label={t(`connector.${c}`)} selected={filters.connectors.includes(c)} onPress={() => toggleConnector(c)} />
      ))}
    </ScrollView>
  );
}

function NearestHeader({
  result,
  error,
  onClose,
  showEta,
  selectedId,
  onNavigate,
}: {
  result: NearestResult | null;
  error: string | null;
  onClose: () => void;
  showEta: boolean;
  selectedId: string | null;
  onNavigate: (t: { name: string; lat: number; lng: number }) => void;
}) {
  const { t, lang } = useLang();
  if (!result && !error) return null;
  const [best, ...others] = result?.results ?? [];
  const go = (path: string) => router.push(path as never);
  return (
    <View>
      <View style={styles.nearestHead}>
        <Text style={styles.nearestTitle}>{t("nearest.title")}</Text>
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel={t("common.close")} style={styles.closeBtn}>
          <Icon name="close" size={22} color={colors.text} />
        </Pressable>
      </View>
      {error ? <EmptyState icon="alert-circle-outline" message={error} /> : null}
      {result && !best ? <EmptyState message={t("nearest.none")} /> : null}
      {result?.ranked_by === "distance" && best ? <Banner icon="information-outline">{t("nearest.rankedByDistance")}</Banner> : null}
      {best ? (
        <StationCard
          station={best.station}
          route={best.route}
          showEta={showEta}
          highlight={selectedId === null || best.station.id === selectedId}
          onPress={() => go(`/station/${best.station.id}`)}
          actions={
            <>
              <Button compact label={t("station.reserve")} icon="timer-sand" style={styles.fullAction} onPress={() => go(`/station/${best.station.id}?reserve=1`)} />
              {showEta ? (
                <Button compact label={t("route.show")} icon="map-marker-path" variant="secondary" style={{ flex: 1 }} onPress={() => go(`/route/${best.station.id}`)} />
              ) : null}
              <Button
                compact
                label={t("station.navigate")}
                icon="navigation-variant"
                variant="secondary"
                style={{ flex: 1 }}
                onPress={() => onNavigate({ name: pick(best.station, "name", lang), lat: best.station.lat, lng: best.station.lng })}
              />
            </>
          }
        />
      ) : null}
      {others.length ? <Text style={styles.othersTitle}>{t("nearest.others")}</Text> : null}
      {others.map((o) => (
        <StationCard
          key={o.station.id}
          station={o.station}
          route={o.route}
          showEta={showEta}
          highlight={o.station.id === selectedId}
          onPress={() => go(`/station/${o.station.id}`)}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  searchWrap: { paddingHorizontal: 12, paddingTop: 8, zIndex: 20 },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    minHeight: MIN_TOUCH,
  },
  searchInput: { flex: 1, fontSize: 16, color: colors.text, paddingVertical: 10 },
  clearBtn: { minWidth: 32, minHeight: 32, alignItems: "center", justifyContent: "center" },
  results: {
    position: "absolute",
    top: 54,
    left: 12,
    right: 12,
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 4,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 6,
  },
  result: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, minHeight: 52 },
  resultName: { fontSize: 15, fontWeight: "600", color: colors.text },
  resultAddr: { fontSize: 12.5, color: colors.textMuted },
  resultEmpty: { padding: 14, color: colors.textMuted },
  originRow: { flexDirection: "row", paddingHorizontal: 12, paddingTop: 8 },
  originChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    minHeight: 36,
    borderRadius: 999,
    backgroundColor: "#dbeafe",
    maxWidth: "100%",
  },
  originChipCustom: { backgroundColor: colors.primary },
  originText: { color: colors.primary, fontWeight: "700", fontSize: 14, flexShrink: 1 },
  filterScroll: { flexGrow: 0, flexShrink: 0 },
  filters: { gap: 6, paddingHorizontal: 12, paddingVertical: 8, alignItems: "center" },
  sep: { width: 1, height: 22, backgroundColor: colors.border, marginHorizontal: 2 },
  stage: { flex: 1, minHeight: 240 },
  searchAreaWrap: {
    position: "absolute",
    top: 10,
    left: 8,
    right: 8,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
    zIndex: 2,
  },
  searchAreaBtn: { borderRadius: 999, flexShrink: 1, shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 6, elevation: 4 },
  searchAreaIcon: { borderRadius: 999, shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 6, elevation: 4 },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.background,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    overflow: "hidden",
    zIndex: 3,
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 8,
  },
  sheetInner: { width: "100%" },
  sheetTitle: { fontSize: 14.5, fontWeight: "700", color: colors.text, paddingHorizontal: 16, paddingBottom: 6 },
  findBtn: {
    minHeight: MIN_TOUCH,
    marginHorizontal: 12,
    marginBottom: 8,
    borderRadius: 12,
    backgroundColor: colors.primary,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 12,
  },
  findText: { color: "#fff", fontSize: 15, fontWeight: "800", flexShrink: 1 },
  radiusRow: { flexDirection: "row", gap: 8, paddingHorizontal: 12, paddingBottom: 8 },
  radiusChip: { flex: 1, minHeight: MIN_TOUCH, justifyContent: "center" },
  list: { flex: 1 },
  nearestHead: { flexDirection: "row", alignItems: "center", paddingLeft: 16, minHeight: MIN_TOUCH },
  nearestTitle: { flex: 1, fontSize: 16, fontWeight: "800", color: colors.text },
  closeBtn: { width: MIN_TOUCH, height: MIN_TOUCH, alignItems: "center", justifyContent: "center" },
  fullAction: { flexBasis: "100%" },
  othersTitle: { marginTop: 16, marginHorizontal: 16, fontSize: 14, fontWeight: "700", color: colors.textMuted },
});
