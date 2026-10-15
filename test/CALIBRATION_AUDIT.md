# Calibration audit — 15 October 2026

## Confirmed failures and changes

- Unsupported reference-only fallback offered corners on details the connecting camera could not see. Automatic candidates now require a common image region. Known geometric/depth occlusions veto candidates; geometry alone does not substitute for image evidence. Empty results keep observations intact and explain how to aim both panoramas or use Manual point / No overlap.
- Repeated wall patterns could generate apparent model support. Repeated local image contexts are rejected, and model support is rechecked after refinement.
- The original-scale image pyramid level was not copied because the upstream resampler only handles downsampling. The unchanged level is now copied explicitly.
- Right/middle mouse buttons and a drag returning to its initial pixel could place unintended measurements. Only a genuine primary-button/touch tap can place a point; multitouch and movement remain navigation.
- Starting Find points with a saved match selected could overwrite that match if the right image was tapped during analysis. Starting a new batch clears the old selection before asynchronous analysis.
- A late status response could restore the previous calibration group. Refresh sequence checks reject older responses, including across panorama loading.
- Switching four/eight-point targets did not replenish a batch. Batch/reserve handling follows the current target; completed automatic collection can resume when constraints become insufficient.
- Four matched points on a plane could leave ambiguous poses while the UI stopped offering points. An unresolved pair can now continue with an additional supported point from the reserve; the four-point minimum and core ambiguity rejection remain unchanged. Apply stays disabled until the solution is stable.
- Invalid/loading image taps cannot be queued as measurements to be applied after decoding. Source neighborhoods from disabled landmarks are eligible for correction rather than permanently excluded.

## New regression coverage

31 browser interaction cases in `calibration-interactions.cjs`: mouse buttons, returned drags, touch pinch, four/eight-point targets, preservation of old matches, recovery after worker failure, group refresh ordering and a synthetic photographic wall occlusion. The last case checks the physical source position against known scene geometry, without giving that geometry to the image matcher.

14 shared-region cases in `calibration-overlap.cjs`: four independently seeded occlusion scenes, four unrelated room pairs, blank images, deterministic/nonmutating operation, two scaled/translated occlusion scenes, repeated tiles and insufficient/collinear features. Reference locations and right hints are checked against independent image geometry.

A numerical photographic fixture preserves an actual four-point ambiguous configuration and verifies that a fifth correspondence resolves it, without weakening core thresholds.

One additional low-texture unit case in `calibration-features.cjs` ensures that known world geometry cannot manufacture an image match. Existing ambiguous-target and guided tests now reject unsupported fallback pins rather than requiring a fabricated four-point quota.

The delayed-analysis lifecycle fixture uses multiple textured physical panels so that a navigation test continues to have enough genuine shared details. The real artwork fixture uses a narrower reference view to stay inside the picture whose frame was independently annotated; it retains physical-region, four-pair, eight-inlier and angular-error assertions.

## Photographic validation

Private archives: 24 panoramas and 36 panoramas. Files remain outside the repository. Twelve photographic replay cases pass: eight hand-annotated door/lamp/frame cases with solve, preview, apply/revert and reopening, and four automatic-reference artwork cases requiring only right-side taps. These require the four-point minimum and successful additional-point recovery when the four observations remain geometrically ambiguous. Saved angular measurements are independently checked after every click.

A separate interactive pass on the 36-panorama archive used four automatic artwork details, visual checks of both photographs, and four native right-side pointer clicks. Target views were cross-checked using a homography from the independently annotated frame, without inserting SDK observations. The result was `solved`, four verified pairs, eight inliers, no outliers, mean angular residual 0.01703 degrees. Preview, apply and undo are checked through the interface.

A second interactive pass at 1280×900 reproduced the exact ambiguous batch: four valid pairs produced `degenerate`, the interface proposed a fifth supported detail, and its native right-side click produced `solved`, ten inliers, no outliers and mean angular residual 0.00945 degrees. The angular observations were not inserted through the SDK.

## Scope and limits

The automatic matcher estimates local planar image support; reconstruction still uses spherical rays and the existing calibration core. RGB matching does not establish every wall, reflection or repeated object physically. Missing support produces no automatic batch, rather than inventing points. The user verifies each actual physical correspondence.

Browser coverage uses Chromium desktop, Android, iPhone and iPad profiles. These emulate viewport, density and input; they are not physical-device or Safari results. General regression also covers plans, routes, cameras, imports/exports, addons, persistence, settings, PWA/offline and the numerical calibration/world SDK.

## Final verification

The first complete expanded run passed 378 of 379 cases. The failed photographic case exposed the four-point ambiguity dead end described above; it was reproduced separately, fixed in the interface and preserved as an additional numerical regression. A subsequent full run passed all calibration/photographic cases and exposed a navigation-wait timeout in the existing iPad 3D-to-2D test. That button changes an animated canvas mode; the test now awaits the actual 2D state, hidden 3D canvas and unchanged document address instead of a page-navigation wait. The focused 12-case format suite passes. The final release run passed **380 of 380 tests**, with **0 failures, 0 skipped cases and 0 cancellations**, in **598.7 seconds**. This is 47 additional cases over the 333-case starting suite. Command: `PALACE_REAL_ARCHIVES_DIR=/workspace/attachments npm test`. `npm run build`, changed JavaScript syntax checks and `git diff --check` also passed. The offline asset cache includes the local feature-matching dependencies.


## Changed files

- `PANORAMA_CALIBRATION.md`
- `TESTING.md`
- `calibration-addon.js`
- `calibration-features.js`
- `scripts/update-offline.cjs`
- `sw.js`
- `test/calibration-features.cjs`
- `test/calibration-guided.cjs`
- `test/calibration-manual-replay.cjs`
- `test/calibration-math.cjs`
- `test/calibration-real-archives.cjs`
- `test/formats-3d.cjs`
- `test/support/guided-photographic-case.json`
- `vendor/README.md`
- `calibration-overlap.js`
- `test/CALIBRATION_AUDIT.md`
- `test/calibration-interactions.cjs`
- `test/calibration-overlap.cjs`
- `test/support/ambiguous-photographic-observations.json`
- `test/support/photographic-calibration.cjs`
- `vendor/jsfeat-0.0.8.min.js`
- `vendor/jsfeat-LICENSE.txt`
