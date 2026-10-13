/* Built-in panorama calibration UI. All observation/solve/world transactions use the public SDK. */
"use strict";
const calibrationUI = {
  enabled: false,
  open: false,
  generation: 0,
  session: null,
  views: {},
  subscriptions: [],
  refreshTimer: null,
  saveTimer: null,
  actionTail: Promise.resolve(),
  drag: null,
  busy: false,
  preview: null,
  spatial: null,
  previousView: null,
};
function calibrationUIBlank() {
  return {
    version: 1,
    sessionId: null,
    left: null,
    right: null,
    selected: null,
    views: {},
    history: [],
    groupViews: {},
    visibleConfirmed: false,
    parallaxConfirmed: false,
  };
}
function calibrationUINormalize(input) {
  if (input == null) return calibrationUIBlank();
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    input.version !== 1
  )
    throw new Error("Invalid panorama calibration workspace.");
  const result = calibrationUIBlank();
  for (const key of ["sessionId", "left", "right", "selected"])
    if (input[key] != null) {
      if (
        typeof input[key] !== "string" ||
        input[key].length > 180 ||
        ["__proto__", "constructor", "prototype"].includes(input[key])
      )
        throw new Error("Invalid calibration workspace ID.");
      result[key] = input[key];
    }
  if (input.views != null) {
    if (
      !input.views ||
      typeof input.views !== "object" ||
      Array.isArray(input.views)
    )
      throw new Error("Invalid panorama views.");
    for (const [id, pose] of Object.entries(input.views)) {
      if (
        ["__proto__", "constructor", "prototype"].includes(id) ||
        !pose ||
        !Number.isFinite(pose.yaw) ||
        !Number.isFinite(pose.pitch) ||
        Math.abs(pose.pitch) > 85 ||
        !Number.isFinite(pose.fov) ||
        pose.fov < 30 ||
        pose.fov > 150
      )
        throw new Error("Invalid saved panorama view.");
      result.views[id] = { yaw: pose.yaw, pitch: pose.pitch, fov: pose.fov };
    }
  }
  if (input.history != null) {
    if (!Array.isArray(input.history))
      throw new Error("Invalid calibration pair history.");
    result.history = Array.from(input.history).map((pair) => {
      if (
        !pair ||
        typeof pair.left !== "string" ||
        typeof pair.right !== "string" ||
        pair.left.length > 180 ||
        pair.right.length > 180 ||
        (pair.selected != null && typeof pair.selected !== "string")
      )
        throw new Error("Invalid calibration pair.");
      return {
        left: pair.left,
        right: pair.right,
        selected: pair.selected || null,
      };
    });
  }
  if (input.groupViews != null) {
    if (typeof input.groupViews !== "object" || Array.isArray(input.groupViews))
      throw new Error("Invalid calibration groups.");
    for (const [id, pair] of Object.entries(input.groupViews)) {
      if (
        !id ||
        id.length > 180 ||
        ["__proto__", "constructor", "prototype"].includes(id) ||
        !pair ||
        typeof pair !== "object"
      )
        throw new Error("Invalid calibration group.");
      const record = {};
      for (const key of ["left", "right", "selected"]) {
        const value = pair[key];
        if (
          value != null &&
          (typeof value !== "string" ||
            value.length > 180 ||
            ["__proto__", "constructor", "prototype"].includes(value))
        )
          throw new Error("Invalid calibration group camera.");
        record[key] = value ?? null;
      }
      result.groupViews[id] = record;
    }
  }
  result.visibleConfirmed = input.visibleConfirmed === true;
  result.parallaxConfirmed = input.parallaxConfirmed === true;
  sceneJSON(result, 2 * 1024 * 1024);
  return result;
}
function calibrationUIState() {
  return state.calibrationUI || (state.calibrationUI = calibrationUIBlank());
}
function calibrationUICapture() {
  const saved = calibrationUIState();
  for (const view of Object.values(calibrationUI.views))
    if (view.currentId)
      saved.views[view.currentId] = {
        yaw: view.yaw,
        pitch: view.pitch,
        fov: view.fov,
      };
  if (saved.sessionId) {
    saved.groupViews ||= {};
    saved.groupViews[saved.sessionId] = {
      left: saved.left,
      right: saved.right,
      selected: saved.selected,
    };
  }
  return structuredClone(saved);
}
function calibrationUISave() {
  calibrationUICapture();
  state.dirty = true;
  scheduleRecovery();
}
function calibrationUIAPI() {
  return window.PalaceAPI.tour.world.calibration;
}
function calibrationUIPanos() {
  return PalacePanoramaSurfaces.list()
    .filter((p) => p.hasImage)
    .sort(
      (a, b) =>
        (Number.isFinite(a.order) ? a.order : Infinity) -
        (Number.isFinite(b.order) ? b.order : Infinity),
    );
}
function calibrationUIPanoLabel(pano) {
  return `${calibrationUIIds().indexOf(pano.id) + 1}. ${pano.room || pano.id}`;
}
function calibrationUINeighbor(id, exclude = []) {
  const ids = calibrationUIIds(),
    destinations = state.panoramas[id]?.destinations || [];
  const neighbors = destinations.map((d) =>
    typeof d === "string" ? d : d.panoId || d.id || d.to,
  );
  return (
    neighbors.find(
      (next) => next !== id && ids.includes(next) && !exclude.includes(next),
    ) || ids.find((next) => next !== id && !exclude.includes(next))
  );
}
function calibrationUIIds() {
  return calibrationUIPanos().map((p) => p.id);
}
const calibrationTool = document.createElement("button");
calibrationTool.id = "calibrationTool";
calibrationTool.type = "button";
calibrationTool.className = "abtn";
calibrationTool.dataset.short = "Calibrate";
calibrationTool.dataset.tool = "calibration";
calibrationTool.title = "Panorama calibration";
calibrationTool.setAttribute("aria-label", "Panorama calibration");
calibrationTool.setAttribute("aria-pressed", "false");
const calibrationSymbol = document.createElementNS(
  "http://www.w3.org/2000/svg",
  "symbol",
);
calibrationSymbol.id = "i-calibration";
calibrationSymbol.setAttribute("viewBox", "0 0 16 16");
calibrationSymbol.innerHTML =
  '<path d="M5 2H2v3m9-3h3v3M2 11v3h3m9-3v3h-3M8 4v8M4 8h8" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="8" cy="8" r="2.5" fill="none" stroke="currentColor" stroke-width="1.4"/>';
document.querySelector("#i-camera-edit").parentNode.append(calibrationSymbol);
calibrationTool.innerHTML =
  '<svg class="ic"><use href="#i-calibration"/></svg>';
document.querySelector("#abTour").after(calibrationTool);
registerPalaceTool(
  "system.calibrationTool",
  "Panorama calibration",
  calibrationTool,
);
const calibrationWorkspace = document.createElement("section");
calibrationWorkspace.id = "calibrationWorkspace";
calibrationWorkspace.className = "palace-plugin-surface";
calibrationWorkspace.hidden = true;
calibrationWorkspace.setAttribute(
  "aria-label",
  "Panorama calibration workspace",
);
calibrationWorkspace.innerHTML = `
 <header class="calibration-header"><div><strong>Panorama calibration</strong><span class="calibration-caption">Choose a point on the left, then match it on the right.</span></div><label class="calibration-session-label">Session<select id="calibrationSession" aria-label="Calibration session"></select></label><button id="calibrationNewSession" type="button" title="New calibration session">New session</button><button id="calibrationClose" type="button" aria-label="Close panorama calibration"><svg class="ic"><use href="#i-close"/></svg></button></header>
 <div class="calibration-summary"><span id="calibrationStatus" role="status" aria-live="polite"></span><span id="calibrationProgress"></span></div>
 <div id="calibrationEmpty" class="calibration-empty" hidden></div>
 <div class="calibration-pair">${["left", "right"].map((side) => `<section class="calibration-pane" data-side="${side}" aria-label="${side === "left" ? "Reference" : "Connecting"} panorama"><header><label>${side === "left" ? "Reference panorama" : "Connecting panorama"}<select id="calibration-${side}-picker" aria-label="${side === "left" ? "Left" : "Right"} panorama"></select></label><label class="calibration-fov">FOV<input id="calibration-${side}-fov" type="range" min="30" max="150" step="1" value="75" aria-label="${side === "left" ? "Left" : "Right"} panorama FOV"></label></header><div class="calibration-viewport"><span class="calibration-step"></span><div class="calibration-loading" role="status">Loading panorama…</div><canvas id="calibration-${side}-canvas" tabindex="0" aria-label="${side === "left" ? "Left" : "Right"} panorama: drag to rotate, scroll to zoom"></canvas><div class="calibration-observations"></div><p class="calibration-view-error" role="status"></p></div></section>`).join("")}</div>
 <div class="calibration-matchbar"><button id="calibrationNewPoint" type="button">New point</button><button id="calibrationAddLink" type="button" class="primary">Add correspondence</button><label class="calibration-confirm"><input id="calibrationVisibility" type="checkbox">Visible in both panoramas</label><label class="calibration-confirm"><input id="calibrationParallax" type="checkbox">Nearby point with clear parallax</label><span id="calibrationPairStatus"></span></div>
 <footer class="calibration-navigation"><button id="calibrationPrevious" type="button">Previous panorama</button><button id="calibrationBack" type="button">Return to previous pair</button><button id="calibrationCameras" type="button">All cameras</button><span></span><button id="calibrationNext" type="button" class="primary">Next panorama →</button></footer>
 <details id="calibrationDetails" class="calibration-details"><summary>Control points and diagnostics <span id="calibrationPointCount"></span></summary><div class="calibration-detail-body"><div id="calibrationLandmarks" class="calibration-landmarks"></div><div class="calibration-inspector"><strong id="calibrationSelected">No point selected</strong><p id="calibrationObservedOn"></p><label>Label<input id="calibrationPointLabel" maxlength="500" aria-label="Control point label"></label><label><input id="calibrationPointEnabled" type="checkbox">Use this point in optimization</label><div class="calibration-point-actions"><button id="calibrationRemoveLeft" type="button">Remove left observation</button><button id="calibrationRemoveRight" type="button">Remove right observation</button><button id="calibrationRemovePoint" type="button">Delete point</button></div><p id="calibrationPointQuality"></p></div></div><p id="calibrationQuality"></p><p class="calibration-guidance">Use the same directly visible physical point. Prefer nearby landmarks around the space between cameras, with clear parallax. Missing depth does not prevent adding observations. Drag a numbered point to correct its position.</p><div class="calibration-distance"><label>Known distance between this pair (meters)<input id="calibrationDistance" type="number" min="0.0001" step="any" aria-label="Known camera distance"></label><button id="calibrationDistanceSave" type="button">Set distance</button><button id="calibrationDistanceRemove" type="button">Remove distance</button><button id="calibrationSolve" type="button">Recalculate</button></div></details>
 <section id="calibrationCameraPanel" class="calibration-camera-panel" hidden><header><strong>All cameras</strong><button id="calibrationCamerasClose" type="button">Close</button></header><div id="calibrationCameraList"></div></section>
 <div class="calibration-result-actions"><button id="calibrationPreview" type="button">Preview reconstruction</button><button id="calibrationApply" type="button" class="primary">Apply calibration</button><button id="calibrationRevert" type="button">Undo last application</button><span id="calibrationMessage" role="status" aria-live="polite"></span></div>
 <section id="calibrationPreviewPanel" hidden><header><strong>Reconstruction preview · not applied</strong><span>Drag to orbit · scroll to zoom · cameras, connections, yellow control points and shared objects</span><button id="calibrationPreviewClose" type="button">Close preview</button></header><canvas id="calibrationPreviewCanvas" aria-label="3D calibration reconstruction" tabindex="0"></canvas></section>`;
document.querySelector("#stage").append(calibrationWorkspace);
const calibrationUIStyle = document.createElement("style");
calibrationUIStyle.textContent = `
/* A bounded matching workspace; secondary tools live in one inspector. */
#appRoot.calibration-open #planTools,#appRoot.calibration-open .bottom,#appRoot.calibration-open #floorOverlay,#appRoot.calibration-open #compass,#appRoot.calibration-open #markerCtl,#appRoot.calibration-open #empty{display:none!important}
#appRoot.calibration-open #abPlan::before{display:none}#appRoot.calibration-open #abPlan{color:var(--vscode-activity-inactive)}#appRoot.calibration-open .m-hint{display:none!important}
#calibrationTool[hidden],#calibrationWorkspace[hidden],#calibrationWorkspace [hidden]{display:none!important}
#calibrationWorkspace{position:absolute;inset:0;z-index:12;display:flex;flex-direction:column;gap:8px;padding:16px;background:var(--vscode-editor-bg);color:var(--text);font:13px/1.45 var(--t-font-ui,system-ui);overflow:hidden;cursor:default;user-select:text;box-sizing:border-box}
#calibrationWorkspace button{color:var(--text);background:var(--vscode-input-bg,var(--panel));border:1px solid var(--line);border-radius:7px;padding:7px 12px;font:inherit;cursor:pointer;min-height:34px}
#calibrationWorkspace button:hover{background:var(--t-hover,var(--line))}#calibrationWorkspace button:disabled{opacity:.45;cursor:default}#calibrationWorkspace button.primary{background:var(--vscode-button-bg);color:var(--vscode-button-fg,#fff)}
#calibrationWorkspace button:focus-visible,#calibrationWorkspace summary:focus-visible,#calibrationWorkspace canvas:focus-visible{outline:2px solid var(--blue);outline-offset:2px}
.calibration-header{display:flex;align-items:center;gap:8px;min-height:36px;flex-shrink:0;padding-right:170px}.calibration-header>div{flex:1;min-width:0}.calibration-header strong{font-size:17px;font-weight:600}.calibration-caption{display:block;color:var(--muted);font-size:12px}#calibrationClose{position:absolute;right:16px;top:16px;padding:6px!important;min-width:34px}
.calibration-hint{font-size:12px;color:var(--muted);flex-shrink:0;min-height:18px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.calibration-pair{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px;flex:1;min-height:0;order:1}.calibration-pane{min-width:0;min-height:0;display:flex;flex-direction:column;overflow:hidden;border:1px solid var(--line);border-radius:12px;background:var(--panel)}.calibration-pane[data-awaiting=true]{border-color:var(--blue)}.calibration-pane>header{display:flex;align-items:center;gap:10px;padding:8px 10px;flex-shrink:0}.calibration-pane>header>label:first-child{flex:1;min-width:0;color:var(--muted);font-size:11px}.calibration-pane select{display:block;width:100%;margin-top:3px}.calibration-fov{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--muted)}.calibration-fov input{width:66px;min-width:0}
.calibration-viewport{position:relative;flex:1;min-height:0;overflow:hidden;background:#111}.calibration-viewport canvas{width:100%;height:100%;position:absolute;inset:0;display:block;touch-action:none;cursor:crosshair}.calibration-step{position:absolute;top:10px;left:10px;z-index:2;border:1px solid #ffffff40;border-radius:6px;padding:3px 7px;background:#181818ab;color:#fff;font-size:11px;pointer-events:none}.calibration-loading{position:absolute;inset:0;display:none;align-items:center;justify-content:center;background:#151515e6;color:#ddd;font-size:13px;z-index:4}.calibration-viewport:has(canvas[aria-busy=true]) .calibration-loading{display:flex}.calibration-loading::before{content:'';width:14px;height:14px;border:2px solid #ffffff35;border-top-color:var(--blue);border-radius:50%;margin-right:9px;animation:calibration-spin 1s linear infinite}@keyframes calibration-spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.calibration-loading::before{animation:none}}
.calibration-observations{position:absolute;inset:0;pointer-events:none;z-index:3}#calibrationWorkspace .calibration-observation{position:absolute;transform:translate(-50%,-50%);width:30px;height:30px;min-height:0;padding:0;border-radius:50%;border:2px solid #fff;color:#fff;background:var(--vscode-button-bg);box-shadow:0 1px 6px #000a;pointer-events:auto;touch-action:none;user-select:none;font-size:12px;font-weight:700}#calibrationWorkspace .calibration-observation.selected{background:#f5b301;color:#17130a;outline:2px solid var(--blue);outline-offset:3px}#calibrationWorkspace .calibration-observation.excluded{opacity:.55;border-style:dashed}.calibration-view-error{position:absolute;bottom:8px;left:10px;right:10px;margin:0;color:#eee;background:#111c;padding:6px;border-radius:5px;font-size:12px;pointer-events:none;z-index:5}.calibration-view-error:empty{display:none}
.calibration-matchbar,.calibration-navigation,.calibration-summary,.calibration-result-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;flex-shrink:0}.calibration-matchbar{order:2}.calibration-confirm{display:flex;gap:6px;align-items:center;font-size:12px}.calibration-summary{order:3;color:var(--muted);font-size:12px;min-height:18px}#calibrationStatus{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.calibration-navigation{order:4;padding-top:8px;border-top:1px solid var(--line)}.calibration-navigation>span{flex:1}#calibrationPairStatus{margin-left:auto;color:var(--muted);font-size:12px}
.calibration-details{position:absolute;top:16px;right:58px;z-index:6;font-size:12px;width:155px}.calibration-details>summary{list-style:none;cursor:pointer;display:block;padding:8px 10px;border:1px solid var(--line);border-radius:7px;text-align:center;background:var(--panel)}.calibration-details>summary::-webkit-details-marker{display:none}.calibration-details[open]{right:16px;top:60px;bottom:16px;width:340px;padding:12px;box-sizing:border-box;border:1px solid var(--line);border-radius:10px;background:var(--vscode-editor-bg);box-shadow:0 12px 35px #0006;overflow:auto}.calibration-details[open]>summary{text-align:left;margin-bottom:12px}.calibration-details[open]>summary::after{content:'×';float:right;font-size:17px;line-height:17px}.calibration-session-controls{display:flex;align-items:end;gap:6px;margin-bottom:12px}.calibration-session-label{flex:1;min-width:0;color:var(--muted)}.calibration-session-label select{display:block;width:100%;margin-top:4px}.calibration-detail-body{display:flex;flex-direction:column;gap:12px}.calibration-landmarks{display:flex;flex-direction:column;gap:4px;max-height:180px;overflow:auto}.calibration-landmarks button{text-align:left}.calibration-landmarks button[aria-pressed=true]{outline:1px solid var(--blue)}.calibration-inspector{border-top:1px solid var(--line);padding-top:12px}.calibration-inspector label{display:flex;align-items:center;gap:5px;margin:8px 0}.calibration-inspector label input[type=text]{min-width:0;flex:1}.calibration-point-actions,.calibration-distance{display:flex;gap:6px;flex-wrap:wrap}.calibration-distance label{display:block;width:100%}.calibration-distance input{display:block;width:100%;margin-top:4px}.calibration-guidance,#calibrationQuality,#calibrationObservedOn,#calibrationPointQuality,#calibrationProgress{color:var(--muted)}#calibrationProgress{display:block;margin:12px 0}.calibration-result-actions{order:3;padding-top:8px;border-top:1px solid var(--line)}
.calibration-camera-panel{position:absolute;z-index:7;inset:60px 16px 16px;border:1px solid var(--line);border-radius:12px;padding:16px;background:var(--vscode-editor-bg);box-shadow:0 8px 32px #0005;overflow:auto}.calibration-camera-panel header,#calibrationPreviewPanel header{display:flex;align-items:center;gap:10px;justify-content:space-between}#calibrationCameraList{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px;margin-top:12px}.calibration-empty{padding:12px;border:1px dashed var(--line);border-radius:8px;color:var(--muted);flex-shrink:0}
#calibrationPreviewPanel{position:absolute;inset:60px 16px 16px;z-index:8;border:1px solid var(--line);border-radius:12px;padding:12px;background:var(--vscode-editor-bg);display:flex;flex-direction:column;box-sizing:border-box;box-shadow:0 8px 32px #0005}#calibrationPreviewPanel header{font-size:12px;flex-wrap:wrap}#calibrationPreviewPanel header>span{flex:1;color:var(--muted)}#calibrationPreviewCanvas{display:block;width:100%;flex:1;min-height:0;touch-action:none;margin-top:8px}
@media(min-width:1000px){#calibrationWorkspace:has(.calibration-details[open]) .calibration-pair{margin-right:366px}}
@media(max-width:760px){#calibrationWorkspace{padding:8px;gap:5px}.calibration-header{padding-right:145px;min-height:32px}.calibration-header strong{font-size:14px}.calibration-caption{display:none}#calibrationClose{right:8px;top:8px}.calibration-details{top:8px;right:48px;width:138px;font-size:11px}.calibration-details[open]{top:48px;right:8px;bottom:8px;width:min(340px,calc(100% - 16px))}.calibration-details>summary{padding:8px 5px}.calibration-pair{grid-template-columns:1fr;grid-template-rows:minmax(0,1fr) minmax(0,1fr);gap:7px}.calibration-pane{border-radius:8px}.calibration-pane>header{padding:4px 7px;gap:6px}.calibration-pane>header>label:first-child{font-size:10px}.calibration-pane select{margin-top:1px;min-height:30px;font-size:16px;padding-top:2px;padding-bottom:2px}.calibration-fov input{width:55px}.calibration-fov{font-size:10px}#calibrationWorkspace button{font-size:12px;min-height:32px;padding:5px 8px}.calibration-matchbar{gap:5px}.calibration-matchbar .calibration-confirm{font-size:11px}#calibrationPairStatus{flex:1 0 100%;font-size:11px;margin:0}.calibration-navigation{gap:5px;padding-top:5px;flex-wrap:nowrap}.calibration-navigation>span{display:none}#calibrationNext{margin-left:auto}.calibration-summary{font-size:11px}.calibration-hint{font-size:11px}.calibration-camera-panel,#calibrationPreviewPanel{inset:48px 8px 8px}.calibration-step{font-size:10px;top:6px;left:6px}.calibration-result-actions{flex-wrap:wrap}}
@media(max-height:520px) and (min-width:600px){#calibrationWorkspace{padding:8px;gap:4px}.calibration-header{min-height:30px}.calibration-caption{display:none}.calibration-pane>header{padding:4px}.calibration-navigation{padding-top:3px}#calibrationWorkspace button{min-height:28px;padding:4px 8px}.calibration-hint{display:none}}
`;
document.head.append(calibrationUIStyle);
const calibrationHeader = calibrationWorkspace.querySelector(
  ".calibration-header",
);
const calibrationDetails = document.querySelector("#calibrationDetails");
calibrationDetails.querySelector("summary").innerHTML =
  'Points & settings <span id="calibrationPointCount"></span>';
const calibrationSessionControls = document.createElement("div");
calibrationSessionControls.className = "calibration-session-controls";
calibrationSessionControls.append(
  calibrationHeader.querySelector(".calibration-session-label"),
  document.querySelector("#calibrationNewSession"),
);
calibrationDetails.querySelector("summary").after(calibrationSessionControls);
calibrationDetails.append(document.querySelector("#calibrationProgress"));
calibrationWorkspace.append(
  document.querySelector(".calibration-result-actions"),
);
calibrationWorkspace.querySelector(".calibration-result-actions").hidden = true;
const calibrationHint = document.createElement("div");
calibrationHint.className = "calibration-hint";
calibrationHint.append(document.querySelector("#calibrationMessage"));
calibrationHeader.after(calibrationHint);
calibrationWorkspace.querySelector(".calibration-caption").textContent =
  "Match the same physical landmark in both panoramas";
calibrationWorkspace
  .querySelector(".calibration-summary")
  .after(document.querySelector(".calibration-navigation"));
calibrationWorkspace
  .querySelector(".calibration-confirm:last-of-type")
  .remove();
const parallaxRule = document.createElement("label");
parallaxRule.className = "calibration-confirm";
parallaxRule.innerHTML =
  '<input id="calibrationParallax" type="checkbox">Nearby point with clear parallax';
calibrationDetails.querySelector(".calibration-guidance").before(parallaxRule);
calibrationWorkspace.querySelector(
  "#calibrationVisibility",
).parentNode.lastChild.textContent = "Visible in both";
document.querySelector("#calibrationAddLink").textContent = "Match point";
document.querySelector("#calibrationNewSession").textContent = "New group";
calibrationSessionControls.querySelector("label").firstChild.textContent =
  "Calibration group";
const calibrationNoOverlap = document.createElement("button");
calibrationNoOverlap.id = "calibrationNoOverlap";
calibrationNoOverlap.type = "button";
calibrationNoOverlap.textContent = "No overlap";
calibrationNoOverlap.title =
  "Skip this pair and start a separate calibration group. No camera connection is invented.";
document.querySelector("#calibrationAddLink").after(calibrationNoOverlap);
const calibrationScope = document.createElement("button");
calibrationScope.id = "calibrationScope";
calibrationScope.type = "button";
calibrationScope.textContent = "Use only observed cameras";
calibrationScope.title =
  "Remove unobserved cameras from this group without deleting them from the project.";
calibrationSessionControls.after(calibrationScope);

document.querySelector("#calibrationPrevious").textContent = "← Previous";
document.querySelector("#calibrationBack").textContent = "↶ Back";
document.querySelector("#calibrationNext").textContent = "Next →";
function calibrationUIFitLayout() {
  calibrationWorkspace.style.left = calibrationWorkspace.style.top = "0px";
  if (!calibrationUI.open) return;
  const pair = calibrationWorkspace.querySelector(".calibration-pair"),
    panel = document.querySelector("#calibrationPreviewPanel");
  const bottom = Math.max(
    0,
    calibrationWorkspace.clientHeight - pair.offsetTop - pair.offsetHeight,
  );
  document.querySelector("#calibrationDetails").style.bottom =
    calibrationDetails.open ? bottom + "px" : "";
  if (!calibrationUI.preview) return;
  panel.style.top = pair.offsetTop + "px";
  panel.style.bottom =
    Math.max(
      0,
      calibrationWorkspace.clientHeight - pair.offsetTop - pair.offsetHeight,
    ) + "px";
}
calibrationDetails.addEventListener("toggle", calibrationUIFitLayout);
const calibrationUILayoutObserver = new ResizeObserver(calibrationUIFitLayout);
calibrationUILayoutObserver.observe(
  calibrationWorkspace.querySelector(".calibration-pair"),
);
calibrationUILayoutObserver.observe(calibrationWorkspace);
function calibrationUIUpdateGuide() {
  if (!calibrationUI.open) return;
  const saved = calibrationUIState(),
    point = calibrationUI.session?.landmarks.find(
      (l) => l.id === saved.selected,
    );
  for (const side of ["left", "right"]) {
    const pane = calibrationWorkspace.querySelector(
      `.calibration-pane[data-side=${side}]`,
    );
    const view = calibrationUI.views[side],
      hasObservation = point?.observations.some(
        (o) => o.panoId === saved[side],
      );
    pane.dataset.awaiting = String(
      side === "left" ? !point : !!point && !hasObservation,
    );
    pane.querySelector(".calibration-step").textContent =
      side === "left" ? "1 · Reference" : "2 · Match";
  }
}
function calibrationUIMessage(message) {
  document.querySelector("#calibrationMessage").textContent =
    message ||
    "Drag to look around. Click a landmark on the left, then the same landmark on the right.";
  calibrationUIUpdateGuide();
}
async function calibrationUIAction(action) {
  const generation = calibrationUI.generation;
  const operation = calibrationUI.actionTail.then(async () => {
    if (!calibrationUI.open || generation !== calibrationUI.generation) return;
    calibrationUI.busy = true;
    const before = calibrationUI.session
      ? {
          id: calibrationUI.session.id,
          revision: calibrationUI.session.revision,
        }
      : null;
    try {
      if (!canEditPlan() || reviewSession)
        throw new Error("Switch to Edit mode and stop reviewing first.");
      await action();
      if (calibrationUI.open && generation === calibrationUI.generation) {
        await calibrationUIRefresh();
        if (
          calibrationUI.session &&
          before?.id === calibrationUI.session.id &&
          calibrationUI.session.revision > before.revision &&
          !calibrationUI.session.config.automaticSolve
        )
          await calibrationUIAPI().solve(calibrationUI.session.id);
      }
    } catch (error) {
      if (calibrationUI.open && generation === calibrationUI.generation) {
        calibrationUIMessage(error.message);
        await calibrationUIRefresh().catch(() => {});
      }
    } finally {
      calibrationUI.busy = false;
    }
  });
  calibrationUI.actionTail = operation.catch(() => {});
  return operation;
}
function calibrationUIQueueRefresh() {
  if (!calibrationUI.open) return;
  clearTimeout(calibrationUI.refreshTimer);
  calibrationUI.refreshTimer = setTimeout(
    () =>
      calibrationUIRefresh().catch((error) =>
        calibrationUIMessage(error.message),
      ),
    25,
  );
}
async function calibrationUIRefresh() {
  if (!calibrationUI.open) return;
  const generation = calibrationUI.generation,
    saved = calibrationUIState(),
    sessions = await calibrationUIAPI().listSessions();
  if (!calibrationUI.open || generation !== calibrationUI.generation) return;
  calibrationUI.session =
    sessions.find((s) => s.id === saved.sessionId) || sessions[0] || null;
  if (calibrationUI.session) saved.sessionId = calibrationUI.session.id;
  if (
    calibrationUI.preview &&
    (calibrationUI.preview.sessionId !== saved.sessionId ||
      calibrationUI.preview.revision !== calibrationUI.session?.revision)
  ) {
    calibrationUI.preview = null;
    calibrationUI.spatial?.dispose();
    calibrationUI.spatial = null;
    document.querySelector("#calibrationPreviewPanel").hidden = true;
  }
  const ids = calibrationUIIds();
  if (!ids.includes(saved.left)) saved.left = ids[0] || null;
  if (!ids.includes(saved.right) || saved.right === saved.left)
    saved.right = calibrationUINeighbor(saved.left) || null;
  if (!calibrationUI.session?.landmarks.some((l) => l.id === saved.selected))
    saved.selected = null;
  if (saved.sessionId) {
    saved.groupViews ||= {};
    saved.groupViews[saved.sessionId] = {
      left: saved.left,
      right: saved.right,
      selected: saved.selected,
    };
  }
  const sessionPicker = document.querySelector("#calibrationSession");
  sessionPicker.replaceChildren();
  for (const session of sessions)
    sessionPicker.add(new Option(session.label || session.id, session.id));
  sessionPicker.value = saved.sessionId || "";
  sessionPicker.disabled = !sessions.length;
  const empty = document.querySelector("#calibrationEmpty");
  empty.hidden = ids.length >= 2;
  empty.textContent = ids.length
    ? "Only one panorama is available. Add another to create correspondences. You can already create reference points."
    : "No panoramas in this project. Import a .3dview / .mpalace or add panorama images first.";
  for (const side of ["left", "right"]) {
    const picker = document.querySelector("#calibration-" + side + "-picker"),
      wanted = saved[side];
    if (picker.dataset.ids !== JSON.stringify(ids) || picker.value !== wanted) {
      picker.replaceChildren();
      for (const pano of calibrationUIPanos())
        picker.add(new Option(calibrationUIPanoLabel(pano), pano.id));
      picker.value = wanted || "";
      picker.dataset.ids = JSON.stringify(ids);
    }
    picker.disabled = ids.length < 2;
    const view = calibrationUI.views[side];
    if (wanted && view.currentId !== wanted) {
      view.overlaySignature = null;
      await view.showPanorama(wanted, saved.views[wanted]);
      if (!calibrationUI.open || generation !== calibrationUI.generation)
        return;
    } else if (!wanted) {
      view.dispose();
      document.querySelector(
        ".calibration-pane[data-side=" + side + "] .calibration-view-error",
      ).textContent =
        side === "left" ? "No reference panorama." : "No connecting panorama.";
    }
    calibrationUIRenderMarkers(side);
    calibrationUIWorldOverlay(side);
  }
  calibrationUIRenderStatus();
  calibrationUIRenderPoints();
  calibrationUIRenderCameras();
  calibrationUIUpdateGuide();
}
function calibrationUIGroupPlacementReady(session) {
  if (!session?.solution) return false;
  const world = worldData(),
    groupIds = session.cameraIds;
  const otherCameras = Object.keys(world.cameras).filter(
    (id) => !groupIds.includes(id),
  );
  if (!otherCameras.length) return true;
  return (
    !!world.cameras[session.solution.referenceCameraId] &&
    (!!session.applied ||
      (session.quality.metricScale.known && world.metersPerUnit != null))
  );
}
function calibrationUIRenderStatus() {
  const saved = calibrationUIState(),
    session = calibrationUI.session,
    quality = session?.quality,
    landmarks = session?.landmarks || [],
    ids = calibrationUIIds(),
    pair = landmarks.filter(
      (l) =>
        l.enabled &&
        l.observations.some((o) => o.panoId === saved.left) &&
        l.observations.some((o) => o.panoId === saved.right),
    ),
    edge = quality?.edges.find(
      (e) =>
        (e.from === saved.left && e.to === saved.right) ||
        (e.from === saved.right && e.to === saved.left),
    ),
    observed = new Set(
      landmarks.flatMap((l) => l.observations.map((o) => o.panoId)),
    ),
    registered = quality?.registeredCameraIds || [];
  const messages = {
    collecting: "Collecting observations.",
    insufficient_data:
      "Correspondences saved. There is not enough information to calculate camera positions yet.",
    degenerate:
      "Geometry needs correction: weak parallax, pure rotation or ambiguous points.",
    provisional:
      "Preliminary solution. More constraints or visibility confirmation are needed.",
    solved: "This group has a stable reconstruction.",
    failed: "Calculation failed. Saved observations are kept.",
  };
  document.querySelector("#calibrationStatus").textContent = session?.pending
    ? "Calculating in the background…"
    : messages[session?.status] || "Create or select a session.";
  document.querySelector("#calibrationProgress").textContent =
    `${ids.length} panoramas · ${observed.size} with observations · ${registered.length} registered candidates · ${Object.keys(worldData().cameras).filter((id) => ids.includes(id)).length} world poses · ${(session?.cameraIds || []).filter((id) => !registered.includes(id)).length} unresolved in group · ${ids.filter((id) => !session?.cameraIds.includes(id)).length} outside group`;
  const pairStatus = !pair.length
    ? "No correspondences"
    : session?.pending
      ? "Correspondences added"
      : edge?.status === "degenerate" ||
          edge?.status === "failed" ||
          quality?.visibility.occluded.some((o) =>
            [saved.left, saved.right].includes(o.panoId),
          )
        ? "Needs correction"
        : pair.length < (session?.config.minCorrespondences || 8)
          ? "Insufficient data"
          : registered.includes(saved.left) &&
              registered.includes(saved.right) &&
              session.status === "solved"
            ? "Calibrated"
            : session?.solution
              ? "Preliminary solution"
              : "Correspondences added";
  document.querySelector("#calibrationPairStatus").textContent =
    `${pair.length}/${session?.config.minCorrespondences || 8} initial matches · ${pairStatus}`;
  document.querySelector("#calibrationVisibility").checked =
    saved.visibleConfirmed;
  document.querySelector("#calibrationParallax").checked =
    saved.parallaxConfirmed;
  const leftIndex = ids.indexOf(saved.left),
    rightIndex = ids.indexOf(saved.right);
  document.querySelector("#calibrationNext").disabled =
    rightIndex < 0 || rightIndex >= ids.length - 1;
  document.querySelector("#calibrationPrevious").disabled = leftIndex <= 0;
  document.querySelector("#calibrationBack").disabled = !saved.history.length;
  document.querySelector("#calibrationAddLink").disabled =
    !saved.selected || !saved.right;
  document.querySelector("#calibrationPreview").disabled =
    !session?.solution || session.pending;
  document.querySelector("#calibrationApply").disabled =
    session?.status !== "solved" ||
    session.pending ||
    !calibrationUIGroupPlacementReady(session);
  document.querySelector("#calibrationRevert").disabled = !session?.applied;
  if (
    session?.status === "solved" &&
    !calibrationUIGroupPlacementReady(session)
  )
    document.querySelector("#calibrationStatus").textContent =
      "Group solved independently. Set its reference world pose and common metric scale before applying beside other groups.";
  calibrationWorkspace.querySelector(".calibration-result-actions").hidden =
    !session?.solution && !session?.applied;
  document.querySelector("#calibrationSolve").disabled = !session;
  const format = (value) => (value == null ? "—" : value.toFixed(3));
  document.querySelector("#calibrationQuality").textContent = quality
    ? `${quality.observationCount} observations · ${quality.verifiedCorrespondences} confirmed pairs · ${quality.inliers} inliers / ${quality.outliers} outliers · mean ${format(quality.meanAngularErrorDeg)}° / median ${format(quality.medianAngularErrorDeg)}° error · parallax ${format(quality.medianParallaxDeg)}° · ${quality.metricScale.known ? "metric scale" : "relative scale; units are not meters"}${quality.degeneracy.length ? " · " + quality.degeneracy.join(", ") : ""}${session.error ? " · " + session.error.message : ""}`
    : "";
  const distance = session?.config.distances.find(
    (d) =>
      d.type === "cameras" &&
      ((d.from === saved.left && d.to === saved.right) ||
        (d.from === saved.right && d.to === saved.left)),
  );
  if (document.activeElement !== document.querySelector("#calibrationDistance"))
    document.querySelector("#calibrationDistance").value =
      distance?.distance ?? "";
}
function calibrationUIRenderMarkers(side) {
  const saved = calibrationUIState(),
    view = calibrationUI.views[side],
    layer = document.querySelector(
      ".calibration-pane[data-side=" + side + "] .calibration-observations",
    );
  if (!view) return;
  const buttons = new Map(
    [...layer.children].map((button) => [button.dataset.landmark, button]),
  );
  const wanted = new Set();
  for (const [ordinal, landmark] of (
    calibrationUI.session?.landmarks || []
  ).entries()) {
    const observation = landmark.observations.find(
      (o) => o.panoId === saved[side],
    );
    if (!observation) continue;
    wanted.add(landmark.id);
    let button = buttons.get(landmark.id);
    if (!button) {
      button = document.createElement("button");
      button.type = "button";
      button.className = "calibration-observation";
      button.dataset.landmark = landmark.id;
      button.setAttribute(
        "aria-label",
        side + " control point " + (ordinal + 1),
      );
      button.onpointerdown = (event) =>
        calibrationUIDragStart(event, side, landmark.id);
      button.onclick = (event) => {
        event.stopPropagation();
        calibrationUISelectPoint(landmark.id);
      };
      layer.append(button);
    }
    button.textContent = String(ordinal + 1);
    button.setAttribute("aria-label", side + " control point " + (ordinal + 1));
    button.title = landmark.label || "Point " + (ordinal + 1);
    button.classList.toggle("selected", saved.selected === landmark.id);
    button.classList.toggle("excluded", !landmark.enabled);
    button.setAttribute("aria-pressed", String(saved.selected === landmark.id));
    const transient =
        calibrationUI.drag?.side === side &&
        calibrationUI.drag.id === landmark.id
          ? calibrationUI.drag.observation
          : observation,
      point = view.projectBearing(transient);
    button.hidden = !point?.visible;
    if (point) {
      button.style.left = point.x * 100 + "%";
      button.style.top = point.y * 100 + "%";
    }
  }
  for (const button of [...layer.children])
    if (!wanted.has(button.dataset.landmark)) button.remove();
}
function calibrationUISelectPoint(id) {
  const saved = calibrationUIState();
  saved.selected = id;
  const point = calibrationUI.session?.landmarks.find((l) => l.id === id);
  saved.visibleConfirmed = [saved.left, saved.right].every((panoId) =>
    point?.observations.some((o) => o.panoId === panoId && o.verified),
  );
  for (const side of ["left", "right"]) calibrationUIRenderMarkers(side);
  calibrationUIRenderPoints();
  calibrationUIRenderStatus();
  calibrationUISave();
  calibrationUIMessage(
    "Match the selected physical point on the right. Drag its marker to correct an observation.",
  );
}
function calibrationUIRenderPoints() {
  const saved = calibrationUIState(),
    session = calibrationUI.session,
    list = document.querySelector("#calibrationLandmarks");
  list.replaceChildren();
  for (const [index, landmark] of (session?.landmarks || []).entries()) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.landmark = landmark.id;
    button.textContent = `${index + 1}. ${landmark.label || "Point"} · ${landmark.observations.length} views${landmark.enabled ? "" : " · excluded"}`;
    button.setAttribute("aria-pressed", String(landmark.id === saved.selected));
    button.onclick = () => calibrationUISelectPoint(landmark.id);
    list.append(button);
  }
  document.querySelector("#calibrationPointCount").textContent =
    `(${session?.landmarks.length || 0})`;
  if (!list.childElementCount)
    list.textContent =
      "No points yet. Click a physical landmark in the left panorama.";
  const selected = session?.landmarks.find((l) => l.id === saved.selected);
  document.querySelector("#calibrationSelected").textContent = selected
    ? "Point " + (session.landmarks.indexOf(selected) + 1)
    : "No point selected";
  document.querySelector("#calibrationObservedOn").textContent = selected
    ? "Observed on: " +
      selected.observations
        .map(
          (o) =>
            calibrationUIPanos().find((p) => p.id === o.panoId)?.room ||
            o.panoId,
        )
        .join(", ")
    : "";
  const label = document.querySelector("#calibrationPointLabel");
  if (document.activeElement !== label) label.value = selected?.label || "";
  label.disabled = !selected;
  document.querySelector("#calibrationPointEnabled").checked =
    selected?.enabled ?? false;
  document.querySelector("#calibrationPointEnabled").disabled = !selected;
  document.querySelector("#calibrationRemovePoint").disabled = !selected;
  for (const side of ["left", "right"])
    document.querySelector(
      "#calibrationRemove" + (side === "left" ? "Left" : "Right"),
    ).disabled = !selected?.observations.some((o) => o.panoId === saved[side]);
  const metric = session?.quality?.landmarks.find(
      (l) => l.id === saved.selected,
    ),
    occluded =
      session?.quality?.visibility.occluded.filter(
        (o) => o.landmarkId === saved.selected,
      ) || [];
  document.querySelector("#calibrationPointQuality").textContent =
    occluded.length
      ? "Visibility contradiction: this point is occluded in " +
        occluded.map((o) => o.panoId).join(", ")
      : metric
        ? `Parallax ${metric.effectiveParallaxDeg.toFixed(2)}° · ${metric.stable ? "stable" : "weak geometry"} · ${metric.preferredBetweenCameras ? "near the camera baseline" : "distant landmark; consider a closer point"}`
        : "No reconstructed position yet. Confirm that the same point is visible from both cameras.";
}
function calibrationUIRenderCameras() {
  const list = document.querySelector("#calibrationCameraList");
  list.replaceChildren();
  const quality = calibrationUI.session?.quality,
    observed = new Set(
      calibrationUI.session?.landmarks.flatMap((l) =>
        l.observations.map((o) => o.panoId),
      ) || [],
    );
  for (const pano of calibrationUIPanos()) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.pano = pano.id;
    button.textContent = `${calibrationUIPanoLabel(pano)} · ${quality?.registeredCameraIds.includes(pano.id) ? "registered" : observed.has(pano.id) ? "needs constraints" : "no observations"}`;
    button.onclick = () =>
      calibrationUIAction(() =>
        pano.id === calibrationUIState().left
          ? calibrationUIMessage("This is the current reference panorama.")
          : calibrationUISetPair(calibrationUIState().left, pano.id),
      );
    list.append(button);
  }
}
async function calibrationUISetPair(
  left,
  right,
  { remember = true, selected } = {},
) {
  const saved = calibrationUIState();
  if (!left || !right || left === right)
    throw new Error("Choose two different panoramas.");
  calibrationUICapture();
  if (
    remember &&
    saved.left &&
    saved.right &&
    (saved.left !== left || saved.right !== right)
  )
    saved.history.push({
      left: saved.left,
      right: saved.right,
      selected: saved.selected,
    });
  saved.left = left;
  saved.right = right;
  if (selected !== undefined) saved.selected = selected;
  else if (
    !calibrationUI.session?.landmarks
      .find((l) => l.id === saved.selected)
      ?.observations.some((o) => o.panoId === left)
  )
    saved.selected = null;
  const selectedPoint = calibrationUI.session?.landmarks.find(
    (l) => l.id === saved.selected,
  );
  saved.visibleConfirmed = [left, right].every((panoId) =>
    selectedPoint?.observations.some((o) => o.panoId === panoId && o.verified),
  );
  saved.parallaxConfirmed = false;
  calibrationUISave();
  await calibrationUIRefresh();
  calibrationUIMessage(
    "Correspondences are saved. You can continue without waiting for a solution.",
  );
}
async function calibrationUIPlace(side, x, y, captured) {
  const saved = calibrationUIState(),
    session = calibrationUI.session,
    view = calibrationUI.views[side];
  if (!session || !saved[side])
    throw new Error("Select a session and panorama first.");
  if (!view.texture || view.readyId !== saved[side])
    throw new Error("Wait for a valid panorama image before choosing points.");
  if (
    captured &&
    (captured.panoId !== saved[side] || captured.sessionId !== session.id)
  )
    return;
  const angles = captured?.angles || view.bearingAt(x, y),
    api = calibrationUIAPI(),
    landmark = session.landmarks.find((l) => l.id === saved.selected);
  if (
    side === "left" &&
    (!landmark || landmark.observations.some((o) => o.panoId === saved.left))
  ) {
    saved.visibleConfirmed = false;
    saved.parallaxConfirmed = false;
    const point = await api.addLandmark(session.id, {
      observations: [{ panoId: saved.left, ...angles, verified: false }],
    });
    saved.selected = point.id;
    calibrationUIMessage(
      "Point saved on the reference panorama. Click its corresponding location on the right.",
    );
  } else {
    if (!landmark)
      throw new Error("Select or create a control point on the left first.");
    if (
      side === "right" &&
      !landmark.observations.some((o) => o.panoId === saved.left)
    )
      throw new Error("Place the selected point on the left panorama first.");
    const observation = {
      panoId: saved[side],
      ...angles,
      verified: saved.visibleConfirmed,
    };
    if (landmark.observations.some((o) => o.panoId === saved[side]))
      await api.updateObservation(session.id, landmark.id, saved[side], {
        ...angles,
        verified: saved.visibleConfirmed,
      });
    else await api.addObservation(session.id, landmark.id, observation);
    if (side === "right" && saved.visibleConfirmed)
      await api.updateObservation(session.id, landmark.id, saved.left, {
        verified: true,
      });
    calibrationUIMessage(
      "Correspondence saved. Add more points, or continue to the next panorama.",
    );
  }
  calibrationUISave();
}
function calibrationUIDragStart(event, side, id) {
  if (
    !calibrationUI.views[side]?.texture ||
    calibrationUI.views[side].readyId !== calibrationUIState()[side]
  ) {
    calibrationUIMessage(
      "Wait for a valid panorama image before correcting points.",
    );
    return;
  }
  if (event.button !== 0 && event.pointerType === "mouse") return;
  event.preventDefault();
  event.stopPropagation();
  calibrationUI.views[side].velYaw = calibrationUI.views[side].velPitch = 0;
  calibrationUISelectPoint(id);
  const button = event.currentTarget,
    old = calibrationUI.session.landmarks
      .find((l) => l.id === id)
      ?.observations.find((o) => o.panoId === calibrationUIState()[side]);
  calibrationUI.drag = {
    side,
    id,
    panoId: calibrationUIState()[side],
    pointer: event.pointerId,
    button,
    start: { x: event.clientX, y: event.clientY },
    observation: old,
    moved: false,
  };
  button.setPointerCapture(event.pointerId);
}
function calibrationUIWorldOverlay(side) {
  const view = calibrationUI.views[side];
  if (!view?.scene) return;
  const world = worldData(),
    record =
      calibrationUI.preview?.cameras[view.currentId] ||
      world.cameras[view.currentId],
    signature = JSON.stringify([
      record,
      world.objects,
      world.geometry,
      world.occlusion,
      state.sceneConfigurations?.[view.currentId],
    ]);
  if (view.overlaySignature === signature) return;
  view.overlaySignature = signature;
  calibrationPanoramaWorld(
    view,
    record,
    calibrationUI.preview?.independentFrame
      ? { ...world, objects: [], geometry: null, occlusion: false }
      : world,
  );
}
async function calibrationUIShowPreview() {
  const session = calibrationUI.session;
  if (!session) return;
  const generation = calibrationUI.generation,
    preview = await calibrationUIAPI().preview(session.id);
  if (
    !calibrationUI.open ||
    generation !== calibrationUI.generation ||
    calibrationUIState().sessionId !== session.id
  )
    return;
  preview.independentFrame = !calibrationUIGroupPlacementReady(session);
  if (preview.independentFrame) {
    preview.cameras = structuredClone(session.solution.cameras);
    preview.objects = [];
  }
  calibrationUI.preview = preview;
  document.querySelector("#calibrationPreviewPanel strong").textContent =
    preview.independentFrame
      ? "Independent group preview · relative placement unknown"
      : "Reconstruction preview · not applied";
  document.querySelector("#calibrationPreviewPanel").hidden = false;
  calibrationUI.spatial?.dispose();
  const oldCanvas = document.querySelector("#calibrationPreviewCanvas"),
    canvas = oldCanvas.cloneNode(false);
  oldCanvas.replaceWith(canvas);
  calibrationUI.spatial = createCalibrationSpatialPreview(canvas);
  calibrationUI.spatial.set(preview);
  calibrationUIFitLayout();
  for (const side of ["left", "right"]) {
    calibrationUI.views[side].overlaySignature = null;
    calibrationUIWorldOverlay(side);
  }
  calibrationUIMessage(
    "Preview only. The project cameras and shared objects have not been changed.",
  );
  document
    .querySelector("#calibrationPreviewPanel")
    .scrollIntoView({ block: "nearest" });
}
function calibrationUIHidePreview() {
  calibrationUI.preview = null;
  calibrationUI.spatial?.dispose();
  calibrationUI.spatial = null;
  document.querySelector("#calibrationPreviewPanel").hidden = true;
  for (const side of ["left", "right"])
    if (calibrationUI.views[side]) {
      calibrationUI.views[side].overlaySignature = null;
      calibrationUIWorldOverlay(side);
    }
}
async function openPanoramaCalibration() {
  if (!calibrationUI.enabled) {
    notify("Enable Panorama calibration in Core plugins.");
    return;
  }
  if (!canEditPlan() || reviewSession) {
    notify("Switch to Edit mode and stop reviewing first.");
    return;
  }
  if (calibrationUI.open) return;
  const saved = calibrationUIState();
  calibrationUI.previousView = {
    ...PalaceAPI.viewRead(),
    tool: state.tool === "calibration" ? "select" : state.tool,
  };
  await PalaceAPI.viewSet({ layout: "plan", planView: "2d" });
  localViewer.dispose();
  state.tool = "calibration";
  syncTools();
  calibrationUI.open = true;
  const generation = ++calibrationUI.generation;
  calibrationWorkspace.hidden = false;
  document.querySelector("#appRoot").classList.add("calibration-open");
  calibrationTool.setAttribute("aria-pressed", "true");
  calibrationTool.classList.add("active");
  calibrationUIFitLayout();
  calibrationUIMessage("");
  for (const side of ["left", "right"]) {
    const old = document.querySelector("#calibration-" + side + "-canvas"),
      canvas = old.cloneNode(false);
    old.replaceWith(canvas);
    calibrationUI.views[side] = PalacePanoramaSurfaces.create(canvas, {
      onFrame: (view) => {
        if (!calibrationUI.open) return;
        calibrationUIRenderMarkers(side);
        document.querySelector("#calibration-" + side + "-fov").value =
          view.fov;
        const ui = calibrationUIState();
        if (view.currentId)
          ui.views[view.currentId] = {
            yaw: view.yaw,
            pitch: view.pitch,
            fov: view.fov,
          };
      },
      onReady: () => {
        if (calibrationUI.open) {
          calibrationUI.views[side].overlaySignature = null;
          calibrationUIUpdateGuide();
          calibrationUIWorldOverlay(side);
          calibrationUIRenderMarkers(side);
        }
      },
      onError: (message) => {
        if (calibrationUI.open)
          document.querySelector(
            ".calibration-pane[data-side=" + side + "] .calibration-view-error",
          ).textContent = message;
      },
    });
    let press = null;
    canvas.addEventListener("pointerdown", (e) => {
      press = {
        x: e.clientX,
        y: e.clientY,
        id: e.pointerId,
        panoId: calibrationUIState()[side],
      };
      canvas.focus({ preventScroll: true });
    });
    canvas.addEventListener("pointerup", (e) => {
      const current = press;
      press = null;
      if (!calibrationUI.open || generation !== calibrationUI.generation)
        return;
      if (
        current &&
        current.panoId === calibrationUIState()[side] &&
        current.id === e.pointerId &&
        Math.hypot(e.clientX - current.x, e.clientY - current.y) < 6
      ) {
        const view = calibrationUI.views[side];
        const captured = {
          panoId: current.panoId,
          sessionId: calibrationUIState().sessionId,
          angles:
            view.readyId === current.panoId
              ? view.bearingAt(e.clientX, e.clientY)
              : null,
        };
        calibrationUIAction(() =>
          calibrationUIPlace(side, e.clientX, e.clientY, captured),
        );
      }
      clearTimeout(calibrationUI.saveTimer);
      calibrationUI.saveTimer = setTimeout(calibrationUISave, 200);
    });
    canvas.addEventListener("pointercancel", () => (press = null));
    canvas.addEventListener(
      "wheel",
      () => {
        clearTimeout(calibrationUI.saveTimer);
        calibrationUI.saveTimer = setTimeout(calibrationUISave, 250);
      },
      { passive: true },
    );
  }
  const api = calibrationUIAPI();
  for (const name of [
    "onObservationAdded",
    "onObservationUpdated",
    "onCalibrationStatusChanged",
    "onCalibrationSolved",
    "onCalibrationApplied",
    "onCalibrationFailed",
  ])
    calibrationUI.subscriptions.push(
      api[name]((event) => {
        if (event.sessionId === calibrationUIState().sessionId)
          calibrationUIQueueRefresh();
      }),
    );
  await Promise.all(calibrationUI.subscriptions.map((sub) => sub.ready));
  const sessions = await api.listSessions();
  if (!calibrationUI.open || generation !== calibrationUI.generation) return;
  if (!sessions.some((s) => s.id === saved.sessionId)) {
    saved.sessionId = sessions[0]?.id || null;
    if (!saved.sessionId && calibrationUIIds().length) {
      const session = await api.createSession({
        label: "Panorama group 1",
        cameraIds: [],
      });
      if (!calibrationUI.open || generation !== calibrationUI.generation)
        return;
      saved.sessionId = session.id;
    }
  }
  await calibrationUIRefresh();
  calibrationUISave();
}
function closePanoramaCalibration({ restore = true } = {}) {
  if (!calibrationUI.open) return;
  calibrationUICapture();
  calibrationUI.open = false;
  ++calibrationUI.generation;
  clearTimeout(calibrationUI.refreshTimer);
  clearTimeout(calibrationUI.saveTimer);
  for (const sub of calibrationUI.subscriptions) sub.dispose();
  calibrationUI.subscriptions = [];
  calibrationUI.spatial?.dispose();
  calibrationUI.spatial = null;
  calibrationUI.preview = null;
  document.querySelector("#calibrationPreviewPanel").hidden = true;
  for (const view of Object.values(calibrationUI.views)) view.destroy();
  calibrationUI.views = {};
  calibrationUI.drag = null;
  calibrationWorkspace.hidden = true;
  document.querySelector("#appRoot").classList.remove("calibration-open");
  calibrationTool.setAttribute("aria-pressed", "false");
  calibrationTool.classList.remove("active");
  state.tool = calibrationUI.previousView?.tool || "select";
  syncTools();
  if (restore && calibrationUI.previousView) {
    state.layout = calibrationUI.previousView.layout;
    applyLayout();
    if (calibrationUI.previousView.planView !== planView)
      setPlanView(calibrationUI.previousView.planView);
  }
  calibrationUISave();
  calibrationTool.focus({ preventScroll: true });
}
calibrationTool.onclick = () =>
  calibrationUI.open
    ? closePanoramaCalibration()
    : openPanoramaCalibration().catch((error) =>
        calibrationUIMessage(error.message),
      );
document.querySelector("#calibrationClose").onclick = () =>
  closePanoramaCalibration();
for (const side of ["left", "right"]) {
  document.querySelector("#calibration-" + side + "-picker").onchange = (
    event,
  ) => {
    const id = event.target.value;
    calibrationUIAction(() => {
      const saved = calibrationUIState();
      const other = side === "left" ? "right" : "left";
      return calibrationUISetPair(
        side === "left" ? id : id === saved[other] ? saved[side] : saved.left,
        side === "right" ? id : id === saved[other] ? saved[side] : saved.right,
      );
    });
  };
  document.querySelector("#calibration-" + side + "-fov").oninput = (e) => {
    calibrationUI.views[side]?.setView({ fov: Number(e.target.value) });
    clearTimeout(calibrationUI.saveTimer);
    calibrationUI.saveTimer = setTimeout(calibrationUISave, 250);
  };
  document.querySelector(
    "#calibrationRemove" + (side === "left" ? "Left" : "Right"),
  ).onclick = () =>
    calibrationUIAction(() =>
      calibrationUIAPI().removeObservation(
        calibrationUI.session.id,
        calibrationUIState().selected,
        calibrationUIState()[side],
      ),
    );
}
document.querySelector("#calibrationNext").onclick = () =>
  calibrationUIAction(() => {
    const saved = calibrationUIState(),
      ids = calibrationUIIds();
    return calibrationUISetPair(saved.right, ids[ids.indexOf(saved.right) + 1]);
  });
document.querySelector("#calibrationPrevious").onclick = () =>
  calibrationUIAction(() => {
    const saved = calibrationUIState(),
      ids = calibrationUIIds();
    return calibrationUISetPair(ids[ids.indexOf(saved.left) - 1], saved.left);
  });
document.querySelector("#calibrationBack").onclick = () =>
  calibrationUIAction(() => {
    const pair = calibrationUIState().history.pop();
    if (pair)
      return calibrationUISetPair(pair.left, pair.right, {
        remember: false,
        selected: pair.selected,
      });
  });
document.querySelector("#calibrationNewPoint").onclick = () => {
  calibrationUIState().selected = null;
  calibrationUIState().visibleConfirmed = false;
  calibrationUIState().parallaxConfirmed = false;
  for (const side of ["left", "right"]) calibrationUIRenderMarkers(side);
  calibrationUIRenderPoints();
  calibrationUIRenderStatus();
  calibrationUISave();
  calibrationUIMessage("Click a new physical landmark in the left panorama.");
};
document.querySelector("#calibrationAddLink").onclick = () => {
  const selected = calibrationUI.session?.landmarks.find(
    (l) => l.id === calibrationUIState().selected,
  );
  if (
    !selected?.observations.some((o) => o.panoId === calibrationUIState().left)
  ) {
    calibrationUIMessage(
      "Place the selected point on the left panorama first.",
    );
    return;
  }
  calibrationUIMessage("Click the same physical point in the right panorama.");
  document
    .querySelector("#calibration-right-canvas")
    .focus({ preventScroll: true });
};
document.querySelector("#calibrationVisibility").onchange = (e) => {
  const verified = e.target.checked;
  calibrationUIState().visibleConfirmed = verified;
  calibrationUIAction(async () => {
    const saved = calibrationUIState(),
      selected = calibrationUI.session?.landmarks.find(
        (l) => l.id === saved.selected,
      );
    if (selected)
      for (const observation of selected.observations)
        if ([saved.left, saved.right].includes(observation.panoId))
          await calibrationUIAPI().updateObservation(
            calibrationUI.session.id,
            selected.id,
            observation.panoId,
            { verified },
          );
    calibrationUISave();
  });
};
document.querySelector("#calibrationPointEnabled").onchange = (e) =>
  calibrationUIAction(() =>
    calibrationUIAPI().updateLandmark(
      calibrationUI.session.id,
      calibrationUIState().selected,
      { enabled: e.target.checked },
    ),
  );
document.querySelector("#calibrationPointLabel").onchange = (e) =>
  calibrationUIAction(() =>
    calibrationUIAPI().updateLandmark(
      calibrationUI.session.id,
      calibrationUIState().selected,
      { label: e.target.value },
    ),
  );
document.querySelector("#calibrationRemovePoint").onclick = () =>
  ask(
    "Delete this physical point and all of its observations?",
    () =>
      calibrationUIAction(() =>
        calibrationUIAPI().removeLandmark(
          calibrationUI.session.id,
          calibrationUIState().selected,
        ),
      ),
    { title: "Delete control point", yes: "Delete" },
  );
document.querySelector("#calibrationSolve").onclick = () =>
  calibrationUIAction(() => calibrationUIAPI().solve(calibrationUI.session.id));
document.querySelector("#calibrationPreview").onclick = () =>
  calibrationUIAction(calibrationUIShowPreview);
document.querySelector("#calibrationPreviewClose").onclick =
  calibrationUIHidePreview;
document.querySelector("#calibrationApply").onclick = () =>
  calibrationUIAction(async () => {
    if (!calibrationUIGroupPlacementReady(calibrationUI.session))
      throw new Error(
        "Relative placement between independent groups is unknown. Preview this group or provide a reference pose and common scale first.",
      );
    const id = calibrationUI.session.id,
      preview = await calibrationUIAPI().preview(id);
    ask(
      "Apply these camera poses? Shared object coordinates will stay unchanged.",
      () =>
        calibrationUIAction(async () => {
          await calibrationUIAPI().apply(id, { previewId: preview.previewId });
          calibrationUIHidePreview();
          calibrationUIMessage(
            "Calibration applied. Shared objects keep their world positions.",
          );
        }),
      { title: "Apply calibration", yes: "Apply" },
    );
  });
document.querySelector("#calibrationRevert").onclick = () =>
  calibrationUIAction(async () => {
    await calibrationUIAPI().revert(calibrationUI.session.id);
    calibrationUIHidePreview();
    calibrationUIMessage("Last application reverted.");
  });
document.querySelector("#calibrationCameras").onclick = () => {
  document.querySelector("#calibrationCameraPanel").hidden =
    !document.querySelector("#calibrationCameraPanel").hidden;
  calibrationUIRenderCameras();
};
document.querySelector("#calibrationCamerasClose").onclick = () =>
  (document.querySelector("#calibrationCameraPanel").hidden = true);
async function calibrationUISelectGroup(id) {
  calibrationUICapture();
  const saved = calibrationUIState(),
    group = await calibrationUIAPI().getSession(id);
  const pair = saved.groupViews?.[id];
  saved.sessionId = id;
  if (pair) Object.assign(saved, pair);
  else if (group.cameraIds.length) {
    saved.left = group.cameraIds[0];
    saved.right =
      group.cameraIds.find((camera) => camera !== saved.left) ||
      calibrationUINeighbor(saved.left);
  }
  if (!pair) saved.selected = null;
  saved.history = [];
  saved.visibleConfirmed = false;
  saved.parallaxConfirmed = false;
  calibrationUISave();
}
async function calibrationUINewGroup({ skip = false } = {}) {
  const saved = calibrationUIState(),
    ids = calibrationUIIds(),
    previous = saved.left;
  const session = await calibrationUIAPI().createSession({
    label:
      "Panorama group " +
      ((await calibrationUIAPI().listSessions()).length + 1),
    cameraIds: [],
  });
  await calibrationUISelectGroup(session.id);
  if (skip) {
    saved.left = saved.right || ids.find((id) => id !== previous) || previous;
    saved.right =
      calibrationUINeighbor(saved.left, [previous]) ||
      calibrationUINeighbor(saved.left) ||
      null;
  }
  saved.selected = null;
  calibrationUISave();
  calibrationUIMessage(
    "New independent group. Match only directly visible common landmarks. Its position relative to other groups remains unknown.",
  );
}
document.querySelector("#calibrationNewSession").onclick = () =>
  calibrationUIAction(() => calibrationUINewGroup());
calibrationNoOverlap.onclick = () =>
  calibrationUIAction(() => calibrationUINewGroup({ skip: true }));
calibrationScope.onclick = () =>
  calibrationUIAction(async () => {
    const cameraIds = [
      ...new Set(
        calibrationUI.session.landmarks.flatMap((point) =>
          point.observations.map((o) => o.panoId),
        ),
      ),
    ];
    const config = {
      referenceCameraId: cameraIds.includes(
        calibrationUI.session.config.referenceCameraId,
      )
        ? calibrationUI.session.config.referenceCameraId
        : null,
      distances: calibrationUI.session.config.distances.filter(
        (d) =>
          d.type !== "cameras" ||
          (cameraIds.includes(d.from) && cameraIds.includes(d.to)),
      ),
    };
    await calibrationUIAPI().updateSession(calibrationUI.session.id, {
      cameraIds,
      config,
    });
    calibrationUIMessage(
      "This group now contains only observed cameras. Other project cameras are unchanged.",
    );
  });
document.querySelector("#calibrationSession").onchange = (event) => {
  const id = event.target.value;
  calibrationUIAction(() => calibrationUISelectGroup(id));
};
for (const [action, remove] of [
  ["Save", false],
  ["Remove", true],
])
  document.querySelector("#calibrationDistance" + action).onclick = () =>
    calibrationUIAction(async () => {
      const saved = calibrationUIState(),
        session = calibrationUI.session,
        distances = session.config.distances.filter(
          (d) =>
            d.type !== "cameras" ||
            !(
              (d.from === saved.left && d.to === saved.right) ||
              (d.from === saved.right && d.to === saved.left)
            ),
        );
      if (!remove)
        distances.push({
          type: "cameras",
          from: saved.left,
          to: saved.right,
          distance: Number(
            document.querySelector("#calibrationDistance").value,
          ),
        });
      await calibrationUIAPI().updateSession(session.id, {
        config: { distances },
      });
    });
calibrationWorkspace.addEventListener("pointermove", (e) => {
  const drag = calibrationUI.drag;
  if (drag?.pointer !== e.pointerId) return;
  if (drag.panoId !== calibrationUIState()[drag.side]) {
    calibrationUI.drag = null;
    calibrationUIRenderMarkers(drag.side);
    return;
  }
  drag.moved ||=
    Math.hypot(e.clientX - drag.start.x, e.clientY - drag.start.y) > 4;
  if (drag.moved) {
    drag.observation = {
      ...calibrationUI.views[drag.side].bearingAt(e.clientX, e.clientY),
      panoId: calibrationUIState()[drag.side],
      verified: false,
    };
    calibrationUIRenderMarkers(drag.side);
  }
});
calibrationWorkspace.addEventListener("pointerup", (e) => {
  const drag = calibrationUI.drag;
  if (drag?.pointer !== e.pointerId) return;
  calibrationUI.drag = null;
  if (drag.panoId !== calibrationUIState()[drag.side]) {
    calibrationUIRenderMarkers(drag.side);
    return;
  }
  if (drag.moved)
    calibrationUIAction(async () => {
      await calibrationUIAPI().updateObservation(
        calibrationUI.session.id,
        drag.id,
        calibrationUIState()[drag.side],
        {
          yaw: drag.observation.yaw,
          pitch: drag.observation.pitch,
          verified: false,
        },
      );
      calibrationUIState().visibleConfirmed = false;
      calibrationUIMessage(
        "Observation corrected. Confirm common visibility again.",
      );
      calibrationUISave();
    });
});
calibrationWorkspace.addEventListener("pointercancel", () => {
  calibrationUI.drag = null;
  for (const side of ["left", "right"]) calibrationUIRenderMarkers(side);
});
for (const type of [
  "pointerdown",
  "pointermove",
  "pointerup",
  "mousedown",
  "mousemove",
  "mouseup",
  "click",
  "dblclick",
  "wheel",
  "contextmenu",
  "touchstart",
  "touchmove",
  "touchend",
])
  calibrationWorkspace.addEventListener(
    type,
    (event) => event.stopPropagation(),
    { passive: type.startsWith("touch") },
  );
document.addEventListener(
  "keydown",
  (event) => {
    if (!calibrationUI.open || event.isComposing) return;
    if (event.key === "Escape" && !document.querySelector(".modal.show")) {
      event.preventDefault();
      event.stopImmediatePropagation();
      closePanoramaCalibration();
      return;
    }
    const side = event.target.closest?.(".calibration-pane")?.dataset.side;
    if (!side || !event.target.matches("canvas")) return;
    const view = calibrationUI.views[side];
    if (
      [
        "ArrowLeft",
        "ArrowRight",
        "ArrowUp",
        "ArrowDown",
        "+",
        "=",
        "-",
      ].includes(event.key)
    ) {
      event.preventDefault();
      event.stopImmediatePropagation();
      view.setView(
        event.key.startsWith("Arrow")
          ? event.key === "ArrowLeft"
            ? { yaw: view.yaw - 3 }
            : event.key === "ArrowRight"
              ? { yaw: view.yaw + 3 }
              : event.key === "ArrowUp"
                ? { pitch: view.pitch - 3 }
                : { pitch: view.pitch + 3 }
          : { fov: view.fov * (event.key === "-" ? 1.12 : 0.89) },
      );
      calibrationUISave();
    } else if (event.key === "Delete" && calibrationUIState().selected) {
      event.preventDefault();
      event.stopImmediatePropagation();
      calibrationUIAction(() =>
        calibrationUIAPI().removeObservation(
          calibrationUI.session.id,
          calibrationUIState().selected,
          calibrationUIState()[side],
        ),
      );
    }
  },
  true,
);
document.querySelector(".activity").addEventListener(
  "click",
  (event) => {
    if (calibrationUI.open && event.target.closest("button")?.id === "abPlan")
      closePanoramaCalibration({ restore: false });
  },
  true,
);
document.querySelector("#planTools").addEventListener(
  "click",
  (event) => {
    if (
      calibrationUI.open &&
      event.target.closest("button") !== calibrationTool
    )
      closePanoramaCalibration({ restore: false });
  },
  true,
);
const calibrationAddonSettings = newSettingsPane(
  "Panorama calibration",
  `<p class="settings-description">Match physical landmarks across two panorama views. Correspondences are saved immediately; camera poses are calculated by the calibration core when sufficient constraints exist.</p><div class="settings-card">${settingsRow("Calibration workspace", "Open the crosshair tool in the far-left activity sidebar, below 3D tour.", '<button id="calibrationSettingsOpen" type="button">Open calibration</button>')}${settingsRow("Visibility and parallax", "Choose directly visible points with clear parallax. Relative reconstructions do not claim metric units.", "")}${settingsRow("Saved observations", "Disabling this system plugin closes its interface and keeps project sessions and observations.", "")}</div>`,
);
settingsPage(
  "panorama-calibration",
  "Panorama calibration",
  "calibration",
  calibrationAddonSettings,
);
settingsSections
  .get("Core plugins")
  .append(settingsPages.get("panorama-calibration").button);
document.querySelector("#calibrationSettingsOpen").onclick = () => {
  closePersistenceModal(settingsModal);
  openPanoramaCalibration().catch((error) => notify(error.message));
};
registerSystemAddon({
  id: "system.panorama-calibration",
  title: "Panorama calibration",
  description:
    "Sequential landmark matching, spatial reconstruction and explicit application of calibrated camera poses.",
  settingsPage: "panorama-calibration",
  activate() {
    calibrationUI.enabled = true;
    calibrationTool.hidden = false;
    document.querySelector("#calibrationSettingsOpen").disabled = false;
    if (!HOTKEYS.some((c) => c.id === "system.panorama-calibration.open"))
      HOTKEYS.push({
        id: "system.panorama-calibration.open",
        label: "Open panorama calibration",
        group: "System addons",
        def: "",
        run: () =>
          openPanoramaCalibration().catch((error) => notify(error.message)),
      });
  },
  deactivate() {
    closePanoramaCalibration();
    calibrationUI.enabled = false;
    calibrationTool.hidden = true;
    document.querySelector("#calibrationSettingsOpen").disabled = true;
    const index = HOTKEYS.findIndex(
      (c) => c.id === "system.panorama-calibration.open",
    );
    if (index >= 0) HOTKEYS.splice(index, 1);
  },
});
const calibrationUISerialize = buildSerializableState;
buildSerializableState = function (...args) {
  return {
    ...calibrationUISerialize(...args),
    calibrationUI: calibrationUICapture(),
  };
};
const calibrationUIBlankState = blankState;
blankState = function () {
  return { ...calibrationUIBlankState(), calibrationUI: calibrationUIBlank() };
};
const calibrationUISnapshot = snapshotState;
snapshotState = function (...args) {
  return {
    ...calibrationUISnapshot(...args),
    calibrationUI: calibrationUICapture(),
  };
};
const calibrationUIRestore = restoreSnapshot;
restoreSnapshot = function (snapshot, ...args) {
  const ui = calibrationUINormalize(snapshot.calibrationUI),
    wasOpen = calibrationUI.open;
  if (wasOpen) closePanoramaCalibration({ restore: false });
  const result = calibrationUIRestore(snapshot, ...args);
  state.calibrationUI = ui;
  if (wasOpen && calibrationUI.enabled && canEditPlan())
    openPanoramaCalibration().catch((error) => notify(error.message));
  return result;
};

const calibrationUILoad = loadMplaceBuffer;
loadMplaceBuffer = async function (buffer) {
  const zip = await JSZip.loadAsync(buffer),
    file = zip.file("palace.json"),
    raw = file ? JSON.parse(await file.async("string")) : null,
    ui = calibrationUINormalize(raw?.calibrationUI);
  closePanoramaCalibration({ restore: false });
  const result = await calibrationUILoad(buffer);
  state.calibrationUI = ui;
  resetHistory();
  return result;
};
const calibrationUIReset = resetPalace;
resetPalace = function (...args) {
  closePanoramaCalibration({ restore: false });
  const result = calibrationUIReset(...args);
  state.calibrationUI = calibrationUIBlank();
  return result;
};
const calibrationUILayout = applyLayout;
applyLayout = function (...args) {
  if (calibrationUI.open && state.layout !== "plan")
    closePanoramaCalibration({ restore: false });
  return calibrationUILayout.apply(this, args);
};
const calibrationUIMode = applyMode;
applyMode = function (...args) {
  if (calibrationUI.open && (!canEditPlan() || reviewSession))
    closePanoramaCalibration({ restore: false });
  return calibrationUIMode.apply(this, args);
};
const calibrationUIRender = render;
render = function (...args) {
  if (calibrationUI.open && (!canEditPlan() || reviewSession))
    closePanoramaCalibration({ restore: false });
  const result = calibrationUIRender.apply(this, args);
  calibrationUIQueueRefresh();
  return result;
};

const calibrationUIRecovery = restoreRecovery;
restoreRecovery = async function (record, ...args) {
  const ui = calibrationUINormalize(record?.state?.calibrationUI);
  closePanoramaCalibration({ restore: false });
  const result = await calibrationUIRecovery(record, ...args);
  state.calibrationUI = ui;
  return result;
};

const calibrationUIHistoryVersion = restoreHistoryVersion;
restoreHistoryVersion = async function (...args) {
  closePanoramaCalibration({ restore: false });
  const result = await calibrationUIHistoryVersion(...args);
  state.calibrationUI = calibrationUINormalize(state.calibrationUI);
  return result;
};

document.querySelector("#calibrationParallax").onchange = (event) => {
  calibrationUIState().parallaxConfirmed = event.target.checked;
  calibrationUISave();
};

const calibrationUIPlanView = setPlanView;
setPlanView = function (mode, ...args) {
  if (calibrationUI.open && mode !== "2d")
    closePanoramaCalibration({ restore: false });
  return calibrationUIPlanView.call(this, mode, ...args);
};
