import { router } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useNow } from "@/hooks/usePolled";
import { pick, useLang } from "@/i18n";
import { formatCountdown } from "@/lib/format";
import { useNavigateTo } from "@/hooks/useNavigateTo";
import { useReservation } from "@/state/reservation";
import { colors } from "./theme";
import { Button, Icon } from "./ui";

/** §5: persistent banner on every screen while a reservation is active (or a cooldown runs). */
export function ReservationBanner() {
  const { t, lang } = useLang();
  const navigateTo = useNavigateTo();
  const { active, station, cooldownUntil, skewMs, busy, cancel, arrive } = useReservation();
  const now = useNow(!!active || !!cooldownUntil) + skewMs;

  if (!active) {
    if (cooldownUntil && cooldownUntil > now) {
      return (
        <View style={[styles.wrap, styles.cooldown]} accessibilityRole="alert">
          <Icon name="timer-off-outline" size={18} color="#92400e" />
          <Text style={styles.cooldownText}>{t("reservation.cooldown", { time: formatCountdown(cooldownUntil - now) })}</Text>
        </View>
      );
    }
    return null;
  }

  const remaining = Date.parse(active.expires_at) - now;
  const name = station ? pick(station, "name", lang) : active.station_id;
  const urgent = remaining < 2 * 60_000;
  return (
    <View style={styles.wrap} accessibilityRole="summary">
      <Pressable
        style={styles.top}
        onPress={() => router.push(`/station/${active.station_id}`)}
        accessibilityRole="button"
        accessibilityLabel={`${t("reservation.banner", { station: name })}, ${t("reservation.remaining")} ${formatCountdown(remaining)}`}
      >
        <Icon name="timer-sand" size={20} color="#fff" />
        <Text style={styles.title} numberOfLines={1}>
          {t("reservation.banner", { station: name })}
        </Text>
        <Text style={[styles.countdown, urgent && styles.urgent]} accessibilityLiveRegion="polite">
          {formatCountdown(remaining)}
        </Text>
      </Pressable>
      <View style={styles.actions}>
        <Button compact label={t("reservation.arrived")} icon="ev-plug-type2" variant="success" onPress={arrive} loading={busy} style={styles.arrive} />
        <Button
          compact
          label={t("reservation.navigate")}
          icon="navigation-variant"
          variant="secondary"
          onPress={() => station && navigateTo({ name: pick(station, "name", lang), lat: station.lat, lng: station.lng })}
        />
        <Button compact label={t("reservation.cancel")} variant="danger" onPress={cancel} disabled={busy} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: colors.primaryDark, paddingHorizontal: 10, paddingVertical: 8, gap: 8 },
  top: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 32 },
  title: { color: "#fff", fontWeight: "700", fontSize: 15, flex: 1 },
  countdown: { color: "#fde68a", fontWeight: "800", fontSize: 20, fontVariant: ["tabular-nums"] },
  urgent: { color: "#fca5a5" },
  actions: { flexDirection: "row", gap: 6 },
  arrive: { flex: 1 },
  cooldown: { backgroundColor: "#fef3c7", flexDirection: "row", alignItems: "center" },
  cooldownText: { color: "#92400e", fontWeight: "600", flex: 1 },
});
