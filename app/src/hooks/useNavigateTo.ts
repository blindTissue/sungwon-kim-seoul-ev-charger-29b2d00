import { useCallback } from "react";
import { useLang } from "@/i18n";
import { openNavigation, type NavTarget } from "@/lib/navigation";
import { useLocation } from "@/state/location";

/** Opens KakaoMap from the user's location (GPS or demo location) to `target`. */
export function useNavigateTo(): (target: NavTarget) => void {
  const { t } = useLang();
  const { user } = useLocation();
  return useCallback(
    (target: NavTarget) => void openNavigation(target, user ? { label: t("home.currentLocation"), lat: user.lat, lng: user.lng } : null),
    [t, user],
  );
}
