import { useEffect, useMemo, useRef } from "react";
import { PanResponder, View } from "react-native";
import { clampSheet, type SheetSnap } from "./sheet";
import { colors, MIN_TOUCH } from "./theme";
import { Icon } from "./ui";

export { clampSheet, nearestSnap, sheetStops, type SheetSnap } from "./sheet";

export function SheetHandle({
  height,
  stageH,
  headerH,
  snap,
  label,
  onDrag,
  onCommit,
  onTap,
}: {
  height: number;
  stageH: number;
  headerH: number;
  snap: SheetSnap;
  label: string;
  onDrag: (height: number) => void;
  onCommit: (height: number) => void;
  onTap: () => void;
}) {
  /* eslint-disable react-hooks/refs -- responder callbacks are the only readers */
  const metrics = useRef({ height, stageH, headerH, onDrag, onCommit, onTap });
  useEffect(() => {
    metrics.current = { height, stageH, headerH, onDrag, onCommit, onTap };
  }, [height, stageH, headerH, onDrag, onCommit, onTap]);
  const gesture = useRef({ startH: 0, latest: 0, moved: false });
  const handlers = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onShouldBlockNativeResponder: () => true,
        onPanResponderGrant: () => {
          const m = metrics.current;
          gesture.current = { startH: m.height, latest: m.height, moved: false };
        },
        onPanResponderMove: (_, g) => {
          if (Math.abs(g.dy) > 4) gesture.current.moved = true;
          const m = metrics.current;
          gesture.current.latest = clampSheet(gesture.current.startH - g.dy, m.stageH, m.headerH);
          m.onDrag(gesture.current.latest);
        },
        onPanResponderRelease: () => {
          if (!gesture.current.moved) metrics.current.onTap();
          else metrics.current.onCommit(gesture.current.latest);
        },
        onPanResponderTerminate: () => metrics.current.onCommit(gesture.current.latest || metrics.current.height),
      }).panHandlers,
    [],
  );
  return (
    <View {...handlers} accessible accessibilityRole="button" accessibilityLabel={label} style={hit}>
      <Icon name={snap === "full" ? "chevron-down" : "chevron-up"} size={22} color={colors.textMuted} />
      <View style={bar} />
    </View>
  );
}
/* eslint-enable react-hooks/refs */

const hit = {
  minHeight: MIN_TOUCH,
  flexDirection: "row" as const,
  alignItems: "center" as const,
  justifyContent: "center" as const,
  gap: 8,
};
const bar = { width: 36, height: 4, borderRadius: 2, backgroundColor: "#d1d5db" };
