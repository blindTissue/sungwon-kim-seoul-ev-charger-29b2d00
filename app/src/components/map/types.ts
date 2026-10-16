import type { MapInboundMessage, MapOutboundMessage } from "@seoul-ev/shared";
import type { Ref } from "react";
import type { StyleProp, ViewStyle } from "react-native";

export interface MapViewHandle {
  send: (msg: MapInboundMessage) => void;
}

export interface MapViewProps {
  ref?: Ref<MapViewHandle>;
  lang: "ko" | "en";
  onMessage: (msg: MapOutboundMessage) => void;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}

/**
 * Remembers the latest message of each type so it can be replayed when the page (re)loads.
 * The page itself is provider-agnostic: Kakao Maps or the Leaflet mock, chosen by the backend.
 */
export class MessageCache {
  private latest = new Map<string, MapInboundMessage>();
  remember(msg: MapInboundMessage): void {
    this.latest.set(msg.type as string, msg);
  }
  all(): MapInboundMessage[] {
    // Markers last so they render on top of the viewport change.
    return [...this.latest.values()].sort((a, b) => Number(a.type === "setMarkers") - Number(b.type === "setMarkers"));
  }
}
