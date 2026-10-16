import { Linking, Platform } from "react-native";

export interface NavTarget {
  name: string;
  lat: number;
  lng: number;
}

/** Start point: the user's location (GPS or demo location), never a searched place. */
export interface NavStart {
  label: string;
  lat: number;
  lng: number;
}

export const kakaoAppUrl = (t: NavTarget, from?: NavStart | null) =>
  from ? `kakaomap://route?sp=${from.lat},${from.lng}&ep=${t.lat},${t.lng}&by=CAR` : `kakaomap://route?ep=${t.lat},${t.lng}&by=CAR`;

const linkPoint = (name: string, lat: number, lng: number) => `${encodeURIComponent(name.replace(/,/g, " "))},${lat},${lng}`;

export const kakaoWebUrl = (t: NavTarget, from?: NavStart | null) =>
  from
    ? `https://map.kakao.com/link/from/${linkPoint(from.label, from.lat, from.lng)}/to/${linkPoint(t.name, t.lat, t.lng)}`
    : `https://map.kakao.com/link/to/${linkPoint(t.name, t.lat, t.lng)}`;

/**
 * §4.6: open KakaoMap with the station as destination (and the user's location as start when
 * known); fall back to the web link when the app isn't installed. openURL rejects when no app
 * handles the scheme, which is the signal we rely on (canOpenURL is unreliable for custom
 * schemes inside Expo Go). On web the link opens in a new tab.
 */
export async function openNavigation(t: NavTarget, from?: NavStart | null): Promise<"app" | "web"> {
  if (Platform.OS === "web") {
    // Linking.openURL would replace the app's page; keep the app (and its in-memory state) open.
    window.open(kakaoWebUrl(t, from), "_blank", "noopener,noreferrer");
    return "web";
  }
  try {
    await Linking.openURL(kakaoAppUrl(t, from));
    return "app";
  } catch {
    // fall through to the web link
  }
  await Linking.openURL(kakaoWebUrl(t, from));
  return "web";
}
