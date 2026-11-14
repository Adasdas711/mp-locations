const fs = require("node:fs"),
  path = require("node:path");
const JSZip = require("../../vendor/jszip.min.js");
const { devices } = require("playwright-core");
const profiles = [
  ["desktop", { viewport: { width: 1280, height: 900 } }],
  ["Android", devices["Pixel 7"]],
  ["iPhone", devices["iPhone 13"]],
  ["iPad", devices["iPad (gen 7)"]],
].filter(
  ([name]) =>
    !process.env.PALACE_PROFILES ||
    process.env.PALACE_PROFILES.split(",").includes(name),
);
let fixture;
async function palace() {
  if (fixture) return fixture;
  const png = fs.readFileSync(path.join(__dirname, "../../icons/icon-192.png"));
  const zip = new JSZip();
  zip.file("images/level-1.png", png);
  zip.file("images/level-2.png", png);
  zip.file("panoramas/p.png", png);
  zip.file("meta.json", JSON.stringify({ fixture: true }));
  zip.file(
    "palace.json",
    JSON.stringify({
      name: "Functional palace",
      levels: [1, 2].map((id) => ({
        name: "Floor " + id,
        named: true,
        floorId: id,
        w: 192,
        h: 192,
        image: "images/level-" + id + ".png",
        labels: [],
        labelsSrc: "svg",
        markers: [
          { x: 40, y: 50, note: "first", localPano: id === 1 ? "a" : null },
          { x: 145, y: 140, note: "second" },
        ],
        walls: [],
      })),
      panoramas: {
        a: {
          mode: "equirect",
          file: "panoramas/p.png",
          room: "Camera A",
          floorId: 1,
          planPx: { x: 70, y: 70 },
          destinations: [{ panoId: "b" }],
        },
        b: {
          mode: "equirect",
          file: "panoramas/p.png",
          room: "Camera B",
          floorId: 1,
          planPx: { x: 120, y: 100 },
          destinations: [{ panoId: "a" }],
        },
      },
    }),
  );
  fixture = await zip.generateAsync({ type: "nodebuffer" });
  return fixture;
}
async function openSession(
  browser,
  t,
  options,
  { empty = false, offlineCache = false } = {},
) {
  const context = await browser.newContext({
    ...options,
    serviceWorkers: offlineCache ? "allow" : "block",
  });
  t.after(() => context.close());
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.setDefaultNavigationTimeout(15000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  t.after(() => require("node:assert/strict").deepEqual(errors, []));
  await page.goto(process.env.PALACE_TEST_URL || "http://127.0.0.1:8000", {
    waitUntil: "networkidle",
  });
  if (!empty) {
    await page.locator("#fileOpen").setInputFiles({
      name: "functional.mpalace",
      mimeType: "application/zip",
      buffer: await palace(),
    });
    await page.waitForFunction(
      () => archiveContext?.name === "functional.mpalace",
    );
    await page.evaluate(() => {
      state.layout = "plan";
      applyLayout();
    });
    await page.waitForFunction(
      () => document.querySelectorAll("#plan .marker").length === 2,
    );
  }
  return { page, context };
}
async function point(page, x = 0.8, y = 0.25) {
  return page.locator("#plan").evaluate(
    (el, { x, y }) => {
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width * x, y: r.top + r.height * y };
    },
    { x, y },
  );
}
async function pressAt(page, options, x, y) {
  // Record which input events reach the page, so a tap that the application
  // never sees can be told apart from one it mishandles (inputTrace()).
  await page.evaluate(() => {
    window.__palaceInputTrace = [];
    if (window.__palaceInputTraceInstalled) return;
    window.__palaceInputTraceInstalled = true;
    for (const type of [
      "touchstart",
      "touchend",
      "pointerdown",
      "pointerup",
      "mousedown",
      "mouseup",
      "click",
    ])
      document.addEventListener(
        type,
        (event) =>
          window.__palaceInputTrace?.push(
            `${type}${event.pointerType ? ":" + event.pointerType : ""}${event.defaultPrevented ? "!" : ""}@${event.target?.id || event.target?.tagName || "?"}`,
          ),
        true,
      );
  });
  // Playwright's WebKit taps dispatch touch, pointer and mouse down/up events
  // but no click, unlike Safari (recorded with inputTrace() in CI), so taps
  // there are performed as clicks. Chromium exercises real touch input.
  if (
    options.hasTouch &&
    (process.env.PALACE_BROWSER || "chromium") !== "webkit"
  )
    await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
}
async function inputTrace(page) {
  return page
    .evaluate(() => (window.__palaceInputTrace || []).join(" "))
    .catch(() => "n/a");
}
// waitForFunction that reports the input events of the last pressAt() on timeout.
async function waitAfterPress(page, predicate, arg) {
  try {
    await page.waitForFunction(predicate, arg);
  } catch (error) {
    error.message += ` (input events after the last press: ${(await inputTrace(page)) || "none"})`;
    throw error;
  }
}
// Waits for an installed plugin to activate. The application itself allows a
// plugin 12 s to activate before marking it failed, so wait a little longer,
// and report what the host looked like if it never became ready.
async function waitForAddon(page, id) {
  try {
    await page.waitForFunction((id) => addonHosts.get(id)?.ready, id, {
      timeout: 15000,
    });
  } catch (error) {
    const host = await page
      .evaluate((id) => {
        const host = addonHosts.get(id);
        return JSON.stringify({
          installed: addonPackages.has(id),
          host: !!host,
          ready: host?.ready,
          error: host?.error,
          status: document.querySelector("#addonStatus")?.textContent,
        });
      }, id)
      .catch(() => "n/a");
    error.message += ` (plugin ${id}: ${host})`;
    throw error;
  }
}
// page.waitForFunction() treats a returned Promise as a truthy value and
// resolves at once, so asynchronous conditions are polled here instead.
async function waitForAsync(page, predicate, arg, { timeout = 10000 } = {}) {
  const deadline = Date.now() + timeout;
  let last;
  for (;;) {
    try {
      last = await page.evaluate(predicate, arg);
    } catch (error) {
      // Like waitForFunction, keep waiting across navigations of the page.
      if (!/Execution context was destroyed|navigation/i.test(error.message))
        throw error;
      last = undefined;
    }
    if (last) return last;
    if (Date.now() > deadline)
      throw new Error(
        `waitForAsync: condition still ${JSON.stringify(last)} after ${timeout}ms: ${String(predicate).replace(/\s+/g, " ").slice(0, 160)}`,
      );
    await page.waitForTimeout(100);
  }
}
module.exports = {
  profiles,
  openSession,
  point,
  pressAt,
  inputTrace,
  waitAfterPress,
  waitForAddon,
  waitForAsync,
  palace,
};
