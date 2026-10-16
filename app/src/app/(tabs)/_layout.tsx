import { Tabs } from "expo-router";
import { Icon } from "@/components/ui";
import { colors } from "@/components/theme";
import { useLang } from "@/i18n";

export default function TabsLayout() {
  const { t } = useLang();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarLabelStyle: { fontSize: 12, fontWeight: "600" },
        tabBarStyle: { minHeight: 56 },
      }}
    >
      <Tabs.Screen name="index" options={{ title: t("tabs.map"), tabBarIcon: ({ color }) => <Icon name="map-marker-radius" size={24} color={color} /> }} />
      <Tabs.Screen name="districts" options={{ title: t("tabs.districts"), tabBarIcon: ({ color }) => <Icon name="view-grid-outline" size={24} color={color} /> }} />
      <Tabs.Screen name="favorites" options={{ title: t("tabs.favorites"), tabBarIcon: ({ color }) => <Icon name="star-outline" size={24} color={color} /> }} />
      <Tabs.Screen name="settings" options={{ title: t("tabs.settings"), tabBarIcon: ({ color }) => <Icon name="cog-outline" size={24} color={color} /> }} />
    </Tabs>
  );
}
