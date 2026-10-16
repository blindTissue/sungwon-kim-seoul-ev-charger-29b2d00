import type { Place, PlaceSearchResult } from "@seoul-ev/shared";
import { DomainError } from "../domain/errors.js";
import { LANDMARKS } from "./landmarks.js";

export interface PlacesProvider {
  readonly name: "kakao" | "mock";
  search(query: string): Promise<PlaceSearchResult>;
}

const norm = (s: string) => s.toLowerCase().replace(/[\s.'·-]/g, "");

export class MockPlacesProvider implements PlacesProvider {
  readonly name = "mock" as const;

  async search(query: string): Promise<PlaceSearchResult> {
    const q = norm(query);
    const qNoStation = q.replace(/(역|station)$/, "");
    const scored = LANDMARKS.map((p) => {
      const ko = norm(p.name_ko);
      const en = norm(p.name_en);
      let score = 0;
      if (ko === q || en === q) score = 3;
      else if (ko.startsWith(q) || en.startsWith(q)) score = 2;
      else if (ko.includes(q) || en.includes(q) || (qNoStation.length >= 2 && (ko.includes(qNoStation) || en.includes(qNoStation)))) score = 1;
      return { p, score };
    })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);
    return { provider: "mock", places: scored.map((x) => x.p) };
  }
}

interface KakaoKeywordDoc {
  id: string;
  place_name: string;
  address_name: string;
  road_address_name: string;
  x: string;
  y: string;
}

// Rough bounding box of Seoul (left,bottom,right,top) used to keep results in the service area.
const SEOUL_RECT = "126.76,37.41,127.19,37.72";

/** Kakao Local keyword search. https://developers.kakao.com/docs/latest/ko/local/dev-guide#search-by-keyword */
export class KakaoPlacesProvider implements PlacesProvider {
  readonly name = "kakao" as const;
  constructor(
    private readonly restKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async search(query: string): Promise<PlaceSearchResult> {
    const url = new URL("https://dapi.kakao.com/v2/local/search/keyword.json");
    url.searchParams.set("query", query);
    url.searchParams.set("rect", SEOUL_RECT);
    url.searchParams.set("size", "15");
    let docs: KakaoKeywordDoc[];
    try {
      const res = await this.fetchImpl(url, { headers: { Authorization: `KakaoAK ${this.restKey}` }, signal: AbortSignal.timeout(4000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      docs = ((await res.json()) as { documents: KakaoKeywordDoc[] }).documents ?? [];
    } catch (e) {
      throw new DomainError("UPSTREAM_ERROR", { provider: "kakao", reason: e instanceof Error ? e.message : String(e) });
    }
    const places: Place[] = docs
      .filter((d) => (d.road_address_name || d.address_name).startsWith("서울"))
      .map((d) => ({
        id: `kakao-${d.id}`,
        name_ko: d.place_name,
        // Kakao Local returns Korean only; the app shows the Korean name in both languages.
        name_en: d.place_name,
        address_ko: d.road_address_name || d.address_name,
        address_en: d.road_address_name || d.address_name,
        lat: Number(d.y),
        lng: Number(d.x),
      }));
    return { provider: "kakao", places };
  }
}
