import puppeteer from "puppeteer-core";
import fs from "node:fs";

export const BASE = process.env.APP_URL ?? "http://localhost:8081";
export const API = process.env.API_URL ?? "http://localhost:3000";
export const SHOTS = process.env.SHOTS_DIR ?? new URL("./shots/", import.meta.url).pathname;
fs.mkdirSync(SHOTS, { recursive: true });

export async function launch() {
  return puppeteer.launch({
    executablePath: process.env.CHROME_PATH ?? "/usr/local/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--lang=ko-KR"],
  });
}

export async function openPage(browser, { lang = null, demo = "gangnam", deviceId, geo = "deny" } = {}) {
  const ctx = await browser.createBrowserContext();
  if (geo === "allow") await ctx.overridePermissions(BASE, ["geolocation"]);
  const page = await ctx.newPage();
  await page.setViewport({ width: 360, height: 780, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.emulateTimezone("Asia/Seoul");
  page.errors = [];
  page.on("console", (m) => m.type() === "error" && page.errors.push(m.text()));
  page.on("response", (r) => r.status() >= 400 && page.errors.push(r.status() + " " + r.url()));
  page.on("pageerror", (e) => page.errors.push(String(e)));
  await page.goto(BASE + "/favicon.ico");
  await page.evaluate(
    (s) => localStorage.setItem("seoulev.settings.v1", JSON.stringify(s)),
    {
      lang,
      demoLocationId: demo,
      serverUrl: process.env.API_URL ? API : null,
      favorites: [],
      filters: { speed: null, connectors: [], availableOnly: true },
      radius: 3000,
      deviceId: deviceId ?? crypto.randomUUID(),
    },
  );
  return page;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function textOf(page) {
  return page.evaluate(() => document.body.innerText);
}

/** Click the innermost visible element whose text (or aria-label) contains `text`. */
export async function click(page, text, { timeout = 8000 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const ok = await page.evaluate((text) => {
      const els = [...document.querySelectorAll("[role=button],[role=tab],[role=link],[role=checkbox],[role=radio],[role=switch],a,button,div[tabindex]")];
      const vis = (el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
      };
      const match = els.filter((el) => vis(el) && ((el.innerText || "").includes(text) || (el.getAttribute("aria-label") || "").includes(text)));
      if (!match.length) return false;
      const inner = match.filter((el) => !match.some((o) => o !== el && el.contains(o)));
      inner[inner.length - 1].click();
      return true;
    }, text);
    if (ok) return;
    await sleep(200);
  }
  throw new Error(`click: "${text}" not found`);
}

export async function waitText(page, text, timeout = 10000) {
  await page.waitForFunction((t) => document.body.innerText.includes(t), { timeout }, text);
}

export async function shot(page, name) {
  const p = `${SHOTS}/${name}.png`;
  await page.screenshot({ path: p });
  return p;
}

export async function apiCall(method, path, body, deviceId) {
  const r = await fetch(API + path, {
    method,
    headers: { "content-type": "application/json", ...(deviceId ? { "x-device-id": deviceId } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}
