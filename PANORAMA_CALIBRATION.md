# Panorama calibration — built-in system addon

The **Panorama calibration** crosshair button sits immediately below **Camera editor** in the left plan toolbar. The addon ships with PALACE and is enabled by default. Open it from the toolbar, Command Palette, or **Settings → Panorama calibration**. It is independent of the community modular-mode switch and requires no package upload.

## Match a physical point

1. Open an imported project in **Edit** mode. Select the reference panorama on the left and the connecting panorama on the right.
2. Click a directly visible landmark on the left to create a numbered control point. Alternatively, select an existing numbered marker or choose it under **Control points and diagnostics**.
3. Click the same physical location on the right. This adds an observation to the **same landmark ID**.
4. Confirm **Visible in both panoramas** only when true. The optional **Nearby point with clear parallax** confirmation reminds you to choose useful geometry. Observations can be saved without either confirmation.
5. Choose **Next panorama** whenever you want. A/B becomes B/C; the selected point is retained if it is observed on B. Match that point in C or create another one. Navigation has no per-pair point quota or predetermined camera count.

Drag each panorama independently to rotate it. Scroll or use its FOV slider to zoom. Markers are projected from stored spherical yaw/pitch, so changing the view does not change measurements. A focused panorama supports arrow keys and +/-.

## Correct and extend observations

Click a numbered marker to select and highlight the corresponding point in both views. Drag it to correct its position. Corrections clear manual visibility verification; confirm visibility again after checking the location.

Diagnostics let you rename a landmark, exclude it from optimization, remove either observation, delete the entire point after confirmation, see observing panoramas and inspect geometry/visibility quality. Removing one observation preserves the physical point's other views. Delete on a focused panorama removes its selected observation.

Select arbitrary left/right panoramas to close loops or revisit work. They must be different cameras. **Add correspondence** focuses the connecting view. **Previous panorama** steps backwards in the sequence; **Return to previous pair** follows actual pair history. **All cameras** shows observation/reconstruction state and lets you choose a connecting camera.

Create or switch sessions in the workspace header. The project stores the active session, pair, selected landmark, pair history, viewing angles/FOV and rule confirmations. The core stores observations, metrics and reconstruction. Save/export/import, local recovery and change history retain workspace state. Opening a project does not automatically reopen this editor; its toolbar button resumes it.

## Two selection rules

**Direct visibility:** both panoramas must show the actual physical point without an intervening wall. Without compatible geometry/depth, the user confirms this. The core checks available geometry/depth after reconstruction and reports occlusion contradictions. Missing depth does not block collecting observations.

**Useful parallax:** prefer nearby features around the space between cameras. Avoid distant points with nearly parallel rays. Do not insist on points exactly on the camera segment: parallel or opposite rays can be degenerate. Until poses exist, use physical judgment; afterwards inspect effective parallax and landmark conditioning/segment metrics.

## Understand progress

The pair row distinguishes no correspondences, added correspondences, insufficient data, a preliminary solution, calibrated geometry and points needing correction. One saved correspondence is not a solved camera transform. Insufficient data never blocks navigation.

Progress separately counts panoramas with observations, registered **candidate** cameras, existing world poses and cameras needing constraints in the active reconstruction. Marked panorama counts never substitute for successful registrations. Core states are:

- `collecting`: no usable constraints yet.
- `insufficient_data`: measurements are saved, but poses are not determined.
- `degenerate`: weak parallax, pure rotation or ambiguous geometry needs correction.
- `provisional`: a partial reconstruction or unresolved constraints/visibility remains.
- `solved`: a stable candidate is ready for explicit application.
- `failed`: calculation failed; saved observations can be corrected/recalculated.

The core performs automatic recalculation. The UI subscribes to SDK observation/status/solved/applied/failed events and runs no registration algorithm. If a session's automatic mode was disabled externally, UI observation mutations explicitly queue `solve`. Closing the editor disposes renderers/subscriptions; background core calculations may finish and appear on reopening.

## Preview, apply and undo

**Preview reconstruction** displays candidate cameras, spatial connections, yellow reconstructed landmarks and existing global objects in a read-only 3D overview. Drag to orbit and scroll to change distance. The panorama surfaces also show shared objects from candidate capture poses.

Preview never changes project transformations. **Apply calibration**, after confirmation, applies a current stable solution through the SDK. A revision-bound preview token prevents confirmation from applying a different candidate. Ordinary application updates world camera poses and preserves global-object coordinates. The same shared object is rendered from multiple registered cameras without creating additional world objects.

**Undo last application** calls `revert`; normal Undo/Redo remains available. External world edits may make transactions stale. The SDK rejects conflicts and the UI reports them instead of overwriting newer data.

## Scale and limitations

Relative reconstruction does not claim real meters. Diagnostics optionally accept a known physical distance between the current cameras; remove incorrect measurements. Known world units and distance constraints govern application to metric projects.

The solver needs at least eight suitable correspondences for an initial pair. One correspondence per consecutive pair can be collected, but does not determine every 6DoF pose. Multiple pairs need shared multi-view tracks or suitable distances to connect relative scales. Pure rotation, weak parallax, wrong matches or insufficient constraints may produce no reconstruction. See [calibration core documentation](CALIBRATION_SDK.md) for the numerical model and SDK.

No automatic image matching, feature detection or dense depth reconstruction is added. External-only tours without imported images cannot be calibrated here. Point placement requires a successfully decoded panorama.

## System and renderer integration

`system.panorama-calibration` uses `registerSystemAddon` and `PalaceAPI.tour.world.calibration`. Disable it in **Settings → Core plugins** to close/hide the interface while retaining project data. Re-enable it to resume. Interface preferences can separately hide/show its toolbar tool, `system.calibrationTool`.

`panorama-surface.js` captures existing `localViewer` methods before singleton SDK hooks. `PalacePanoramaSurfaces.create(canvas, callbacks)` creates independent instances using the same sphere, image decoding/cache, pointer rotation, FOV interpolation and resizing. Its metadata-only `list()` and image access are trusted **system adapters**, not sandbox permissions or a second panorama engine. Per-surface dim transitions avoid cancelling the other pane's image load. World previews reuse `createWorldObjectVisual`, the visual builder used by World Space. Calibration mathematics remains unchanged.

## Regression

`test/calibration-addon.cjs` uses real browser renderers and SDK/core calculations. It checks toolbar position/selection, simultaneous images, independent rotation, shared IDs, A/B → B/C and back, independently calculated spherical projection after FOV changes, dragging/removal/exclusion, insufficient-data navigation, lifecycle retention, zero/one-camera projects, arbitrary pairs, camera deletion, invalid restored UI, reconstruction preview, apply/revert, shared objects from multiple cameras, archive restart and leaving during calculation. The matching workflow runs on desktop, Android, iPhone and iPad Chromium profiles. Existing mathematical/integration and full application regression remain applicable.
