# Architecture

```
┌──────────────── app/ (Expo, expo-router) ────────────────┐
│ screens: map+list · station detail · districts ·          │
│          favorites · settings                              │
│ state:   settings (AsyncStorage) · location · reservation │
│          (polls /reservations/active every 15 s)          │
│ api/client.ts ── fetch + X-Device-Id ───────────────┐     │
│ MapView ── WebView (native) / iframe (web) ──┐      │     │
└──────────────────────────────────────────────┼──────┼─────┘
                                               │ /map │ REST (docs/openapi.yaml)
┌──────────────── server/ (Fastify) ───────────▼──────▼─────┐
│ routes/      stations · reservations · proxy (/route,      │
│              /places/search) · debug (DEBUG_ENDPOINTS)     │
│ services/    StationService (summaries, nearest ranking,   │
│              districts) · ReservationService (rules)       │
│ repositories/types.ts   StationRepository,                 │
│                         ReservationRepository  ◄─ interfaces
│ repositories/mock/      SQLite store + Simulator           │
│ providers/   routing (kakao | mock) · places (kakao | mock)│
│ map/page.ts  /map page: Kakao Maps JS or Leaflet+OSM       │
└────────────────────────────────────────────────────────────┘
shared/  types generated from docs/openapi.yaml (openapi-typescript) + constants
```

## Contract first

`docs/openapi.yaml` is the source of truth.
- `npm run gen:types` regenerates `shared/src/generated/openapi.ts`.
- `shared/src/index.ts` re-exports friendly aliases (`StationSummary`, `Reservation`, the map messages, …) and the rule constants: a 600 s reservation, a 600 s maximum ETA and a 900 s cooldown.
- The server's contract test validates real responses against the OpenAPI component schemas with Ajv.

## Backend layers

- **Routes** handle HTTP only: parsing, `X-Device-Id` validation and the mapping from errors to statuses (`DomainError` → `{code, message_ko, message_en, details}`).
- **Services** hold the product rules. They depend only on the repository and provider interfaces and on a `Clock`.
  - `ReservationService.create` checks, in order: the cooldown, an existing active reservation, the charger's existence and status, then the ETA (≤ 600 s, or allowed when the origin is unknown). After that it calls `repo.create`.
  - `StationService.nearest` takes the 10 straight-line-closest stations with matching available chargers, routes them all in parallel and returns the top 3 by ETA.
- **Repositories** are the swap point for a real data source. The mock adapter is SQLite (better-sqlite3).
  - Atomicity: `create` runs in an `IMMEDIATE` transaction. It does a compare-and-set on `chargers.status = 'available'` and inserts the reservation. Partial unique indexes on `reservations(charger_id)` and `reservations(device_id)` `WHERE state = 'active'` make a double booking impossible even if a bug slips into the service. When 25 concurrent requests race, exactly one gets 201 (covered by a test).
  - Expiry: `expireDue(now)` marks reservations expired, frees the chargers and records `cooldown_until = expires_at + 15 min`. The service calls it from a 1-second sweep and before every read.
- **Simulator** (mock only). Every `SIM_TICK_MS` (30 s), it advances simulated time by `tick × SIM_SPEED`. Using a seeded RNG, it ends charging sessions, starts new ones to track the time-of-day occupancy target, and injects and clears faults. It never updates a `reserved` charger.
- **DemoControl** is the interface behind `/debug/*`: set a charger's status, fast-forward a reservation, clear a cooldown, reset, and simulator speed. The debug routes are only registered when `DEBUG_ENDPOINTS=true`.
- **Providers.**
  - Routing: Kakao Mobility directions, cached for 60 s, or the mock (haversine × 1.3 at 22 km/h).
  - Places: Kakao Local keyword search restricted to a Seoul rectangle and "서울" addresses, or the mock (about 35 landmarks).
  - Kakao keys stay on the server.

## Map

`GET /map?lang=ko|en` returns a self-contained HTML page.
- With `MAP_PROVIDER=kakao` it loads the Kakao Maps JS SDK with `KAKAO_JS_KEY`. Otherwise it loads Leaflet, served from `/static/leaflet/`, with OSM tiles.
- The app sends `setMarkers`, `setCenter`, `fitBounds`, `setUserLocation`, `setPin` (with an `a11y` label), `setRadius`, `setRoute` and `setDistricts` (자치구 code, availability color and label; the page joins these to `/static/geo/seoul-districts.geojson`). The page replies with `ready`, `markerPress`, `longPress`, `mapClick` (a short tap, which moves the search pin without searching), `districtPress`, `regionChange` and `error`.
- Native uses `react-native-webview` (`injectJavaScript` → `window.__onAppMessage`; replies via `ReactNativeWebView.postMessage`). Web uses an `<iframe>` with `postMessage`.
- Messages sent before `ready` are cached and replayed once the page is ready.
- Markers show an icon and a count. Their accessible label includes the name, status and availability.

## App

- **Routing (expo-router).** Screens live in `app/src/app/`: tabs for the map, districts, favorites and settings, plus `station/[id]`.
- **Providers**, outermost first: Settings → Dialog → Location → Reservation.
  - *Settings* holds the language, demo location, server URL, favorites, filters, radius and device ID, persisted in AsyncStorage.
  - *Location* combines the permission state, GPS or demo location, the outside-Seoul check, and the current origin (current location, place, pin or map area).
  - *Reservation* polls the active reservation every 15 s while the app is in the foreground. It keeps a server-clock offset for countdowns, raises the in-app expiry alert, and bumps a `version` so the screens refetch right after a change.
- **Data loading.** `usePolled` refetches every 15 s while the screen is focused and the app is in the foreground. It keeps the previous data during a refresh. Screens render a skeleton, an empty state with an action, or an error state with retry; an offline banner comes from NetInfo.
- **i18n.** i18next with `ko` (the base `Dict` type) and `en`. Station and district names come from `name_ko` / `name_en` via `pick()`, and API errors use the server's `message_ko` / `message_en`.
- **Accessibility.**
  - Statuses always show an icon and a text label; `out_of_order` is also struck through.
  - Touch targets are at least 44 pt (`MIN_TOUCH`).
  - The countdown is a polite live region.

## Running

- `docker compose up` runs the backend image: Node 20, with only the server's production dependencies plus `shared` and `docs`.
- The app runs separately with `npx expo start`. See the README for LAN and tunnel setup.
