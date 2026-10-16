import type { ChargerStatus, MarkerStatus } from "@seoul-ev/shared";

export const colors = {
  primary: "#1d4ed8",
  primaryDark: "#1e3a8a",
  text: "#111827",
  textMuted: "#4b5563",
  textFaint: "#6b7280",
  border: "#e5e7eb",
  surface: "#ffffff",
  surfaceAlt: "#f3f4f6",
  background: "#f8fafc",
  danger: "#dc2626",
  warning: "#d97706",
  success: "#16a34a",
  info: "#0369a1",
};

/** §6 status colors. Always paired with an icon and a text label (never color alone). */
export const statusStyle: Record<ChargerStatus, { color: string; bg: string; icon: string }> = {
  available: { color: "#15803d", bg: "#dcfce7", icon: "check-circle" },
  charging: { color: "#4b5563", bg: "#e5e7eb", icon: "flash" },
  reserved: { color: "#b45309", bg: "#fef3c7", icon: "timer-sand" },
  out_of_order: { color: "#b91c1c", bg: "#fee2e2", icon: "close-octagon" },
  unknown: { color: "#6b7280", bg: "#f3f4f6", icon: "help-circle" },
};

export const markerStyle: Record<MarkerStatus, { color: string; bg: string; icon: string }> = {
  available: { color: "#15803d", bg: "#dcfce7", icon: "check-circle" },
  reserved: { color: "#b45309", bg: "#fef3c7", icon: "timer-sand" },
  unavailable: { color: "#4b5563", bg: "#e5e7eb", icon: "minus-circle" },
};

export const MIN_TOUCH = 44;
