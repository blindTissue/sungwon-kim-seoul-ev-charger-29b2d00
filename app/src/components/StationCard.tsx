import type { RouteSummary, StationSummary } from "@seoul-ev/shared";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { pick, useLang } from "@/i18n";
import { formatDistance, formatDuration } from "@/lib/format";
import { colors } from "./theme";
import { Icon, MarkerBadge } from "./ui";

export function StationCard({
  station,
  route,
  showEta = true,
  onPress,
  actions,
  highlight,
}: {
  station: StationSummary;
  route?: RouteSummary | null;
  showEta?: boolean;
  onPress?: () => void;
  actions?: ReactNode;
  highlight?: boolean;
}) {
  const { t, lang } = useLang();
  const s = station.summary;
  const name = pick(station, "name", lang);
  const availLabel = t("station.available", { available: s.available, total: s.total });
  const dist = route ? route.distance_m : station.distance_m;
  const connectors = station.connectors.map((c) => t(`connector.${c}`)).join(" · ");
  const a11y = [
    name,
    availLabel,
    dist !== null && dist !== undefined ? formatDistance(dist, lang) : null,
    route && showEta ? t("nearest.eta", { eta: formatDuration(route.duration_s, lang) }) : null,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <View style={[styles.card, highlight && styles.highlight]}>
      <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={a11y} style={({ pressed }) => [styles.main, pressed && { opacity: 0.8 }]}>
        <View style={styles.row}>
          <Text style={styles.name} numberOfLines={2}>
            {name}
          </Text>
          {route && showEta ? (
            <View style={styles.eta}>
              <Icon name="car" size={15} color={colors.primary} />
              <Text style={styles.etaText}>{formatDuration(route.duration_s, lang)}</Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.sub} numberOfLines={1}>
          {t(`siteType.${station.site_type}`)}
          {dist !== null && dist !== undefined ? ` · ${formatDistance(dist, lang)}` : ""}
        </Text>
        <View style={[styles.row, { marginTop: 8, justifyContent: "flex-start", gap: 8, flexWrap: "wrap" }]}>
          <MarkerBadge status={station.marker_status} label={availLabel} />
          <Text style={styles.meta}>
            {t("districts.dc", { available: s.dc_available, total: s.dc_total })} · {t("districts.ac", { available: s.ac_available, total: s.ac_total })}
          </Text>
        </View>
        <Text style={styles.connectors} numberOfLines={1}>
          {connectors} · {station.max_power_kw}kW
        </Text>
      </Pressable>
      {actions ? <View style={styles.actions}>{actions}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: 14, marginHorizontal: 12, marginTop: 10, borderWidth: 1, borderColor: colors.border, overflow: "hidden" },
  highlight: { borderColor: colors.primary, borderWidth: 2 },
  main: { padding: 14 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  name: { fontSize: 16, fontWeight: "700", color: colors.text, flex: 1 },
  eta: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#dbeafe", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  etaText: { color: colors.primary, fontWeight: "800", fontSize: 15 },
  sub: { color: colors.textMuted, fontSize: 13.5, marginTop: 2 },
  meta: { color: colors.textMuted, fontSize: 12.5 },
  connectors: { color: colors.textFaint, fontSize: 12.5, marginTop: 6 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: 12, paddingBottom: 12 },
});
