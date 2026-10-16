import type { ErrorBody } from "@seoul-ev/shared";
import { getLocales } from "expo-localization";
import i18next from "i18next";
import { initReactI18next, useTranslation } from "react-i18next";
import { ApiError } from "@/api/client";
import { en } from "./en";
import { ko } from "./ko";

export type Lang = "ko" | "en";

/** Korean is the base language; English only when the device's first locale is English. */
export function deviceLang(): Lang {
  const first = getLocales()[0]?.languageCode ?? "ko";
  return first === "en" ? "en" : "ko";
}

i18next.use(initReactI18next).init({
  resources: { ko: { translation: ko }, en: { translation: en } },
  lng: deviceLang(),
  fallbackLng: "ko",
  interpolation: { escapeValue: false },
  returnNull: false,
});

export default i18next;

export function useLang(): { lang: Lang; t: ReturnType<typeof useTranslation>["t"] } {
  const { t, i18n } = useTranslation();
  return { lang: (i18n.language === "en" ? "en" : "ko") as Lang, t };
}

/** Picks `${field}_ko` / `${field}_en` from an API object. */
export function pick<T extends object, F extends string>(obj: T, field: F, lang: Lang): string {
  const rec = obj as Record<string, unknown>;
  return String(rec[`${field}_${lang}`] ?? rec[`${field}_ko`] ?? "");
}

export function errorMessage(e: unknown, lang: Lang): string {
  if (e instanceof ApiError) {
    if (e.body) return pick(e.body as ErrorBody, "message", lang);
    if (e.network) return i18next.t("errors.network", { lng: lang });
  }
  return i18next.t("errors.generic", { lng: lang });
}
