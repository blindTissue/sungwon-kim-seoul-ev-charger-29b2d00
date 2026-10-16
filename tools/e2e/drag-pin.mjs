// Taps the mock (Leaflet) map to move the search pin, then checks that "Search this area"
// searches around that pin and that "Back to last search" puts the pin back without searching.
import { API, BASE, launch, openPage, click, sleep, shot, textOf, waitText } from "./lib.mjs";

const b = await launch();
const page = await openPage(b, { lang: "ko" });
await page.goto(BASE + "/");
const mapFrame = async () => {
  for (let i = 0; i < 50; i++) {
    const f = page.frames().find((f) => f.url().startsWith(API + "/map"));
    if (f && (await f.$(".pin").catch(() => null))) return f;
    await sleep(200);
  }
  throw new Error("map frame / pin not found");
};
const pinBox = async () => {
  const f = await mapFrame();
  const el = await f.$(".pin");
  return el.boundingBox();
};
const stationsReq = [];
page.on("request", (r) => {
  if (!r.url().includes("/stations?")) return;
  const q = new URL(r.url()).searchParams;
  stationsReq.push({ lat: Number(q.get("lat")), lng: Number(q.get("lng")) });
});
await page.evaluate(() => {
  window.__mapClicks = [];
  window.addEventListener("message", (e) => {
    try { const d = JSON.parse(e.data); if (d.__evmap && d.msg.type === "mapClick") window.__mapClicks.push(d.msg); } catch {}
  });
});
const lastSearch = () => stationsReq[stationsReq.length - 1];
const near = (a, b, m = 0.0003) => !!a && !!b && Math.abs(a.lat - b.lat) < m && Math.abs(a.lng - b.lng) < m;
const hasButton = (text) =>
  page.evaluate((text) => [...document.querySelectorAll("[role=button]")].some((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && ((el.innerText || "").includes(text) || (el.getAttribute("aria-label") || "").includes(text));
  }), text);
const waitButton = (text) =>
  page.waitForFunction((text) => [...document.querySelectorAll("[role=button]")].some((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && ((el.innerText || "").includes(text) || (el.getAttribute("aria-label") || "").includes(text));
  }), { timeout: 5000 }, text);

const results = [];
const ok = (name, pass, info = "") => { results.push(pass); console.log(`${pass ? "PASS" : "FAIL"} ${name} ${info}`); };

await sleep(3000);
const f = await mapFrame();
const label = await f.$eval(".pin", (e) => e.getAttribute("aria-label"));
ok("pin has screen-reader label", !!label && label.includes("핀"), label);
ok("no search button before tapping", !(await textOf(page)).includes("이 지역에서 다시 검색"));

const box = await pinBox();
const frameBox = await (await page.$("iframe")).boundingBox();
// The sheet covers the lower half of the map, so tap the visible area.
const tapX = frameBox.x + frameBox.width * 0.78;
const tapY = frameBox.y + 64;
const gangnam = lastSearch();
const beforeTap = stationsReq.length;
await page.mouse.click(tapX, tapY);
await waitText(page, "이 지역에서 다시 검색", 5000);
await waitButton("마지막 검색 위치로");
const moved = await pinBox();
const tapped = (await page.evaluate(() => window.__mapClicks)).pop();
ok("tap moves the pin and shows search, without searching", !!tapped && Math.abs(moved.x - box.x) > 40 && stationsReq.slice(beforeTap).every((p) => near(p, gangnam)), JSON.stringify(tapped));
await click(page, "마지막 검색 위치로");
await sleep(600);
const back = await pinBox();
ok("back to last search restores the pin and hides the button", Math.abs(back.x - box.x) < 8 && !(await textOf(page)).includes("이 지역에서 다시 검색") && !(await hasButton("마지막 검색 위치로")));
await page.mouse.click(tapX, tapY);
await waitText(page, "이 지역에서 다시 검색", 5000);
const dropped = (await page.evaluate(() => window.__mapClicks)).pop();
await shot(page, "drag-pin-before-search");

await click(page, "이 지역에서 다시 검색");
await waitText(page, "선택한 위치", 5000);
await sleep(1500);
const searched = lastSearch();
ok("origin chip shows the pin", (await textOf(page)).includes("선택한 위치"));
ok("stations searched around the dropped pin, not the old origin", near(searched, dropped) && !near(searched, gangnam), JSON.stringify({ searched, gangnam }));
const pinNow = await pinBox();
const mapBox = await (await page.$("iframe")).boundingBox();
ok("pin stays on the dropped spot (map recentred on it)", Math.abs(pinNow.x + pinNow.width / 2 - (mapBox.x + mapBox.width / 2)) < 4, `pinX=${Math.round(pinNow.x + pinNow.width / 2)} centerX=${Math.round(mapBox.x + mapBox.width / 2)}`);
ok("search button hidden after searching", !(await textOf(page)).includes("이 지역에서 다시 검색"));
const p = await shot(page, "drag-pin-after-search");
console.log("shot", p);

// Panning without touching the pin keeps the old behaviour: search the map center.
const mb = await (await page.$("iframe")).boundingBox();
await page.mouse.move(mb.x + 24, mb.y + 90);
await page.mouse.down();
for (let i = 1; i <= 10; i++) { await page.mouse.move(mb.x + 24 + 16 * i, mb.y + 90); await sleep(30); }
await page.mouse.up();
await waitText(page, "이 지역에서 다시 검색", 5000);
await click(page, "이 지역에서 다시 검색");
await waitText(page, "지도 영역", 5000);
await sleep(1000);
const area = lastSearch();
ok("panning then searching uses the map area", !near(area, searched), JSON.stringify(area));

// Long-press moves the same pin.
await page.mouse.click(mb.x + 30, mb.y + 36, { button: "right" });
await sleep(1500);
const lp = lastSearch();
ok("right-click/long-press moves the same pin and searches there", (await f.$$(".pin")).length === 1 && !near(lp, area) && (await textOf(page)).includes("선택한 위치"), JSON.stringify(lp));

console.log("errors", page.errors);
await b.close();
process.exit(results.every(Boolean) ? 0 : 1);
