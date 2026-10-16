import type { MapInboundMessage, MapOutboundMessage } from "@seoul-ev/shared";
import { useImperativeHandle, useRef, useState, type ComponentType, type Ref } from "react";
import { StyleSheet, Text, View } from "react-native";
import { WebView as RNWebView, type WebViewMessageEvent, type WebViewProps } from "react-native-webview";
import { api } from "@/api/client";
import { MessageCache, type MapViewProps } from "./types";

type WebViewHandle = { injectJavaScript: (script: string) => void };
// The package ships class-component typings that React 19's JSX types reject.
const WebView = RNWebView as unknown as ComponentType<WebViewProps & { ref?: Ref<WebViewHandle> }>;

/** Native map: the backend-served /map page inside react-native-webview. */
export function MapView({ ref, lang, onMessage, style, accessibilityLabel }: MapViewProps) {
  const web = useRef<WebViewHandle>(null);
  const cache = useRef(new MessageCache());
  const ready = useRef(false);
  const [failed, setFailed] = useState(false);

  const inject = (msg: MapInboundMessage) => {
    web.current?.injectJavaScript(`window.__onAppMessage && window.__onAppMessage(${JSON.stringify(JSON.stringify(msg))}); true;`);
  };

  useImperativeHandle(ref, () => ({
    send: (msg) => {
      cache.current.remember(msg);
      if (ready.current) inject(msg);
    },
  }));

  return (
    <View style={[styles.wrap, style]} accessibilityLabel={accessibilityLabel}>
      <WebView
        ref={web}
        key={lang}
        source={{ uri: api.mapUrl(lang) }}
        originWhitelist={["*"]}
        javaScriptEnabled
        domStorageEnabled
        setSupportMultipleWindows={false}
        onLoadStart={() => {
          ready.current = false;
        }}
        onError={() => setFailed(true)}
        onMessage={(e: WebViewMessageEvent) => {
          let msg: MapOutboundMessage;
          try {
            msg = JSON.parse(e.nativeEvent.data) as MapOutboundMessage;
          } catch {
            return;
          }
          if (msg.type === "ready") {
            ready.current = true;
            setFailed(false);
            cache.current.all().forEach(inject);
          }
          onMessage(msg);
        }}
        style={styles.web}
      />
      {failed ? (
        <View style={styles.fail}>
          <Text style={styles.failText}>Map unavailable / 지도를 불러올 수 없습니다</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { overflow: "hidden", backgroundColor: "#e8eef1" },
  web: { flex: 1, backgroundColor: "#e8eef1" },
  fail: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center", backgroundColor: "#e8eef1" },
  failText: { color: "#4b5563" },
});
