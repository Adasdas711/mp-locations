# PALACE Addon SDK 1.6 — 3D anchors, scenes, camera and playback

This supplements [ADDONS_AI_GUIDE.md](ADDONS_AI_GUIDE.md). Runtime API version is `1.6.0` (the local scene contract introduced in 1.5 remains compatible); manifest `apiVersion` remains the number `1`. CommonJS `exports.activate(api)` receives the SDK. All methods below return Promises except event subscription factories. Declarations: [palace-sdk.d.ts](docs/addons/palace-sdk.d.ts).

## Permissions and compatibility

| API | Permission | Legacy permission also accepted |
| --- | --- | --- |
| `tour.anchors.create/update/remove/clear` | `anchors.write` | `tour.write` |
| `tour.anchors.get/list`, anchor events | `anchors.read` | `tour.read` |
| `tour.scene.getInfo/raycast/project/unproject`, readiness | `scene.read` | `tour.read` |
| `tour.scene.configure` | `scene.write` | `tour.write` |
| `tour.camera.*`, `tour.playback.*`, camera/playback events | `camera.control` | `view.control` |

`focusAnchor` and `moveTo({anchorId})` also need `anchors.read`. Playback start also needs `scene.read`, and `anchors.read` when stops reference anchors. Changing project anchors or scene configurations requires Edit mode. Camera operations require no active review session. Disabling an addon cancels its camera animation and tour; its project anchors remain saved. No raw renderer, arbitrary parent-page JavaScript or external model URLs are exposed.

## Coordinates and capabilities

Each panorama has its own right-handed coordinate frame: capture point is `(0,0,0)`, positive X is right, positive Y up, negative Z forward. Camera angles are **degrees**; anchor/geometry rotation is XYZ Euler **radians**. Anchor scale is a positive scalar. Positions do not automatically correspond to meters. `scene.getInfo(panoId?)` returns `{panoId,type,coordinateSystem,camera,ready,hasGeometry,hasDepthMap,unregisteredDollhouseAvailable,panoramaRadius,capabilities}`. `coordinateSystem.units` reports `scene-units`, `meters` or `model-units` as declared by the geometry provider. Inactive panoramas report a reference pose, not a remembered live camera pose.

`capabilities` reports `anchors`, `raycast`, `syntheticDistancePlacement`, `translation`, `occlusion` and supported `styles`.

| Scene data | Placement and occlusion | Camera movement |
| --- | --- | --- |
| Photo only | Actual scene objects with perspective; chosen distance is synthetic; no wall occlusion | Rotation/FOV and panorama switching |
| Registered radial depth | Raycast and depth occlusion where valid samples exist | Rotation/FOV and panorama switching |
| Registered solid geometry | Surface raycast, occlusion and perspective/parallax for geometry | Real camera translation |

A translated photo background remains a spherical background, not reconstructed photographic 6DoF. Declaring units does not calibrate geometry. Imported dollhouse presence alone does not establish the capture pose; a provider must explicitly register its origin/rotation. The panoramic background radius is 500; place anchors inside the supported camera clip range, normally within the photo sphere. Fully immersive textured reconstruction and movement collision avoidance are not supplied.

## Anchor CRUD

`Anchor3D` contains `id`, `panoId`, `position:{x,y,z}`, `rotation:{x,y,z}`, `scale`, `label`, `visible`, `interactive`, `style`, optional `metadata`.

Style: `{type:'sphere'|'billboard'|'sprite'|'model',color:'#RRGGBB',size,opacity,icon?,model?}`. Defaults: sphere, `#3592c4`, size `.35`, opacity `1`. `icon` is a raster image data URL, not an external URL or SVG. `model` supplies a triangle mesh `{positions:number[],indices?:number[],uvs?:number[]}`; it is required for model style. Billboards/sprites face the camera; spheres/models retain spatial rotation. Label sprites are rendered in the same scene. Visible interactive objects respond to pointer/touch clicks and hover; dragging the panorama does not activate an anchor. Movement is exposed through `update`, not an implicit drag gizmo.

| Method | Result and behavior |
| --- | --- |
| `tour.anchors.create(input)` | Complete normalized Anchor3D. `id` defaults to UUID, `panoId` to active panorama; position required. Duplicate ID rejects. |
| `tour.anchors.update(id,patch)` | Complete updated Anchor3D. ID cannot change. Style merges partially; position and rotation require all XYZ; metadata replaces previous object, null removes it. |
| `tour.anchors.remove(id)` | Boolean: false if absent. |
| `tour.anchors.get(id)` | Complete cloned Anchor3D; missing ID rejects. |
| `tour.anchors.list(panoId?)` | Cloned Anchor3D array for specified/current panorama. |
| `tour.anchors.clear(panoId)` | Number removed. |

Anchors are actual Three.js objects in the panorama scene, not SVG screen overlays. Their world positions stay fixed while the camera rotates. They participate in geometry depth testing and are selectable through pointer interactions or `focusAnchor`. Project serialization, archive export/import, local autosave, Undo/Redo and Change history include anchors and scene configurations. Deleting a panorama removes its anchors/configuration; Undo restores them.

Limits: 500 anchors/project; ID matches `[A-Za-z0-9._-]{1,100}` excluding prototype names; position components ±100000; rotation components ±100π; scale `.001..100`; label 500 characters; style size `.01..100`, opacity `0..1`; metadata finite JSON object ≤16384 serialized characters; raster data URL ≤512 KiB characters (rendered at ≤512px); model ≤2048 vertices. Complete scene persistence ≤8 MiB serialized characters. Limits are validation bounds, not performance guarantees for large geometry.

## Scene geometry, depth, raycast and projection

`tour.scene.configure(panoId,input)` returns updated SceneInfo; pass `null` to clear. Input:

```js
{
  units: 'scene-units',
  geometry: {
    positions: [-5,-5,-8, 5,-5,-8, 0,5,-8],
    // indices and uvs optional
    render: 'solid', // or 'occlusion': depth-only invisible mesh
    color: '#777777'
  },
  // optional depthMap: {width, height, data: radialDistances}
}
```

Geometry is already in the panorama coordinate frame. Alternative: `geometry:{source:'dollhouse',origin:{x,y,z},rotation:{x,y,z},render:'solid'}` registers an imported model using its known capture pose. Native source Z-up is converted to Three.js Y-up; origin/rotation refer to that converted model frame. Geometry is cloned before calibration. Missing imported model rejects `GEOMETRY_UNAVAILABLE`. Maximum 30000 geometry vertices, 180000 triangle indices; configuration ≤4 MiB serialized characters.

Depth map width `4..256`, height `3..128`, row-major distances `0..100000`; zero means missing. At column x and row y: yaw=`2π*x/width`, pitch=`π/2-π*y/(height-1)`; position=`distance*(-sin(yaw)*cos(pitch),sin(pitch),-cos(yaw)*cos(pitch))`. Column zero faces -Z, the top row +Y. A provider must reorient/resample its source depth image to this convention. Adjacent valid samples form occluding triangles; missing/discontinuous depth cannot prove occlusion and interpolation is approximate.

| Method | Input → result |
| --- | --- |
| `tour.scene.getInfo(panoId?)` | Existing specified/current panorama → SceneInfo; does not require open renderer. |
| `tour.scene.configure(panoId,input|null)` | Registered data → SceneInfo; persistent Edit-mode mutation. |
| `tour.scene.raycast(input)` | `{screenPosition:{x,y,space?}}` OR `{origin:{x,y,z},direction:{x,y,z}}`, optional `includeAnchors`, optional fallback `distance` → nearest `{panoId,position,distance,synthetic,source,anchorId?}` or null. |
| `tour.scene.project(position)` | XYZ → `{x,y,depth,visible,occluded,panoId}`; normalized screen coordinates, radial depth. |
| `tour.scene.unproject(screenPosition,depth)` | Screen point and radial depth → XYZ. This is chosen-distance projection, not automatic measured depth. |

Screen coordinates default to normalized `0..1`; `space:'pixels'` uses CSS pixels relative to the canvas. `project.visible` means in front, inside the viewport and not occluded; `occluded` separately reports geometry blocking. Screen input must be within the viewport. Scene queries that use the active camera require readiness. Raycast returns real geometry first, including anchors only when requested. If no real hit and fallback distance `.1..400` is provided, returns `synthetic:true`; otherwise null. Synthetic fallback must not be presented as a measured surface. Unproject depth `.01..100000`.

## Readiness and camera

`tour.select(id)` retains its old request-only behavior. Follow it with `await tour.waitForPanoramaReady(id,{timeout:8000})`, which resolves `{panoId,ready:true,hasImage,scene}` after a rendered frame with the panorama texture (or explicit image-less panorama). Timeout accepts `1..20000` milliseconds. Changing panorama/project, renderer disposal, addon shutdown, failed image loading and timeout reject instead of silently succeeding. Use this before camera/projection APIs. Camera animation promises resolve at their target pose; starting another animation rejects the previous promise with `ANIMATION_CANCELLED`.

| Method | Result |
| --- | --- |
| `tour.camera.getPose()` | `{panoId,position:{x,y,z},yaw,pitch,roll,fov}`. |
| `tour.camera.setPose(pose)` | Final CameraPose3D; partial pose plus `duration`, `easing`. Nonzero translation without registered solid geometry rejects. |
| `tour.camera.lookAt(position,options?)` | Final pose facing XYZ. Target at camera origin rejects. |
| `tour.camera.moveTo(target,options?)` | `{pose,mode,translated}`; target may contain `panoId`, `anchorId`, `position`, `pose`, or direct XYZ. Modes: translation, panorama-switch, rotation-only. Photo/depth-only scene turns/switches instead of claiming physical translation. |
| `tour.camera.focusAnchor(id,options?)` | Switches to anchor panorama, waits for readiness, selects anchor and turns to it; resolves final pose. |
| `tour.camera.stopAnimation()` | Boolean indicating cancelled animation; also pauses playing auto tour. |

Animation options `{duration:0..8000,easing:'linear'|'easeInOut'|'easeOut'}`; default instant/easeInOut. Camera yaw normalized to `[0,360)`, pitch clamped `[-85,85]`, roll normalized around ±180, FOV clamped `[30,150]`. Coordinates are panorama-local. Manual pointer/wheel control pauses playback and cancels its animation. Leaving panorama view, switching project or disabling owner stops movement. There is no collision detection or inferred navigation between disconnected camera positions.

## Playback

`tour.playback.start({stops,loop:false})` starts asynchronously and returns current PlaybackState immediately. Each stop: `{panoId,anchorId?,duration?,hold?,easing?,pose?}`; default duration 2000ms, hold 3000ms. Pose may contain yaw/pitch/roll/FOV. 1..200 stops, duration `0..8000`, hold `0..600000`; anchor must belong to stop panorama. Readiness is awaited before aiming; errors change state to `error` and are reported through events/getState.

`tour.playback.pause()`, `resume()`, `stop()`, `next()`, `previous()`, `getState()` all resolve PlaybackState: `{status,index,phase,panoId,anchorId,stops,loop,error}`. Status: idle/playing/paused/stopped/completed/error. Pause preserves remaining motion/hold time. Resume requires paused state. Next/previous keep playing when already playing; otherwise move to the selected stop and stay paused. Without looping endpoints clamp. Only the owning addon can control an existing tour; another addon may read its state. Starting a new tour replaces the previous one. Stop retains its stop list for inspection/manual navigation. Playback errors do not delete project data.

## Events

`tour.onCameraChanged(handler)`, `onPanoramaReady`, `onAnchorClick`, `onAnchorHover`, `onAnchorMoved`, `onPlaybackChanged` return `{ready:Promise,dispose()}` synchronously. **Await subscription.ready before triggering actions when event order matters.** Maximum 60 tour subscriptions/addon. Calling dispose removes its listener and host subscription. Shutdown destroys the sandbox/subscriptions. Callback exceptions follow the existing addon error handling; catch errors in async event callbacks.

Payloads:

- CameraChanged: CameraPose3D, throttled to approximately 20Hz and emitted on SDK pose changes.
- PanoramaReady: `{panoId,ready,hasImage,scene}` after actual rendering; may occur again when image is replaced.
- AnchorClick: `{panoId,anchorId,anchor,position}` where position is intersection XYZ.
- AnchorHover: `{panoId,anchorId,hovered,anchor?}`; leave payload omits anchor.
- AnchorMoved: `{panoId,anchorId,anchor,reason:'create'|'update',previousPosition?}`; update emitted on position/panorama change.
- PlaybackChanged: PlaybackState, including phase/status changes.

## Working example

Manifest permissions: `['tour.read','view.control','ui.control','scene.read','anchors.read','anchors.write','camera.control']`, engine `>=1.5.0 <2.0.0`. Run the following from a command handler after the user opens a palace. The API variable lives inside activate; do not redeclare reserved top-level loader identifiers.

```js
exports.activate = async function(api) {
  const subscription = api.tour.onAnchorClick(async ({anchor}) => {
    try { await api.ui.showMessage('Clicked: ' + anchor.label); }
    catch (error) { console.error(error); }
  });
  await subscription.ready;
  api.commands.register('example.place-anchor', async () => {
    const cameras = await api.tour.read();
    const ids = Object.keys(cameras);
    if (!ids.length) throw new Error('Open a palace with panoramas first.');
    await api.tour.select(ids[0]);
    await api.tour.waitForPanoramaReady(ids[0]);
    const hit = await api.tour.scene.raycast({
      screenPosition: {x:.5,y:.5}, distance:10
    });
    const anchor = await api.tour.anchors.create({
      panoId:ids[0], position:hit.position, label:'Example locus',
      style:{type:'sphere',color:'#3592c4',size:.4},
      metadata:{syntheticPlacement:hit.synthetic}
    });
    await api.tour.anchors.update(anchor.id, {
      position:{x:anchor.position.x+1,y:anchor.position.y,z:anchor.position.z}
    });
    await api.tour.camera.focusAnchor(anchor.id,{duration:600});
    const pose = await api.tour.camera.getPose();
    console.log(pose);
    await api.tour.playback.start({stops:ids.map(panoId=>({
      panoId, ...(panoId===anchor.panoId?{anchorId:anchor.id}:{}),
      duration:1000,hold:2000
    })),loop:false});
  });
};
```

Declare `example.place-anchor` in `contributes.commands`. A non-synthetic placement on a surface requires registered geometry/depth, not a different raycast flag. Export the palace through the normal Save UI or archive API to preserve its anchors.

## Errors and asynchronous behavior

All RPC methods reject with Error whose message starts with a code. The sandbox does not preserve a custom Error.code field; parse/message-match only when needed. Common codes: `PERMISSION_DENIED`, `INVALID_ARGUMENT`, `LIMIT_EXCEEDED`, `PANORAMA_NOT_FOUND`, `ANCHOR_NOT_FOUND`, `ANCHOR_EXISTS`, `INVALID_GEOMETRY`, `INVALID_DEPTH_MAP`, `INVALID_PROJECT`, `GEOMETRY_UNAVAILABLE`, `PANORAMA_NOT_READY`, `PANORAMA_TIMEOUT`, `PANORAMA_LOAD_FAILED`, `PANORAMA_CHANGED`, `PROJECT_CHANGED`, `ANIMATION_CANCELLED`, `TRANSLATION_UNSUPPORTED`, `ADDON_STOPPED`, `REVIEW_ACTIVE`, `PLAYBACK_EMPTY`, `PLAYBACK_NOT_PAUSED`, `PLAYBACK_OWNED`. Edit-mode denial uses the existing editor error. Always catch camera cancellation promises. Scene/anchor mutations resolve after validation/state update; image icon decoding and browser display remain asynchronous. Camera/readiness RPCs have a 30-second transport timeout; other RPCs retain 10 seconds. Playback start does not wait for the entire tour: monitor events/getState.

Regression coverage is in `test/scene-sdk.cjs`: real renderer objects, pointer/touch interactions, stable coordinates, mutations/Undo/Redo, archive round-trip, panorama cleanup, raycasting/projection, GPU depth occlusion, translation restrictions, camera cancellation/readiness, playback pause/resume/navigation, permissions, legacy compatibility, View-mode safety and owner shutdown across desktop/mobile Chromium profiles.

## SDK 1.6: shared world

For explicitly registered panorama capture poses and objects shared across multiple cameras, see [WORLD_SDK.md](WORLD_SDK.md). Existing anchors, camera poses and scene projections remain panorama-local.
