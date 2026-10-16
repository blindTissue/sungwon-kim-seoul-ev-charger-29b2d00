import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("defaults to mock providers with no keys", () => {
    const c = loadConfig({});
    expect([c.routingProvider, c.placesProvider, c.mapProvider]).toEqual(["mock", "mock", "mock"]);
    expect(c.kakaoRestKey).toBeNull();
  });

  it("accepts KAKAO_REST_API / KAKAO_JS as aliases", () => {
    const c = loadConfig({ KAKAO_REST_API: "rest", KAKAO_JS: "js", ROUTING_PROVIDER: "kakao", PLACES_PROVIDER: "kakao", MAP_PROVIDER: "kakao" });
    expect(c.kakaoRestKey).toBe("rest");
    expect(c.kakaoMobilityKey).toBe("rest");
    expect(c.kakaoJsKey).toBe("js");
  });

  it("prefers the *_KEY names over the aliases", () => {
    const c = loadConfig({ KAKAO_REST_API_KEY: "a", KAKAO_REST_API: "b", KAKAO_JS_KEY: "c", KAKAO_JS: "d", KAKAO_MOBILITY_API_KEY: "m" });
    expect([c.kakaoRestKey, c.kakaoJsKey, c.kakaoMobilityKey]).toEqual(["a", "c", "m"]);
  });

  it("fails fast when a kakao provider has no key", () => {
    expect(() => loadConfig({ PLACES_PROVIDER: "kakao" })).toThrow(/KAKAO_REST_API/);
  });
});
