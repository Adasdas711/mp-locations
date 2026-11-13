const { test, before, after } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  { spawnSync } = require("node:child_process");
globalThis.PalaceCalibrationOverlap = require("../calibration-overlap.js");
const F = require("../calibration-features.js"),
  A = require("../calibration-auto.js"),
  M = require("../calibration-math.js"),
  S = require("./support/corner-scene.cjs"),
  Zip = require("../vendor/jszip.min.js"),
  { openSession } = require("./support/fixtures.cjs"),
  { launchBrowser } = require("./support/browser.cjs");
const cameras = { a: [0, 0, 0], b: [0.7, 0.05, 0.3], c: [-0.6, 0, 0.6] },
  views = [
    ...[0, 90, 180, 270].map((yaw) => ({ yaw, pitch: 0, fov: 100 })),
    { yaw: 0, pitch: 90, fov: 100 },
    { yaw: 0, pitch: -90, fov: 100 },
  ];
const distance = (p, q) => Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z),
  truth = (a, b) => Math.hypot(...cameras[a].map((v, i) => v - cameras[b][i]));
function assertGeometry(positions, tolerance) {
  const ratio =
      distance(positions.a, positions.c) / distance(positions.a, positions.b),
    expected = truth("a", "c") / truth("a", "b");
  assert.ok(
    Math.abs(ratio / expected - 1) < tolerance,
    `baseline ratio ${ratio} vs ${expected}`,
  );
  const scale = distance(positions.a, positions.b) / truth("a", "b");
  for (const id of ["b", "c"]) {
    const d = ["x", "y", "z"].map(
        (k, i) => (positions[id][k] - positions.a[k]) / scale,
      ),
      t = cameras[id].map((v, i) => v - cameras.a[i]);
    assert.ok(
      Math.hypot(...d.map((v, i) => v - t[i])) <
        tolerance * Math.hypot(...t) * 2,
      `${id} position ${JSON.stringify(d)} vs ${JSON.stringify(t)}`,
    );
  }
}

test("Candidate pairs combine tour links, nearest registered cameras and sequence", () => {
  const panoramas = Array.from({ length: 40 }, (_, i) => ({
    id: "p" + String(i).padStart(2, "0"),
    neighbors: i === 0 ? ["p39"] : [],
    position: { x: i * 2, y: 0, z: 0 },
  }));
  const pairs = A.candidatePairs(panoramas),
    has = (a, b) => pairs.some((p) => p.a === a && p.b === b);
  assert.ok(has("p00", "p39"), "tour link");
  assert.ok(has("p05", "p07"), "nearest registered camera");
  assert.ok(!has("p00", "p10"), "large projects are not compared exhaustively");
  assert.equal(new Set(pairs.map((p) => p.a + p.b)).size, pairs.length);
  assert.equal(
    A.candidatePairs(panoramas.slice(0, 5)).length,
    10,
    "small projects compare all pairs",
  );
  const floors = [
    { id: "a", floor: 1 },
    { id: "b", floor: 1 },
    { id: "c", floor: 2, neighbors: ["a"] },
    { id: "d", floor: 2 },
  ];
  assert.deepEqual(
    A.candidatePairs(floors, { sameFloor: true }).map((p) => p.a + p.b),
    ["ab", "ac", "cd"],
    "other floors only through a tour link",
  );
  assert.equal(A.candidatePairs(floors).length, 6);
  assert.deepEqual(
    A.candidatePairs(panoramas, { mode: "links" }).map((p) => [p.a, p.b]),
    [["p00", "p39"]],
  );
});
test("Pairwise matches chain into multi-view tracks; contradictory chains are discarded", () => {
  const point = (yaw, pitch, ryaw, rpitch) => ({
    yaw,
    pitch,
    rightHint: { yaw: ryaw, pitch: rpitch },
  });
  const { tracks, ambiguous } = A.buildTracks([
    { a: "a", b: "b", points: [point(10, 0, 20, 0), point(50, 5, 60, 5)] },
    {
      a: "b",
      b: "c",
      points: [point(20.1, 0.1, 30, 0), point(100, 0, 110, 0)],
    },
    // b(60,5) also chains to a different direction of a: ambiguous.
    { a: "c", b: "a", points: [point(200, 0, 0, 0)] },
    { a: "b", b: "a", points: [point(60, 5, 80, 0)] },
  ]);
  assert.equal(ambiguous, 1);
  const three = tracks.find((t) => t.observations.length === 3);
  assert.deepEqual(
    three.observations.map((o) => o.panoId),
    ["a", "b", "c"],
  );
  assert.ok(
    tracks.every(
      (t) =>
        new Set(t.observations.map((o) => o.panoId)).size ===
        t.observations.length,
    ),
  );
  assert.deepEqual(
    A.components(
      ["a", "b", "c", "d", "e", "f"],
      [
        { a: "a", b: "b" },
        { a: "c", b: "b" },
        { a: "d", b: "e" },
      ],
    ),
    [
      ["a", "b", "c"],
      ["d", "e"],
    ],
  );
});
test("Batch review and application gates are conservative", () => {
  const session = {
    status: "solved",
    pending: false,
    revision: 3,
    solvedRevision: 3,
    config: { ransacThresholdDeg: 0.6 },
    landmarks: [
      {
        id: "good",
        enabled: true,
        observations: [
          { panoId: "a", verified: false },
          { panoId: "b", verified: false },
        ],
      },
      {
        id: "bad",
        enabled: true,
        observations: [
          { panoId: "a", verified: false },
          { panoId: "b", verified: false },
        ],
      },
      {
        id: "lost",
        enabled: true,
        observations: [
          { panoId: "a", verified: false },
          { panoId: "b", verified: false },
        ],
      },
      {
        id: "unknown",
        enabled: true,
        observations: [
          { panoId: "a", verified: false },
          { panoId: "c", verified: false },
        ],
      },
      {
        id: "done",
        enabled: true,
        observations: [
          { panoId: "a", verified: true },
          { panoId: "b", verified: true },
        ],
      },
    ],
    quality: {
      inliers: 40,
      outliers: 2,
      meanAngularErrorDeg: 0.1,
      medianAngularErrorDeg: 0.05,
      registeredCameraIds: ["a", "b"],
      unregisteredCameraIds: [],
      degeneracy: [],
      visibility: { occluded: [] },
      landmarks: [
        {
          id: "good",
          distances: [{ angularErrorDeg: 0.1 }, { angularErrorDeg: 0.3 }],
        },
        {
          id: "bad",
          distances: [{ angularErrorDeg: 0.1 }, { angularErrorDeg: 3 }],
        },
      ],
    },
  };
  // "lost" was not reconstructed although both of its cameras are registered:
  // it contradicts the solution. "unknown" involves an unregistered camera.
  assert.deepEqual(A.reviewDecision(session), {
    confirm: ["good"],
    disable: ["bad", "lost"],
  });
  assert.equal(A.qualityGate(session).pass, true);
  for (const change of [
    { status: "provisional" },
    { pending: true },
    { solvedRevision: 2 },
    { quality: { ...session.quality, unregisteredCameraIds: ["c"] } },
    { quality: { ...session.quality, medianAngularErrorDeg: 1 } },
    { quality: { ...session.quality, outliers: 30 } },
    { quality: { ...session.quality, visibility: { occluded: [{}] } } },
    { quality: { ...session.quality, inliers: 10 } },
  ])
    assert.equal(
      A.qualityGate({ ...session, ...change }).pass,
      false,
      JSON.stringify(change),
    );
});
test("Cached whole-sphere analysis links three cameras with a consistent scale", () => {
  const handle = F.analysisSession();
  for (const [id, C] of Object.entries(cameras))
    handle({ type: "add", pano: id, views: views.map((p) => S.render(C, p)) });
  const accepted = A.candidatePairs(
    Object.keys(cameras).map((id) => ({ id })),
  ).map((pair) => ({
    ...pair,
    points: handle({ type: "pair", a: pair.a, b: pair.b, limit: 40 }).points,
  }));
  assert.ok(accepted.every((p) => p.points.length >= 20));
  assert.throws(
    () => handle({ type: "pair", a: "a", b: "missing" }),
    /not analysed/,
  );
  const { tracks } = A.buildTracks(accepted);
  assert.ok(
    tracks.filter((t) => t.observations.length === 3).length >= 5,
    "multi-view tracks link the baselines",
  );
  const result = M.calculate(
    {
      id: "s",
      cameraIds: ["a", "b", "c"],
      config: {
        orientationModel: "upright",
        minCorrespondences: 4,
        requireVerified: false,
        ransacThresholdDeg: 0.6,
        ransacIterations: 512,
        minParallaxDeg: 0.75,
        bundleIterations: 35,
        seed: 1,
        distances: [],
        referenceCameraId: "a",
      },
      landmarks: tracks.map((t, i) => ({
        id: "t" + i,
        enabled: true,
        observations: t.observations.map((o) => ({ ...o, verified: false })),
      })),
    },
    {},
  );
  assert.equal(result.status, "solved");
  assert.deepEqual(result.quality.unregisteredCameraIds, []);
  assertGeometry(
    Object.fromEntries(
      Object.entries(result.solution.cameras).map(([id, c]) => [
        id,
        c.position,
      ]),
    ),
    0.03,
  );
});

let browser;
before(async () => {
  browser = await launchBrowser();
});
after(async () => {
  await browser?.close();
});
test("Calibrate all panoramas builds, solves, reviews and applies groups; unrelated panoramas stay separate", async (t) => {
  const { page } = await openSession(
    browser,
    t,
    { viewport: { width: 1280, height: 900 } },
    { empty: true },
  );
  page.setDefaultTimeout(120000);
  // d sees an unrelated, featureless place: it must not join the group.
  const buffer = await S.cornerArchive({ ...cameras, d: [40, 0, 40] });
  await page.locator("#fileOpen").setInputFiles({
    name: "corner.mpalace",
    mimeType: "application/zip",
    buffer,
  });
  await page.waitForFunction(
    () => archiveContext?.name === "corner.mpalace" && !calibrationUI.importing,
  );
  await page.locator("#calibrationTool").click();
  await page.locator("#calibrationDetails summary").click();
  await page.locator("#calibrationAutopilotApply").check();
  await page.locator("#calibrationAutopilot").click();
  await page.waitForFunction(
    () =>
      !PalaceCalibrationAutopilot.running &&
      PalaceCalibrationAutopilot.lastReport,
  );
  const report = await page.evaluate(
    () => PalaceCalibrationAutopilot.lastReport,
  );
  assert.equal(report.pairs.length, 6);
  assert.deepEqual(report.unmatchedPanoramas, ["d"]);
  assert.equal(report.groups.length, 1);
  const group = report.groups[0];
  assert.deepEqual([...group.cameraIds].sort(), ["a", "b", "c"]);
  assert.ok(group.multiViewTracks >= 5);
  assert.equal(group.status, "solved", JSON.stringify(group));
  assert.equal(group.gate.pass, true, JSON.stringify(group.gate));
  assert.equal(group.applied, true);
  assert.match(
    await page.locator("#calibrationAutopilotReport").textContent(),
    /1 solved, 1 applied/,
  );
  const world = await page.evaluate(() => worldData().cameras);
  assert.equal(world.d, undefined, "an unmatched camera gets no invented pose");
  assertGeometry(
    Object.fromEntries(["a", "b", "c"].map((id) => [id, world[id].position])),
    0.03,
  );
  const session = await page.evaluate(
    (id) => PalaceAPI.tour.world.calibration.getSession(id),
    group.sessionId,
  );
  assert.ok(
    session.landmarks
      .filter((l) => l.enabled)
      .every((l) => l.observations.every((o) => o.verified)),
  );
  assert.equal(
    await page.evaluate(() => calibrationUIState().sessionId),
    group.sessionId,
  );
  // The applied transform remains reversible.
  await page.evaluate(
    (id) => PalaceAPI.tour.world.calibration.revert(id),
    group.sessionId,
  );
  assert.equal(
    await page.evaluate(() => Object.keys(worldData().cameras).length),
    0,
  );
});
test("Without automatic application the autopilot leaves the world unchanged", async (t) => {
  const { page } = await openSession(
    browser,
    t,
    { viewport: { width: 1280, height: 900 } },
    { empty: true },
  );
  page.setDefaultTimeout(120000);
  const buffer = await S.cornerArchive({ a: cameras.a, b: cameras.b });
  await page.locator("#fileOpen").setInputFiles({
    name: "pair.mpalace",
    mimeType: "application/zip",
    buffer,
  });
  await page.waitForFunction(
    () => archiveContext?.name === "pair.mpalace" && !calibrationUI.importing,
  );
  const report = await page.evaluate(() =>
    PalaceCalibrationAutopilot.run({ apply: false }),
  );
  assert.equal(report.groups[0].status, "solved");
  assert.equal(report.groups[0].applied, false);
  assert.equal(
    await page.evaluate(() => Object.keys(worldData().cameras).length),
    0,
  );
  await assert.rejects(
    page.evaluate(() => {
      const first = PalaceCalibrationAutopilot.run({});
      return Promise.all([first, PalaceCalibrationAutopilot.run({})]);
    }),
    /already running/,
  );
});
test("Command-line batch calibration writes a report and a calibrated project", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "palace-cli-")),
    input = path.join(dir, "corner.mpalace"),
    output = path.join(dir, "calibrated.mpalace"),
    reportFile = path.join(dir, "report.json");
  try {
    fs.writeFileSync(input, await S.cornerArchive(cameras, { level: true }));
    const run = spawnSync(
      process.execPath,
      [
        path.join(__dirname, "../scripts/auto-calibrate.cjs"),
        input,
        "--apply",
        "--out",
        output,
        "--report",
        reportFile,
      ],
      { encoding: "utf8", timeout: 300000 },
    );
    assert.equal(run.status, 0, run.stderr);
    assert.match(
      run.stderr,
      /3\/3 panorama pairs matched · 1 group, 1 solved, 1 applied/,
    );
    const report = JSON.parse(fs.readFileSync(reportFile, "utf8"));
    assert.equal(report.groups[0].applied, true);
    assert.deepEqual(report.pageErrors, []);
    const project = JSON.parse(
      await (
        await Zip.loadAsync(fs.readFileSync(output))
      )
        .file("palace.json")
        .async("string"),
    );
    assertGeometry(
      Object.fromEntries(
        ["a", "b", "c"].map((id) => [
          id,
          project.worldSpace.cameras[id].position,
        ]),
      ),
      0.03,
    );
    assert.equal(Object.keys(project.calibrationSessions).length, 1);
    const usage = spawnSync(
      process.execPath,
      [path.join(__dirname, "../scripts/auto-calibrate.cjs")],
      { encoding: "utf8" },
    );
    assert.equal(usage.status, 1);
    assert.match(usage.stdout, /Headless batch calibration/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
// Opt-in: private archives (PALACE_REAL_ARCHIVES_DIR) must never produce groups
// or poses without accepted image evidence.
const archiveRoot = process.env.PALACE_REAL_ARCHIVES_DIR,
  archives = (dir) =>
    fs
      .readdirSync(dir, { withFileTypes: true })
      .flatMap((e) =>
        e.isDirectory()
          ? archives(path.join(dir, e.name))
          : e.name.endsWith(".3dview")
            ? [path.join(dir, e.name)]
            : [],
      );
for (const file of archiveRoot ? archives(archiveRoot) : [])
  test(
    `Autopilot on real archive ${path.basename(file)} reports evidence-backed groups only`,
    { timeout: 900000 },
    async (t) => {
      const { page } = await openSession(
        browser,
        t,
        { viewport: { width: 1280, height: 900 } },
        { empty: true },
      );
      page.setDefaultTimeout(0);
      await page.locator("#fileOpen").setInputFiles(file);
      await page.waitForFunction(
        (name) => archiveContext?.name === name && !calibrationUI.importing,
        path.basename(file),
      );
      await page.evaluate(() => {
        if (state.mode !== "edit") {
          state.mode = "edit";
          applyMode();
        }
      });
      const report = await page.evaluate(() =>
        PalaceCalibrationAutopilot.run({ apply: false }),
      );
      assert.ok(report.pairs.length > 0);
      const accepted = report.pairs.filter((p) => p.accepted);
      for (const group of report.groups)
        for (const id of group.cameraIds)
          assert.ok(
            accepted.some((p) => p.a === id || p.b === id),
            "every grouped camera has an accepted pair",
          );
      assert.equal(
        await page.evaluate(() => Object.keys(worldData().cameras).length),
        0,
      );
      t.diagnostic(PalaceCalibrationAutopilotSummary(report));
    },
  );
function PalaceCalibrationAutopilotSummary(report) {
  return `${report.pairs.filter((p) => p.accepted).length}/${report.pairs.length} pairs matched, ${report.groups.length} groups, ${report.unmatchedPanoramas.length} unmatched`;
}
