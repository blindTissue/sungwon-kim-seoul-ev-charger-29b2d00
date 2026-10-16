# 서울 EV 충전 · Seoul EV Charger (MVP)

Find the nearest **available** EV charger in Seoul and hold it for **10 minutes** while you drive there.

- `app/` — Expo (React Native, TypeScript, expo-router) app for iOS, Android and web. Korean first, English second.
- `server/` — Fastify + TypeScript backend. It uses a SQLite mock store with a seeded availability simulator, sitting behind repository interfaces.
- `shared/` — TypeScript types generated from `docs/openapi.yaml`, plus shared constants.
- `docs/` — `openapi.yaml` (the API contract) and `architecture.md`.

> **All availability data is simulated.** The 200 station locations are derived from OpenStreetMap: real public parking lots, community centers, district offices and marts in all 25 districts. The chargers, their statuses and the reservations are synthetic. Map data © OpenStreetMap contributors (ODbL).

## Quick start

Requirements: Node 20+, npm 10+, and Docker (optional).

```bash
cp .env.example .env            # optional: every value has a mock default
docker compose up --build       # backend on http://localhost:3000 (debug endpoints on)
# or, without Docker:
npm install && npm run dev:server

cd app && npm install
npx expo start                  # press w for web, or scan the QR code with Expo Go
```

Check the backend with `curl localhost:3000/health`.

### Pointing the app at the backend

The app picks the backend URL in this order:

1. **Settings → Server URL** inside the app.
2. `EXPO_PUBLIC_API_URL`, for example `EXPO_PUBLIC_API_URL=http://192.168.0.10:3000 npx expo start`.
3. On web: the page's hostname on port 3000.
4. In Expo Go: the dev server's LAN IP on port 3000. This works automatically when the phone and computer share Wi-Fi.
5. Otherwise, `http://localhost:3000`.

If you use `npx expo start --tunnel`, the phone can't reach port 3000 on your computer. Expose the backend too (for example `npx localtunnel --port 3000` or `cloudflared tunnel --url http://localhost:3000`) and set `EXPO_PUBLIC_API_URL` or the in-app Server URL to that address.

## Configuration

Every variable is listed with comments in [`.env.example`](.env.example).

| Variable | Default | Purpose |
|---|---|---|
| `ROUTING_PROVIDER` / `PLACES_PROVIDER` / `MAP_PROVIDER` | `mock` | Set to `kakao` to use the real Kakao APIs |
| `KAKAO_REST_API_KEY` (alias `KAKAO_REST_API`) | — | Kakao Local search, and Mobility directions unless a separate key is set |
| `KAKAO_MOBILITY_API_KEY` | REST key | Optional separate key for Kakao Mobility directions |
| `KAKAO_JS_KEY` (alias `KAKAO_JS`) | — | Kakao Maps JavaScript SDK used on the `/map` page |
| `DB_PATH` | `:memory:` | SQLite file. With the default, the database reseeds on every start |
| `SIM_SEED` / `SIM_SPEED` / `SIM_TICK_MS` / `SIM_ENABLED` | `42` / `1` / `30000` / `true` | Availability simulator settings |
| `DEBUG_ENDPOINTS` | `false` (compose: `true`) | Enables the `/debug/*` demo controls |

### Kakao keys

The **app never sees a REST key**. Routing and place search are proxied through the backend (`/route`, `/places/search`). The map is a backend-served page at `/map`, rendered in a WebView, or in an iframe on web.

- `KAKAO_REST_API_KEY` and `KAKAO_JS_KEY` are the canonical names. **`KAKAO_REST_API` and `KAKAO_JS` are accepted as aliases** to match the Cursor Cloud Agent secret names. The `*_KEY` name wins if both are set.
- Docker Compose passes `KAKAO_REST_API` / `KAKAO_JS` through from the host environment when they are set. You can also put any of the names in `.env`.
- A provider only uses Kakao when its `*_PROVIDER` is set to `kakao`. The server refuses to start if a provider is set to `kakao` but its key is missing.
- For the JS key, register the backend's origin (for example `http://localhost:3000`, or your LAN or tunnel URL) as a Web platform domain in Kakao Developers.

Example of real Kakao routing and search with the OSM map:

```bash
ROUTING_PROVIDER=kakao PLACES_PROVIDER=kakao KAKAO_REST_API=xxxx docker compose up --build
```

## Tests and checks

```bash
npm test             # backend: reservations, concurrency, ranking, filters, simulator, contract, config
npm run typecheck    # shared, server and app
npm run gen:types    # regenerate shared/src/generated/openapi.ts after editing docs/openapi.yaml
cd app && npx expo lint
```

## Demo controls (`DEBUG_ENDPOINTS=true`)

```bash
API=http://localhost:3000
curl -X POST $API/debug/chargers/ST11680-01-C1/status -H 'content-type: application/json' -d '{"status":"out_of_order"}'
curl -X POST $API/debug/reservations/<reservationId>/fast-forward          # expire now (no-show → 15 min cooldown)
curl -X POST $API/debug/reservations/<reservationId>/fast-forward -H 'content-type: application/json' -d '{"seconds":540}'
curl -X DELETE $API/debug/devices/<deviceId>/cooldown                      # clear a cooldown
curl -X POST $API/debug/simulator -H 'content-type: application/json' -d '{"speed":20}'
curl -X POST $API/debug/reset                                             # reseed everything
curl -H 'X-Device-Id: <deviceId>' $API/reservations/active                # find a device's reservation id
```

The device ID is shown under **Settings → Device ID**.

## Demo script

### A. Verified on the VM (Expo web + API)

An automated headless-Chrome run at 360 px wide, with the Gangnam demo location and mock providers, covered acceptance criteria 2–10 using two or three browser contexts as separate devices. To rerun it, start the backend with debug endpoints on and run `npx expo start --web --port 8081` in `app/`. Then run `cd tools/e2e && npm install && npm run e2e`; set `CHROME_PATH` if Chrome isn't at `/usr/local/bin/google-chrome`. The run calls `/debug/reset`, so don't point it at a backend someone else is using. Start a separate one instead (`cd server && PORT=3001 DEBUG_ENDPOINTS=true npx tsx src/index.ts`) and run with `API_URL=http://localhost:3001`. The pages then use that server. You can also repeat it by hand in two browser windows (one of them private).

### B. Physical devices (iOS + Android): criteria 1–10

**Setup (once)**

1. On your computer, run `docker compose up --build`, then `curl http://localhost:3000/health`.
2. Install **Expo Go** on both phones (App Store / Play Store). The app targets **Expo SDK 57** because the store Expo Go builds (e.g. iOS client 57.0.9) don't support SDK 58 yet. If Expo Go says the project is incompatible, update Expo Go or check `app/package.json`'s `expo` version against [the versions API](https://exp.host/--/api/v2/versions). Connect the phones and the computer to the same Wi-Fi.
3. In `app/`, run `npm install`, then `npx expo start`. Scan the QR code with the iPhone camera, or from inside Expo Go on Android.
4. The app finds the backend at `http://<your-computer-LAN-IP>:3000` automatically.
   - If the map or lists don't load, open **설정 → 서버 주소** and enter `http://<LAN-IP>:3000`, then check that the provider line shows "mock".
   - On a network that isolates clients (corporate or guest Wi-Fi), use `npx expo start --tunnel`, expose port 3000 with a tunnel, and set the Server URL to the tunnel address.
5. If you're not in Seoul, open **설정 → 데모 위치** on both phones and choose **강남역**. Otherwise, allow location access when asked.

**Walkthrough**

| # | Steps | Expected |
|---|---|---|
| 1 | Launch on both iPhone and Android | Map with Seoul markers (icon + count), list below, "가장 가까운 충전기 찾기" button within thumb reach |
| 2 | Phone A: tap **가장 가까운 충전기 찾기** | Within 2 s, "추천 충전소" shows a station with an ETA (n분), a distance and "n/m 사용 가능", plus two other options |
| 3 | Phone A: **예약** → pick a charger → **예약**. Phone B: open the same station | A shows a top banner "예약 중 · …" with a 10:00 countdown. Within 15 s, B shows that charger as **예약됨 · mm:ss 남음** |
| 4 | Phone B: open the station *before* A reserves, then tap **예약** on the same charger right after A does (or pick it from a stale screen) | B gets "방금 다른 사용자가 이 충전기를 예약했습니다…" |
| 5 | On the computer: `curl -H "X-Device-Id: <A's 기기 ID from 설정>" localhost:3000/reservations/active` to get the reservation id, then `curl -X POST localhost:3000/debug/reservations/<id>/fast-forward` | Within 15 s, A shows "예약이 만료되었습니다". The charger is back to **사용 가능**. A's banner shows "노쇼로 인해 mm:ss 후에 다시 예약할 수 있습니다" and reserving is blocked. Clear it with `curl -X DELETE localhost:3000/debug/devices/<A's 기기 ID>/cooldown` |
| 6 | Phone A: reserve again → **도착했어요** | Alert "충전을 시작합니다". The charger shows **충전 중** on both phones |
| 7 | Search "서울역" and pick the result | The origin chip shows 서울역, and the map and list move to stations around Seoul Station |
| 8 | Open the **자치구** tab | A map of Seoul with the 25 district borders, colored green / amber / gray by availability. Tap a district for available/total and the DC/AC split, then **이 구 충전소 보기** (or tap it again) to open its stations |
| 9 | **설정 → English** | Every screen, including station and district names, switches to English. Station detail also shows the Korean name as a secondary line, on purpose |
| 10 | Tap **길안내** on a station | KakaoMap opens with the station as destination. Without the KakaoMap app, the browser opens map.kakao.com |

**Also check on device**
- Deny location (with no demo location set): the app centers on Seoul City Hall, shows a banner, and hides ETA.
- Tap the map to move the blue search pin, then tap **이 지역에서 다시 검색** to search there. The pin icon beside it, **마지막 검색 위치로**, puts the pin back. Long-press still searches immediately. Panning without moving the pin searches the map center. Drag the list handle to peek / half / full (a tap with no move still cycles). On **자치구**, search a district name instead of scrolling a list of names.
- Turn on airplane mode: an offline banner appears. Turn it off and the data refreshes.
- With VoiceOver or TalkBack on, markers and buttons read out the name and status.
