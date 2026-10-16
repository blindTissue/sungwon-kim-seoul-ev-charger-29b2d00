import type { StationDetail } from "@seoul-ev/shared";
import { router } from "expo-router";
import { FlatList, StyleSheet, Text, View } from "react-native";
import { api, ApiError } from "@/api/client";
import { StationCard } from "@/components/StationCard";
import { colors } from "@/components/theme";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui";
import { usePolled } from "@/hooks/usePolled";
import { errorMessage, useLang } from "@/i18n";
import { useReservation } from "@/state/reservation";
import { useSettings } from "@/state/settings";

export default function FavoritesScreen() {
  const { t, lang } = useLang();
  const { favorites } = useSettings();
  const { version } = useReservation();
  const res = usePolled<StationDetail[]>(
    async () => {
      const results = await Promise.all(favorites.map((id) => api.station(id).catch((e) => (e instanceof ApiError && e.status === 404 ? null : Promise.reject(e)))));
      return results.filter((s): s is StationDetail => s !== null);
    },
    [favorites.join(","), version],
  );

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>{t("favorites.title")}</Text>
      {favorites.length === 0 ? (
        <EmptyState icon="star-outline" message={t("favorites.empty")} />
      ) : res.loading && !res.data ? (
        <Skeleton rows={3} />
      ) : res.error && !res.data ? (
        <ErrorState message={errorMessage(res.error, lang)} onRetry={() => void res.reload()} />
      ) : (
        <FlatList
          data={res.data ?? []}
          keyExtractor={(s) => s.id}
          contentContainerStyle={{ paddingBottom: 24 }}
          renderItem={({ item }) => <StationCard station={item} onPress={() => router.push(`/station/${item.id}`)} />}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  title: { fontSize: 22, fontWeight: "800", color: colors.text, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 4 },
});
