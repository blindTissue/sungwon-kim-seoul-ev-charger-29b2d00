import { useNetInfo } from "@react-native-community/netinfo";
import { useLang } from "@/i18n";
import { Banner } from "./ui";

export function OfflineBanner() {
  const { t } = useLang();
  const net = useNetInfo();
  if (net.isConnected !== false) return null;
  return (
    <Banner tone="danger" icon="wifi-off">
      {t("errors.offline")}
    </Banner>
  );
}
