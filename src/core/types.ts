// ============================================================================
// core/types.ts — the data model everything depends on.
//
// Design notes (why it's shaped this way):
//  - Strokes store RAW, un-jittered points. Wiggle is applied at RENDER time,
//    never baked into the data.
//  - Color is a real hex string per stroke (Path B / color-native).
//  - durationMs (how long a panel shows) is kept SEPARATE from wiggleFps.
//  - Panels own Layers; Layers can hold strokes, fills, and texts.
//  - Panels also own SubPanels — comic-panel-style nested frames that clip
//    their own layers to a shape (rect / rounded / balloon / thought / burst).
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

// ---- Strokes / Fills / Text -----------------------------------------------

export type Stroke = {
  brush: string;
  color: string;
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
  strokes: Stroke[];
  fills: Fill[];
  texts?: TextElement[];
};

// ---- SubPanels (comic frames) ----------------------------------------------

export type SubPanelShape = "rect" | "rounded" | "balloon" | "thought" | "burst";

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
  tail?: Vec2;
  border: SubPanelBorder;
  bg: string | null;
  layers: Layer[];
  activeLayerIndex?: number;
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

// ---- Panel / Project -------------------------------------------------------

export type PanelKind = "normal" | "timelapse";

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
  version: 10;
  width: number;
  height: number;
  wiggleFps: number;
  panels: Panel[];
  brushPresets: BrushPreset[];
  drawingSettings: DrawingSettings;
  groups?: FrameGroup[];
  audio?: AudioProject;
};

export const TIKTOK_WIDTH = 1080;
export const TIKTOK_HEIGHT = 1920;

// ---- Constructors ----------------------------------------------------------

export function newProject(width = TIKTOK_WIDTH, height = TIKTOK_HEIGHT): Project {
  return {
    version: 10,
    width,
    height,
    wiggleFps: 8,
    panels: [newPanel()],
    brushPresets: [],
    drawingSettings: newDrawingSettings(),
    audio: newAudioProject(),
  };
}

export function newDrawingSettings(): DrawingSettings {
  return {
    smoothing: { ...DEFAULT_STROKE_SMOOTHING },
  };
}

export function newPanel(): Panel {
  return {
    id: crypto.randomUUID(),
    durationMs: 1000,
    bg: "#ffffff",
    paletteId: null,
    layers: [newLayer("Layer 1")],
    activeLayerIndex: 0,
    kind: "normal",
    subPanels: [],
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
  return {
    id: crypto.randomUUID(),
    bounds,
    shape: "rect",
    border,
    bg: null,
    layers: [newLayer("Layer 1")],
    activeLayerIndex: 0,
  };
}

// ---- Migration -------------------------------------------------------------

/** Loads any prior version (v1-v9) and returns a v10 project. */
export function migrateProject(raw: unknown): Project {
  if (!raw || typeof raw !== "object") throw new Error("not a project");
  const p = raw as Record<string, unknown>;
  const project = p.version === 10
    ? normalizeV10(raw as Project)
    : p.version === 9
      ? migrateV9toV10(normalizeV9(raw as V9Project))
      : migrateV9toV10(migrateV8toV9(migrateLegacyToV8(p)));
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
function migrateV9toV10(p: V9Project): Project {
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

function normalizeV10(p: Project): Project {
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
