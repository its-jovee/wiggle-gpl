// ============================================================================
// core/projectValidation.ts — guardrails for loaded / migrated projects.
//
// Hard limits reject corrupt or hostile files. Fill tolerance and gap-close
// are capped in place so slightly out-of-range editor values still load.
// ============================================================================

import type { BrushPreset, Fill, Layer, Project, Stroke, SubPanel } from "./types";
import { normalizeBrushSettings } from "./brushSettings";
import { normalizeStrokeSmoothingSettings } from "./strokeSmoothing";

export const MAX_PROJECT_DIMENSION = 4096;
export const MIN_PROJECT_DIMENSION = 1;
export const MAX_PANELS = 200;
export const MAX_PANEL_ANNOTATION_CHARS = 4000;
export const MAX_LAYERS_PER_PANEL = 256;
export const MAX_SUBPANELS_PER_PANEL = 64;
export const MAX_TEXTS_PER_LAYER = 10_000;
export const MAX_STROKES_PER_LAYER = 50_000;
export const MAX_POINTS_PER_STROKE = 20_000;
export const MAX_FILL_TOLERANCE = 64;
export const MAX_FILL_GAP_CLOSE = 64;
/** ~12MB decoded — generous but bounded; guards against corrupt/hostile files. */
export const MAX_RASTER_DATA_CHARS = 16_000_000;

export type ProjectValidationResult =
  | { ok: true }
  | { ok: false; errors: string[] };

function capFill(fill: Fill): Fill {
  const tolerance = fill.tolerance ?? 0;
  const gapClosePx = fill.gapClosePx ?? 0;
  if (tolerance <= MAX_FILL_TOLERANCE && gapClosePx <= MAX_FILL_GAP_CLOSE) return fill;
  return {
    ...fill,
    tolerance: Math.min(Math.max(0, tolerance), MAX_FILL_TOLERANCE),
    gapClosePx: Math.min(Math.max(0, gapClosePx), MAX_FILL_GAP_CLOSE),
  };
}

function capLayerFills(layer: Layer): Layer {
  const fills = layer.fills.map(capFill);
  if (fills.every((f, i) => f === layer.fills[i])) return layer;
  return { ...layer, fills };
}

function capSubPanelFills(subPanel: SubPanel): SubPanel {
  const layers = subPanel.layers.map(capLayerFills);
  if (layers.every((l, i) => l === subPanel.layers[i])) return subPanel;
  return { ...subPanel, layers };
}

function normalizeStrokeBrushSettings(stroke: Stroke): Stroke {
  if (!stroke.brushSettings) return stroke;
  return {
    ...stroke,
    brushSettings: normalizeBrushSettings(stroke.brushSettings),
  };
}

function capLayerBrushSettings(layer: Layer): Layer {
  const strokes = layer.strokes.map(normalizeStrokeBrushSettings);
  if (strokes.every((s, i) => s === layer.strokes[i])) return layer;
  return { ...layer, strokes };
}

function capSubPanelBrushSettings(subPanel: SubPanel): SubPanel {
  const layers = subPanel.layers.map(capLayerBrushSettings);
  if (layers.every((l, i) => l === subPanel.layers[i])) return subPanel;
  return { ...subPanel, layers };
}

function capBrushPresetSettings(preset: BrushPreset): BrushPreset {
  return {
    ...preset,
    settings: normalizeBrushSettings(preset.settings),
  };
}

/** Clamp fill tolerance / gap-close on every layer (including sub-panels). */
export function capProjectFillLimits(project: Project): void {
  for (const panel of project.panels) {
    for (let i = 0; i < panel.layers.length; i++) {
      panel.layers[i] = capLayerFills(panel.layers[i]);
    }
    for (let i = 0; i < (panel.subPanels ?? []).length; i++) {
      panel.subPanels![i] = capSubPanelFills(panel.subPanels![i]);
    }
  }
}

/** Clamp serialized brush options on strokes and project brush presets. */
export function capProjectBrushSettings(project: Project): void {
  project.brushPresets = project.brushPresets.map(capBrushPresetSettings);
  for (const panel of project.panels) {
    for (let i = 0; i < panel.layers.length; i++) {
      panel.layers[i] = capLayerBrushSettings(panel.layers[i]);
    }
    for (let i = 0; i < (panel.subPanels ?? []).length; i++) {
      panel.subPanels![i] = capSubPanelBrushSettings(panel.subPanels![i]);
    }
  }
}

/** Clamp project-level drawing controls that can arrive out-of-range in files. */
export function capProjectDrawingSettings(project: Project): void {
  project.drawingSettings = {
    ...project.drawingSettings,
    smoothing: normalizeStrokeSmoothingSettings(project.drawingSettings?.smoothing),
  };
}

const PNG_DATA_URL_PREFIX = "data:image/png;base64,";

function validateLayer(layer: Layer, path: string, errors: string[]): void {
  for (const [name, fade] of [["fadeIn", layer.fadeIn], ["fadeOut", layer.fadeOut]] as const) {
    if (fade && (!Number.isFinite(fade.durationTicks) || fade.durationTicks < 1)) {
      errors.push(`${path}: ${name} durationTicks must be a positive finite number`);
    }
  }
  if (layer.strokes.length > MAX_STROKES_PER_LAYER) {
    errors.push(`${path}: ${layer.strokes.length} strokes exceeds max ${MAX_STROKES_PER_LAYER}`);
  }
  for (let i = 0; i < layer.strokes.length; i++) {
    const count = layer.strokes[i].points.length;
    if (count > MAX_POINTS_PER_STROKE) {
      errors.push(`${path} stroke ${i + 1}: ${count} points exceeds max ${MAX_POINTS_PER_STROKE}`);
    }
  }
  if ((layer.texts?.length ?? 0) > MAX_TEXTS_PER_LAYER) {
    errors.push(`${path}: ${layer.texts?.length ?? 0} texts exceeds max ${MAX_TEXTS_PER_LAYER}`);
  }
  if (layer.kind === "raster" && !layer.raster) {
    errors.push(`${path}: raster layer is missing pixel data`);
    return;
  }
  if (layer.kind === "raster" && layer.raster) {
    const { data, width, height } = layer.raster;
    if (typeof data !== "string" || !data.startsWith(PNG_DATA_URL_PREFIX)) {
      errors.push(`${path}: raster data must be a PNG data URL`);
    }
    if (typeof data === "string" && data.length > MAX_RASTER_DATA_CHARS) {
      errors.push(`${path}: raster data ${data.length} chars exceeds max ${MAX_RASTER_DATA_CHARS}`);
    }
    if (!Number.isFinite(width) || !Number.isFinite(height) ||
      width < MIN_PROJECT_DIMENSION || width > MAX_PROJECT_DIMENSION ||
      height < MIN_PROJECT_DIMENSION || height > MAX_PROJECT_DIMENSION) {
      errors.push(`${path}: raster dimensions ${width}x${height} out of bounds`);
    }
  }
}

export function validateProject(project: Project): ProjectValidationResult {
  const errors: string[] = [];

  if (!Number.isFinite(project.width) || !Number.isFinite(project.height)) {
    errors.push("project width/height must be finite numbers");
  } else {
    if (project.width < MIN_PROJECT_DIMENSION || project.width > MAX_PROJECT_DIMENSION) {
      errors.push(`width ${project.width} must be between ${MIN_PROJECT_DIMENSION} and ${MAX_PROJECT_DIMENSION}`);
    }
    if (project.height < MIN_PROJECT_DIMENSION || project.height > MAX_PROJECT_DIMENSION) {
      errors.push(`height ${project.height} must be between ${MIN_PROJECT_DIMENSION} and ${MAX_PROJECT_DIMENSION}`);
    }
  }

  if (project.panels.length > MAX_PANELS) {
    errors.push(`${project.panels.length} panels exceeds max ${MAX_PANELS}`);
  }

  for (let pi = 0; pi < project.panels.length; pi++) {
    const panel = project.panels[pi];
    if (!Number.isFinite(panel.durationMs) || panel.durationMs < 1) {
      errors.push(`panel ${pi + 1}: durationMs must be a positive finite number`);
    }
    if (panel.transitionToNext &&
        (!Number.isFinite(panel.transitionToNext.durationTicks) ||
         panel.transitionToNext.durationTicks < 1)) {
      errors.push(`panel ${pi + 1}: transition durationTicks must be a positive finite number`);
    }
    if (panel.annotation !== undefined &&
        (typeof panel.annotation !== "string" || panel.annotation.length > MAX_PANEL_ANNOTATION_CHARS)) {
      errors.push(`panel ${pi + 1}: annotation must be a string of at most ${MAX_PANEL_ANNOTATION_CHARS} characters`);
    }
    if (panel.layers.length > MAX_LAYERS_PER_PANEL) {
      errors.push(`panel ${pi + 1}: ${panel.layers.length} layers exceeds max ${MAX_LAYERS_PER_PANEL}`);
    }
    if ((panel.subPanels?.length ?? 0) > MAX_SUBPANELS_PER_PANEL) {
      errors.push(`panel ${pi + 1}: ${panel.subPanels?.length ?? 0} sub-panels exceeds max ${MAX_SUBPANELS_PER_PANEL}`);
    }
    for (let li = 0; li < panel.layers.length; li++) {
      if (!Number.isFinite(panel.layers[li].opacity) || panel.layers[li].opacity < 0 || panel.layers[li].opacity > 1) {
        errors.push(`panel ${pi + 1} layer ${li + 1}: opacity must be between 0 and 1`);
      }
      validateLayer(panel.layers[li], `panel ${pi + 1} layer ${li + 1}`, errors);
    }
    for (let si = 0; si < (panel.subPanels ?? []).length; si++) {
      const sub = panel.subPanels![si];
      if (!Number.isFinite(sub.bounds.x) || !Number.isFinite(sub.bounds.y) ||
          !Number.isFinite(sub.bounds.w) || !Number.isFinite(sub.bounds.h)) {
        errors.push(`panel ${pi + 1} sub-panel ${si + 1}: bounds must be finite numbers`);
      }
      if (sub.layers.length > MAX_LAYERS_PER_PANEL) {
        errors.push(`panel ${pi + 1} sub-panel ${si + 1}: ${sub.layers.length} layers exceeds max ${MAX_LAYERS_PER_PANEL}`);
      }
      for (let li = 0; li < sub.layers.length; li++) {
        if (!Number.isFinite(sub.layers[li].opacity) || sub.layers[li].opacity < 0 || sub.layers[li].opacity > 1) {
          errors.push(`panel ${pi + 1} sub-panel ${si + 1} layer ${li + 1}: opacity must be between 0 and 1`);
        }
        validateLayer(sub.layers[li], `panel ${pi + 1} sub-panel ${si + 1} layer ${li + 1}`, errors);
      }
    }
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

export function assertValidProject(project: Project): void {
  const result = validateProject(project);
  if (result.ok === false) throw new Error(`invalid project: ${result.errors.join("; ")}`);
}
