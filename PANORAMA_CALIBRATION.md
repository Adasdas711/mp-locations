# Panorama calibration — built-in system addon

The **Panorama calibration** crosshair button sits below **3D tour** in the far-left activity sidebar (the bottom activity bar on phones). The addon ships with PALACE and is enabled by default. Open it from the activity sidebar, Command Palette, or **Settings → Panorama calibration**. It is independent of the community modular-mode switch and requires no package upload.

## Match a physical point

1. Open an imported project in **Edit** mode. Select the reference panorama on the left and the connecting panorama on the right. Cameras without imported images are omitted. Options have unique numbered labels in archive order; the default pair uses a tour connection when available.
2. PALACE looks for distinctive corners in the current reference view and searches the other panorama in all directions for supporting image evidence. In the default level-horizon mode, collect four matches. The point strip between the views lists suggestions and saved points; click a number to center its detail. Only the active point is drawn on the photographs. The reference marker is yellow. Click the same physical detail on the right; the next reference point is selected automatically. The suggested right-side viewing direction is a search hint, not a saved observation. You do not need to place points on the left.
3. Use **Skip point** if the detail is hidden, unclear or absent in the other panorama. Skipping does not create an observation. Rotate or zoom the reference view and choose **Find points** to get a new batch. Blank images, ambiguous repeating details and pairs with no confidently shared features produce no suggestions; PALACE never fills a quota with arbitrary positions. Fewer than four confident suggestions are allowed. **Manual point** retains the previous workflow. Click a saved point in the strip to show its markers, then drag them for corrections.
4. Placing the same visible feature on the right confirms both observations. The caption states this confirmation; **Visible in both** can revoke or reconfirm the selected match. The optional **Nearby point with clear parallax** confirmation reminds you to choose useful geometry. Observations can be saved without either confirmation.
5. Choose **Next panorama** whenever you want. A/B becomes B/C; the selected point is retained if it is observed on B. Match that point in C or create another one. Navigation has no per-pair point quota or predetermined camera count.

Use **Manual point** before adding a feature near an existing marker. Unselected markers do not obscure the photographs or intercept taps. Drag each panorama independently to rotate it. Scroll or use its FOV slider to zoom. Markers are projected from stored spherical yaw/pitch, so changing the view does not change measurements. A focused panorama supports arrow keys and +/-.

## Correct and extend observations

Click a numbered marker to select and highlight the corresponding point in both views. Drag it to correct its position. Corrections clear manual visibility verification; confirm visibility again after checking the location.

Diagnostics let you rename a landmark, exclude it from optimization, remove either observation, delete the entire point after confirmation, see observing panoramas and inspect geometry/visibility quality. Removing one observation preserves the physical point's other views. Delete on a focused panorama removes its selected observation.

Select arbitrary left/right panoramas to close loops or revisit work. They must be different cameras. **Match point** focuses the connecting view. **Previous** steps backwards in the sequence; **Back** follows actual pair history. **All cameras** shows observation/reconstruction state and lets you choose a connecting camera.

Open **Points & settings** to create or switch sessions, inspect control points and provide a known distance. This collapsible inspector leaves the main views and navigation usable. Compact top/bottom controls and floating camera selectors let photographs fill the available area. On desktop the point strip is vertical and centered between the panoramas. On phones the photographs stack, with a horizontally scrollable point strip between them; the compact bottom controls also scroll horizontally. The project stores the active session, pair, selected landmark, pair history, viewing angles/FOV and rule confirmations. The core stores observations, metrics and reconstruction. Save/export/import, local recovery and change history retain workspace state. Opening a project does not automatically reopen this editor; its activity button resumes it.

## Two selection rules

**Direct visibility:** both panoramas must show the actual physical point without an intervening wall. Image suggestions use multiscale brightness-normalized context and dense spatial gradient histograms, require a distinctive reciprocal match, and reject ambiguous alternatives. These checks reduce unrelated or hidden-detail suggestions but cannot infer all walls from RGB images. The user must still check that a suggested detail is the same physical object. Without registered world poses and compatible geometry/depth, visibility remains an approximation, not a geometric guarantee.

With registered world poses, suggestions also use available global triangle geometry (including transformed dollhouse geometry) and compatible radial depth maps. Source rays recover a candidate surface position; target rays test intervening surfaces, opposite sides of a wall and closer target depth. Contradictory geometry rejects a suggestion and blocks confirming that reference point from the other camera, including manual placement. Unknown or incompatible depth never substitutes a fictitious surface. The calibration core continues to check available geometry/depth after reconstruction and reports occlusion contradictions. Missing depth does not block collecting manual observations.

**Useful parallax:** prefer nearby features around the space between cameras. Avoid distant points with nearly parallel rays. Do not insist on points exactly on the camera segment: parallel or opposite rays can be degenerate. Until poses exist, use physical judgment; afterwards inspect effective parallax and landmark conditioning/segment metrics.

## Separate groups without common visibility

A navigation link is only a suggestion for choosing a nearby panorama. It does **not** prove that the cameras see common physical points. A closed house and street views can be independent groups.

Use **No overlap** to leave a pair without creating a correspondence and start a new group; all measurements in the previous group remain saved. **Points & settings → New group** also starts an independent group. The group picker restores each group's last pair and selection. New groups include only cameras actually observed, rather than every panorama in the project. Other project cameras do not prevent a sufficiently constrained group from reaching `solved`. **Use only observed cameras** trims the scope of an existing session created with all project cameras, without deleting project cameras or observations.

Disconnected groups can be reconstructed separately. Their relative positions, rotations and scales are unknown without additional constraints. PALACE does not create connections or pretend that arbitrary relative coordinates locate the groups together. If another group already has world poses, an independent group can be previewed in its own frame; its preview omits other groups' cameras and global objects. Applying it alongside existing world poses requires its reference world pose and a common metric scale (or an already applied shared reference). Provide these through the existing World SDK and distance constraints, then recalculate. Independent groups and their UI state are saved with the project.

## Understand progress

The pair row distinguishes no correspondences, added correspondences, insufficient data, a preliminary solution, calibrated geometry and points needing correction. One saved correspondence is not a solved camera transform. Insufficient data never blocks navigation.

Progress separately counts panoramas with observations, registered **candidate** cameras, existing world poses and cameras needing constraints **inside the active group**, and cameras outside that group. Marked panorama counts never substitute for successful registrations. Core states are:

- `collecting`: no usable constraints yet.
- `insufficient_data`: measurements are saved, but poses are not determined.
- `degenerate`: weak parallax, pure rotation or ambiguous geometry needs correction.
- `provisional`: a partial reconstruction or unresolved constraints/visibility remains.
- `solved`: a stable candidate is ready for explicit application.
- `failed`: calculation failed; saved observations can be corrected/recalculated.

The core performs automatic recalculation. The UI subscribes to SDK observation/status/solved/applied/failed events and runs no registration algorithm. Feature detection, image comparison and geometric visibility filtering run in a separate worker on bounded photograph-only renders, without UI or global-object overlays. Square angular samples keep analysis independent of viewport proportions; the connecting panorama is sampled in its current view, four horizontal directions, and upward/downward views. Subpixel corners are refined and distributed over the reference view. Suggestions remain temporary until the user supplies a right-side match. Changing the pair or closing the editor cancels analysis. A changed reference view invalidates the pending result so an old job cannot unexpectedly rotate it back. Saved matches and camera pose calculations continue through the public calibration SDK. If a session's automatic mode was disabled externally, UI observation mutations explicitly queue `solve`. Closing the editor disposes renderers/subscriptions; background core calculations may finish and appear on reopening.

## Preview, apply and undo

**Preview reconstruction** displays candidate cameras, spatial connections, yellow reconstructed landmarks and existing global objects in a read-only 3D overview. Drag to orbit and scroll to change distance. The panorama surfaces also show shared objects from candidate capture poses.

Preview never changes project transformations. **Apply calibration**, after confirmation, applies a current stable solution through the SDK. A revision-bound preview token prevents confirmation from applying a different candidate. Ordinary application updates world camera poses and preserves global-object coordinates. The same shared object is rendered from multiple registered cameras without creating additional world objects.

**Undo last application** calls `revert`; normal Undo/Redo remains available. External world edits may make transactions stale. The SDK rejects conflicts and the UI reports them instead of overwriting newer data.

## Scale and limitations

Relative reconstruction does not claim real meters. Diagnostics optionally accept a known physical distance between the current cameras; remove incorrect measurements. Known world units and distance constraints govern application to metric projects.

**Four** suitable matches are sufficient in the default **Level panorama horizons** mode. This assumes the source panoramas are upright; rotating the viewport does not change that assumption. Disable the option for source panoramas with tilt/roll, which uses unrestricted eight-point registration. One correspondence per consecutive pair can be collected, but does not determine every 6DoF pose. Multiple pairs need shared multi-view tracks or suitable distances to connect relative scales. Pure rotation, weak parallax, wrong matches or insufficient constraints may produce no reconstruction. See [calibration core documentation](CALIBRATION_SDK.md) for the numerical model and SDK.

Image matching only proposes features and approximate viewing directions; it does not automatically confirm observations or solve poses from unconfirmed suggestions. No dense depth reconstruction is added. External-only tours without imported images cannot be calibrated here. Point placement requires a successfully decoded panorama.

## System and renderer integration

`system.panorama-calibration` uses `registerSystemAddon` and `PalaceAPI.tour.world.calibration`. Disable it in **Settings → Core plugins** to close/hide the interface while retaining project data. Re-enable it to resume. Interface preferences can separately hide/show its activity tool, `system.calibrationTool`.

`panorama-surface.js` captures existing `localViewer` methods before singleton SDK hooks. `PalacePanoramaSurfaces.create(canvas, callbacks)` creates independent instances using the same sphere, image decoding/cache, pointer rotation, FOV interpolation and resizing. Its metadata-only `list()` and image access are trusted **system adapters**, not sandbox permissions or a second panorama engine. Per-surface dim transitions avoid cancelling the other pane's image load. Paired surfaces suppress redundant neighbor prefetch; active image sources are protected from shared-cache eviction. Observation actions are serialized, so a quick second tap is retained. Loading and error overlays prevent stale-image measurements. World previews reuse `createWorldObjectVisual`, the visual builder used by World Space. Calibration mathematics remains unchanged.

## Regression

`test/calibration-addon.cjs` uses real browser renderers and SDK/core calculations. It checks activity sidebar position/selection, simultaneous images, independent rotation, shared IDs, A/B → B/C and back, independently calculated spherical projection after FOV changes, dragging/removal/exclusion, insufficient-data navigation, lifecycle retention, zero/one-camera projects, arbitrary pairs, camera deletion, invalid restored UI, reconstruction preview, apply/revert, shared objects from multiple cameras, archive restart and leaving during calculation. The matching workflow runs on desktop, Android, iPhone and iPad Chromium profiles. Existing mathematical/integration and full application regression remain applicable.

`test/calibration-real-archives.cjs` is an opt-in suite for private `.3dview` files. Set `PALACE_REAL_ARCHIVES_DIR` to a directory of archives; files are discovered recursively and are never added to the repository. It imports real AVIF panoramas, checks paired layout and linked default cameras, delays a core mutation to verify rapid pointer taps are queued, switches every panorama on desktop and repeats switching on mobile, protects active texture sources from cache eviction, verifies FOV invariance and close/reopen persistence. Run it with `PALACE_TEST_FILES=calibration-real-archives.cjs PALACE_REAL_ARCHIVES_DIR=/path/to/private/files npm test`.

The independent-group regression constructs a closed interior group and a separate street group with an additional unobserved panorama. The interior solves/applies without the street; the street solves independently, keeps the interior unchanged, previews without fake global placement, and restores both group selections.

The four-point photographic regression replays features selected by hand on the supplied 24/36-panorama archives: door-trim corners and a lamp apex, and the four corners of a framed picture on a planar wall. `test/calibration-manual-replay.cjs` clicks the photographs through the UI on desktop, Android, iPhone and iPad, requires a stable four-match solution, previews/applies/reverts, checks unregistered cameras remain unassigned, and saves/reopens full projects on desktop. It blocks the external worker-script URL to verify the self-contained worker. No synthetic observations are seeded into these runs.

Pending UI groups saved before four-point support migrate to upright four-point configuration once. Applied groups and explicit later free-orientation choices retain their configuration. Opening a workspace while an import is running is blocked until import completion. Calculation errors show their actual worker or geometric reason and retain observations.

`test/calibration-features.cjs` checks numerical corner localization, feature ambiguity, shared/absent image details, wall faces, intervening geometry and radial depth contradictions. `test/calibration-guided.cjs` renders synthetic photographs from known camera poses and clicks only the right-hand matches on desktop, Android, iPhone and iPad. It verifies real four-match registration, centered point-strip selection, image-height usage, absence of unconfirmed right-hand markers, skipping/cancellation and blocked manual confirmation through a known wall. Synthetic observations are not inserted into these guided runs.
