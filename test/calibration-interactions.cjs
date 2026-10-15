const { test, before, after } = require("node:test"),
  assert = require("node:assert/strict");
const { profiles, openSession, pressAt } = require("./support/fixtures.cjs"),
  { launchBrowser } = require("./support/browser.cjs"),
  { photographicFixture } = require("./support/photographic-calibration.cjs");
let browser;
before(async () => {
  browser = await launchBrowser();
});
after(async () => browser?.close());
async function open(t, options, fixture = {}) {
  const { page, context } = await openSession(browser, t, options, {
    empty: true,
  });
  await photographicFixture(page, fixture);
  await page.locator("#calibrationTool").click();
  await page.waitForFunction(
    () => calibrationUI.suggestions?.completed && !calibrationUI.busy,
  );
  return { page, context };
}
async function center(page, side, x = 0.3, y = 0.65) {
  const b = await page
    .locator("#calibration-" + side + "-canvas")
    .boundingBox();
  return { x: b.x + b.width * x, y: b.y + b.height * y };
}
async function noMeasurements(page) {
  await page.waitForFunction(() => !calibrationUI.busy);
  await page.waitForTimeout(100);
  assert.equal(
    await page.evaluate(() => calibrationUI.session.landmarks.length),
    0,
    "A navigation gesture must not create control points",
  );
}
for (const [name, options] of profiles) {
  test(`${name}: secondary mouse buttons do not create panorama control points`, async (t) => {
    const { page } = await open(t, options);
    await page.locator("#calibrationNewPoint").click();
    const p = await center(page, "left");
    for (const button of ["right", "middle"])
      await page.mouse.click(p.x, p.y, { button });
    await noMeasurements(page);
  });
  test(`${name}: dragging back to the starting location never becomes a point-placement click`, async (t) => {
    const { page } = await open(t, options);
    await page.locator("#calibrationNewPoint").click();
    const p = await center(page, "left");
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.mouse.move(p.x + 90, p.y + 20, { steps: 8 });
    await page.mouse.move(p.x, p.y, { steps: 8 });
    await page.mouse.up();
    await noMeasurements(page);
  });
  test(`${name}: starting a new automatic search cannot overwrite the previously selected match`, async (t) => {
    const { page } = await open(t, options);
    await page.locator("#calibrationNewPoint").click();
    for (const side of ["left", "right"]) {
      const p = await center(page, side);
      await pressAt(page, options, p.x, p.y);
      await page.waitForFunction(() => !calibrationUI.busy);
    }
    const original = await page.evaluate(() =>
      structuredClone(calibrationUI.session.landmarks),
    );
    await page.evaluate(() => {
      const original = PalaceCalibrationFeatures;
      window.PalaceCalibrationFeatures = {
        ...original,
        start(input) {
          const job = original.start(input);
          return {
            ...job,
            promise: job.promise.then(
              (p) =>
                new Promise((resolve) => setTimeout(() => resolve(p), 700)),
            ),
          };
        },
      };
    });
    await page.locator("#calibrationSuggest").click();
    await page.waitForFunction(() => calibrationUI.suggestions.detecting);
    const p = await center(page, "right", 0.7, 0.7);
    await pressAt(page, options, p.x, p.y);
    await page.waitForFunction(() => !calibrationUI.busy);
    assert.deepEqual(
      await page.evaluate(() => calibrationUI.session.landmarks),
      original,
      "A tap during reference analysis must not change an old match",
    );
  });
  test(`${name}: eight-point mode expands a four-point suggestion batch`, async (t) => {
    const { page } = await open(t, options, { double: true });
    await page.locator("#calibrationDetails summary").click();
    await page.locator("#calibrationUpright").uncheck();
    await page.waitForFunction(
      () =>
        calibrationUI.session.config.minCorrespondences === 8 &&
        !calibrationUI.busy,
    );
    assert.equal(
      await page.locator("#calibrationPointTrack button").count(),
      8,
      "Changing the model must replenish the batch to the requested target",
    );
  });
}
for (const [name, options] of profiles.filter(([, o]) => o.hasTouch)) {
  test(`${name}: two-finger panorama zoom creates no phantom observations`, async (t) => {
    const { page, context } = await open(t, options);
    await page.locator("#calibrationNewPoint").click();
    const cdp = await context.newCDPSession(page),
      p = await center(page, "left", 0.5, 0.6);
    const points = (distance) => [
      { id: 1, x: p.x - distance, y: p.y },
      { id: 2, x: p.x + distance, y: p.y },
    ];
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: points(25),
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: points(50),
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [points(50)[0]],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await noMeasurements(page);
  });
}
for (const [name, options] of profiles) {
  test(`${name}: adjusting the connecting view retries an initially failed reference search`, async (t) => {
    const { page } = await openSession(browser, t, options, { empty: true });
    await photographicFixture(page);
    await page.evaluate(() => {
      const original = PalaceCalibrationFeatures;
      let failed = false;
      window.PalaceCalibrationFeatures = {
        ...original,
        start(input) {
          if (!failed) {
            failed = true;
            return {
              promise: Promise.reject(
                new Error("Temporary feature worker failure"),
              ),
              cancel() {},
            };
          }
          return original.start(input);
        },
      };
    });
    await page.locator("#calibrationTool").click();
    await page.waitForFunction(() => calibrationUI.suggestions?.completed);
    assert.equal(
      await page.evaluate(() => calibrationUI.suggestions.points.length),
      0,
    );
    await page.locator("#calibration-right-fov").evaluate((el) => {
      el.value = "80";
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.waitForFunction(
      () =>
        calibrationUI.suggestions.completed &&
        calibrationUI.suggestions.points.length === 4,
      null,
      { timeout: 30000 },
    );
    assert.equal(
      await page.evaluate(() => calibrationUI.session.landmarks.length),
      0,
    );
  });
  test(`${name}: an older status response cannot switch the editor back to a previous group`, async (t) => {
    const { page } = await open(t, options);
    await page.waitForFunction(
      () => !calibrationUI.refreshTimer || !!calibrationUI.session,
    );
    const previous = await page.evaluate(() => calibrationUIState().sessionId);
    await page.evaluate(() => {
      window.auditAPI = calibrationUIAPI;
      let held = false;
      calibrationUIAPI = () => {
        const api = window.auditAPI();
        return {
          ...api,
          listSessions: async () => {
            const snapshot = await api.listSessions();
            if (!held) {
              held = true;
              window.auditSnapshot = snapshot;
              await new Promise((resolve) => (window.auditRelease = resolve));
            }
            return snapshot;
          },
        };
      };
      window.auditOldRefresh = calibrationUIRefresh();
    });
    await page.waitForFunction(() => !!window.auditRelease);
    await page.locator("#calibrationNoOverlap").click();
    await page.waitForFunction(
      (id) => calibrationUIState().sessionId !== id && !calibrationUI.busy,
      previous,
    );
    const next = await page.evaluate(() => calibrationUIState().sessionId);
    await page.evaluate(async () => {
      window.auditRelease();
      await window.auditOldRefresh;
      calibrationUIAPI = window.auditAPI;
    });
    assert.equal(
      await page.evaluate(() => calibrationUIState().sessionId),
      next,
    );
    assert.equal(await page.evaluate(() => calibrationUI.session.id), next);
  });
}

for (const [name, options] of profiles)
  test(`${name}: automatic landmarks stay on the shared photograph surface when a wall hides the other half`, async (t) => {
    const { page } = await open(t, options, { double: true, occluded: true });
    const points = await page.evaluate(() =>
      calibrationUI.suggestions.points.map((p) => {
        const ray = PalaceCalibrationMath.ray(p.yaw, p.pitch);
        return {
          worldX: (-4 * ray[0]) / ray[2],
          supported: p.visibility === "image-supported" && !!p.rightHint,
        };
      }),
    );
    assert.equal(
      points.length,
      4,
      "The unobstructed textured picture must still supply four automatic points",
    );
    assert.ok(
      points.every((p) => p.supported && p.worldX < -0.4),
      "No proposed point may lie on the picture hidden by the right-hand wall",
    );
    assert.equal(
      await page.evaluate(() => calibrationUI.session.landmarks.length),
      0,
      "Finding a shared region does not create confirmed observations",
    );
  });
