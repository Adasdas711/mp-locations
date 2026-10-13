# PALACE SDK 1.7 — Spherical spatial calibration core

Calibration lives in the **application core**, not in an addon. It is available through `api.tour.world.calibration` in community sandboxes and the same contract at `window.PalaceAPI.tour.world.calibration` for trusted system modules. The bundled [Panorama calibration system addon](PANORAMA_CALIBRATION.md) uses this contract for its paired matching UI. The existing World Space UI and SDK 1.5/1.6 APIs remain available.

Runtime `api.version` is `1.7.0`; manifest `apiVersion` remains `1`. Full declarations: [palace-sdk.d.ts](docs/addons/palace-sdk.d.ts). [General guide](ADDONS_AI_GUIDE.md), [World SDK](WORLD_SDK.md), [code-only example](docs/addons/calibration-example.js).

## Coordinates and what is measured

An observation is a unit bearing in the **existing panorama-local frame**. Angles are degrees; yaw is normalized to `[0,360)`, pitch is `[-90,90]`. PALACE's right-handed convention is +X right, +Y up, -Z forward:

```text
bearing = (-sin(yaw)*cos(pitch), sin(pitch), -cos(yaw)*cos(pitch))
```

This includes rear-facing directions, image seams and both hemispheres. It never divides bearings by Z or treats the entire equirectangular image as a single perspective photograph. Image pixel-to-bearing conversion and matching physical points are the caller's responsibility; a viewer's changing FOV is not a different camera intrinsic for these spherical bearings.

A world quaternion maps panorama-local axes to world axes. Calibration estimates relative rotations and capture positions in that same convention. The first reference capture fixes the rigid gauge; the first accepted baseline fixes a unit baseline when metric scale is unknown. `quality.gauge` identifies that baseline. The core retains its selected reference across recalculations. With a registered reference, the reconstruction is anchored to its current world position/orientation. Otherwise it uses an identity reference frame. Unconnected cameras or independently unobservable baselines are not assigned arbitrary positions.

One common physical point between two previously unknown cameras does **not** determine a 6DoF transform. It is retained, with an insufficient-data status, until enough observations exist.

## Two landmark selection rules

**Direct common visibility:** the same physical point must actually be visible from its observing cameras. `verified:true` records the caller/user's confirmation. When compatible registered geometry or radial depth exists, the core checks reconstructed inlier landmarks for occlusion in the worker. An occlusion contradiction makes the solution provisional and blocks apply. With no usable geometry/depth, the core cannot prove visibility; the caller remains responsible. By default unverified reconstructed inlier observations also make the result provisional.

Geometry checks need a common numeric scale and an anchored world frame for global meshes. A known metric conversion or an existing registered numeric camera baseline can establish that scale; the latter does not establish meters. Panorama-local depth/geometry can be checked when its units match the reconstructed scale independently of an absolute world translation. If the data cannot be compared in the same scale/frame, quality reports unknown visibility rather than inventing walls. Occlusion validation uses available physical data regardless of the virtual-object display occlusion mode. Wall points within a small depth tolerance are treated as surface observations, not hidden points.

**Useful parallax near the camera baseline:** adding an observation is never blocked because preliminary poses are absent. After reconstruction, per-landmark metrics include radial distances, nearest distance to the clipped camera segment, that distance divided by baseline length, triangulation angle, effective parallax, condition number, estimated positional uncertainty and a broad `preferredBetweenCameras` flag. This is guidance, not a requirement to put points exactly on the baseline. Nearly parallel **or anti-parallel** rays are ill-conditioned. Points strictly on the camera segment can be degenerate even though they are physically between cameras.

The uncertainty estimate is a first-order geometric estimate using the configured angular tolerance; it is not a certified statistical covariance or a ground-truth confidence interval.

## Implemented numerical pipeline

1. Convert all observations to 3D unit bearings.
2. Build shared-landmark camera edges. Tracks with many cameras use adjacent/reference/closing connections instead of retaining a quadratic complete edge graph. Short tracks retain all pairs.
3. Estimate a calibrated essential matrix from at least **eight** correspondences using the smallest eigenvector of the 9×9 bearing normal matrix. Enforce two equal singular values and rank two with a 3×3 SVD.
4. Deterministic-seed **RANSAC** samples eight correspondences, scores spherical angular epipolar residuals, adapts its iteration budget and refits the consensus.
5. Decompose the essential matrix into candidate rotations/translation directions. Check positive distances **along bearing rays**, cheirality ambiguity, effective parallax, rank deficiency and near-pure rotation. This is not a perspective Z-positive test.
6. Initialize a connected pose graph. The first accepted pair sets the relative gauge. Later baselines get their length from already triangulated shared tracks or applicable known distances. A camera whose independent baseline scale cannot be determined stays unregistered.
7. Triangulate stable multi-view landmarks and filter observations contradicted by robust pair consensus.
8. Run global **bundle adjustment** over camera positions/rotations and 3D points. The implementation uses alternating damped Gauss–Newton blocks, numerical Jacobians, line search and a robust Huber spherical residual. All blocks minimize the common spherical reprojection objective. The reference pose fixes the rigid gauge; relative baseline normalization or known-distance residuals fix scale.
9. Known camera/landmark distance constraints participate in optimization, with a final consistent scale estimate and spread check. Contradictory or unresolved scale constraints remain provisional.
10. Evaluate angular errors, inlier/outlier/unresolved observations, parallax, visibility and registration completeness. Publish a candidate for the exact input revision; never automatically change the main world.

This is a real eight-point spherical SfM solver, not a five-point minimal solver, feature detector, image matcher, visual-inertial system, dense depth reconstruction or certified photogrammetry package. Eight is its implemented minimal pair size; more well-distributed observations improve robustness. Multi-view geometry still has genuine degeneracies and uncertain scale. Incorrect `verified` flags cannot substitute for correct physical correspondences.

## Background execution and automatic updates

`calibration-math.js` is a pure numerical module used by both numerical tests and `calibration-worker.js`. The main-thread `calibration-core.js` owns validation, storage, job scheduling, events and world transactions. Essential estimation, RANSAC, triangulation, bundle adjustment, native-model geometry decoding and occlusion intersections execute in a **Web Worker**.

After a correspondence changes, the core saves its new revision, invalidates the previous candidate/preview, updates preliminary status and debounces an automatic job when there are potentially enough shared tracks. The worker performs the exact graph/sufficiency check. Jobs are serialized across sessions, latest revisions replace stale jobs, and changing projects/cameras or restoring a snapshot cancels stale work. A result can publish only if its project, panorama dictionary, revision and input snapshot still match. Unfinished automatically configured sessions restart after import/recovery/Undo.

`solve(sessionId)` returns a **queue receipt**, not a completed reconstruction. Await event subscriptions' `ready`, then watch status/events. `pending:true` includes queued work. `timeoutMs` is the execution budget for an active worker, not a promised total queue latency. Worker startup failures/timeouts produce failed status and a failure event; the core does not fall back to blocking synchronous solves. An HTTP/PWA origin with Worker support is required; browsers may prohibit file-URL workers.

Disabling the requesting addon removes its sandbox subscriptions. Its session is project data, so already authorized core calculation can finish and be read later. Trusted system modules must dispose their subscriptions in their own lifecycle cleanup.

## Data and configuration

Project state contains `calibrationSessions`, keyed by ID. A session includes:

```ts
{
  id, version:1, label, cameraIds,
  landmarks:[{id,label,enabled,observations:[{panoId,yaw,pitch,verified}],worldPosition?}],
  status, revision, config, pending,
  quality, solution, solvedRevision, preview, applied, error
}
```

`worldPosition` and solution transforms are calculated output. A landmark may be observed by two, three or many cameras. There can be only one observation per camera for each landmark. Disabled landmarks remain stored but do not constrain the solver. Internal apply/revert backups, full cached previews and conflict signatures are not exposed by public session reads; public preview/applied fields contain identifiers/revisions/scope only. Old projects without calibration data load with an empty session dictionary. Sessions, calculated positions, metrics and apply/revert backups participate in palace Save/export/import, local autosave, Undo/Redo and Change history. Invalid imported data is rejected before replacing the current project; preview tokens and running-worker flags are not restored as active operations.

`createSession` accepts optional `id`, `label`, `cameraIds`, and the following flat config. `updateSession` accepts `{label?,cameraIds?,config?:partialConfig}`:

| Field | Default | Valid range/meaning |
| --- | --- | --- |
| automaticSolve | true | Debounced recalculation after edits. |
| requireVerified | true | Unverified inlier visibility without usable depth makes candidate provisional. |
| referenceCameraId | first observed registered camera, otherwise first observed camera | Stored when calculation is first scheduled. Explicit reference must belong to the current project; a disconnected reference cannot be silently replaced. |
| minCorrespondences | 8 | Integer 8..100 per pair. |
| ransacThresholdDeg | .6 | .01..5 spherical angular tolerance. |
| ransacIterations | 512 | Integer 32..4000 maximum. |
| minParallaxDeg | .75 | .05..20 effective angle; excludes near 0° and 180° lines. |
| bundleIterations | 35 | Integer 1..200 block refinement passes. |
| seed | 1 | Integer 0..4294967295. |
| timeoutMs | 60000 | Integer 1000..120000 active-worker milliseconds. |
| distances | [] | `{type:'cameras'|'landmarks',from,to,distance}`; distance is positive **meters**, .0001..100000. |

IDs follow existing SDK safe identifiers, labels max 500 characters, values must be finite. The algorithm has no predetermined camera count. Calibration state is bounded by **32 MiB serialized characters**; world registrations remain subject to the World Space serialized-size budget. The old fixed camera-count cap was removed; global object count/mesh limits remain unchanged.

## Public API and permissions

All operations below return Promises except event factories. They use existing `scene.read`/`scene.write`; legacy `tour.read`/`tour.write` aliases remain supported. Mutating/requesting calculation/preview/apply/revert requires Edit mode and no active review session. Read operations can inspect stored progress without a renderer.

| Method | Result | Permission |
| --- | --- | --- |
| createSession(config?) | Complete normalized CalibrationSession. | scene.write |
| getSession(id) | Complete clone; missing ID rejects. | scene.read |
| listSessions() | Complete session array. | scene.read |
| updateSession(id,patch) | Complete session after invalidation/revision increment. | scene.write |
| removeSession(id) | true, cancels its job and removes its data. | scene.write |
| addLandmark(id,data) | Normalized landmark, UUID default ID. | scene.write |
| updateLandmark(id,landmarkId,patch) | Landmark; patch label/enabled/observations. | scene.write |
| removeLandmark(id,landmarkId) | true; missing landmark rejects. | scene.write |
| addObservation(id,landmarkId,data) | `{panoId,yaw,pitch,verified}`; duplicate camera observation rejects. | scene.write |
| updateObservation(id,landmarkId,panoId,patch) | Observation; patch yaw/pitch/verified, not camera identity. | scene.write |
| removeObservation(id,landmarkId,panoId) | false if absent, otherwise true. | scene.write |
| solve(id) | `{sessionId,revision,status,queued:true}` request receipt. | scene.write |
| getStatus(id) | `{sessionId,revision,status,pending,solvedRevision,appliedRevision,error}`. | scene.read |
| getQuality(id) | Quality metrics or null before metrics exist. | scene.read |
| preview(id,options?) | Unapplied camera/landmark/object snapshot and preview token. | scene.write |
| apply(id,{previewId?}?) | `{sessionId,revision,applied:true,wholeWorld}`. | scene.write |
| revert(id) | `{sessionId,reverted:true}`; guarded against overwriting newer world changes. | scene.write |

A sandboxed full-world transform additionally requires `anchors.read` and `anchors.write`; applying/reverting that transform requires `anchors.write`. Ordinary calibration does not need these permissions. Ordinary preview returns an empty objects map with `objectsIncluded:false` to callers without anchors.read, rather than exposing unrelated anchor metadata.

No calibration UI is created by these calls. The service needs neither a visible panorama canvas nor access to parent DOM. Community modules can import the example helper from their own package. Trusted system modules call the same API at `window.PalaceAPI.tour.world.calibration`.

## Scale and explicit world application

Without a known distance, `metricScale.known` is false, units are `relative`, and the abstract unit baseline is disclosed by `quality.gauge`. Existing registrations relative to the reference preserve the numeric world-unit gauge even when the strongest reconstructed baseline changes; they are not treated as measured metric distances. Multiple registrations use the median length ratio. Relative coordinates are not reported as meters. Known distances between two cameras or triangulated landmarks can establish metric scale; constraints whose endpoints have not been reconstructed remain unresolved.

World Space now records optional **metersPerUnit**. A world labelled `meters` requires `metersPerUnit:1`; other units can have a known conversion or null. `world.configure({metersPerUnit})` can explicitly register a conversion. Meter-based calibration is converted into the world's numeric units before world anchoring. If no conversion was given but reference baselines are registered, known physical distances infer the conversion while preserving numeric coordinates. An unscaled relative calibration cannot be applied to a world with known metric conversion.

Ordinary `preview(id)`/`apply(id)` update only the calculated camera registrations, preserving all global object positions/scales and other cameras. Existing camera FOVs are retained. Only a **solved**, current, nonpending revision can apply; provisional/degenerate/insufficient candidates remain unapplied. Preview supports provisional candidates for inspection but they cannot be applied. If the reference pose or world changed, preview/application requires a fresh compatible calculation or preview. The quality state describes the stored mathematical solution, not a guarantee that a previously cached preview remains applicable after outside edits.

For an intentional change of the entire world's origin/coordinate scale:

```js
const preview = await calibration.preview(id, {
  worldTransform:{position:{x:10,y:0,z:0},rotation:{x:0,y:0,z:0,w:1},scale:2}
});
// Inspect preview.cameras, preview.objects, preview.landmarks and wholeWorld.
await calibration.apply(id,{previewId:preview.previewId});
await calibration.revert(id); // unless subsequent world edits conflict
```

This transforms all registered cameras, global objects, shared geometry, local anchor dimensions/coordinates, radial depth values, cached calibration frames and live translated-view coordinate offsets together. Physical view direction and FOV do not change. It updates `metersPerUnit` inversely with coordinate scale. Scaling a meter-labelled world by 2 defaults to scene units with `metersPerUnit:.5`, so a physical meter is still a meter; the coordinate values doubled. Do not request `units:'meters'` while the conversion differs from one. Original meter distance measurements remain unchanged. Re-solving in the converted frame preserves the same physical reconstruction.

Native dollhouse registration accepts `geometry.scale`: in a shared world it is model-to-world numeric scale; in a panorama-local registration it scales the local result after the inverse capture pose. Rigid/world scale conversion composes these registered transforms without rewriting the original archive's model bytes. A stale full-world preview is rejected if the world or another calibration frame changed. Revert restores matching frame revisions and never silently overwrites newly changed observations. Ordinary Undo/Redo also restores the transaction.

## Quality and statuses

Quality includes observation count, caller-confirmed pair correspondences, inlier/outlier counts, unresolved observations, mean/median angular errors, median effective parallax, degeneracy reasons, relative/metric scale, registered/unregistered camera IDs, edge consensus statistics, per-landmark conditioning and segment metrics, visibility results, and bundle-adjustment initial/final cost/iteration count.

Angular means include reconstructed outlier observations; the median and robust optimization resist them. Missing poses/points are counted as unresolved rather than automatically called wrong correspondences. Pair-consensus rejection can identify an outlier correspondence without proving which endpoint the user mislabeled.

- collecting: no usable observations yet.
- insufficient_data: not enough geometric constraints or an unavailable explicit reference component.
- degenerate: rank-deficient geometry, pure rotation, weak/anti-parallel parallax or unresolved cheirality.
- provisional: valid partial candidate, missing cameras/scale links, inconsistent distance constraints, or unverified/occluded visibility. No unobservable camera positions are fabricated.
- solved: stable complete candidate for the requested graph, still unapplied until confirmed.
- failed: robust fitting could not find a valid model, worker startup/calculation error or timeout.

A graph edge's relative essential pose does not by itself determine that edge's scale relative to a different baseline. A disconnected/scale-disconnected camera stays in `unregisteredCameraIds`. Add shared tracks seen across three or more cameras, a suitable loop, or sufficient known distances.

## Events, disposal and errors

`onObservationAdded`, `onObservationUpdated`, `onCalibrationStatusChanged`, `onCalibrationSolved`, `onCalibrationApplied`, `onCalibrationFailed` synchronously return `{ready:Promise,dispose()}`. Await ready before requesting calculations. Maximum 60 calibration subscriptions per sandbox. Payloads include sessionId/revision; observation events add landmarkId/observation; status events expose status/pending/error; solved adds quality; applied adds wholeWorld. **Solved can publish a provisional candidate**: inspect its status before enabling apply. Failures are distinct from ordinary insufficiency/degeneracy. Observation removal is reported through the updated revision/status event.

Callbacks follow existing sandbox error handling; catch exceptions in async callbacks. Dispose removes parent and sandbox listeners. Session calculations belong to the core, not an addon-owned disposable rendering object.

Errors reject with an Error message prefixed by code. Custom Error.code is not transported into the iframe. Codes include `SESSION_NOT_FOUND`, `SESSION_EXISTS`, `LANDMARK_NOT_FOUND`, `LANDMARK_EXISTS`, `OBSERVATION_NOT_FOUND`, `OBSERVATION_EXISTS`, `INVALID_CALIBRATION`, `CALIBRATION_NOT_READY`, `CALIBRATION_UNSTABLE`, `CALIBRATION_NOT_APPLIED`, `PREVIEW_NOT_FOUND`, `PREVIEW_REQUIRED`, `WORLD_CHANGED`, `WORLD_UNITS_MISMATCH`, `SCALE_UNRESOLVED`, `CALIBRATION_WORKER_FAILED`, plus existing permission/argument/mode/JSON-size errors. Worker failure messages are stored in getStatus().error and emitted asynchronously. No output pose is created for insufficient/degenerate reconstruction.

## Regression evidence

`test/calibration-math.cjs` uses synthetic ground-truth 3D geometry with explicit tolerances: two/multiple cameras, a 64-camera chain, full-sphere/rear observations, noise/outliers, loop refinement, insufficient pairs, pure rotation/weak parallax, coplanar/collinear/anti-parallel degeneracy, independent scales, camera/landmark metric constraints, contradiction handling and both native model binary formats. The noisy-loop test checks an actual decrease in the global objective.

`test/calibration-integration.cjs` exercises real sandbox SDK calls and real browser workers: automatic revision calculation, events/disposal, unchanged world until apply, apply/revert/Undo, projection compatibility, archive reload, stale jobs/project replacement, camera deletion, malformed import, permissions/View mode, world-frame scaling/re-solving, occlusion validation, system API and main-thread responsiveness. Mobile profiles use Chromium emulation; this does not claim Safari or physical device testing.
