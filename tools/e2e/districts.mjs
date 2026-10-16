// District names are a search field, not a strip. Every district must be findable by name,
// and choosing one shows the callout rather than leaving the map.
import { launch, openPage, BASE, sleep, click, textOf, apiCall } from "./lib.mjs";

const b = await launch();
const page = await openPage(b, { lang: "ko" });
await page.goto(BASE + "/districts");
await sleep(2500);
const ds = (await apiCall("GET", "/districts")).body.districts;
const initial = await textOf(page);
const leaked = ds.filter((d) => initial.includes(d.name_ko)).map((d) => d.name_ko);

async function setQuery(name) {
  await page.$eval(
    'input[placeholder="자치구 이름 검색"]',
    (el, value) => {
      const proto = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value");
      proto.set.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    },
    name,
  );
}

const missing = [];
for (const d of ds) {
  await setQuery(d.name_ko);
  await sleep(200);
  const text = await textOf(page);
  if (!text.includes(d.name_ko)) missing.push(d.name_ko);
}
await setQuery("강남");
await sleep(200);
await click(page, "강남구");
await sleep(400);
const after = await textOf(page);
const callout = after.includes("강남구") && after.includes("이 구 충전소 보기");
const pass = missing.length === 0 && leaked.length === 0 && ds.length === 25 && callout;
console.log(
  `${pass ? "PASS" : "FAIL"} C8 district search finds all ${ds.length} districts`,
  missing.length ? `missing ${missing}` : "",
  leaked.length ? `listed before search ${leaked}` : "",
  callout ? "" : "callout missing",
);
await b.close();
process.exit(pass ? 0 : 1);
