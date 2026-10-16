import type { Health } from "@seoul-ev/shared";
import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { api, defaultApiBaseUrl } from "@/api/client";
import { colors, MIN_TOUCH } from "@/components/theme";
import { Banner, Button, Chip } from "@/components/ui";
import { pick, useLang } from "@/i18n";
import { DEMO_LOCATIONS, useSettings } from "@/state/settings";
import { useLocation } from "@/state/location";

export default function SettingsScreen() {
  const { t, lang } = useLang();
  const settings = useSettings();
  const { resetOrigin } = useLocation();
  const [server, setServer] = useState(settings.serverUrl ?? "");
  const [health, setHealth] = useState<Health | null>(null);
  const [healthError, setHealthError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .health()
      .then((h) => !cancelled && (setHealth(h), setHealthError(false)))
      .catch(() => !cancelled && (setHealth(null), setHealthError(true)));
    return () => {
      cancelled = true;
    };
  }, [settings.serverUrl]);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>{t("settings.title")}</Text>

      <Section title={t("settings.language")}>
        <View style={styles.row}>
          <Chip label={t("settings.korean")} selected={lang === "ko"} onPress={() => settings.update({ lang: "ko" })} />
          <Chip label={t("settings.english")} selected={lang === "en"} onPress={() => settings.update({ lang: "en" })} />
        </View>
      </Section>

      <Section title={t("settings.demoLocation")} help={t("settings.demoLocationHelp")}>
        <View style={[styles.row, { flexWrap: "wrap" }]}>
          <Chip label={t("settings.demoOff")} selected={!settings.demoLocationId} onPress={() => settings.update({ demoLocationId: null })} />
          {DEMO_LOCATIONS.map((d) => (
            <Chip
              key={d.id}
              label={pick(d, "name", lang)}
              selected={settings.demoLocationId === d.id}
              onPress={() => {
                settings.update({ demoLocationId: d.id });
                resetOrigin();
              }}
            />
          ))}
        </View>
      </Section>

      <Section title={t("settings.server")} help={t("settings.serverHelp", { url: defaultApiBaseUrl() })}>
        <View style={styles.row}>
          <TextInput
            value={server}
            onChangeText={setServer}
            placeholder={defaultApiBaseUrl()}
            placeholderTextColor={colors.textFaint}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            style={styles.input}
            accessibilityLabel={t("settings.server")}
          />
          <Button label={t("settings.save")} onPress={() => settings.update({ serverUrl: server.trim() || null })} />
        </View>
        {health ? (
          <Text style={styles.help}>{t("settings.providers", health.providers)}</Text>
        ) : healthError ? (
          <Banner tone="danger" icon="lan-disconnect">
            {t("settings.serverUnreachable")}
          </Banner>
        ) : null}
      </Section>

      <Section title={t("settings.deviceId")}>
        <Text style={styles.mono} selectable>
          {settings.deviceId}
        </Text>
      </Section>

      <Text style={styles.about}>{t("settings.about")}</Text>
    </ScrollView>
  );
}

function Section({ title, help, children }: { title: string; help?: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {help ? <Text style={styles.help}>{help}</Text> : null}
      <View style={{ marginTop: 8, gap: 8 }}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  title: { fontSize: 22, fontWeight: "800", color: colors.text, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 4 },
  section: { backgroundColor: "#fff", marginTop: 12, padding: 16 },
  sectionTitle: { fontSize: 15, fontWeight: "800", color: colors.text },
  help: { fontSize: 13, color: colors.textMuted, marginTop: 4, lineHeight: 18 },
  row: { flexDirection: "row", gap: 8, alignItems: "center" },
  input: { flex: 1, minHeight: MIN_TOUCH, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12, fontSize: 15, color: colors.text },
  mono: { fontFamily: "monospace", fontSize: 13, color: colors.textMuted },
  about: { margin: 16, fontSize: 12.5, color: colors.textFaint, lineHeight: 18 },
});
