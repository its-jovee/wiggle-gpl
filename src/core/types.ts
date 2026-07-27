// ============================================================================
// core/types.ts — the data model everything depends on.
//
// Design notes (why it's shaped this way):
//  - Strokes store RAW, un-jittered points. Wiggle is applied at RENDER time,
//    never baked into the data.
//  - Color is a real hex string per stroke (Path B / color-native).
//  - durationMs (how long a panel shows) is kept SEPARATE from wiggleFps.
//  - Panels own Layers; Layers can hold strokes, fills, and texts.
//  - Panels also own SubPanels — comic-panel-style frames that clip their
//    contents to a shape (rect / rounded / balloon / thought / burst).
//  - SubPanels may nest: each has its own layers, child subPanels, and stack
//    so drawings and child frames share one local z-order. Children render
//    inside the parent clip.
//  - Panel.stack is the root z-order: layer and sub-panel ids interleaved
//    bottom→top so drawings can sit above or below frames. Entities stay in
//    `layers` / `subPanels`; the stack only orders them.
//  - Animations (enter/exit) live on Panel, SubPanel, and TextElement.
//    LayerAnimation is separate: it is a render-time transform for layer
//    motion, not an edit to stored stroke geometry.
// ============================================================================

import type { AudioProject } from "./audioTypes";
import { newAudioProject } from "./audioTypes";
import {
  assertValidProject,
  capProjectBrushSettings,
  capProjectDrawingSettings,
  capProjectFillLimits,
} from "./projectValidation";
import { DEFAULT_STROKE_SMOOTHING, normalizeStrokeSmoothingSettings } from "./strokeSmoothing";

export type Vec2 = { x: number; y: number };

/** Serializable clip region for bucket fills (stored on Fill, not editor UI). */
export type SelectionShape =
  | { kind: "rect"; x: number; y: number; w: number; h: number }
  | { kind: "ellipse"; cx: number; cy: number; rx: number; ry: number }
  | { kind: "polygon"; points: Vec2[] };

// ---- Animations ------------------------------------------------------------

export type AnimationKind = "none" | "pop" | "fade" | "jump" | "squeeze";

export type AnimationSpec = {
  kind: AnimationKind;
  durationTicks: number; // measured in project.wiggleFps ticks; 4 = 0.5s @ 8fps
  startTick?: number;    // when the anim starts within the parent's local time.
                         // Default: enter=0, exit=(parentDurationTicks - durationTicks).
};

export const NONE_ANIM: AnimationSpec = { kind: "none", durationTicks: 4 };

export type FadeSpec = {
  durationTicks: number;
  startTick?: number;
};

export type PanelTransition = {
  kind: "crossfade";
  durationTicks: number;
};

export type EasingKind = "linear" | "easeIn" | "easeOut" | "easeInOut";
export type LayerLoopKind = "none" | "repeat" | "pingpong";

export type LayerAnimTransform = {
  x: number;
  y: number;
  opacity: number;
  scale: number;
  rotation: number;
};

export type LayerAnimation = {
  enabled: boolean;
  startTick: number;
  durationTicks: number;
  from: LayerAnimTransform;
  to: LayerAnimTransform;
  easing: EasingKind;
  loop?: LayerLoopKind;
};

/**
 * Render-time pixel warp for raster / tone layers. Stored bitmaps stay static;
 * faux movement is applied during renderPanel from seeded noise, like stroke
 * jitter. Independent of LayerAnimation transforms.
 */
export type LayerNoiseDisplace = {
  enabled: boolean;
  /** Max cell offset in px (typical 2–16). */
  amplitude: number;
  /** Grid cell size in px — smaller = finer waves. */
  cellSize: number;
  /** Multiplier on wiggle tick for how fast the field evolves. */
  speed: number;
};

// ---- Strokes / Fills / Text -----------------------------------------------

export type Stroke = {
  brush: string;
  color: string;
  /** Paint this stroke by removing pixels instead of adding color. This keeps
   *  erasing independent of the brush registry, so any brush can be used as
   *  an eraser while preserving its stamp shape, spacing, and pressure. */
  erase?: boolean;
  size: number;
  brushSettings?: BrushSettings;
  points: Vec2[];
  /** Per-point pen pressure in [0, 1]. Parallel to `points`. Optional for
   *  back-compat with strokes drawn before pressure support; treated as 1. */
  pressures?: number[];
};

export type BrushSettings = {
  spacingScale: number;
  flow: number;
  pressureSize: boolean;
  pressureFlow: boolean;
};

export type BrushPreset = {
  id: string;
  name: string;
  brush: string;
  size: number;
  settings: BrushSettings;
};

export type StrokeSmoothingMode = "off" | "weighted" | "stabilizer";

export type StrokeSmoothingSettings = {
  mode: StrokeSmoothingMode;
  distance: number;
  delayDistance: number;
  finishStabilizedStroke: boolean;
  smoothPressure: boolean;
};

export type DrawingSettings = {
  smoothing: StrokeSmoothingSettings;
};

export type Fill = {
  point: Vec2;
  color: string;
  seed: number;
  afterStrokeIndex: number;
  tolerance?: number;
  gapClosePx?: number;
  referenceMode?: "activeLayer" | "visibleStrokes";
  /** When set, flood fill is intersected with this shape at render time. */
  clipShape?: SelectionShape;
  clipInverted?: boolean;
  /** Optional drag-defined color gradient inside the flood-filled region. */
  gradient?: {
    kind: "linear" | "radial";
    start: Vec2;
    end: Vec2;
    endColor: string;
  };
};

export type LayerBlendMode =
  | "normal"
  | "multiply"
  | "screen"
  | "overlay"
  | "darken"
  | "lighten"
  | "color-dodge"
  | "color-burn"
  | "hard-light"
  | "soft-light"
  | "difference";

export type LayerMask = {
  enabled: boolean;
  mode: "reveal" | "hide";
  shape: SelectionShape;
};

export type TextElement = {
  id: string;
  x: number;
  y: number;
  content: string;
  fontFamily: string;
  fontSize: number;
  color: string;
  wiggleAmplitude: number;
  /** Rotation in radians around (x, y). Default 0. */
  rotation?: number;
  enter?: AnimationSpec;
  exit?: AnimationSpec;
};

export type ToneStyle = "halftone" | "hatch" | "crosshatch";

/** Saved settings for a static, rasterized manga texture layer. */
export type ToneSettings = {
  style: ToneStyle;
  color: string;
  spacing: number;
  size: number;
  angle: number;
  /** "full": legacy whole-canvas texture. "painted": strokes reveal the
   *  pattern as a mask (source-in composite) — the manga-correct paintable tone. */
  coverage: "full" | "painted";
  /** Optional density fade applied to the generated tone pattern. */
  gradient?: {
    kind: "linear" | "radial";
    start: Vec2;
    end: Vec2;
    reverse?: boolean;
  };
};

export type LayerKind = "draw" | "text" | "tone" | "raster";

/** A 1x1 fully-transparent PNG, used to seed a brand-new raster layer. */
export const EMPTY_RASTER_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

export type Layer = {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  blendMode?: LayerBlendMode;
  mask?: LayerMask;
  kind?: LayerKind;
  /** Present on dedicated tone layers. It is rasterized during render, never wiggled. */
  tone?: ToneSettings;
  /** Present on raster layers. `data` is a PNG data URL persisted in project JSON;
   *  the live pixels are held in `core/rasterStore.ts`, keyed by layer.id. */
  raster?: { data: string; width: number; height: number };
  clipToBelow?: boolean;
  /** Independent opacity envelopes for a drawing/layer. These compose with
   *  the layer's static opacity and transform animation at render time. */
  fadeIn?: FadeSpec;
  fadeOut?: FadeSpec;
  animation?: LayerAnimation;
  /** Optional noise-displacement wiggle for raster / tone layers only. */
  noiseDisplace?: LayerNoiseDisplace;
  strokes: Stroke[];
  fills: Fill[];
  texts?: TextElement[];
};

// ---- SubPanels (comic frames) ----------------------------------------------

export type SubPanelShape = "rect" | "rounded" | "balloon" | "thought" | "burst" | "custom";

export type SubPanelBorder = {
  brush: string;
  color: string;
  thickness: number;
  wiggleAmplitude: number;
};

export type SubPanel = {
  id: string;
  bounds: { x: number; y: number; w: number; h: number };
  shape: SubPanelShape;
  /** Closed outline for `shape: "custom"` (from Cut Subpanel). Ignored otherwise. */
  points?: Vec2[];
  tail?: Vec2;
  border: SubPanelBorder;
  bg: string | null;
  layers: Layer[];
  activeLayerIndex?: number;
  /** Nested comic frames; clipped by this sub-panel's outline at render time. */
  subPanels?: SubPanel[];
  /** Local z-order (bottom→top): this frame's layers + child sub-panels. */
  stack?: PanelStackItem[];
  enter?: AnimationSpec;
  exit?: AnimationSpec;
};

// ---- Perspective guides -----------------------------------------------------

export type PerspectiveGuideKind = "grid" | "1p" | "2p" | "3p" | "fisheye";

/** CSP-style perspective ruler: editor-only overlay + optional stroke snapping.
 *  Never rendered by renderPanel, so exports and thumbnails stay clean. */
export type PerspectiveGuide = {
  id: string;
  kind: PerspectiveGuideKind;
  /** Horizon line Y in canvas coords. */
  horizonY: number;
  /** Vanishing points in canvas coords — may lie far outside the frame.
   *  grid: 0, 1p: 1, 2p: 2, 3p: 3, fisheye: 1 (the lens center). */
  vps: Vec2[];
  /** Fisheye lens radius in canvas px (fisheye kind only). */
  radius?: number;
  /** Fisheye lens rotation in radians (fisheye kind only). The four rim poles
   *  sit at rotation + k·90°; the curvilinear grid tilts with them. */
  rotation?: number;
  /** When set, the ruler belongs to that layer: it only snaps strokes and
   *  shows its overlay while that layer is active. Unset = all layers. */
  layerId?: string | null;
  /** Overlay visible. */
  enabled: boolean;
  /** Freehand strokes snap onto guide lines through their start point. */
  snapEnabled: boolean;
  /** Overlay opacity 0..1. */
  opacity: number;
};

export function newPerspectiveGuide(
  kind: PerspectiveGuideKind,
  width: number,
  height: number,
  layerId?: string | null
): PerspectiveGuide {
  const hy = height / 2;
  const vps: Vec2[] =
    kind === "grid" ? []
    : kind === "1p" || kind === "fisheye" ? [{ x: width / 2, y: hy }]
    : kind === "2p" ? [{ x: -width * 0.35, y: hy }, { x: width * 1.35, y: hy }]
    : [{ x: -width * 0.35, y: hy }, { x: width * 1.35, y: hy }, { x: width / 2, y: height * 1.8 }];
  return {
    id: crypto.randomUUID(),
    kind,
    horizonY: hy,
    vps,
    ...(kind === "fisheye" ? { radius: Math.min(width, height) * 0.48, rotation: 0 } : {}),
    ...(layerId ? { layerId } : {}),
    enabled: true,
    snapEnabled: true,
    opacity: 0.35,
  };
}

// ---- Reference images (editor-only board overlays) -------------------------

/** PNG/JPEG dropped onto the infinite board as a non-exporting reference.
 *  Position is relative to this project's export-frame origin so moving the
 *  library card keeps refs attached. Never drawn by renderPanel / export. */
export type ReferenceImage = {
  id: string;
  name: string;
  /** PNG data URL (JPEG is converted on import, matching raster layers). */
  data: string;
  /** Intrinsic pixel size of `data`. */
  width: number;
  height: number;
  /** Top-left relative to this project's export frame origin. */
  x: number;
  y: number;
  /** Display scale in world space (1 = 1 source pixel = 1 world unit). */
  scale: number;
  /** Overlay opacity 0..1. */
  opacity: number;
  visible: boolean;
};

export function newReferenceImage(
  name: string,
  data: string,
  width: number,
  height: number,
  x: number,
  y: number,
  scale = 1
): ReferenceImage {
  return {
    id: crypto.randomUUID(),
    name,
    data,
    width,
    height,
    x,
    y,
    scale,
    opacity: 1,
    visible: true,
  };
}

// ---- Panel / Project -------------------------------------------------------

export type PanelKind = "normal" | "timelapse";

/** Root composite order entry — layer and sub-panel ids may interleave. */
export type PanelStackItem =
  | { kind: "layer"; id: string }
  | { kind: "subpanel"; id: string };

export type Panel = {
  id: string;
  durationMs: number;
  /** Editor-only dialogue, narration, or sequencing note for this frame. */
  annotation?: string;
  bg: string;
  paletteId: string | null;
  layers: Layer[];
  activeLayerIndex?: number;
  kind?: PanelKind;
  timelapse?: { sourceId: string };
  subPanels?: SubPanel[];
  /** Root composite order (bottom→top). Layer and sub-panel ids may interleave.
   *  Absent stacks resolve to [...layers, ...subPanels]. */
  stack?: PanelStackItem[];
  guides?: PerspectiveGuide[];
  enter?: AnimationSpec;
  exit?: AnimationSpec;
  /** Overlap transition owned by this panel and leading into the next
   *  expanded timeline entry. It does not change either panel's exposure. */
  transitionToNext?: PanelTransition;
};

/** Contiguous run of panels played repeat times during sequence playback. */
export type FrameGroup = {
  id: string;
  panelIds: string[];
  repeat: number;
};

export type Project = {
  version: 13;
  width: number;
  height: number;
  wiggleFps: number;
  panels: Panel[];
  brushPresets: BrushPreset[];
  drawingSettings: DrawingSettings;
  groups?: FrameGroup[];
  audio?: AudioProject;
  /** Editor-only board overlays. Omitted/empty on older saves. */
  referenceImages?: ReferenceImage[];
};

export const TIKTOK_WIDTH = 1080;
export const TIKTOK_HEIGHT = 1920;

// ---- Constructors ----------------------------------------------------------

export function newProject(width = TIKTOK_WIDTH, height = TIKTOK_HEIGHT): Project {
  return {
    version: 13,
    width,
    height,
    wiggleFps: 8,
    panels: [newPanel()],
    brushPresets: [],
    drawingSettings: newDrawingSettings(),
    referenceImages: [],
    audio: newAudioProject(),
  };
}

/** True when a project still looks like an untouched quick-start canvas:
 *  one empty draw panel, no presets/audio/groups. Used to drop unused
 *  Untitled library records when the user opens or creates something else. */
export function isBlankQuickStartProject(project: Project): boolean {
  if (project.brushPresets.length > 0) return false;
  if ((project.groups?.length ?? 0) > 0) return false;
  if ((project.referenceImages?.length ?? 0) > 0) return false;
  const audio = project.audio;
  if (audio && (audio.assets.length > 0 || audio.tracks.some((track) => track.clips.length > 0))) {
    return false;
  }
  if (project.panels.length !== 1) return false;
  const panel = project.panels[0];
  if ((panel.subPanels?.length ?? 0) > 0) return false;
  if (panel.layers.length !== 1) return false;
  const layer = panel.layers[0];
  if ((layer.kind ?? "draw") !== "draw") return false;
  if (layer.strokes.length || layer.fills.length || (layer.texts?.length ?? 0)) return false;
  return true;
}

export function newDrawingSettings(): DrawingSettings {
  return {
    smoothing: { ...DEFAULT_STROKE_SMOOTHING },
  };
}

export function newPanel(): Panel {
  const layer = newLayer("Layer 1");
  return {
    id: crypto.randomUUID(),
    durationMs: 1000,
    bg: "#ffffff",
    paletteId: null,
    layers: [layer],
    activeLayerIndex: 0,
    kind: "normal",
    subPanels: [],
    stack: [{ kind: "layer", id: layer.id }],
  };
}

export function newLayer(
  name = "Layer",
  kind: LayerKind = "draw",
  dims?: { width: number; height: number }
): Layer {
  return {
    id: crypto.randomUUID(),
    name,
    visible: true,
    opacity: 1,
    blendMode: "normal",
    kind,
    tone: kind === "tone" ? {
      style: "halftone", color: "#202020", spacing: 18, size: 5, angle: 45,
      coverage: "painted",
    } : undefined,
    raster: kind === "raster" ? {
      data: EMPTY_RASTER_DATA_URL,
      width: dims?.width ?? TIKTOK_WIDTH,
      height: dims?.height ?? TIKTOK_HEIGHT,
    } : undefined,
    strokes: [],
    fills: [],
    texts: kind === "text" ? [] : undefined,
  };
}

export function newSubPanel(
  bounds: { x: number; y: number; w: number; h: number },
  border: SubPanelBorder
): SubPanel {
  const layer = newLayer("Layer 1");
  return {
    id: crypto.randomUUID(),
    bounds,
    shape: "rect",
    border,
    bg: null,
    layers: [layer],
    activeLayerIndex: 0,
    subPanels: [],
    stack: [{ kind: "layer", id: layer.id }],
  };
}

// ---- Migration -------------------------------------------------------------

/** Loads any prior version (v1–v12) and returns a v13 project. */
export function migrateProject(raw: unknown): Project {
  if (!raw || typeof raw !== "object") throw new Error("not a project");
  const p = raw as Record<string, unknown>;
  const project = p.version === 13
    ? normalizeV13(raw as Project)
    : p.version === 12
      ? migrateV12toV13(normalizeV12(raw as V12Project))
      : p.version === 11
        ? migrateV12toV13(migrateV11toV12(normalizeV11(raw as V11Project)))
        : p.version === 10
          ? migrateV12toV13(migrateV11toV12(migrateV10toV11(normalizeV10(raw as V10Project))))
          : p.version === 9
            ? migrateV12toV13(migrateV11toV12(migrateV10toV11(migrateV9toV10(normalizeV9(raw as V9Project)))))
            : migrateV12toV13(migrateV11toV12(migrateV10toV11(migrateV9toV10(migrateV8toV9(migrateLegacyToV8(p))))));
  capProjectFillLimits(project);
  capProjectBrushSettings(project);
  capProjectDrawingSettings(project);
  assertValidProject(project);
  return project;
}

type V1Panel = {
  id: string; durationMs: number; bg: string; paletteId: string | null;
  strokes?: Stroke[]; fills?: Fill[];
};
type V2Layer = { id: string; name: string; visible: boolean; opacity: number;
  strokes: Stroke[]; fills: Fill[]; };
type V2Panel = {
  id: string; durationMs: number; bg: string; paletteId: string | null;
  layers: V2Layer[]; activeLayerIndex?: number; kind?: PanelKind;
  timelapse?: { sourceId: string };
};
type V2Project = {
  version: 2; width: number; height: number; wiggleFps: number; panels: V2Panel[];
};
type V3Layer = V2Layer & { kind?: LayerKind; texts?: TextElement[] };
type V3SubPanel = Omit<SubPanel, "layers"> & { layers: V3Layer[] };
type V3Panel = Omit<V2Panel, "layers"> & {
  layers: V3Layer[];
  subPanels?: V3SubPanel[];
  enter?: AnimationSpec;
  exit?: AnimationSpec;
};
type V3Project = {
  version: 3; width: number; height: number; wiggleFps: number; panels: V3Panel[];
};
type V4Project = Omit<Project, "version" | "audio" | "brushPresets" | "drawingSettings"> & {
  version: 4;
  audio?: AudioProject;
};
type V5Project = Omit<Project, "version" | "brushPresets" | "drawingSettings"> & { version: 5 };
type V6Project = Omit<Project, "version" | "brushPresets" | "drawingSettings"> & { version: 6 };
type V7Project = Omit<Project, "version" | "brushPresets" | "drawingSettings"> & { version: 7; brushPresets?: BrushPreset[] };
type V8Project = Omit<Project, "version"> & { version: 8 };
type V9Project = Omit<Project, "version"> & { version: 9 };
type V10Project = Omit<Project, "version"> & { version: 10 };
/** v11: Panel.stack, flat SubPanels (no nested subPanels/stack on frames). */
type V11SubPanel = {
  id: string;
  bounds: { x: number; y: number; w: number; h: number };
  shape: SubPanelShape;
  points?: Vec2[];
  tail?: Vec2;
  border: SubPanelBorder;
  bg: string | null;
  layers: Layer[];
  activeLayerIndex?: number;
  enter?: AnimationSpec;
  exit?: AnimationSpec;
};
type V11Panel = {
  id: string;
  durationMs: number;
  annotation?: string;
  bg: string;
  paletteId: string | null;
  layers: Layer[];
  activeLayerIndex?: number;
  kind?: PanelKind;
  timelapse?: { sourceId: string };
  subPanels?: V11SubPanel[];
  stack?: PanelStackItem[];
  guides?: PerspectiveGuide[];
  enter?: AnimationSpec;
  exit?: AnimationSpec;
  transitionToNext?: PanelTransition;
};
type V11Project = {
  version: 11;
  width: number;
  height: number;
  wiggleFps: number;
  panels: V11Panel[];
  brushPresets: BrushPreset[];
  drawingSettings: DrawingSettings;
  groups?: FrameGroup[];
  audio?: AudioProject;
};
/** v12: nested SubPanels; no referenceImages. */
type V12Project = {
  version: 12;
  width: number;
  height: number;
  wiggleFps: number;
  panels: Panel[];
  brushPresets: BrushPreset[];
  drawingSettings: DrawingSettings;
  groups?: FrameGroup[];
  audio?: AudioProject;
};

function migrateLegacyToV8(p: Record<string, unknown>): V8Project {
  if (p.version === 8) return p as V8Project;
  if (p.version === 7) return migrateV7toV8(p as V7Project);
  if (p.version === 6) return migrateV7toV8(migrateV6toV7(p as V6Project));
  if (p.version === 5) return migrateV7toV8(migrateV6toV7(migrateV5toV6(p as V5Project)));
  if (p.version === 4) return migrateV7toV8(migrateV6toV7(migrateV5toV6(migrateV4toV5(p as V4Project))));
  if (p.version === 3) return migrateV7toV8(migrateV6toV7(migrateV5toV6(migrateV4toV5(migrateV3toV4(p as V3Project)))));
  if (p.version === 2) {
    const v3 = migrateV2toV3(p as V2Project);
    return migrateV7toV8(migrateV6toV7(migrateV5toV6(migrateV4toV5(migrateV3toV4(v3)))));
  }
  if (p.version === 1) {
    const v2 = migrateV1toV2(p);
    const v3 = migrateV2toV3(v2);
    return migrateV7toV8(migrateV6toV7(migrateV5toV6(migrateV4toV5(migrateV3toV4(v3)))));
  }
  throw new Error("unknown project version");
}

function migrateV1toV2(p: Record<string, unknown>): V2Project {
  const panels = ((p.panels as V1Panel[]) ?? []).map((pp) => ({
    id: pp.id ?? crypto.randomUUID(),
    durationMs: pp.durationMs ?? 1000,
    bg: pp.bg ?? "#1a1a2e",
    paletteId: pp.paletteId ?? null,
    layers: [{
      id: crypto.randomUUID(),
      name: "Layer 1",
      visible: true,
      opacity: 1,
      strokes: pp.strokes ?? [],
      fills: pp.fills ?? [],
    }],
    activeLayerIndex: 0,
    kind: "normal" as PanelKind,
  }));
  return {
    version: 2,
    width: (p.width as number) ?? TIKTOK_WIDTH,
    height: (p.height as number) ?? TIKTOK_HEIGHT,
    wiggleFps: (p.wiggleFps as number) ?? 8,
    panels,
  };
}

function migrateV2toV3(p: V2Project): V3Project {
  return {
    version: 3,
    width: p.width,
    height: p.height,
    wiggleFps: p.wiggleFps,
    panels: p.panels.map((pp) => ({
      ...pp,
      layers: pp.layers.map((l) => ({ ...l, kind: "draw" as LayerKind })),
      subPanels: [],
    })),
  };
}

function migrateV3toV4(p: V3Project): V4Project {
  const migrateLayer = (l: V3Layer): Layer => ({
    ...l,
    clipToBelow: false,
  });
  return {
    version: 4,
    width: p.width,
    height: p.height,
    wiggleFps: p.wiggleFps,
    panels: p.panels.map((pp) => ({
      ...pp,
      layers: pp.layers.map(migrateLayer),
      subPanels: (pp.subPanels ?? []).map((sp) => ({
        ...sp,
        layers: sp.layers.map(migrateLayer),
      })),
    })),
  };
}

function migrateV4toV5(p: V4Project): V5Project {
  return {
    ...p,
    version: 5,
    audio: p.audio ?? newAudioProject(),
  };
}

function migrateV5toV6(p: V5Project): V6Project {
  // v6 adds optional Panel.guides (perspective rulers) — nothing to backfill.
  return { ...p, version: 6 };
}

function normalizeLayerV7(layer: Layer): Layer {
  return {
    ...layer,
    blendMode: layer.blendMode ?? "normal",
  };
}

function normalizeV7(p: V7Project): V7Project {
  return {
    ...p,
    version: 7,
    audio: p.audio ?? newAudioProject(),
    panels: p.panels.map((panel) => ({
      ...panel,
      layers: panel.layers.map(normalizeLayerV7),
      subPanels: (panel.subPanels ?? []).map((sp) => ({
        ...sp,
        layers: sp.layers.map(normalizeLayerV7),
      })),
    })),
  };
}

function migrateV6toV7(p: V6Project): V7Project {
  return normalizeV7({ ...p, version: 7 });
}

function normalizeV9(p: V9Project): V9Project {
  return {
    ...p,
    version: 9,
    audio: p.audio ?? newAudioProject(),
    brushPresets: p.brushPresets ?? [],
    drawingSettings: {
      ...newDrawingSettings(),
      ...(p.drawingSettings ?? {}),
      smoothing: normalizeStrokeSmoothingSettings(p.drawingSettings?.smoothing),
    },
    panels: p.panels.map((panel) => ({
      ...panel,
      layers: panel.layers.map(normalizeLayerV7),
      subPanels: (panel.subPanels ?? []).map((sp) => ({
        ...sp,
        layers: sp.layers.map(normalizeLayerV7),
      })),
    })),
  };
}

function normalizeV8(p: V8Project): V8Project {
  return {
    ...p,
    version: 8,
    audio: p.audio ?? newAudioProject(),
    brushPresets: p.brushPresets ?? [],
    drawingSettings: {
      ...newDrawingSettings(),
      ...(p.drawingSettings ?? {}),
      smoothing: normalizeStrokeSmoothingSettings(p.drawingSettings?.smoothing),
    },
    panels: p.panels.map((panel) => ({
      ...panel,
      layers: panel.layers.map(normalizeLayerV7),
      subPanels: (panel.subPanels ?? []).map((sp) => ({
        ...sp,
        layers: sp.layers.map(normalizeLayerV7),
      })),
    })),
  };
}

function migrateV7toV8(p: V7Project): V8Project {
  return normalizeV8({
    ...p,
    version: 8,
    brushPresets: p.brushPresets ?? [],
    drawingSettings: newDrawingSettings(),
  });
}

function migrateV8toV9(p: V8Project): V9Project {
  return normalizeV9({ ...p, version: 9 } as V9Project);
}

function tonizeLayerV10(layer: Layer): Layer {
  if (layer.kind !== "tone" || !layer.tone) return layer;
  if (layer.tone.coverage === "full" || layer.tone.coverage === "painted") return layer;
  return { ...layer, tone: { ...layer.tone, coverage: "full" } };
}

/** v9 tone layers were always full-bleed; existing ones keep that look. */
function migrateV9toV10(p: V9Project): V10Project {
  return normalizeV10({
    ...p,
    version: 10,
    panels: p.panels.map((panel) => ({
      ...panel,
      layers: panel.layers.map(tonizeLayerV10),
      subPanels: (panel.subPanels ?? []).map((sp) => ({
        ...sp,
        layers: sp.layers.map(tonizeLayerV10),
      })),
    })),
  });
}

function normalizeV10(p: V10Project): V10Project {
  return {
    ...p,
    version: 10,
    audio: p.audio ?? newAudioProject(),
    brushPresets: p.brushPresets ?? [],
    drawingSettings: {
      ...newDrawingSettings(),
      ...(p.drawingSettings ?? {}),
      smoothing: normalizeStrokeSmoothingSettings(p.drawingSettings?.smoothing),
    },
    panels: p.panels.map((panel) => ({
      ...panel,
      layers: panel.layers.map(normalizeLayerV7).map(tonizeLayerV10),
      subPanels: (panel.subPanels ?? []).map((sp) => ({
        ...sp,
        layers: sp.layers.map(normalizeLayerV7).map(tonizeLayerV10),
      })),
    })),
  };
}

/** v11 adds Panel.stack so root layers and sub-panels share one z-order. */
function migrateV10toV11(p: V10Project): V11Project {
  return normalizeV11({
    ...p,
    version: 11,
    panels: p.panels.map((panel) => ({
      ...panel,
      stack: panel.stack ?? [
        ...panel.layers.map((l) => ({ kind: "layer" as const, id: l.id })),
        ...(panel.subPanels ?? []).map((sp) => ({ kind: "subpanel" as const, id: sp.id })),
      ],
    })),
  });
}

function normalizeSubPanelV12(sp: SubPanel): SubPanel {
  const layers = sp.layers.map(normalizeLayerV7).map(tonizeLayerV10);
  const subPanels = (sp.subPanels ?? []).map(normalizeSubPanelV12);
  return {
    ...sp,
    layers,
    subPanels,
    stack: sp.stack ?? [
      ...layers.map((l) => ({ kind: "layer" as const, id: l.id })),
      ...subPanels.map((child) => ({ kind: "subpanel" as const, id: child.id })),
    ],
  };
}

/** v12: SubPanels may nest (child frames + local stack). */
function migrateV11toV12(p: V11Project): V12Project {
  return normalizeV12({
    ...p,
    version: 12,
    panels: p.panels.map((panel) => ({
      ...panel,
      subPanels: (panel.subPanels ?? []).map((sp) => ({
        ...sp,
        subPanels: [],
        stack: [
          ...sp.layers.map((l) => ({ kind: "layer" as const, id: l.id })),
        ],
      })),
    })),
  });
}

/** v13: project-owned reference images on the infinite board. */
function migrateV12toV13(p: V12Project): Project {
  return normalizeV13({
    ...p,
    version: 13,
    referenceImages: [],
  });
}

function normalizeV11(p: V11Project): V11Project {
  return {
    ...p,
    version: 11,
    audio: p.audio ?? newAudioProject(),
    brushPresets: p.brushPresets ?? [],
    drawingSettings: {
      ...newDrawingSettings(),
      ...(p.drawingSettings ?? {}),
      smoothing: normalizeStrokeSmoothingSettings(p.drawingSettings?.smoothing),
    },
    panels: p.panels.map((panel) => ({
      ...panel,
      layers: panel.layers.map(normalizeLayerV7).map(tonizeLayerV10),
      subPanels: (panel.subPanels ?? []).map((sp) => ({
        ...sp,
        layers: sp.layers.map(normalizeLayerV7).map(tonizeLayerV10),
      })),
      stack: panel.stack ?? [
        ...panel.layers.map((l) => ({ kind: "layer" as const, id: l.id })),
        ...(panel.subPanels ?? []).map((sp) => ({ kind: "subpanel" as const, id: sp.id })),
      ],
    })),
  };
}

function normalizeV12(p: V12Project): V12Project {
  return {
    ...p,
    version: 12,
    audio: p.audio ?? newAudioProject(),
    brushPresets: p.brushPresets ?? [],
    drawingSettings: {
      ...newDrawingSettings(),
      ...(p.drawingSettings ?? {}),
      smoothing: normalizeStrokeSmoothingSettings(p.drawingSettings?.smoothing),
    },
    panels: p.panels.map((panel) => ({
      ...panel,
      layers: panel.layers.map(normalizeLayerV7).map(tonizeLayerV10),
      subPanels: (panel.subPanels ?? []).map(normalizeSubPanelV12),
      stack: panel.stack ?? [
        ...panel.layers.map((l) => ({ kind: "layer" as const, id: l.id })),
        ...(panel.subPanels ?? []).map((sp) => ({ kind: "subpanel" as const, id: sp.id })),
      ],
    })),
  };
}

function normalizeReferenceImage(raw: ReferenceImage): ReferenceImage {
  const scale = Number.isFinite(raw.scale) && raw.scale > 0 ? raw.scale : 1;
  const opacity = Number.isFinite(raw.opacity) ? Math.min(1, Math.max(0, raw.opacity)) : 1;
  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : crypto.randomUUID(),
    name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : "Reference",
    data: typeof raw.data === "string" ? raw.data : "",
    width: Number.isFinite(raw.width) ? raw.width : 1,
    height: Number.isFinite(raw.height) ? raw.height : 1,
    x: Number.isFinite(raw.x) ? raw.x : 0,
    y: Number.isFinite(raw.y) ? raw.y : 0,
    scale,
    opacity,
    visible: raw.visible !== false,
  };
}

function normalizeV13(p: Project): Project {
  const base = normalizeV12({ ...p, version: 12 });
  return {
    ...base,
    version: 13,
    referenceImages: (p.referenceImages ?? []).map(normalizeReferenceImage),
  };
}
