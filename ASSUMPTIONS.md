# Assumptions & decisions

Decisions made where the spec was silent or ambiguous, following §13: choose the simplest reasonable option and write it down. Each one is grouped by area.

## Product behaviour

1. **Which origin is used for what.**
   - The *search point* is the user's location, a searched place, a dropped pin or the map area. It decides which stations are candidates.
   - The *ETA origin* is always the user's actual location, because reservation eligibility (ETA ≤ 10 min) only makes sense from where the driver is.
   - So after searching "서울역" from 강남, "nearest" lists stations around Seoul Station, ranked by driving ETA from the user. The ETA and route distance shown are from the user.
2. **Nearest ranking.**
   - Candidates are the 10 straight-line-closest stations to the search point that have at least one *available* charger matching the filters (no radius cap). They are ranked by driving ETA, and the top 3 are shown.
   - When there is no location (permission denied, or outside Seoul), they are ranked by straight-line distance from the search point, ETA is hidden, and a note explains why.
   - If routing fails for some stations, those stations sort after the routed ones. If routing fails for all of them, the server returns `502 UPSTREAM_ERROR`.
3. **Reserve from the nearest card.** The "Reserve" button opens the station detail with a "pick a charger" hint, because a station has several chargers and the spec reserves a *charger*. Each available charger row has its own Reserve button.
4. **Unknown ETA.** If the app has no location, reserving shows a confirmation warning ("only reserve if you can arrive within 10 minutes"). The request is sent without `origin`, and the server allows it (§5).
5. **Reservation timer vs. simulator time.**
   - Reservations, expiry and the cooldown always run on real time: 10 minutes and 15 minutes.
   - `SIM_SPEED` only speeds up the simulator's charging sessions and faults. To demo expiry, use `POST /debug/reservations/{id}/fast-forward`.
6. **Cooldown.** It starts at the moment the reservation *expired* (`expires_at`) and lasts 15 minutes. It applies only to no-shows; cancelling or arriving never triggers it.
7. **Arrive.** "I've arrived" ends the reservation and sets the charger to `charging`. The simulator then ends that session after a normal session length (DC 25–60 min, AC 2–6 h). There is no geofence check (no §9/§10 features).
8. **Error codes and HTTP statuses.**
   - Another device holds the charger: `409 ALREADY_RESERVED`.
   - The charger is charging, out of order or unknown: `409 CHARGER_UNAVAILABLE`.
   - The device already has an active reservation: `409 ACTIVE_RESERVATION_EXISTS`.
   - The device is in its cooldown: `429 COOLDOWN_ACTIVE`, with `details.cooldown_until`.
   - The ETA is over 10 minutes: `422 ETA_TOO_LONG`.
   - Every error body is `{ code, message_ko, message_en, details }`, so the app can show the server's message in either language.
9. **Expiry alert.** This is an in-app alert (no push notifications, §9). It fires on the next poll after expiry (at most 15 s), or immediately when the local countdown reaches zero while the app is open.
10. **Device identity.** A random UUID is generated on first launch, stored in AsyncStorage (localStorage on web) and sent as `X-Device-Id`. There are no accounts (§9). Clearing app data gives you a new device.
11. **Marker status.** A station shows as `available` if any charger is available, `reserved` if none are available but some are reserved, and `unavailable` otherwise. Markers always show an icon and a count, not just a colour.
12. **The "available only" filter is on by default.** This matches the app's purpose. Turning it off shows every station in the radius.
13. **Radius options** are 1, 3 and 5 km; 3 km is the default. The empty state offers "expand radius" up to 5 km.
14. **District screen.** Tapping a district opens the map fitted to that district and lists all its stations, ignoring the radius. Clearing the origin chip returns to the user's location.
15. **Favorites** are stored only on the device.
    - **What survives a reload or app restart:** the settings (language, demo location, filters, radius, favorites, device ID) and the chosen search origin (place, pin or map area) are stored on the device. The active reservation and cooldown aren't stored locally; they're re-read from the server on start using the device ID, so the banner and countdown come back after a reload.
16. **Outside Seoul.**
    - "Inside Seoul" means inside a generous bounding box of Seoul (lat 37.413–37.716, lng 126.764–127.184). That box also includes some areas just outside the city limits.
    - Outside it, the app shows "서울 지역만 지원합니다", centers on City Hall and hides ETA.
    - The backend also filters Kakao place results to addresses starting with "서울".
17. **Demo location (Settings).** You can pick a fixed point (강남역, 서울역, 홍대입구역, 잠실역, 여의도공원, 서울시청) that replaces GPS. This lets the demo work away from Seoul and in desktop browsers. When it's set, it counts as the user's location, so ETA is shown.
18. **Server URL override (Settings).** For physical devices on networks where the automatic LAN address doesn't work, such as tunnels.
19. **Language.** Korean is the default. English is used on first launch if the device's first locale is English. The Settings toggle persists.
    - Station names and addresses come from the seed in both languages: the English versions are Revised Romanization plus translated generic words, e.g. "공영주차장" → "Public Parking Lot".
    - On station detail, the other-language name is shown as a secondary line on purpose. It helps when reading signs or asking for directions.
20. **Times and formats.** Times are shown in 24-hour KST. Countdowns are mm:ss. Prices are in KRW per kWh, using the locale's number formatting.
21. **Navigation handoff.**
    - Start point: the user's location (GPS inside Seoul, or the demo location when set), labelled "현재 위치" / "Current location". It is never the searched place or pin. With no location, the links are destination-only, as before.
    - Native: opens `kakaomap://route?sp={lat},{lng}&ep={lat},{lng}&by=CAR` (no `sp` without a location). If no app handles the scheme (`openURL` rejects), it falls back to the web link.
    - Web link: `https://map.kakao.com/link/from/{label},{lat},{lng}/to/{name},{lat},{lng}`, or `/link/to/{name},{lat},{lng}` with no location. Commas in names are replaced with spaces, because commas separate the fields.
    - Web: opens the web link in a new tab (`window.open(url, "_blank", "noopener,noreferrer")`), so the app page and its state stay put. `Linking.openURL` would replace the app's page.
    - `canOpenURL` isn't used because it's unreliable for custom schemes in Expo Go.
21a. **In-app route preview.**
    - It's a separate screen (`/route/{stationId}`) with its own map, rather than drawing on the home map. Home is busy with markers, the radius circle and the list, and both station detail and the nearest result can link to the same screen.
    - It shows the driving polyline from the user's location to the station, fitted to the screen, with ETA, distance, a Navigate button and a link to the station details. The "경로 보기" / "Show route" button is only shown when the user's location is known.
    - Geometry comes from `GET /route?geometry=true`, as `path`: an array of `[lat, lng]` pairs. It's opt-in, so the nearest-charger ranking (10 routes) stays light.
      - Kakao: `summary=false`, then the flattened `sections[].roads[].vertexes` (`[lng, lat, …]` → `[lat, lng]`), with consecutive duplicates removed and capped at 1,500 points (both ends kept). It's cached separately from summary-only routes.
      - Mock: an L-shaped "street grid" line (along the latitude first, then the longitude). Its length is close to the mock's haversine × 1.3 distance.
    - Map page: a new `setRoute` message (`path`, or `null` to clear it, plus `fit`). Leaflet draws an `L.polyline` and Kakao a `kakao.maps.Polyline`, each with a white casing under a blue line.
    - Display only: no turn-by-turn, no rerouting.
    - On station detail, "경로 보기" replaced the duplicate favorite button. Favoriting stays on the header star.

## Data

22. **Seed.**
    - 200 stations: 8 in each of the 25 districts. That's an even spread, not proportional to real density, so every district has data.
    - 827 chargers in total, 29% of them DC.
    - Locations are real OpenStreetMap features: public parking, community centers (주민센터), district offices, parks, transfer parking and large marts. Names come from OSM, and addresses come from Nominatim reverse geocoding.
    - Charger counts, connectors, power, prices, opening hours, parking notes and location notes are synthetic.
    - The seed builder (`server/seed/tools/build_seed.py`) runs offline and needs raw OSM extracts that aren't committed. The generated `stations.json` and `districts.json` are committed.
23. **Extra fields** beyond §6:
    - `site_type`, for the "Community center parking" style labels;
    - `operator_note_ko/en`, for the location hint;
    - `parking_fee_note_ko/en`;
    - `source: "osm"`.
24. **District codes** are the standard 5-digit 시군구 codes (11110 종로구 … 11740 강동구). Each district's bbox and center come from its OSM boundary.
25. **Connectors.** `AC_TYPE1` is labelled "AC 5핀" in Korean (the common Korean name for the J1772 slow connector) and "AC Type 1" in English. `AC3` is "AC 3상" / "AC 3-phase".

## Simulator

26. **Steady-state model.**
    - Each charger flips between `available` and `charging` using an hourly occupancy profile for Seoul (KST).
    - Business districts (강남구 11680, 중구 11140, 영등포구 11560) get +18 percentage points on weekdays from 08:00 to 20:00. Weekends are ×0.85.
    - The arrival rate is derived from the target occupancy and the mean session length.
27. **Faults.** Each tick, the simulator aims for about 3% of chargers `out_of_order` (mean duration 3 h) and about 1% `unknown` (mean 10 min).
28. **Reserved chargers are never touched by the simulator.** This is enforced in SQL with `WHERE status <> 'reserved'`.
29. **Seeded RNG.** It uses mulberry32 with `SIM_SEED`. With the same seed, start time and number of ticks, the output is deterministic. Tests use a fake clock.

## Architecture & tech

30. **Map.** There is one backend-served page at `GET /map?lang=` that renders Kakao Maps (when `MAP_PROVIDER=kakao`) or Leaflet with OSM tiles (the mock).
    - The native app embeds it in `react-native-webview`; web embeds it in an `<iframe>`. Both talk to it through the same small message protocol, defined as `MapInboundMessage` / `MapOutboundMessage` in OpenAPI.
    - This keeps a single map implementation and keeps the Kakao JS key on the server's domain.
    - Leaflet is served from the backend's `node_modules`, so the mock map needs no CDN. It still needs internet access for OSM tiles.
    - Long-press on the map is implemented as a 600 ms touch hold or a right-click.
    - **Search pin.** One blue-and-white pin marks where the next search can happen. It starts at the current search origin. It is not draggable.
        - The pin was the 📍 emoji from the first map page through the tap-to-move change. Kakao used the red default marker only while dragging was enabled. That red marker is not used. The pin is now the app's own teardrop, blue `#2563eb` with a white stroke and center, the same colors as the user-location dot. Leaflet and Kakao both draw that overlay (`L.marker` with pointer events off, or a Kakao `CustomOverlay`). The tip sits on the coordinate.
        - A short tap on the map posts `mapClick` and moves the pin there. That shows "이 지역에서 다시 검색" and does not search yet. Tapping the button searches around the pin (origin "선택한 위치"), and the map recenters on the pin, which stays put.
        - "마지막 검색 위치로" is shown only while the pin is away from the last actual search. It is a 44 pt icon on the same row as "이 지역에서 다시 검색", so the pair stays one row tall. Its screen-reader name is still "마지막 검색 위치로". Tapping it puts the pin back and hides both buttons, unless the map was also panned, in which case "이 지역에서 다시 검색" stays and searches the map center.
        - If the map was only panned, the button searches the map center. If the pin was also moved, the pin wins.
        - A move under 30 m counts as no move.
        - Long-press (600 ms, or right-click) still moves the pin and searches immediately. The page ignores the click that follows a long-press, so the two don't fight.
        - ETA is still measured from the user's location.
    - **District view.** The pin is hidden there because no single search origin applies. Long-press still works and leaves district mode.
    - **Leaflet/mock vs. Kakao.** Both draw the same blue-and-white pin overlay. Neither uses a draggable marker or Kakao's red default marker.
    - **Accessibility.** The pin's screen-reader label is in `setPin.a11y`. The pin itself ignores pointer events so a tap reaches the map. Panning, the search button, long-press and place search remain available without dragging.
    - **Verification.** The tap path was checked in a browser on the Leaflet map (`tools/e2e/drag-pin.mjs`). The Kakao path is covered by a parse/contract test only, because this VM has no Kakao JS key.
31. **List sheet.** The station list is a sheet over the map with three snap points: peek (just the handle, the find-nearest button and the radius chips), half, and full (a strip of map stays visible). Dragging the handle follows the pointer; it snaps to the nearest of those three only when the gesture ends. The handle captures the pointer so the map iframe and the station list cannot steal the drag. The map ignores pointer events and the list does not scroll while a drag is in progress. A tap with no move still cycles peek → half → full → peek. There is no gesture-handler dependency, so it works the same on web.
    - **Find nearest** sits in the sheet header, so it never covers a card. The result is the first card in the sheet (with reserve / route / navigate), not a second copy of that station under a separate button.
    - **Radius chips** (1 / 3 / 5 km) live in the sheet, each at least 44 pt. They are hidden while a district is open, because that list is not radius-filtered. The other filters stay above the map.
32. **Dialogs.** A small in-app dialog component is used instead of `Alert.alert`, because `Alert` does nothing on react-native-web.
33. **Storage.**
    - The mock store is SQLite (better-sqlite3), with `DB_PATH=:memory:` by default, so every start is a fresh seed.
    - Atomic reservations use an `IMMEDIATE` transaction with a compare-and-set update (`UPDATE chargers SET status='reserved' WHERE id=? AND status='available'`). Partial unique indexes on active reservations, per charger and per device, act as a backstop.
    - better-sqlite3 is pinned to v12, because v13 needs Node ≥ 22 and the image uses Node 20.
34. **Expiry processing.**
    - The server sweeps due reservations every second, and again before every read.
    - Clients never decide expiry. They re-anchor their countdown to `expires_at` and `server_time` on every poll, so a wrong phone clock doesn't matter.
35. **Debug endpoints.** They exist only when `DEBUG_ENDPOINTS=true`; otherwise they return 404. The server default is `false`; `docker compose` defaults it to `true` for demos.
    - Besides the endpoints in §7.3, there is `DELETE /debug/devices/{deviceId}/cooldown` to clear a cooldown during demos, and `GET/POST /debug/simulator` to view the simulator or change its speed.
36. **Swappability.**
    - Routes and services only use the `StationRepository`, `ReservationRepository` and `DemoControl` interfaces. The mock implementations live in `server/src/repositories/mock/`.
    - Routing and places are separate provider interfaces, each with Kakao and mock implementations.
37. **Kakao keys.** They are read only by the backend. The Cloud Agent secret names `KAKAO_REST_API` and `KAKAO_JS` are accepted as aliases for `KAKAO_REST_API_KEY` and `KAKAO_JS_KEY`.
    - Kakao Mobility results are cached for 60 s per origin and destination, with coordinates rounded to 4 decimals (about 10 m).
    - Kakao place results don't include English names. `name_en` falls back to the Korean name.
38. **Empty JSON bodies.** A body-less POST that still sends `Content-Type: application/json` is accepted (treated as "no body"), so debug and cancel calls work from any HTTP client.
39. **Versions.** Expo SDK 57 (expo ~57.0.30, React Native 0.86, React 19.2). The app was first built on SDK 58, then downgraded: SDK 58's Expo Go hadn't reached the App Store or Play Store yet. Store Expo Go (iOS client 57.0.9) only supports SDK 57.0.0, and the versions API reports `expoGoSdkVersion: 57.0.0`, so an SDK 58 project shows "Project is incompatible with this version of Expo Go". No app code needed changes; the dependencies were aligned with `npx expo install --fix`. Move to SDK 58 once store Expo Go supports it. Also: Node 20 in Docker, Fastify 5, TypeScript throughout. The app links `shared/` via `file:../shared`, and Metro watches that folder.
40. **Not built**, per §9/§10: push notifications, accounts, payments, reporting broken chargers, price comparison and history.
41. **자치구 map.** The districts tab draws the 25 boundaries instead of the old row list.
    - **Boundaries.** `server/static/seoul-districts.geojson` is `seoul_municipalities_geo_simple.json` from [southkorea/seoul-maps](https://github.com/southkorea/seoul-maps) (`juso/2015/json/`), Apache License 2.0. The upstream geometry is the 2015 서울시 행정구역 시군구 from JUSO. `SIG_CD` matches the seed district codes. See `server/static/seoul-districts.NOTICE.md`.
    - **Drawing.** Both map pages load that file from `GET /static/geo/seoul-districts.geojson`. The app sends `setDistricts` (code, status, selected, screen-reader label) and the page joins on `SIG_CD`. Leaflet uses `L.geoJSON`; Kakao uses `kakao.maps.Polygon`. A tap posts `districtPress`.
    - **Color.** Same rule as station markers: green when any charger is available, amber when none are available but some are reserved, gray otherwise. A text legend repeats that, so color is not the only cue.
    - **Callout.** The first tap selects a district and shows available/total, the DC/AC split and the station count. A second tap on the same district, or "이 구 충전소 보기", opens the station map, which already zooms to that district's bbox.
    - **Search.** District names are not listed in a strip. A search field ("자치구 이름 검색") filters the 25 names, and the matches drop down over the map. Choosing one selects that district and closes the list, which shows the callout. The map stays the center of the screen.
    - **Sort.** Name vs. available-count stays as two small chips. It orders the search matches. The map itself stays geographic.
    - **Viewport.** The page fits Seoul the first time districts are drawn, then leaves pan and zoom alone when availability refreshes.
42. **Radius does not move the map.** Switching 1 / 3 / 5 km refetches stations and redraws the radius circle around the current search origin. It does not call `setCenter`, so the center and zoom stay where the user left them, including after a pan or a search pin that has not been searched yet. Choosing a new origin (search, pin, long-press, or leaving a district) still recenters, and that recenter uses the radius that is selected at the time.
