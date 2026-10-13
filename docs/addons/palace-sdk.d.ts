/** PALACE community addon SDK 1.5.0; manifest apiVersion stays 1.
 * Development declarations only. The running API is passed to exports.activate(api).
 * Permission, mode, size and identifier rules are in ADDONS_AI_GUIDE.md.
 */
export interface Point3D { x: number; y: number; z: number; }
export interface GeometryData { positions: number[]; indices?: number[]; uvs?: number[]; }
export interface AnchorStyle { type?: 'sphere' | 'billboard' | 'sprite' | 'model'; color?: string; size?: number; opacity?: number; icon?: string; model?: GeometryData; }
export interface Anchor3D { id: string; panoId: string; position: Point3D; rotation: Point3D; scale: number; label: string; visible: boolean; interactive: boolean; style: AnchorStyle; metadata?: JsonObject; }
export type AnchorInput = Pick<Anchor3D, 'position'> & Partial<Omit<Anchor3D, 'position'>>;
export interface SceneConfiguration { units?: 'scene-units' | 'meters' | 'model-units'; geometry?: (GeometryData | {source: 'dollhouse'; origin: Point3D; rotation?: Point3D}) & {render?: 'solid' | 'occlusion'; color?: string}; depthMap?: {width: number; height: number; data: number[]}; }
export interface CameraPose3D { panoId: string; position: Point3D; yaw: number; pitch: number; roll: number; fov: number; }
export interface CameraAnimation { duration?: number; easing?: 'linear' | 'easeInOut' | 'easeOut'; }
export interface ScreenPosition { x: number; y: number; space?: 'normalized' | 'pixels'; }
export interface SceneInfo { panoId: string; type: 'panorama' | '3d'; coordinateSystem: {units: string; [key: string]: unknown}; hasGeometry: boolean; hasDepthMap: boolean; unregisteredDollhouseAvailable: boolean; capabilities: {anchors: boolean; raycast: boolean; syntheticDistancePlacement: boolean; translation: boolean; occlusion: boolean; styles: string[]}; camera: CameraPose3D; [key: string]: unknown; }
export interface PanoramaReady { panoId: string; ready: boolean; hasImage: boolean; scene: SceneInfo; }
export interface RayHit { panoId: string; position: Point3D; distance: number; synthetic: boolean; source: string; anchorId?: string | null; }
export interface PlaybackStop { panoId: string; anchorId?: string; duration?: number; hold?: number; easing?: CameraAnimation['easing']; pose?: Partial<Pick<CameraPose3D, 'yaw' | 'pitch' | 'roll' | 'fov'>>; }
export interface PlaybackState { status: 'idle' | 'playing' | 'paused' | 'stopped' | 'completed' | 'error'; index: number; phase: string; stops: PlaybackStop[]; loop: boolean; error: string | null; [key: string]: unknown; }
export interface TourSubscription extends Disposable { ready: Promise<{id: string; event: string}>; }
export interface AnchorEvent { panoId: string; anchorId: string; anchor: Anchor3D; [key: string]: unknown; }

export type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;
export interface JsonObject { [key: string]: JsonValue; }
export interface Disposable { dispose(): void; }
export type FloorId = string | number | null;
export interface Point { x: number; y: number; }
export type Layout = 'plan' | 'tour' | 'split' | 'split-rev';
export type PlanView = '2d' | '3d';
export type SettingValue = string | number | boolean;
export type SettingsValues = Record<string, SettingValue>;
export type Permission =
  | 'project.read' | 'metadata.write' | 'markers.write'
  | 'plan.read' | 'plan.write' | 'tour.read' | 'tour.write'
  | 'view.control' | 'ui.control' | 'ui.contribute'
  | 'archive.read' | 'archive.write' | 'keybindings.write'
  | 'scene.read' | 'scene.write' | 'camera.control' | 'anchors.read' | 'anchors.write';

export interface Contribution { id: string; title: string; }
export interface ActivityContribution extends Contribution { command: string; icon?: string; }
export interface ToolbarContribution extends ActivityContribution { location: 'plan' | 'tour' | 'header' | 'status'; }
export type SettingDefinition =
  | { key: string; title: string; description?: string; type: 'boolean'; default?: boolean }
  | { key: string; title: string; description?: string; type: 'string'; default?: string }
  | { key: string; title: string; description?: string; type: 'number'; default?: number; min?: number; max?: number };
export interface AddonManifest {
  id: string; name: string; description?: string; version: string; apiVersion: 1;
  main: string; permissions: Permission[]; engines?: {palace?: string};
  contributes?: {
    commands?: Contribution[]; panels?: Contribution[];
    activityBar?: ActivityContribution[]; toolbars?: ToolbarContribution[];
    settings?: SettingDefinition[];
  };
}

export interface Marker {
  x: number; y: number; note?: string; localPano?: string | null;
  [field: string]: unknown;
}
export interface Wall { x1: number; y1: number; x2: number; y2: number; [field: string]: unknown; }
export interface Destination { panoId: string; room?: string; angleDeg?: number | null; [field: string]: unknown; }
export interface Camera {
  room?: string | null; floorId?: FloorId; planPx?: Point | null;
  destinations?: Destination[]; hidden?: boolean; mode?: string;
  data?: string; mime?: string; file?: string; headingDeg?: number; navYawOffsetDeg?: number;
  [field: string]: unknown;
}
export interface FloorSummary { index: number; name: string; w: number | null; h: number | null; floorId?: FloorId; markers: Marker[]; }
/** Raw floor copy may carry more editor-specific properties and image/part data. */
export interface Floor {
  name: string; w?: number | null; h?: number | null; floorId?: FloorId;
  src?: string | null; markers: Marker[]; walls?: Wall[]; selected?: number | null;
  [field: string]: unknown;
}
export interface ProjectSummary {
  name: string; purpose: string; source: string; explain: string; notes: string;
  active: number; mode: 'edit' | 'view'; levels: FloorSummary[];
  /** An array here; tour.read() instead returns a record keyed by camera ID. */
  panoramas: Array<Pick<Camera, 'room' | 'floorId' | 'planPx' | 'destinations'> & {id: string}>;
}
export type MetadataPatch = Partial<Pick<ProjectSummary, 'name' | 'purpose' | 'source' | 'explain' | 'notes'>>;
export interface ViewState {
  layout: Layout; planView: PlanView; zoom: number; rotation: number;
  activeCamera: string | null; yaw: number; pitch: number; fov: number;
}
export interface ThemeState {
  name: string; background: string; foreground: string; accent: string;
  colorScheme: string; ui: Record<string, string>;
}
export interface Tool { id: string; title: string; owner: string; visible: boolean; }
export interface CommandInfo { id: string; title: string; }
export interface IconThemeInfo { id: string; title: string; active: boolean; }

export type UiColorKey =
  | 'chrome' | 'editor' | 'widget' | 'dialog' | 'border' | 'widgetBorder'
  | 'fg' | 'fgStrong' | 'fgDim' | 'fgMute' | 'input' | 'inputBorder'
  | 'btn' | 'btnHover' | 'btnFg' | 'btn2' | 'btn2Hover' | 'accent' | 'focus' | 'sel'
  | 'status' | 'statusFg' | 'statusItem' | 'statusItemFg' | 'activityFg' | 'activityInactive' | 'hover';
/** Hex colors must be #RRGGBB at runtime. */
export interface ThemeDefinition {
  id: string; title: string; base: string; mode?: 'dark' | 'light';
  colors?: Partial<Record<UiColorKey, string>>;
  canvas?: Partial<Record<'bg' | 'walls', string>>;
}
export interface IconPath { d: string; filled?: boolean; }
export interface IconThemeDefinition { id: string; title: string; icons: Record<string, IconPath[]>; }
export interface AppearanceCatalog { themes?: ThemeDefinition[]; iconThemes?: IconThemeDefinition[]; }
export interface ShapeAttributes {
  x?: number; y?: number; x1?: number; y1?: number; x2?: number; y2?: number;
  width?: number; height?: number; r?: number; cx?: number; cy?: number;
  stroke?: string; fill?: string; opacity?: number;
  'stroke-width'?: number; 'font-size'?: number;
}
export type Shape = ShapeAttributes & ({type: 'circle' | 'rect' | 'line'} | {type: 'text'; text?: string});
export type OverlayInput = {id: string; location: 'plan' | 'tour'; title?: string} &
  ({shapes: Shape[]; remove?: false} | {remove: true});
export interface ArchiveFile { path: string; }
export type Encoding = 'text' | 'base64';
export interface FileContent { path: string; encoding: Encoding; data: string; }
export interface KeybindingInfo { id: string; title: string; key: string; owner: string; }

export interface PalaceSDK {
  readonly version: string;
  commands: {
    register(id: string, handler: (args?: unknown) => unknown | Promise<unknown>): Disposable;
  };
  project: {
    read(): Promise<ProjectSummary>;
    updateMetadata(patch: MetadataPatch): Promise<ProjectSummary>;
  };
  markers: {
    add(input: {level: number; x: number; y: number; note?: string}): Promise<{level: number; index: number}>;
    remove(input: {level: number; index: number}): Promise<true>;
    update(input: {level: number; index: number; patch: Partial<Pick<Marker, 'x' | 'y' | 'note' | 'localPano'>>}): Promise<true>;
  };
  plan: {
    read(level?: number): Promise<Floor>;
    add(input: {src: string; name?: string; floorId?: FloorId}): Promise<number>;
    remove(level: number): Promise<true>;
    rename(input: {level: number; name: string}): Promise<true>;
    select(level: number): Promise<true>;
    move(input: {from: number; to: number}): Promise<true>;
    /** Opens native arrangement. true is not a placement/completion guarantee. */
    merge(input: {from: number; to: number}): Promise<true>;
    split(level: number): Promise<true>;
    /** Display rotation; does not rewrite source image pixels. */
    transform(input: {rotation: number}): Promise<true>;
    walls: {
      add(input: {level: number; x1: number; y1: number; x2: number; y2: number}): Promise<number>;
      remove(input: {level: number; index: number}): Promise<true>;
    };
  };
  view: {
    read(): Promise<ViewState>;
    /** zoom controls the 2D plan; renderer limits/layout adjustments still apply. */
    set(input: {layout?: Layout; planView?: PlanView; zoom?: number}): Promise<ViewState>;
  };
  tour: {
    anchors: {
      create(input: AnchorInput): Promise<Anchor3D>;
      update(id: string, patch: Partial<Omit<Anchor3D, 'id'>>): Promise<Anchor3D>;
      remove(id: string): Promise<boolean>;
      get(id: string): Promise<Anchor3D>;
      list(panoId?: string): Promise<Anchor3D[]>;
      clear(panoId: string): Promise<number>;
    };
    scene: {
      getInfo(panoId?: string): Promise<SceneInfo>;
      configure(panoId: string, input: SceneConfiguration | null): Promise<SceneInfo>;
      raycast(input: {screenPosition?: ScreenPosition; origin?: Point3D; direction?: Point3D; distance?: number; includeAnchors?: boolean}): Promise<RayHit | null>;
      project(position: Point3D): Promise<{x: number; y: number; depth: number; visible: boolean; occluded: boolean; panoId: string}>;
      unproject(screenPosition: ScreenPosition, depth: number): Promise<Point3D>;
    };
    camera: {
      getPose(): Promise<CameraPose3D>;
      setPose(input: Partial<Omit<CameraPose3D, 'panoId'>> & CameraAnimation): Promise<CameraPose3D>;
      lookAt(target: Point3D, options?: CameraAnimation): Promise<CameraPose3D>;
      moveTo(target: {panoId?: string; anchorId?: string; position?: Point3D; pose?: Partial<CameraPose3D>} | Point3D, options?: CameraAnimation): Promise<{pose: CameraPose3D; mode: string; translated: boolean}>;
      focusAnchor(anchorId: string, options?: CameraAnimation): Promise<CameraPose3D>;
      stopAnimation(): Promise<boolean>;
    };
    playback: {
      start(config: {stops: PlaybackStop[]; loop?: boolean}): Promise<PlaybackState>;
      pause(): Promise<PlaybackState>;
      resume(): Promise<PlaybackState>;
      stop(): Promise<PlaybackState>;
      next(): Promise<PlaybackState>;
      previous(): Promise<PlaybackState>;
      getState(): Promise<PlaybackState>;
    };
    waitForPanoramaReady(panoId?: string, options?: {timeout?: number}): Promise<PanoramaReady>;
    onCameraChanged(handler: (pose: CameraPose3D) => void): TourSubscription;
    onPanoramaReady(handler: (event: PanoramaReady) => void): TourSubscription;
    onAnchorClick(handler: (event: AnchorEvent) => void): TourSubscription;
    onAnchorHover(handler: (event: Omit<AnchorEvent, 'anchor'> & {anchor?: Anchor3D; hovered: boolean}) => void): TourSubscription;
    onAnchorMoved(handler: (event: AnchorEvent) => void): TourSubscription;
    onPlaybackChanged(handler: (event: PlaybackState) => void): TourSubscription;

    add(input: {id?: string; level?: number; room?: string; planPx?: Point; src?: string}): Promise<{id: string}>;
    remove(id: string): Promise<true>;
    loadPanorama(input: {id: string; src: string}): Promise<{id: string}>;
    read(): Promise<Record<string, Camera>>;
    /** Selection is requested; image/WebGL readiness is not awaited. */
    select(id: string): Promise<true>;
    pose(input: {yaw?: number; pitch?: number; fov?: number}): Promise<ViewState>;
    update(input: {id: string; patch: {room?: string; hidden?: boolean; headingDeg?: number; navYawOffsetDeg?: number; planPx?: Point | null}}): Promise<true>;
    connect(input: {from: string; to: string; add: boolean}): Promise<boolean>;
    setStart(id: string | null): Promise<true>;
  };
  ui: {
    registerAppearance(input: AppearanceCatalog): Promise<{themes: string[]; iconThemes: string[]}>;
    removeAppearance(): Promise<true>;
    iconThemes(): Promise<IconThemeInfo[]>;
    iconTheme(id: string): Promise<string>;
    tools(): Promise<Tool[]>;
    setToolVisible(id: string, visible: boolean): Promise<true>;
    themes(): Promise<CommandInfo[]>;
    commands(): Promise<CommandInfo[]>;
    /** Dispatches a registry command without awaiting its internal async work. */
    execute(id: string): Promise<true>;
    theme(id: string): Promise<ThemeState>;
    scale(size: 0 | 1 | 2): Promise<0 | 1 | 2>;
    overlay(input: OverlayInput): Promise<true>;
    showMessage(text: string): Promise<true>;
    /** Replaces #panel in this iframe. Bind DOM listeners after awaiting it. */
    showPanel(id: string, html: string): Promise<void>;
  };
  archive: {
    list(): Promise<ArchiveFile[]>;
    read(input: {path: string; encoding?: Encoding}): Promise<FileContent>;
    write(input: FileContent): Promise<boolean>;
    remove(path: string): Promise<boolean>;
    export(): Promise<{name: string; encoding: 'base64'; data: string}>;
    download(): Promise<{name: string}>;
    meta: {
      read(): Promise<JsonObject | null>;
      write(value: JsonObject | null): Promise<boolean>;
    };
  };
  keybindings: {
    register(input: {id: string; command: string; key: string}): Promise<{id: string; key: string}>;
    unregister(id: string): Promise<boolean>;
    list(): Promise<KeybindingInfo[]>;
  };
  theme: {read(): Promise<ThemeState>};
  storage: {
    get<T extends JsonValue = JsonValue>(key: string): Promise<T | null>;
    set(key: string, value: JsonValue): Promise<true>;
  };
  /** Local package resources. Synchronous; not an HTTP/filesystem API. */
  assets: {read(path: string): string};
  settings: {
    read(): Promise<SettingsValues>;
    update(patch: SettingsValues): Promise<SettingsValues>;
  };
  onProjectChanged(handler: (project: ProjectSummary) => void): Disposable;
  onSettingsChanged(handler: (settings: SettingsValues) => void): Disposable;
}

/** Implement with CommonJS exports.activate, not an ESM runtime import. */
export interface PalaceExtension {
  activate(api: PalaceSDK): void | Promise<void>;
  deactivate?(): void;
}
