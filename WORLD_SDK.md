# PALACE SDK 1.6 — Shared World Space

This extends SDK 1.5 without changing local anchor or camera coordinate semantics. Manifest `apiVersion` stays `1`; runtime `api.version` is `1.7.0`. [Type declarations](docs/addons/palace-sdk.d.ts), [local scene API](SCENE_SDK.md), [general addon guide](ADDONS_AI_GUIDE.md).

## One entity, many registered panoramic cameras

A project now contains one `worldSpace` record: `{version:1,units,cameras,objects,geometry,occlusion}`. Objects are stored once by ID. The renderer creates a temporary instance referring to that ID; camera switching changes its view transform, not its persistent position. Local anchors still belong to their `panoId` and appear in their own panorama only. A local ID and world ID belong to separate namespaces.

Camera registration is explicit. An unregistered panorama displays its existing local anchors, but no world objects. Reading its transform or raycasting its world view rejects `CAMERA_UNREGISTERED`. Panorama photos, 2D plan markers, heading metadata and an imported dollhouse do not automatically prove a calibrated capture pose.

## Coordinates, units, orientation and FOV

The world is right-handed: +X right, +Y up, -Z forward. Default units are arbitrary `scene-units`; `meters` and `model-units` are labels for data that the provider has calibrated. Changing the units label does **not** rescale anything. All registrations and geometry must use the same scale and coordinate convention.

Camera registration:

```js
await api.tour.world.setCameraTransform('camera-a', {
  position: {x:0,y:1.6,z:0},
  rotation: {x:0,y:0,z:0,w:1}, // quaternion: panorama-local -> world
  fov:75 // vertical degrees
});
```

Position is the physical capture point. Quaternion maps the existing PALACE panoramic viewer's local axes into world axes, not raw image UV coordinates. At viewer yaw/pitch/roll zero, -Z is the viewer's forward ray. Register the orientation of that ray in the room; account for any calibration already used by the photo provider. Nonzero quaternions are normalized; zero/nonfinite quaternions reject. Quaternions q and -q describe the same orientation.

`Pworld = Qcapture * Plocal + Pcapture`. The renderer applies its inverse to all world geometry/objects before using the unchanged local viewer camera. Local yaw/pitch/roll then rotate the view. Local SDK camera translation, when supported by SDK 1.5, is an offset from the registered capture point. `tour.camera.getPose().position` remains **local**; it is not changed to world coordinates. Use conversion methods below. This preserves existing anchors, projections and playback.

Registered FOV is the baseline used when selecting that camera. `tour.pose`, `tour.camera.setPose` and mouse/gesture zoom continue to change live FOV. Perspective uses the same Three.js camera and current viewport aspect ratio as the panorama. World coordinates never change when FOV, yaw or viewport changes. Smaller distance produces a larger rendered object.

## API contract

Every method in the following tables returns a Promise. Errors reject rather than return fabricated spatial data. Event factories return subscriptions synchronously.

| Method | Input → output | Permission |
| --- | --- | --- |
| `tour.world.getCameraTransform(panoId?)` | Existing registered panorama → `{panoId,position,rotation,fov}` clone; defaults active. | scene.read |
| `tour.world.setCameraTransform(panoId,input)` | Position required for initial registration; subsequent patches may change position, quaternion and/or FOV. Complete normalized transform returned. | scene.write |
| `tour.world.removeCameraTransform(panoId)` | Boolean; leaves global objects intact. | scene.write |
| `tour.world.listCameras()` | Registered camera transform array; excludes unregistered cameras. | scene.read |
| `tour.world.getInfo()` | `{units,handedness,axes,registered,panoId,occlusion,effectiveOcclusion,selectedObjectId,objectCount,cameraCount}`. | scene.read |
| `tour.world.configure(input)` | `{units?,geometry?}` → WorldInfo. `geometry:null` removes shared geometry and resets Geometry mode to none. | scene.write |
| `tour.world.localToWorld(position,panoId?)` | Panorama-local XYZ → world XYZ. | scene.read |
| `tour.world.worldToLocal(position,panoId?)` | World XYZ → panorama-local XYZ. | scene.read |
| `tour.world.project(position)` | World XYZ → normalized `{panoId,x,y,depth,visible,occluded}` for active view. | scene.read |
| `tour.world.raycast(input)` | Active registered view → hit record described below. | scene.read |

Conversion/projection/raycast methods need an initialized ready panorama renderer. For inactive-camera conversion, select any view first; conversion still uses the specified camera registration. Raycast only accepts the **active** panorama: explicitly `await tour.select(id)` and `await tour.waitForPanoramaReady(id)` first. An inactive raycast rejects `PANORAMA_NOT_ACTIVE`; it does not silently navigate. Data-only CRUD/registration/info do not require a renderer.

`scene.write` operations require Edit mode, including camera registration and changing occlusion. Existing permission aliases remain: `tour.read` accepts scene.read/anchors.read; `tour.write` accepts scene.write/anchors.write; `view.control` accepts camera.control.

## Global object CRUD

```js
const object = await api.tour.world.objects.create({
  id:'locus-001', position:{x:2,y:1.2,z:-6},
  rotation:{x:0,y:0,z:0,w:1}, scale:{x:1,y:1,z:1},
  label:'Shared locus', style:{type:'sphere',color:'#ff0000',size:.4},
  metadata:{name:'Locus 1'}
});
```

Complete normalized WorldObject: `{id,type:'world',position,rotation,scale,label,visible,interactive,style,metadata?}`. It has no `panoId`. Passing `panoId` rejects. Rotation is a quaternion; scale is nonuniform XYZ. Style supports **sphere, cube, billboard, sprite, model**, color, size, opacity, optional raster icon and model triangle data. Sphere size is radius, cube size is half-edge. Models use `style.model:{positions,indices?,uvs?}` and `style.size` as mesh scale. Models/cubes have real changed perspective between cameras; billboards intentionally face the current viewer.

| Method | Result | Permission |
| --- | --- | --- |
| `tour.world.objects.create(data)` | Complete WorldObject; ID defaults UUID. | anchors.write |
| `tour.world.objects.update(id,patch)` | Complete updated WorldObject. ID/type/panoId cannot change. Style shallow-merges; XYZ position/scale and quaternion replace as complete values; metadata replaces, null removes. | anchors.write |
| `tour.world.objects.remove(id)` | false if absent, otherwise true; disappears from every camera. | anchors.write |
| `tour.world.objects.get(id)` | Complete clone; missing ID rejects `OBJECT_NOT_FOUND`. | anchors.read |
| `tour.world.objects.list()` | Complete cloned array of all world objects, independent of active view. | anchors.read |

Mutations require Edit mode. Visibility/interactivity false affects rendering/picking. Clicking selects the entity, draws a 3D highlight and emits ObjectClicked. API `update` or the UI's Move selected changes its world position for all cameras. Camera transform changes never modify object coordinates. Objects survive deleting/unregistering a camera and disabling their creating addon.

Limits match local SDK where appropriate: 500 world objects; camera count is variable and limited by serialized project size; positions ±100000; positive XYZ scale `.001..100`; FOV `30..150`; metadata 16384 serialized characters; label 500 characters; style size `.01..100`, opacity `0..1`; model ≤2048 vertices; raster data URLs ≤512 KiB characters, rendered ≤512px. World record ≤8 MiB serialized characters. ID validation and finite JSON rules are unchanged.

## Occlusion and calibrated geometry

`tour.world.occlusion.getMode()` requires scene.read and returns `'geometry'|'depth-map'|'none'`. `setMode(mode)` requires scene.write/Edit mode and returns the validated mode.

- **geometry:** requires registered shared geometry. Real depth testing and intersection checks hide objects behind surfaces. Missing triangles, including a doorway, leave the object visible. If a referenced dollhouse is unavailable, effective mode falls back to none.
- **depth-map:** requires a registered active camera with a depth map from `tour.scene.configure`. Valid depth samples form approximate occluding triangles. Switching to a camera without depth reports `effectiveOcclusion:'none'`; it does not invent its walls.
- **none:** no automatic blocking by real room surfaces. World objects still depth-test against each other in a separate render pass; this does not invent physical walls. Registered positions alone do not establish physical visibility or identify a doorway.

Existing active-panorama scene geometry/depth can augment occluders when a depth-enabled world mode is active. World object render depth tests and pointer/project intersection tests use the corresponding data. `getInfo().occlusion` is the configured mode; `effectiveOcclusion` reports what the current registered camera can actually use.

Shared geometry input:

```js
await api.tour.world.configure({
  units:'meters',
  geometry:{
    positions:[-5,0,-8, 5,0,-8, 5,3,-8, -5,0,-8, 5,3,-8, -5,3,-8],
    render:'occlusion', // invisible depth-only, or solid
    color:'#777777'
  }
});
await api.tour.world.occlusion.setMode('geometry');
```

Triangle positions are **world** XYZ; optional indices and UVs use SDK 1.5 validation. Maximum 30000 vertices and 180000 triangle indices. Alternative `{source:'dollhouse',origin:{x,y,z},rotation:{x,y,z},render,color}` uses an imported model: source Z-up is converted to Three.js Y-up, then origin/XYZ Euler radians apply **model-to-world** placement. Unlike local scene.configure's capture pose, this world geometry transform is not inverted. Register known camera capture poses in the same world. No automatic extraction of unknown extrinsics is claimed.

Panorama radial depth map convention remains [SCENE_SDK.md](SCENE_SDK.md). Depth is transformed by the registered camera's capture pose; you must align the depth map with that panorama's local rays. Images do not gain measured depth by being registered.

## Raycast and placement

```js
const result = await api.tour.world.raycast({
  panoId:'camera-a', screenX:450, screenY:320,
  distance:10 // optional explicit fallback if no real hit
});
```

`screenX/screenY` are CSS pixels relative to the canvas, not the page. Alternative `screenPosition:{x:.5,y:.5}` uses normalized coordinates; `space:'pixels'` is also supported. Real geometry/depth intersections are searched independently of the chosen display occlusion mode. Nearest hit returns `{hit:true,position:worldXYZ,distance,source:'geometry'|'depth-map',synthetic:false,panoId}`. No hit returns `{hit:false,position:null,distance:null,source:'none',synthetic:false,panoId}`. Explicit fallback distance `.1..400` produces `source:'reference-distance',synthetic:true`. Virtual world objects are not placement surfaces. Results use radial distance from the current viewer camera offset, transformed into the world's frame.

UI: open a local panorama → **World objects** → **Register cameras / geometry**. Settings → World space also exposes camera position/quaternion/FOV, unit label and shared-geometry JSON import. After registering the active camera, choose shape/color/distance and **Place object**, then click the panorama. The controls collapse to allow placement on phones. Surface depth wins when available; otherwise the entered distance is explicitly synthetic. Select an object by clicking it or choosing it from the list. **Move selected** accepts a new panorama point; **Remove** asks for confirmation and removes the entity everywhere. Escape cancels placement/movement. The World objects control can be hidden/restored through Interface tool visibility.

## Events and cleanup

`tour.world.onCameraChanged`, `onObjectCreated`, `onObjectUpdated`, `onObjectRemoved`, `onObjectClicked` each return `{ready:Promise<{id,event}>,dispose()}`. Await ready before triggering actions. Maximum 60 world subscriptions/addon. World event subscriptions are separate from existing local scene subscriptions.

CameraChanged needs camera.control: `{panoId,camera:PanoramaCamera|null,active,reason:'registration'|'unregister'|'view',pose?}`. Camera may be null for an unregistered active panorama. The pose uses existing **local** SDK semantics; camera is the registered capture transform. Object events need anchors.read: `{objectId,object,panoId,position?}`; position on click is the world-space intersection. Removed includes the last saved object. Callbacks may catch their own errors; uncaught callback errors use existing sandbox error handling. Dispose removes the listener and host registration. Addon shutdown destroys subscriptions but keeps project entities.

## Persistence, compatibility and errors

World space participates in project Save/export, import, local autosave, Undo/Redo and Change history. Malformed world data is validated before importing a palace, preserving the previous project on failure. Old projects without worldSpace load an empty unregistered world; SDK 1.5 local anchors continue to render. Panorama removal only removes its registration and panorama-local data, not shared objects.

New error codes: `CAMERA_UNREGISTERED`, `OBJECT_NOT_FOUND`, `OBJECT_EXISTS`, `INVALID_WORLD`, `PANORAMA_NOT_ACTIVE`, `DEPTH_UNAVAILABLE`. Existing `PERMISSION_DENIED`, `INVALID_ARGUMENT`, `LIMIT_EXCEEDED`, `GEOMETRY_UNAVAILABLE`, `PANORAMA_NOT_READY` and Edit-mode errors still apply. RPC promises reject with a message prefixed by the code; custom Error.code is not transported. Do not treat synthetic placement as a real measured location. Registration enables cross-camera consistency, not photographic reconstruction, collision avoidance or inferred 6DoF imagery.

## Complete example and regression project

[Example source](docs/addons/world-example/main.js) and [manifest](docs/addons/world-example/manifest.json) implement a command that explicitly registers three user-confirmed demo capture poses, creates **one** world sphere, watches its clicks and provides commands to view it from each registered camera. Do not use these demo transforms for an unrelated real tour.

`test/world-space.cjs` verifies a three-camera world, one persistent entity, quaternion changes, camera-position changes without moving objects, real perspective/FOV, active aspect ratio, occlusion in GPU pixels, door openings, missing-depth fallback, local coexistence, pointer/touch placement and movement, archive reload, Undo/Redo, camera deletion, malformed-import safety, legacy permissions, subscription cleanup and virtual-object depth ordering without physical depth. Desktop, Android, iPhone and iPad profiles run in Chromium; these are emulations, not claims of Safari or physical device testing.

## SDK 1.7: spherical spatial calibration

[CALIBRATION_SDK.md](CALIBRATION_SDK.md) documents the core SfM service, public `tour.world.calibration` API and its worker-based solver. WorldInfo now reports optional `metersPerUnit`; `world.configure` accepts this conversion, and registered native geometry accepts a positive `scale`. Camera-count caps are replaced by the existing serialized-size budget.
