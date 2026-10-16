import "@/i18n";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { StyleSheet, View } from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { OfflineBanner } from "@/components/OfflineBanner";
import { ReservationBanner } from "@/components/ReservationBanner";
import { colors } from "@/components/theme";
import { DialogProvider } from "@/state/dialog";
import { LocationProvider } from "@/state/location";
import { ReservationProvider } from "@/state/reservation";
import { SettingsProvider } from "@/state/settings";

function Shell() {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <StatusBar style="dark" />
      <ReservationBanner />
      <OfflineBanner />
      <View style={styles.body}>
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="station/[id]" />
          <Stack.Screen name="route/[id]" />
        </Stack>
      </View>
    </View>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SettingsProvider>
        <DialogProvider>
          <LocationProvider>
            <ReservationProvider>
              <Shell />
            </ReservationProvider>
          </LocationProvider>
        </DialogProvider>
      </SettingsProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#fff" },
  body: { flex: 1 },
});
