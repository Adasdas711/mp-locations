const { test, before, after } = require("node:test"),
  assert = require("node:assert/strict");
globalThis.PalaceCalibrationOverlap = require("../calibration-overlap.js");
const F = require("../calibration-features.js"),
  M = require("../calibration-math.js"),
  S = require("./support/corner-scene.cjs"),
  Zip = require("../vendor/jszip.min.js"),
  { openSession } = require("./support/fixtures.cjs"),
  { launchBrowser } = require("./support/browser.cjs");
const A = [0, 0, 0],
  B = [0.7, 0.05, 0.3],
  poses = [-25, -70, 20].map((yaw) => ({ yaw, pitch: -10, fov: 100 }));
function sameDirection(solution, from, to, truth) {
  const a = solution.cameras[from].position,
    b = solution.cameras[to].position,
    d = [b.x - a.x, b.y - a.y, b.z - a.z];
  return (
    (Math.acos(
      (d[0] * truth[0] + d[1] * truth[1] + d[2] * truth[2]) /
        Math.hypot(...d) /
        Math.hypot(...truth),
    ) *
      180) /
    Math.PI
  );
}
function session(points, orientationModel) {
  return {
    id: "s",
    cameraIds: ["a", "b"],
    config: {
      orientationModel,
      minCorrespondences: orientationModel === "upright" ? 4 : 8,
      requireVerified: false,
      ransacThresholdDeg: 0.6,
      ransacIterations: 512,
      minParallaxDeg: 0.75,
      bundleIterations: 35,
      seed: 1,
      distances: [],
      referenceCameraId: "a",
    },
    landmarks: points.map((p, i) => ({
      id: "l" + i,
      enabled: true,
      observations: [
        { panoId: "a", yaw: p.yaw, pitch: p.pitch, verified: false },
        { panoId: "b", ...p.rightHint, verified: false },
      ],
    })),
  };
}
let corner;
function cornerPoints() {
  corner ??= F.collectShared({
    references: poses.map((p) => S.render(A, p)),
    targets: poses.map((p) => S.render(B, p)),
    limit: 40,
  });
  return corner;
}
test("Automatic collection spreads correspondences over several independent surfaces", () => {
  const points = cornerPoints(),
    truth = points.map((p) => S.project(A, B, p));
  assert.ok(points.length >= 20, `only ${points.length} matches`);
  const surfaces = new Set(truth.filter(Boolean).map((t) => t.surface));
  assert.ok(surfaces.size >= 2, "points must not all lie on one plane");
  assert.ok(new Set(points.map((p) => p.plane)).size >= 2);
  for (const [i, p] of points.entries())
    for (const q of points.slice(i + 1))
      assert.ok(S.separation(p, q) >= 1.5, "selected points are distinct");
});
test("Automatic connecting directions agree with independent scene geometry", () => {
  const points = cornerPoints(),
    errors = points
      .map((p) => S.project(A, B, p))
      .map((t, i) => (t ? S.separation(t, points[i].rightHint) : Infinity))
      .sort((a, b) => a - b);
  assert.ok(
    errors[errors.length >> 1] < 0.2,
    "median " + errors[errors.length >> 1],
  );
  assert.ok(
    errors.filter((e) => e < 0.5).length >= points.length * 0.9,
    JSON.stringify(errors),
  );
});
for (const model of ["upright", "free"])
  test(`Unconfirmed automatic matches recover the known relative pose (${model})`, () => {
    const result = M.calculate(session(cornerPoints(), model), {});
    assert.equal(
      result.status,
      "solved",
      JSON.stringify(result.quality.degeneracy),
    );
    assert.ok(result.quality.meanAngularErrorDeg < 0.2);
    assert.ok(sameDirection(result.solution, "a", "b", B) < 0.5);
  });
test("Automatic collection is empty for unrelated photographs and deterministic otherwise", () => {
  const other = poses.map((p) => S.render([30, 0, 30], p));
  assert.equal(
    F.collectShared({
      references: poses.map((p) => S.render(A, p)),
      targets: other.map((o) => {
        const pixels = o.pixels.slice();
        for (let i = 0; i < pixels.length; i += 4)
          pixels[i] =
            pixels[i + 1] =
            pixels[i + 2] =
              (pixels[i] * 37 + 11) % 251;
        return { ...o, pixels };
      }),
    }).length,
    0,
  );
  const again = F.collectShared({
    references: poses.map((p) => S.render(A, p)),
    targets: poses.map((p) => S.render(B, p)),
    limit: 40,
  });
  assert.deepEqual(again, cornerPoints());
});

let browser;
before(async () => {
  browser = await launchBrowser();
});
after(async () => {
  await browser?.close();
});
async function cornerFixture(page) {
  const width = 2048,
    height = 1024,
    images = [A, B].map((C) =>
      Buffer.from(S.renderEquirect(C, width, height)).toString("base64"),
    );
  const urls = await page.evaluate(
    ({ images, width, height }) =>
      images.map((data) => {
        const gray = Uint8Array.from(atob(data), (c) => c.charCodeAt(0)),
          canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d"),
          image = ctx.createImageData(width, height);
        for (let i = 0; i < gray.length; i++) {
          image.data[i * 4] =
            image.data[i * 4 + 1] =
            image.data[i * 4 + 2] =
              gray[i];
          image.data[i * 4 + 3] = 255;
        }
        ctx.putImageData(image, 0, 0);
        return canvas.toDataURL("image/png").split(",")[1];
      }),
    { images, width, height },
  );
  const zip = new Zip();
  urls.forEach((data, i) => zip.file(`p${i}.png`, data, { base64: true }));
  zip.file(
    "palace.json",
    JSON.stringify({
      name: "Room corner",
      levels: [],
      panoramas: {
        a: { mode: "equirect", file: "p0.png", room: "Reference" },
        b: { mode: "equirect", file: "p1.png", room: "Connecting" },
      },
    }),
  );
  await page.locator("#fileOpen").setInputFiles({
    name: "corner.mpalace",
    mimeType: "application/zip",
    buffer: await zip.generateAsync({ type: "nodebuffer" }),
  });
  await page.waitForFunction(
    () => archiveContext?.name === "corner.mpalace" && !calibrationUI.importing,
  );
}
test("Auto match saves a whole-sphere batch without right-side taps; one review confirms it", async (t) => {
  const { page } = await openSession(
    browser,
    t,
    { viewport: { width: 1280, height: 900 } },
    { empty: true },
  );
  page.setDefaultTimeout(60000);
  await cornerFixture(page);
  await page.locator("#calibrationTool").click();
  await page.waitForFunction(
    () =>
      !document.querySelector("#calibrationAutoMatch").disabled &&
      calibrationUI.suggestions?.completed,
  );
  await page.locator("#calibrationAutoMatch").click();
  await page.waitForFunction(
    () =>
      !calibrationUI.suggestions.autoMatching &&
      calibrationUI.session.landmarks.length >= 8 &&
      calibrationUI.session.solution &&
      !calibrationUI.session.pending &&
      calibrationUI.session.solvedRevision === calibrationUI.session.revision,
  );
  const before = await page.evaluate(() => calibrationUI.session);
  const auto = before.landmarks.filter((l) => l.label.startsWith("Auto match"));
  assert.equal(auto.length, before.landmarks.length);
  assert.ok(auto.every((l) => l.observations.every((o) => !o.verified)));
  assert.equal(
    before.status,
    "provisional",
    "unreviewed matches cannot be applied",
  );
  assert.equal(await page.locator("#calibrationApply").isDisabled(), true);
  // Every saved connecting observation must agree with independent geometry.
  const errors = auto
    .map((l) => {
      const a = l.observations.find((o) => o.panoId === "a"),
        b = l.observations.find((o) => o.panoId === "b"),
        truth = S.project(A, B, a);
      return truth ? S.separation(truth, b) : Infinity;
    })
    .sort((x, y) => x - y);
  assert.ok(errors[errors.length >> 1] < 0.3, JSON.stringify(errors));
  assert.ok(
    new Set(
      auto
        .map((l) => S.project(A, B, l.observations[0])?.surface)
        .filter(Boolean),
    ).size >= 2,
  );
  await page.locator("#calibrationConfirmAuto").click();
  await page.waitForFunction(
    () =>
      calibrationUI.session.status === "solved" &&
      !calibrationUI.session.pending,
  );
  const result = await page.evaluate(() => calibrationUI.session);
  assert.ok(result.quality.verifiedCorrespondences >= 8);
  assert.equal(await page.locator("#calibrationConfirmAuto").isHidden(), true);
  assert.ok(sameDirection(result.solution, "a", "b", B) < 1);
});
