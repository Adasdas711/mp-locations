/* Project autopilot: analyse candidate panorama pairs, build multi-view tracks,
   create one calibration group per connected set of cameras, solve, review
   the batch against the reconstruction and optionally apply it when strict
   quality gates pass. Uses only the public calibration SDK for project data. */
"use strict";
const calibrationAutopilot = { running: null };
function calibrationAutopilotPanoramas() {
  const world = worldData();
  return Object.entries(state.panoramas || {})
    .filter(([, p]) => p.mode === "equirect" && p.data)
    .map(([id, p]) => ({
      id,
      neighbors: (p.destinations || [])
        .map((d) => d.panoId || d.id || d.to)
        .filter(Boolean),
      position: world.cameras[id]?.position || null,
    }));
}
// Off-screen renderer reusing the shared panorama surface implementation.
function calibrationAutopilotSurface() {
  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.cssText =
    "position:fixed;left:0;top:0;width:64px;height:64px;opacity:0;pointer-events:none;z-index:-1";
  document.body.append(canvas);
  let waiting = null;
  const view = PalacePanoramaSurfaces.create(canvas, {
    onReady: (id) => waiting?.ready(id),
    onError: (message) => message && waiting?.fail(message),
  });
  return {
    async sample(id, poses, size) {
      const loaded = new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("Panorama image did not load: " + id)),
          90000,
        );
        waiting = {
          ready: (ready) => {
            if (ready === id && view.readyId === id) {
              clearTimeout(timer);
              resolve();
            }
          },
          fail: (message) => {
            clearTimeout(timer);
            reject(new Error(message));
          },
        };
      });
      await view.showPanorama(id);
      if (view.readyId !== id) await loaded;
      waiting = null;
      return poses.map((pose) => {
        const image = view.sampleImage({ width: size, height: size, pose });
        return {
          width: image.width,
          height: image.height,
          pixels: image.pixels,
          pose: image.pose,
        };
      });
    },
    dispose() {
      view.destroy?.();
      canvas.remove();
    },
  };
}
async function calibrationAutopilotWait(api, id, signal, timeoutMs = 180000) {
  const start = Date.now();
  for (;;) {
    if (signal?.cancelled)
      throw new Error("Automatic calibration was cancelled.");
    const status = await api.getStatus(id);
    if (!status.pending) return api.getSession(id);
    if (Date.now() - start > timeoutMs)
      throw new Error("Calibration calculation did not finish in time.");
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}
const CALIBRATION_AUTOPILOT_VIEWS = [
  ...[0, 90, 180, 270].map((yaw) => ({ yaw, pitch: 0, fov: 100 })),
  { yaw: 0, pitch: 90, fov: 100 },
  { yaw: 0, pitch: -90, fov: 100 },
];
/**
 * options: {pairs:'auto'|'links'|'all', apply:boolean, orientationModel,
 *   minPairMatches, limit, gate, onProgress(info), signal:{cancelled}}
 * Resolves to a JSON-serialisable report.
 */
async function calibrationAutopilotRun(options = {}) {
  if (calibrationAutopilot.running)
    throw new Error("Automatic calibration is already running.");
  requireEditing();
  const A = PalaceCalibrationAuto,
    api = PalaceAPI.tour.world.calibration,
    signal = options.signal || { cancelled: false },
    progress = (info) => options.onProgress?.(info),
    started = performance.now(),
    minPairMatches = options.minPairMatches ?? 8,
    orientationModel = options.orientationModel || "upright",
    report = {
      version: 1,
      startedAt: new Date().toISOString(),
      options: {
        pairs: options.pairs || "auto",
        apply: !!options.apply,
        orientationModel,
        minPairMatches,
      },
      panoramas: 0,
      pairs: [],
      tracks: 0,
      ambiguousTracks: 0,
      groups: [],
      unmatchedPanoramas: [],
    };
  const project = state.panoramas,
    check = () => {
      if (signal.cancelled)
        throw new Error("Automatic calibration was cancelled.");
      if (state.panoramas !== project)
        throw new Error("The project changed during automatic calibration.");
    };
  calibrationAutopilot.running = signal;
  let analysis = null,
    surface = null;
  try {
    const panoramas = calibrationAutopilotPanoramas();
    report.panoramas = panoramas.length;
    if (panoramas.length < 2)
      throw new Error("At least two panoramas with images are required.");
    const pairs = A.candidatePairs(panoramas, {
      mode: options.pairs || "auto",
    });
    const remaining = new Map();
    for (const p of pairs)
      for (const id of [p.a, p.b])
        remaining.set(id, (remaining.get(id) || 0) + 1);
    analysis = PalaceCalibrationFeatures.startProject();
    surface = calibrationAutopilotSurface();
    const added = new Set(),
      accepted = [];
    const ensure = async (id) => {
      if (added.has(id)) return;
      progress({ phase: "sampling", panoId: id });
      const views = await surface.sample(id, CALIBRATION_AUTOPILOT_VIEWS, 384);
      check();
      await analysis.add(id, views);
      added.add(id);
    };
    // Stage 3/4: every candidate pair against cached whole-sphere views.
    for (const [index, pair] of pairs.entries()) {
      check();
      progress({
        phase: "matching",
        done: index,
        total: pairs.length,
        pair: [pair.a, pair.b],
      });
      await ensure(pair.a);
      await ensure(pair.b);
      const result = await analysis.pair(pair.a, pair.b, {
        limit: options.limit ?? 40,
        geometryContext: calibrationUIVisibilityContext(pair.a, pair.b),
      });
      check();
      const ok = result.points.length >= minPairMatches;
      report.pairs.push({
        a: pair.a,
        b: pair.b,
        reasons: pair.reasons,
        matches: result.points.length,
        surfaces: new Set(result.points.map((p) => p.plane)).size,
        accepted: ok,
      });
      if (ok) accepted.push({ a: pair.a, b: pair.b, points: result.points });
      for (const id of [pair.a, pair.b]) {
        remaining.set(id, remaining.get(id) - 1);
        if (!remaining.get(id) && added.has(id)) {
          await analysis.drop(id);
          added.delete(id);
        }
      }
    }
    analysis.dispose();
    analysis = null;
    surface.dispose();
    surface = null;
    const { tracks, ambiguous } = A.buildTracks(accepted);
    report.tracks = tracks.length;
    report.ambiguousTracks = ambiguous;
    const groups = A.components(
      panoramas.map((p) => p.id),
      accepted,
    );
    const grouped = new Set(groups.flat());
    report.unmatchedPanoramas = panoramas
      .map((p) => p.id)
      .filter((id) => !grouped.has(id));
    // One independent calibration group per connected set of cameras.
    for (const [index, cameraIds] of groups.entries()) {
      check();
      const members = new Set(cameraIds),
        groupTracks = tracks.filter((t) =>
          t.observations.every((o) => members.has(o.panoId)),
        ),
        entry = {
          cameraIds,
          landmarks: groupTracks.length,
          multiViewTracks: groupTracks.filter((t) => t.observations.length > 2)
            .length,
        };
      report.groups.push(entry);
      try {
        progress({ phase: "solving", group: index + 1, total: groups.length });
        const session = await api.createSession({
          label: "Auto calibration " + (index + 1),
          cameraIds,
          orientationModel,
          minCorrespondences: orientationModel === "upright" ? 4 : 8,
        });
        entry.sessionId = session.id;
        await api.addLandmarks(
          session.id,
          groupTracks.map((t, i) => ({
            label: CALIBRATION_AUTO_LABEL + (i + 1),
            observations: t.observations.map((o) => ({
              panoId: o.panoId,
              yaw: o.yaw,
              pitch: o.pitch,
              verified: false,
            })),
          })),
        );
        await api.solve(session.id);
        let solved = await calibrationAutopilotWait(api, session.id, signal);
        entry.initialStatus = solved.status;
        // Batch review: keep what the reconstruction confirms.
        if (solved.solution && solved.solvedRevision === solved.revision) {
          const decision = A.reviewDecision(solved);
          progress({
            phase: "reviewing",
            group: index + 1,
            confirm: decision.confirm.length,
            disable: decision.disable.length,
          });
          for (const id of decision.confirm) {
            const landmark = solved.landmarks.find((l) => l.id === id);
            await api.updateLandmark(session.id, id, {
              observations: landmark.observations.map((o) => ({
                ...o,
                verified: true,
              })),
            });
          }
          for (const id of decision.disable)
            await api.updateLandmark(session.id, id, { enabled: false });
          entry.confirmed = decision.confirm.length;
          entry.disabled = decision.disable.length;
          await api.solve(session.id);
          solved = await calibrationAutopilotWait(api, session.id, signal);
        }
        const q = solved.quality || {};
        entry.status = solved.status;
        entry.quality = {
          inliers: q.inliers ?? null,
          outliers: q.outliers ?? null,
          meanAngularErrorDeg: q.meanAngularErrorDeg ?? null,
          medianAngularErrorDeg: q.medianAngularErrorDeg ?? null,
          registeredCameraIds: q.registeredCameraIds || [],
          unregisteredCameraIds: q.unregisteredCameraIds || [],
          degeneracy: q.degeneracy || [],
        };
        entry.gate = A.qualityGate(solved, options.gate);
        entry.applied = false;
        // Stage 5: apply only stable, internally consistent reconstructions.
        if (options.apply && entry.gate.pass) {
          progress({ phase: "applying", group: index + 1 });
          const preview = await api.preview(session.id);
          await api.apply(session.id, { previewId: preview.previewId });
          entry.applied = true;
        }
      } catch (error) {
        entry.error = error.message;
        if (signal.cancelled || state.panoramas !== project) throw error;
      }
    }
    report.durationMs = Math.round(performance.now() - started);
    progress({ phase: "done", report });
    return report;
  } finally {
    analysis?.dispose();
    surface?.dispose();
    calibrationAutopilot.running = null;
  }
}
function calibrationAutopilotSummary(report) {
  const solved = report.groups.filter((g) => g.status === "solved").length,
    applied = report.groups.filter((g) => g.applied).length,
    accepted = report.pairs.filter((p) => p.accepted).length;
  return (
    `${accepted}/${report.pairs.length} panorama pairs matched · ${report.groups.length} group${report.groups.length === 1 ? "" : "s"}, ${solved} solved` +
    (report.options.apply ? `, ${applied} applied` : "") +
    (report.unmatchedPanoramas.length
      ? ` · ${report.unmatchedPanoramas.length} panoramas without automatic matches`
      : "")
  );
}
// Interface: Points & settings → Calibrate all panoramas.
const calibrationAutopilotControls = document.createElement("div");
calibrationAutopilotControls.className = "calibration-autopilot";
calibrationAutopilotControls.innerHTML =
  '<button id="calibrationAutopilot" type="button" class="primary">Calibrate all panoramas</button>' +
  '<label class="calibration-confirm"><input id="calibrationAutopilotApply" type="checkbox">Apply automatically when quality checks pass</label>' +
  '<p id="calibrationAutopilotReport" class="calibration-guidance" role="status"></p>';
calibrationDetails.querySelector("summary").after(calibrationAutopilotControls);
calibrationUIStyle.textContent +=
  ".calibration-autopilot{display:grid;gap:6px;margin:6px 0 10px}.calibration-autopilot button{justify-self:start}.calibration-autopilot p:empty{display:none}";
const calibrationAutopilotButton = calibrationAutopilotControls.querySelector(
  "#calibrationAutopilot",
);
calibrationAutopilotButton.onclick = async () => {
  if (calibrationAutopilot.running) {
    calibrationAutopilot.running.cancelled = true;
    return;
  }
  const output = calibrationAutopilotControls.querySelector(
    "#calibrationAutopilotReport",
  );
  calibrationAutopilotButton.textContent = "Stop";
  try {
    const report = await calibrationAutopilotRun({
      apply: calibrationAutopilotControls.querySelector(
        "#calibrationAutopilotApply",
      ).checked,
      onProgress: (info) => {
        const text =
          info.phase === "matching"
            ? `Matching pair ${info.done + 1} of ${info.total}…`
            : info.phase === "sampling"
              ? "Reading panorama views…"
              : info.phase === "solving"
                ? `Solving group ${info.group} of ${info.total}…`
                : info.phase === "reviewing"
                  ? `Reviewing group ${info.group}: ${info.confirm} consistent, ${info.disable} disabled…`
                  : info.phase === "applying"
                    ? `Applying group ${info.group}…`
                    : "";
        if (text) {
          output.textContent = text;
          calibrationUIMessage(text);
        }
      },
    });
    calibrationAutopilot.lastReport = report;
    output.textContent = calibrationAutopilotSummary(report);
    calibrationUIMessage(output.textContent);
    const first = report.groups.find((g) => g.sessionId);
    if (first && calibrationUI.open) {
      const saved = calibrationUIState();
      saved.sessionId = first.sessionId;
      calibrationUISave();
      await calibrationUIRefresh();
      if (first.cameraIds.length >= 2)
        await calibrationUISetPair(first.cameraIds[0], first.cameraIds[1], {
          remember: false,
        }).catch(() => {});
    }
  } catch (error) {
    output.textContent = error.message;
    calibrationUIMessage(error.message);
  } finally {
    calibrationAutopilotButton.textContent = "Calibrate all panoramas";
  }
};
window.PalaceCalibrationAutopilot = Object.freeze({
  run: calibrationAutopilotRun,
  summary: calibrationAutopilotSummary,
  get running() {
    return !!calibrationAutopilot.running;
  },
  get lastReport() {
    return calibrationAutopilot.lastReport || null;
  },
});
