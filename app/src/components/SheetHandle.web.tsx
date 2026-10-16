import { createElement, useLayoutEffect, useRef, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { View } from "react-native";
import { clampSheet, type SheetSnap } from "./sheet";
import { colors, MIN_TOUCH } from "./theme";
import { Icon } from "./ui";

/** Web: capture the pointer on the handle so the map iframe and the list cannot steal the drag. Snap only on release. */
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
  /* eslint-disable react-hooks/refs -- pointer callbacks are the only readers */
  const metrics = useRef({ height, stageH, headerH, onDrag, onCommit, onTap });
  useLayoutEffect(() => {
    metrics.current = { height, stageH, headerH, onDrag, onCommit, onTap };
  }, [height, stageH, headerH, onDrag, onCommit, onTap]);
  const gesture = useRef({ y0: 0, h0: 0, latest: 0, moved: false, id: -1, skipClick: false });
  const raf = useRef(0);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const m = metrics.current;
    gesture.current = { y0: e.clientY, h0: m.height, latest: m.height, moved: false, id: e.pointerId, skipClick: false };
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (gesture.current.id !== e.pointerId) return;
    const dy = e.clientY - gesture.current.y0;
    if (Math.abs(dy) > 4) gesture.current.moved = true;
    if (!gesture.current.moved) return;
    e.preventDefault();
    const m = metrics.current;
    gesture.current.latest = clampSheet(gesture.current.h0 - dy, m.stageH, m.headerH);
    if (!raf.current) {
      raf.current = requestAnimationFrame(() => {
        raf.current = 0;
        metrics.current.onDrag(gesture.current.latest);
      });
    }
  };
  const end = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (gesture.current.id !== e.pointerId) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    gesture.current.id = -1;
    if (raf.current) {
      cancelAnimationFrame(raf.current);
      raf.current = 0;
    }
    if (!gesture.current.moved) {
      gesture.current.skipClick = true;
      metrics.current.onTap();
    } else {
      gesture.current.skipClick = true;
      metrics.current.onCommit(gesture.current.latest);
    }
  };

  return createElement(
    "div",
    {
      role: "button",
      "aria-label": label,
      onPointerDown,
      onPointerMove,
      onPointerUp: end,
      onPointerCancel: end,
      onClick: (e: ReactMouseEvent<HTMLDivElement>) => {
        if (gesture.current.skipClick) {
          gesture.current.skipClick = false;
          return;
        }
        e.stopPropagation();
        metrics.current.onTap();
      },
      style: {
        minHeight: MIN_TOUCH,
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        touchAction: "none",
        cursor: "ns-resize",
        userSelect: "none",
      },
    },
    <Icon name={snap === "full" ? "chevron-down" : "chevron-up"} size={22} color={colors.textMuted} />,
    <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: "#d1d5db" }} />,
  );
}
/* eslint-enable react-hooks/refs */
