import type { MapInboundMessage, MapOutboundMessage } from "@seoul-ev/shared";
import { createElement, useEffect, useImperativeHandle, useLayoutEffect, useRef } from "react";
import { StyleSheet, View } from "react-native";
import { api } from "@/api/client";
import { MessageCache, type MapViewProps } from "./types";

/** Web map: the same backend-served /map page in an iframe, bridged with postMessage. */
export function MapView({ ref, lang, onMessage, style, accessibilityLabel }: MapViewProps) {
  const frame = useRef<HTMLIFrameElement | null>(null);
  const cache = useRef(new MessageCache());
  const ready = useRef(false);
  const onMessageRef = useRef(onMessage);
  useLayoutEffect(() => {
    onMessageRef.current = onMessage;
  });
  useEffect(() => {
    ready.current = false;
  }, [lang]);

  const post = (msg: MapInboundMessage) => frame.current?.contentWindow?.postMessage(JSON.stringify({ __evapp: true, msg }), "*");

  useImperativeHandle(ref, () => ({
    send: (msg) => {
      cache.current.remember(msg);
      if (ready.current) post(msg);
    },
  }));

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (!frame.current || e.source !== frame.current.contentWindow || typeof e.data !== "string") return;
      let data: { __evmap?: boolean; msg?: MapOutboundMessage };
      try {
        data = JSON.parse(e.data);
      } catch {
        return;
      }
      if (!data.__evmap || !data.msg) return;
      if (data.msg.type === "ready") {
        ready.current = true;
        cache.current.all().forEach(post);
      }
      onMessageRef.current(data.msg);
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  return (
    <View style={[styles.wrap, style]} accessibilityLabel={accessibilityLabel}>
      {createElement("iframe", {
        key: lang,
        ref: frame,
        src: api.mapUrl(lang),
        title: accessibilityLabel ?? "map",
        style: { border: 0, width: "100%", height: "100%", display: "block" },
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { overflow: "hidden", backgroundColor: "#e8eef1" },
});
