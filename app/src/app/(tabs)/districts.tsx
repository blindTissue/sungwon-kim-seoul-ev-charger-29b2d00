import type { District, MapOutboundMessage, MarkerStatus } from "@seoul-ev/shared";
import { router } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { api } from "@/api/client";
import { MapView } from "@/components/map/MapView";
import type { MapViewHandle } from "@/components/map/types";
import { colors, MIN_TOUCH } from "@/components/theme";
import { Button, Chip, ErrorState, Icon, Skeleton } from "@/components/ui";
import { usePolled } from "@/hooks/usePolled";
import { errorMessage, pick, useLang } from "@/i18n";
import { useReservation } from "@/state/reservation";

type Sort = "name" | "available";

function districtStatus(d: District): MarkerStatus {
  if (d.summary.available > 0) return "available";
  if (d.summary.reserved > 0) return "reserved";
  return "unavailable";
}

export default function DistrictsScreen() {
  const { t, lang } = useLang();
  const { version } = useReservation();
  const [sort, setSort] = useState<Sort>("name");
  const [query, setQuery] = useState("");
  const [listOpen, setListOpen] = useState(false);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const map = useRef<MapViewHandle>(null);
  const fitted = useRef(false);
  const res = usePolled(() => api.districts(), [version]);

  const data = useMemo(() => {
    const arr = [...(res.data?.districts ?? [])];
    if (sort === "name") arr.sort((a, b) => pick(a, "name", lang).localeCompare(pick(b, "name", lang), lang));
    else arr.sort((a, b) => b.summary.available - a.summary.available || a.code.localeCompare(b.code));
    return arr;
  }, [res.data, sort, lang]);

  const totals = useMemo(
    () => (res.data?.districts ?? []).reduce((acc, d) => ({ available: acc.available + d.summary.available, total: acc.total + d.summary.total }), { available: 0, total: 0 }),
    [res.data],
  );

  const q = query.trim().toLowerCase();
  const matches = q ? data.filter((d) => pick(d, "name", lang).toLowerCase().includes(q)) : [];
  const selected = data.find((d) => d.code === selectedCode) ?? null;

  const openDistrict = (code: string) => router.navigate({ pathname: "/", params: { district: code } });

  useEffect(() => {
    if (!res.data) return;
    const fit = !fitted.current;
    fitted.current = true;
    map.current?.send({
      type: "setDistricts",
      fit,
      districts: res.data.districts.map((d) => {
        const name = pick(d, "name", lang);
        const s = d.summary;
        return {
          code: d.code,
          status: districtStatus(d),
          selected: d.code === selectedCode,
          a11y: `${name}, ${t("station.available", { available: s.available, total: s.total })}, ${t("districts.dc", { available: s.dc_available, total: s.dc_total })}, ${t("districts.ac", { available: s.ac_available, total: s.ac_total })}`,
        };
      }),
    });
  }, [res.data, selectedCode, lang, t]);

  const onMapMessage = (msg: MapOutboundMessage) => {
    if (msg.type !== "districtPress") return;
    if (msg.code === selectedCode) openDistrict(msg.code);
    else setSelectedCode(msg.code);
  };

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>{t("districts.title")}</Text>
        {res.data ? <Text style={styles.total}>{t("station.available", totals)}</Text> : null}
      </View>
      <View style={styles.toolbar}>
        <View style={styles.searchBox}>
          <Icon name="magnify" size={20} color={colors.textMuted} />
          <TextInput
            value={query}
            onChangeText={(v) => {
              setQuery(v);
              setListOpen(true);
            }}
            placeholder={t("districts.searchPlaceholder")}
            placeholderTextColor={colors.textFaint}
            style={styles.searchInput}
            accessibilityLabel={t("districts.searchPlaceholder")}
            returnKeyType="search"
          />
          {query ? (
            <Pressable
              onPress={() => {
                setQuery("");
                setListOpen(false);
              }}
              accessibilityRole="button"
              accessibilityLabel={t("common.close")}
              hitSlop={8}
              style={styles.clearBtn}
            >
              <Icon name="close-circle" size={18} color={colors.textFaint} />
            </Pressable>
          ) : null}
        </View>
        <View style={styles.sortRow}>
          <Chip label={t("districts.sortName")} selected={sort === "name"} onPress={() => setSort("name")} />
          <Chip label={t("districts.sortAvailable")} selected={sort === "available"} onPress={() => setSort("available")} />
        </View>
      </View>
      {res.loading && !res.data ? (
        <Skeleton rows={4} />
      ) : res.error && !res.data ? (
        <ErrorState message={errorMessage(res.error, lang)} onRetry={() => void res.reload()} />
      ) : (
        <View style={styles.mapWrap}>
          <MapView ref={map} lang={lang} onMessage={onMapMessage} style={StyleSheet.absoluteFill} accessibilityLabel={t("districts.mapA11y")} />
          <View style={styles.legend} accessibilityRole="text" pointerEvents="none">
            <LegendDot color={colors.success} label={t("districts.legendAvailable")} />
            <LegendDot color={colors.warning} label={t("districts.legendReserved")} />
            <LegendDot color="#6b7280" label={t("districts.legendNone")} />
          </View>
          {listOpen && q ? (
            <View style={styles.results}>
              {matches.length === 0 ? (
                <Text style={styles.resultEmpty}>{t("districts.noMatch")}</Text>
              ) : (
                matches.slice(0, 6).map((d) => {
                  const name = pick(d, "name", lang);
                  return (
                    <Pressable
                      key={d.code}
                      onPress={() => {
                        setSelectedCode(d.code);
                        setListOpen(false);
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={`${name}, ${t("station.available", { available: d.summary.available, total: d.summary.total })}`}
                      style={({ pressed }) => [styles.result, pressed && { backgroundColor: colors.surfaceAlt }]}
                    >
                      <Text style={styles.resultName}>{name}</Text>
                      <Text style={styles.resultCount}>{t("station.available", { available: d.summary.available, total: d.summary.total })}</Text>
                    </Pressable>
                  );
                })
              )}
            </View>
          ) : null}
          {selected ? <Callout d={selected} onOpen={() => openDistrict(selected.code)} /> : null}
        </View>
      )}
    </View>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

function Callout({ d, onOpen }: { d: District; onOpen: () => void }) {
  const { t, lang } = useLang();
  const s = d.summary;
  const name = pick(d, "name", lang);
  return (
    <View style={styles.callout} accessibilityRole="summary">
      <Text style={styles.calloutName}>{name}</Text>
      <Text style={styles.calloutCount}>{t("station.available", { available: s.available, total: s.total })}</Text>
      <Text style={styles.calloutMeta}>
        {t("districts.dc", { available: s.dc_available, total: s.dc_total })} · {t("districts.ac", { available: s.ac_available, total: s.ac_total })} · {t("districts.stations", { count: d.station_count })}
      </Text>
      <Button label={t("districts.viewStations")} icon="map-search" onPress={onOpen} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", paddingHorizontal: 16, paddingTop: 14 },
  title: { fontSize: 22, fontWeight: "800", color: colors.text },
  total: { fontSize: 13.5, color: colors.textMuted, fontWeight: "600" },
  toolbar: { paddingHorizontal: 12, paddingTop: 8, gap: 8 },
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
  searchInput: { flex: 1, fontSize: 16, color: colors.text, minHeight: MIN_TOUCH, paddingVertical: 0 },
  clearBtn: { minWidth: MIN_TOUCH, minHeight: MIN_TOUCH, alignItems: "center", justifyContent: "center" },
  sortRow: { flexDirection: "row", gap: 8 },
  legend: {
    position: "absolute",
    top: 8,
    left: 8,
    maxWidth: "92%",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    backgroundColor: "rgba(255,255,255,0.92)",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 12, height: 12, borderRadius: 3 },
  legendText: { fontSize: 12, color: colors.textMuted, fontWeight: "600" },
  mapWrap: { flex: 1, minHeight: 280, marginTop: 8 },
  results: {
    position: "absolute",
    top: 8,
    left: 12,
    right: 12,
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
    zIndex: 3,
    elevation: 6,
  },
  result: { minHeight: MIN_TOUCH, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  resultName: { fontSize: 15, fontWeight: "700", color: colors.text },
  resultCount: { fontSize: 13, fontWeight: "600", color: colors.textMuted },
  resultEmpty: { padding: 14, color: colors.textMuted },
  callout: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 12,
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 14,
    gap: 4,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  calloutName: { fontSize: 18, fontWeight: "800", color: colors.text },
  calloutCount: { fontSize: 15, fontWeight: "700", color: colors.success },
  calloutMeta: { fontSize: 13, color: colors.textMuted, marginBottom: 8 },
});
