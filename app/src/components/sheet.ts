import { MIN_TOUCH } from "./theme";

export type SheetSnap = "peek" | "half" | "full";

export function sheetStops(stageH: number, headerH: number) {
  const peek = Math.max(headerH, MIN_TOUCH);
  const full = Math.max(peek, stageH - 56);
  const half = Math.min(full, Math.max(peek, Math.round(stageH * 0.5)));
  return { peek, half, full };
}

export function clampSheet(h: number, stageH: number, headerH: number) {
  const { peek, full } = sheetStops(stageH, headerH);
  return Math.min(full, Math.max(peek, h));
}

export function nearestSnap(h: number, stageH: number, headerH: number): SheetSnap {
  const { peek, half, full } = sheetStops(stageH, headerH);
  const points = [
    ["peek", peek],
    ["half", half],
    ["full", full],
  ] as const;
  return points.reduce((best, p) => (Math.abs(p[1] - h) < Math.abs(best[1] - h) ? p : best))[0];
}
