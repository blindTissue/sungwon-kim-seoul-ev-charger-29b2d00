import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import type { ChargerStatus, MarkerStatus } from "@seoul-ev/shared";
import type { ComponentProps, ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type ColorValue, type StyleProp, type ViewStyle } from "react-native";
import { useLang } from "@/i18n";
import { colors, markerStyle, MIN_TOUCH, statusStyle } from "./theme";

type IconName = ComponentProps<typeof MaterialCommunityIcons>["name"];

export function Icon({ name, size = 18, color = colors.text }: { name: string; size?: number; color?: ColorValue }) {
  return <MaterialCommunityIcons name={name as IconName} size={size} color={color as string | undefined} />;
}

export function StatusBadge({ status, suffix }: { status: ChargerStatus; suffix?: string }) {
  const { t } = useLang();
  const s = statusStyle[status];
  const label = t(`status.${status}`);
  return (
    <View style={[styles.badge, { backgroundColor: s.bg }]} accessible accessibilityLabel={suffix ? `${label}, ${suffix}` : label}>
      <Icon name={s.icon} size={14} color={s.color} />
      <Text style={[styles.badgeText, { color: s.color }, status === "out_of_order" && styles.strike]}>{label}</Text>
      {suffix ? <Text style={[styles.badgeText, { color: s.color }]}>· {suffix}</Text> : null}
    </View>
  );
}

export function MarkerBadge({ status, label }: { status: MarkerStatus; label: string }) {
  const { t } = useLang();
  const s = markerStyle[status];
  return (
    <View style={[styles.badge, { backgroundColor: s.bg }]} accessible accessibilityLabel={`${t(`marker.${status}`)}, ${label}`}>
      <Icon name={s.icon} size={14} color={s.color} />
      <Text style={[styles.badgeText, { color: s.color }]}>{label}</Text>
    </View>
  );
}

export function Button({
  label,
  onPress,
  icon,
  variant = "primary",
  disabled,
  loading,
  style,
  accessibilityLabel,
  accessibilityHint,
  compact,
  iconOnly,
}: {
  label: string;
  onPress: () => void;
  icon?: string;
  variant?: "primary" | "secondary" | "ghost" | "danger" | "success";
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  compact?: boolean;
  /** Renders just the icon at MIN_TOUCH size; `label` becomes the screen-reader label. */
  iconOnly?: boolean;
}) {
  const v = VARIANTS[variant];
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!(disabled || loading), busy: !!loading }}
      style={({ pressed }) => [
        styles.btn,
        compact && styles.btnCompact,
        iconOnly && styles.btnIconOnly,
        { backgroundColor: v.bg, borderColor: v.border },
        (disabled || loading) && styles.btnDisabled,
        pressed && styles.pressed,
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={v.fg} size="small" /> : icon ? <Icon name={icon} size={18} color={v.fg} /> : null}
      {iconOnly ? null : (
        <Text style={[styles.btnText, { color: v.fg }]} numberOfLines={1}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

const VARIANTS = {
  primary: { bg: colors.primary, fg: "#fff", border: colors.primary },
  secondary: { bg: "#fff", fg: colors.primary, border: "#bfdbfe" },
  ghost: { bg: "transparent", fg: colors.text, border: "transparent" },
  danger: { bg: "#fff", fg: colors.danger, border: "#fecaca" },
  success: { bg: colors.success, fg: "#fff", border: colors.success },
};

export function Chip({
  label,
  selected,
  onPress,
  icon,
  accessibilityLabel,
  style,
}: {
  label: string;
  selected?: boolean;
  onPress: () => void;
  icon?: string;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      accessibilityLabel={accessibilityLabel ?? label}
      style={({ pressed }) => [styles.chip, selected && styles.chipOn, pressed && styles.pressed, style]}
    >
      {icon ? <Icon name={icon} size={15} color={selected ? "#fff" : colors.textMuted} /> : null}
      <Text style={[styles.chipText, selected && styles.chipTextOn]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

export function Banner({ tone = "info", icon, children, action }: { tone?: "info" | "warning" | "danger"; icon?: string; children: ReactNode; action?: ReactNode }) {
  const c = tone === "danger" ? { bg: "#fee2e2", fg: "#991b1b" } : tone === "warning" ? { bg: "#fef3c7", fg: "#92400e" } : { bg: "#e0f2fe", fg: "#075985" };
  return (
    <View style={[styles.banner, { backgroundColor: c.bg }]} accessibilityRole="alert">
      {icon ? <Icon name={icon} size={18} color={c.fg} /> : null}
      <Text style={[styles.bannerText, { color: c.fg }]}>{children}</Text>
      {action}
    </View>
  );
}

export function Skeleton({ rows = 3 }: { rows?: number }) {
  const { t } = useLang();
  return (
    <View accessibilityLabel={t("common.loading")} accessible>
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} style={styles.skel}>
          <View style={[styles.skelLine, { width: "60%" }]} />
          <View style={[styles.skelLine, { width: "40%", marginTop: 8 }]} />
          <View style={[styles.skelLine, { width: "75%", marginTop: 8 }]} />
        </View>
      ))}
    </View>
  );
}

export function EmptyState({ icon = "ev-station", message, action }: { icon?: string; message: string; action?: ReactNode }) {
  return (
    <View style={styles.empty}>
      <Icon name={icon} size={36} color={colors.textFaint} />
      <Text style={styles.emptyText}>{message}</Text>
      {action}
    </View>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useLang();
  return <EmptyState icon="alert-circle-outline" message={message} action={<Button label={t("common.retry")} icon="refresh" onPress={onRetry} variant="secondary" />} />;
}

export const styles = StyleSheet.create({
  badge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, alignSelf: "flex-start" },
  badgeText: { fontSize: 12.5, fontWeight: "700" },
  strike: { textDecorationLine: "line-through" },
  btn: {
    minHeight: MIN_TOUCH,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  btnIconOnly: { width: MIN_TOUCH, paddingHorizontal: 0 },
  btnCompact: { paddingHorizontal: 10 },
  btnDisabled: { opacity: 0.45 },
  btnText: { fontSize: 15, fontWeight: "700", flexShrink: 1 },
  pressed: { opacity: 0.75 },
  chip: {
    minHeight: 36,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#fff",
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 13.5, color: colors.textMuted, fontWeight: "600" },
  chipTextOn: { color: "#fff" },
  banner: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 10 },
  bannerText: { flex: 1, fontSize: 13.5, lineHeight: 18 },
  skel: { backgroundColor: "#fff", borderRadius: 12, padding: 14, marginHorizontal: 12, marginTop: 10 },
  skelLine: { height: 12, borderRadius: 6, backgroundColor: colors.surfaceAlt },
  empty: { alignItems: "center", padding: 28, gap: 12 },
  emptyText: { fontSize: 15, color: colors.textMuted, textAlign: "center", lineHeight: 21 },
});
