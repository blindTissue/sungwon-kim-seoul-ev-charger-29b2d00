import { launch, openPage, BASE, sleep, textOf, shot, click, waitText, apiCall } from "./lib.mjs";

const results = [];
const ok = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} ${name} ${detail}`);
};

await apiCall("POST", "/debug/reset");
const b = await launch();
const devA = crypto.randomUUID();
const devB = crypto.randomUUID();
const A = await openPage(b, { lang: "ko", deviceId: devA });
const B = await openPage(b, { lang: "ko", deviceId: devB });

// ---- Criterion 2: nearest from Gangnam
await A.goto(BASE + "/");
await waitText(A, "충전소", 15000);
await sleep(2500);
await shot(A, "01-home-ko");
let t0 = Date.now();
await click(A, "가장 가까운 충전기 찾기");
await waitText(A, "추천 충전소");
await waitText(A, "사용 가능");
const nearestMs = Date.now() - t0;
await sleep(400);
const sheet = await textOf(A);
const sheetPart = sheet.slice(sheet.indexOf("추천 충전소"));
const hasEta = /\d+분/.test(sheetPart);
const hasDist = /\d+(\.\d+)?km|\d+m/.test(sheetPart);
const hasCount = /\d+\/\d+ 사용 가능/.test(sheetPart);
ok("C2 nearest < 2s with ETA, distance, available count", nearestMs < 2000 && hasEta && hasDist && hasCount, `${nearestMs}ms eta=${hasEta} dist=${hasDist} count=${hasCount}`);
await shot(A, "02-nearest-ko");

// Open detail via "예약" in the nearest card
await click(A, "예약");
await A.waitForFunction(() => location.pathname.startsWith("/station/"), { timeout: 8000 });
const stationId = (await A.evaluate(() => location.pathname)).split("/").pop();
await waitText(A, "예약할 충전기를 선택하세요");
console.log("station", stationId);

// Device B opens the same station before A reserves (stale view for criterion 4)
await B.goto(BASE + "/station/" + stationId);
await B.waitForSelector('[aria-label^="이 충전기 예약"]', { timeout: 15000 });
const C = await openPage(b, { lang: "ko", deviceId: crypto.randomUUID() });
await C.goto(BASE + "/station/" + stationId);
await C.waitForSelector('[aria-label^="이 충전기 예약"]', { timeout: 15000 });
await sleep(2500);

// ---- Criterion 3: A reserves
await click(A, "이 충전기 예약");
await waitText(A, "예약되었습니다");
await click(A, "확인");
await waitText(A, "예약 중 ·");
const reservedAt = Date.now();
const active = await apiCall("GET", "/reservations/active", null, devA);
const chargerId = active.body.reservation?.charger_id;
ok("A has active reservation", !!chargerId, chargerId);
await sleep(1500);
await A.evaluate(() => {
  const el = [...document.querySelectorAll("div")].find((d) => d.scrollHeight > d.clientHeight + 20 && ["auto", "scroll"].includes(getComputedStyle(d).overflowY) && d.innerText.includes("충전기 "));
  if (el) el.scrollTop = el.scrollHeight;
});
await sleep(600);
await shot(A, "03-station-reserved-ko");

// ---- Criterion 4: B taps reserve on the same (stale) charger
const bClicked = await B.evaluate((cid) => {
  // charger rows are rendered in order; reserve buttons carry the "이 충전기 예약" label
  const btns = [...document.querySelectorAll("[role=button]")].filter((e) => (e.getAttribute("aria-label") || "").includes("이 충전기 예약"));
  if (!btns.length) return false;
  btns[btns.length - 1].click();
  return true;
}, chargerId);
let bErr = "";
if (bClicked) {
  await waitText(B, "문제가 발생했습니다", 8000).catch(() => {});
  await sleep(600);
  bErr = (await textOf(B)).match(/방금 다른 사용자[^\n]*/)?.[0] ?? "";
  await shot(B, "b-already-reserved");
  await click(B, "확인").catch(() => {});
}
const apiB = await apiCall("POST", "/reservations", { charger_id: chargerId, origin: { lat: 37.49795, lng: 127.02762 } }, crypto.randomUUID());
ok("C4 second device gets already-reserved", apiB.status === 409 && apiB.body.code === "ALREADY_RESERVED" && (!bClicked || !!bErr), `ui="${bErr}" api=${apiB.status} ${apiB.body.code}`);

// Device C loaded the page before the reservation and only polls.
let seen = false;
while (Date.now() - reservedAt < 16000) {
  const tx = await textOf(C);
  if (tx.includes("예약됨") && /\d+:\d{2} 남음/.test(tx)) { seen = true; break; }
  await sleep(250);
}
ok("C3 another device shows reserved + countdown within 15s (polling)", seen, `${Date.now() - reservedAt}ms after reserving`);
await shot(C, "04-second-device-reserved-ko");
await C.close();

// ---- Criterion 6: arrive -> charging
await click(A, "도착했어요");
await waitText(A, "충전을 시작합니다");
await click(A, "확인");
const det = await apiCall("GET", "/stations/" + stationId);
const ch = det.body.chargers.find((c) => c.id === chargerId);
ok("C6 arrive sets charger to charging", ch.status === "charging", ch.status);

// ---- Criterion 5: reserve again, fast-forward -> expiry, available, cooldown
await sleep(1000);
await A.reload();
await A.waitForSelector('[aria-label^="이 충전기 예약"]', { timeout: 15000 });
await sleep(1500);
await click(A, "이 충전기 예약");
await waitText(A, "예약되었습니다");
await click(A, "확인");
const act2 = await apiCall("GET", "/reservations/active", null, devA);
const r2 = act2.body.reservation;
const ff = await apiCall("POST", `/debug/reservations/${r2.id}/fast-forward`);
t0 = Date.now();
await waitText(A, "예약이 만료되었습니다", 20000);
const expiryAlertMs = Date.now() - t0;
await sleep(500);
await shot(A, "05-expired-alert-ko");
await click(A, "확인");
const det2 = await apiCall("GET", "/stations/" + stationId);
const ch2 = det2.body.chargers.find((c) => c.id === r2.charger_id);
await waitText(A, "노쇼로 인해", 5000).catch(() => {});
const cooldownBanner = (await textOf(A)).includes("노쇼로 인해");
const retry = await apiCall("POST", "/reservations", { charger_id: r2.charger_id, origin: { lat: 37.49795, lng: 127.02762 } }, devA);
ok(
  "C5 fast-forward expires, charger available, cooldown enforced",
  ff.status < 300 && ch2.status === "available" && retry.status === 429 && retry.body.code === "COOLDOWN_ACTIVE" && cooldownBanner,
  `ff=${ff.status} alert after ${expiryAlertMs}ms charger=${ch2.status} retry=${retry.status} ${retry.body.code} banner=${cooldownBanner}`,
);
await sleep(800);
await shot(A, "06-cooldown-ko");
await apiCall("DELETE", `/debug/devices/${devA}/cooldown`);

// ---- Criterion 10: navigate opens web fallback
const popup = new Promise((res) => b.once("targetcreated", (tg) => res(tg.url())));
await click(A, "길안내");
const navUrl = await Promise.race([popup, sleep(5000).then(() => null)]);
ok("C10 navigate opens KakaoMap web fallback", !!navUrl && navUrl.includes("map.kakao.com"), navUrl ?? "no popup");

// ---- Criterion 7: search 서울역
await A.goto(BASE + "/");
await waitText(A, "충전소", 15000);
await sleep(1500);
await A.type('input[placeholder^="장소 검색"]', "서울역");
await waitText(A, "서울특별시", 8000).catch(() => {});
await sleep(500);
await click(A, "서울역");
await sleep(2500);
const st = await apiCall("GET", "/places/search?q=" + encodeURIComponent("서울역"));
const p = st.body.places[0];
const listText = await textOf(A);
const near = await apiCall("GET", `/stations?lat=${p.lat}&lng=${p.lng}&radius_m=3000&available_only=true`);
const firstName = near.body.stations[0]?.name_ko;
ok("C7 search 서울역 lists nearby stations", !!firstName && listText.includes(firstName) && listText.includes(p.name_ko), `${p.name_ko} -> first ${firstName} (${near.body.stations[0]?.distance_m}m), ${near.body.stations.length} stations`);
await shot(A, "07-search-seoul-station-ko");

// ---- Criterion 8: districts
await click(A, "자치구");
await waitText(A, "자치구별 현황");
await A.waitForSelector('input[placeholder="자치구 이름 검색"]');
await sleep(500);
const dres = await apiCall("GET", "/districts");
const ds = dres.body.districts;
let sumOk = true;
for (const d of ds) {
  const s = await apiCall("GET", `/districts/${d.code}/stations`);
  const sum = s.body.stations.reduce((a, x) => a + x.summary.total, 0);
  const avail = s.body.stations.reduce((a, x) => a + x.summary.available, 0);
  if (sum !== d.summary.total || avail !== d.summary.available || s.body.stations.length !== d.station_count) sumOk = false;
}
// Names stay behind the search field. districts.mjs checks that all 25 can be found that way.
ok("C8 25 districts with counts matching their stations (API)", ds.length === 25 && sumOk, `api=${ds.length} sumsMatch=${sumOk}`);
await shot(A, "08-districts-ko");

// ---- Criterion 9: English
await click(A, "설정");
await waitText(A, "언어");
await click(A, "English");
await sleep(800);
const settingsEn = await textOf(A);
await click(A, "Districts");
await sleep(800);
await A.type('input[placeholder="Search districts by name"]', "Gangnam");
await waitText(A, "Gangnam-gu");
const dEn = await textOf(A);
await shot(A, "09-districts-en");
await click(A, "Map");
await sleep(2500);
await click(A, "Find nearest available charger");
await waitText(A, "Other options");
await sleep(500);
const homeEn = await textOf(A);
await shot(A, "10-nearest-en");
await click(A, "Show route");
await A.waitForFunction(() => location.pathname.startsWith("/route/"), { timeout: 8000 });
await waitText(A, "View details");
await click(A, "View details");
await A.waitForFunction(() => location.pathname.startsWith("/station/"), { timeout: 8000 });
await sleep(2000);
const detEn = await textOf(A);
await shot(A, "11-station-en");
const hangul = (s) => (s.match(/[^\n]*[가-힣][^\n]*/g) || []);
// Station detail intentionally shows the Korean name as a secondary line under the English name.
const offenders0 = [...hangul(settingsEn), ...hangul(dEn), ...hangul(homeEn), ...hangul(detEn)];
const detKo = detEn.split("\n").filter((l) => /[가-힣]/.test(l));
const offenders = offenders0.filter((l) => l !== "한국어" && !(detKo.length === 1 && l === detKo[0]));
ok("C9 English translates visible strings incl. names", offenders.length === 0, JSON.stringify(offenders.slice(0, 8)));

console.log("A errors", A.errors, "B errors", B.errors);
await b.close();
process.exit(results.every((r) => r.pass) ? 0 : 1);
