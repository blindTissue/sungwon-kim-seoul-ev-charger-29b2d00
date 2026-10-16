import type { Charger, RouteSummary, StationDetail } from "@seoul-ev/shared";
import { RESERVATION_MAX_ETA_S } from "@seoul-ev/shared";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { api } from "@/api/client";
import { colors, MIN_TOUCH } from "@/components/theme";
import { Banner, Button, ErrorState, Icon, MarkerBadge, Skeleton, StatusBadge } from "@/components/ui";
import { useNow, usePolled } from "@/hooks/usePolled";
import { errorMessage, pick, useLang } from "@/i18n";
import { formatCountdown, formatDistance, formatDuration, formatKrw, formatTime } from "@/lib/format";
import { useNavigateTo } from "@/hooks/useNavigateTo";
import { useDialog } from "@/state/dialog";
import { useLocation } from "@/state/location";
import { useReservation } from "@/state/reservation";
import { useSettings } from "@/state/settings";

export default function StationScreen() {
  const { id, reserve: reserveParam } = useLocalSearchParams<{ id: string; reserve?: string }>();
  const { t, lang } = useLang();
  const { user } = useLocation();
  const { isFavorite, toggleFavorite } = useSettings();
  const resv = useReservation();
  const dialog = useDialog();
  const navigateTo = useNavigateTo();
  const station = usePolled<StationDetail>(() => api.station(id), [id, resv.version]);
  const [route, setRoute] = useState<RouteSummary | null>(null);
  const now = useNow();

  const s = station.data;
  useEffect(() => {
    if (!s || !user) {
      setRoute(null);
      return;
    }
    let cancelled = false;
    api
      .route(user, s)
      .then((r) => !cancelled && setRoute(r))
      .catch(() => !cancelled && setRoute(null));
    return () => {
      cancelled = true;
    };
  }, [s?.id, user?.lat, user?.lng]);

  const back = () => (router.canGoBack() ? router.back() : router.replace("/"));
  const fav = isFavorite(id);

  if (!s) {
    return (
      <View style={styles.screen}>
        <Header title="" onBack={back} />
        {station.error ? <ErrorState message={errorMessage(station.error, lang)} onRetry={() => void station.reload()} /> : <Skeleton rows={4} />}
      </View>
    );
  }

  const etaTooLong = route !== null && route.duration_s > RESERVATION_MAX_ETA_S;
  const cooldown = resv.cooldownUntil && resv.cooldownUntil > now + resv.skewMs ? resv.cooldownUntil : null;
  const blockedReason = resv.active
    ? null
    : cooldown
      ? t("reservation.cooldown", { time: formatCountdown(cooldown - now - resv.skewMs) })
      : etaTooLong
        ? t("station.etaTooLong", { eta: formatDuration(route!.duration_s, lang) })
        : null;

  const doReserve = async (c: Charger) => {
    if (!route && !(await dialog.confirm(t("station.etaUnknownTitle"), t("station.etaUnknownWarning"), { okLabel: t("station.reserve") }))) return;
    if (await resv.reserve(c.id)) await dialog.alert(t("station.reserve"), t("station.reservedOk"));
  };

  const name = pick(s, "name", lang);
  const minPrice = Math.min(...s.chargers.map((c) => c.price_per_kwh_krw));
  const maxPrice = Math.max(...s.chargers.map((c) => c.price_per_kwh_krw));

  return (
    <View style={styles.screen}>
      <Header
        title={name}
        onBack={back}
        right={
          <Pressable
            onPress={() => toggleFavorite(id)}
            accessibilityRole="button"
            accessibilityLabel={fav ? t("station.unfavorite") : t("station.favorite")}
            accessibilityState={{ selected: fav }}
            style={styles.iconBtn}
          >
            <Icon name={fav ? "star" : "star-outline"} size={26} color={fav ? "#f59e0b" : colors.text} />
          </Pressable>
        }
      />
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        <View style={styles.section}>
          <Text style={styles.name}>{name}</Text>
          <Text style={styles.altName}>{lang === "ko" ? s.name_en : s.name_ko}</Text>
          <View style={styles.tags}>
            <View style={styles.tag}>
              <Text style={styles.tagText}>{t(`siteType.${s.site_type}`)}</Text>
            </View>
            <View style={styles.tag}>
              <Text style={styles.tagText}>{t(`lotType.${s.lot_type}`)}</Text>
            </View>
            <MarkerBadge status={s.marker_status} label={t("station.available", { available: s.summary.available, total: s.summary.total })} />
          </View>
          {route ? (
            <Text style={styles.eta}>
              <Icon name="car" size={16} color={colors.primary} /> {t("station.yourEta", { eta: formatDuration(route.duration_s, lang), dist: formatDistance(route.distance_m, lang) })}
            </Text>
          ) : null}
          <View style={styles.actions}>
            {user ? (
              <Button label={t("route.show")} icon="map-marker-path" variant="secondary" style={{ flex: 1 }} onPress={() => router.push(`/route/${s.id}`)} />
            ) : null}
            <Button label={t("station.navigate")} icon="navigation-variant" style={{ flex: 1 }} onPress={() => navigateTo({ name, lat: s.lat, lng: s.lng })} />
          </View>
        </View>

        <View style={styles.section}>
          <Info icon="map-marker-outline" label={t("station.address")} value={pick(s, "address", lang)} />
          <Info icon="clock-outline" label={t("station.hours")} value={s.open_hours === "00:00-24:00" ? t("station.open24h") : s.open_hours.replace("-", "–")} />
          <Info icon="parking" label={t("station.parkingFee")} value={pick(s, "parking_fee_note", lang)} />
          <Info
            icon="cash"
            label={t("station.price")}
            value={t("station.perKwh", { price: minPrice === maxPrice ? formatKrw(minPrice, lang) : `${formatKrw(minPrice, lang)}–${formatKrw(maxPrice, lang)}` })}
          />
          <Info icon="sign-direction" label={t("station.location")} value={pick(s, "operator_note", lang)} />
        </View>

        <Text style={styles.sectionTitle}>{t("station.chargers", { count: s.chargers.length })}</Text>
        {reserveParam && !resv.active ? <Banner icon="gesture-tap">{t("station.pickCharger")}</Banner> : null}
        {blockedReason ? (
          <Banner tone="warning" icon="timer-off-outline">
            {blockedReason}
          </Banner>
        ) : null}
        {s.chargers.map((c) => (
          <ChargerRow
            key={c.id}
            charger={c}
            now={now}
            canReserve={c.status === "available" && !resv.active && !blockedReason}
            busy={resv.busy}
            onReserve={() => void doReserve(c)}
          />
        ))}
        <Text style={styles.note}>{t("station.simulatedNote")}</Text>
      </ScrollView>
    </View>
  );
}

function ChargerRow({ charger: c, now, canReserve, busy, onReserve }: { charger: Charger; now: number; canReserve: boolean; busy: boolean; onReserve: () => void }) {
  const { t, lang } = useLang();
  const { active } = useReservation();
  const mine = active?.charger_id === c.id;
  // Countdown ticks locally and is re-anchored to the server's expires_at on every poll.
  const remaining = c.reservation ? formatCountdown(Date.parse(c.reservation.expires_at) - now) : null;
  return (
    <View style={[styles.charger, mine && styles.chargerMine]}>
      <View style={styles.chargerTop}>
        <View style={[styles.speedPill, { backgroundColor: c.speed === "DC" ? "#ede9fe" : "#e0f2fe" }]}>
          <Icon name={c.speed === "DC" ? "lightning-bolt" : "power-plug"} size={14} color={c.speed === "DC" ? "#6d28d9" : "#0369a1"} />
          <Text style={[styles.speedText, { color: c.speed === "DC" ? "#6d28d9" : "#0369a1" }]}>{t(`speed.${c.speed}`)}</Text>
        </View>
        <Text style={styles.chargerTitle}>
          {t(`connector.${c.connector}`)} · {c.power_kw}kW
        </Text>
      </View>
      <View style={styles.chargerBottom}>
        <View style={{ flex: 1, gap: 4 }}>
          <StatusBadge status={c.status} suffix={remaining ? t("station.remaining", { time: remaining }) : undefined} />
          <Text style={styles.chargerMeta}>
            {t("station.perKwh", { price: formatKrw(c.price_per_kwh_krw, lang) })} · {t("station.updated", { time: formatTime(c.status_updated_at) })}
          </Text>
        </View>
        {c.status === "available" ? (
          <Button
            compact
            label={t("station.reserve")}
            icon="timer-sand"
            onPress={onReserve}
            disabled={!canReserve}
            loading={busy && canReserve}
            accessibilityLabel={`${t("station.reserveCharger")}: ${t(`connector.${c.connector}`)} ${c.power_kw}kW`}
          />
        ) : null}
      </View>
    </View>
  );
}

function Header({ title, onBack, right }: { title: string; onBack: () => void; right?: React.ReactNode }) {
  const { t } = useLang();
  return (
    <View style={styles.header}>
      <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel={t("common.close")} style={styles.iconBtn}>
        <Icon name="arrow-left" size={24} color={colors.text} />
      </Pressable>
      <Text style={styles.headerTitle} numberOfLines={1}>
        {title}
      </Text>
      {right ?? <View style={styles.iconBtn} />}
    </View>
  );
}

function Info({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <View style={styles.info} accessible accessibilityLabel={`${label}: ${value}`}>
      <Icon name={icon} size={20} color={colors.textMuted} />
      <View style={{ flex: 1 }}>
        <Text style={styles.infoLabel}>{label}</Text>
        <Text style={styles.infoValue}>{value}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: "row", alignItems: "center", backgroundColor: "#fff", borderBottomWidth: 1, borderColor: colors.border, minHeight: 52, paddingHorizontal: 4 },
  headerTitle: { flex: 1, fontSize: 17, fontWeight: "700", color: colors.text, textAlign: "center" },
  iconBtn: { width: MIN_TOUCH + 4, height: MIN_TOUCH + 4, alignItems: "center", justifyContent: "center" },
  section: { backgroundColor: "#fff", padding: 16, marginTop: 10, gap: 6 },
  name: { fontSize: 21, fontWeight: "800", color: colors.text },
  altName: { fontSize: 14, color: colors.textFaint },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6, alignItems: "center" },
  tag: { backgroundColor: colors.surfaceAlt, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  tagText: { fontSize: 12.5, color: colors.textMuted, fontWeight: "600" },
  eta: { marginTop: 6, color: colors.primary, fontWeight: "700", fontSize: 15 },
  actions: { flexDirection: "row", gap: 8, marginTop: 10 },
  info: { flexDirection: "row", gap: 12, paddingVertical: 6 },
  infoLabel: { fontSize: 12.5, color: colors.textFaint },
  infoValue: { fontSize: 15, color: colors.text, lineHeight: 20 },
  sectionTitle: { fontSize: 15, fontWeight: "800", color: colors.text, marginTop: 18, marginBottom: 6, marginHorizontal: 16 },
  charger: { backgroundColor: "#fff", marginHorizontal: 12, marginTop: 8, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: colors.border, gap: 8 },
  chargerMine: { borderColor: colors.warning, borderWidth: 2 },
  chargerTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  speedPill: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  speedText: { fontSize: 12.5, fontWeight: "800" },
  chargerTitle: { fontSize: 15, fontWeight: "700", color: colors.text },
  chargerBottom: { flexDirection: "row", alignItems: "center", gap: 8 },
  chargerMeta: { fontSize: 12, color: colors.textFaint },
  note: { textAlign: "center", color: colors.textFaint, fontSize: 12, marginTop: 20, paddingHorizontal: 24 },
});
