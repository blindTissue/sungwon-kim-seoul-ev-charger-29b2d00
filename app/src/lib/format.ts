import type { Lang } from "@/i18n";

export function formatDistance(m: number, lang: Lang): string {
  if (m < 1000) return lang === "ko" ? `${Math.round(m)}m` : `${Math.round(m)} m`;
  const km = (m / 1000).toFixed(m < 10_000 ? 1 : 0);
  return lang === "ko" ? `${km}km` : `${km} km`;
}

export function formatDuration(s: number, lang: Lang): string {
  const min = Math.max(1, Math.round(s / 60));
  if (min < 60) return lang === "ko" ? `${min}분` : `${min} min`;
  const h = Math.floor(min / 60);
  const rest = min % 60;
  return lang === "ko" ? `${h}시간 ${rest}분` : `${h} h ${rest} min`;
}

export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function formatKrw(n: number, lang: Lang): string {
  const v = n.toLocaleString(lang === "ko" ? "ko-KR" : "en-US", { maximumFractionDigits: 1 });
  return lang === "ko" ? `${v}원` : `KRW ${v}`;
}

/** 24-hour local time, e.g. "14:05". */
export function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
