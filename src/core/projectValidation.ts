// ============================================================================
// core/projectValidation.ts — guardrails for loaded / migrated projects.
//
// Hard limits reject corrupt or hostile files. Fill tolerance and gap-close
// are capped in place so slightly out-of-range editor values still load.
// ============================================================================

import type { BrushPreset, Fill, Layer, Project, ReferenceImage, Stroke, SubPanel } from "./types";
import { normalizeBrushSettings } from "./brushSettings";
import { normalizeStrokeSmoothingSettings } from "./strokeSmoothing";
import { countSubPanels, maxSubPanelDepth } from "./panelStack";

export const MAX_PROJECT_DIMENSION = 4096;
export const MIN_PROJECT_DIMENSION = 1;
export const MAX_PANELS = 200;
export const MAX_PANEL_ANNOTATION_CHARS = 4000;
export const MAX_LAYERS_PER_PANEL = 256;
export const MAX_SUBPANELS_PER_PANEL = 64;
/** Root frames are depth 1; children increment. */
export const MAX_SUBPANEL_DEPTH = 8;
export const MAX_SUBPANEL_POINTS = 20_000;
export const MAX_TEXTS_PER_LAYER = 10_000;
export const MAX_STROKES_PER_LAYER = 50_000;
export const MAX_POINTS_PER_STROKE = 20_000;
export const MAX_FILL_TOLERANCE = 64;
export const MAX_FILL_GAP_CLOSE = 64;
/** ~12MB decoded — generous but bounded; guards against corrupt/hostile files. */
export const MAX_RASTER_DATA_CHARS = 16_000_000;
export const MAX_RASTER_TIMELAPSE_EVENTS = 10_000;
export const MAX_TIMELAPSE_CAMERA_KEYFRAMES = 100;
export const MAX_REFERENCE_IMAGES = 32;
export const MAX_REFERENCE_NAME_CHARS = 200;
/** Reference bitmaps may be larger than the export frame (photos, sheets). */
export const MAX_REFERENCE_DIMENSION = 8192;

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
  const children = (subPanel.subPanels ?? []).map(capSubPanelFills);
  const layersSame = layers.every((l, i) => l === subPanel.layers[i]);
  const childrenSame = children.every((c, i) => c === (subPanel.subPanels ?? [])[i]);
  if (layersSame && childrenSame) return subPanel;
  return { ...subPanel, layers, subPanels: children };
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
  const children = (subPanel.subPanels ?? []).map(capSubPanelBrushSettings);
  const layersSame = layers.every((l, i) => l === subPanel.layers[i]);
  const childrenSame = children.every((c, i) => c === (subPanel.subPanels ?? [])[i]);
  if (layersSame && childrenSame) return subPanel;
  return { ...subPanel, layers, subPanels: children };
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
const HEX_COLOR = /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i;

function finitePoint(point: { x: number; y: number } | undefined): boolean {
  return !!point && Number.isFinite(point.x) && Number.isFinite(point.y);
}

function validateLayer(layer: Layer, path: string, errors: string[]): void {
  if (layer.locked !== undefined && typeof layer.locked !== "boolean") {
    errors.push(`${path}: locked must be a boolean`);
  }
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
  for (let i = 0; i < layer.fills.length; i++) {
    const fill = layer.fills[i];
    const fillPath = `${path} fill ${i + 1}`;
    if (!finitePoint(fill.point)) errors.push(`${fillPath}: point must be finite`);
    if (typeof fill.color !== "string" || !HEX_COLOR.test(fill.color)) {
      errors.push(`${fillPath}: color must be a hex color`);
    }
    if (fill.gradient) {
      if (fill.gradient.kind !== "linear" && fill.gradient.kind !== "radial") {
        errors.push(`${fillPath}: gradient kind must be linear or radial`);
      }
      if (!finitePoint(fill.gradient.start) || !finitePoint(fill.gradient.end)) {
        errors.push(`${fillPath}: gradient points must be finite`);
      }
      if (typeof fill.gradient.endColor !== "string" || !HEX_COLOR.test(fill.gradient.endColor)) {
        errors.push(`${fillPath}: gradient end color must be a hex color`);
      }
    }
  }
  if (layer.tone?.gradient) {
    const gradient = layer.tone.gradient;
    if (gradient.kind !== "linear" && gradient.kind !== "radial") {
      errors.push(`${path}: tone gradient kind must be linear or radial`);
    }
    if (!finitePoint(gradient.start) || !finitePoint(gradient.end)) {
      errors.push(`${path}: tone gradient points must be finite`);
    }
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
    const timeline = layer.raster.timelapse;
    if (timeline) {
      if (typeof timeline.baseline !== "string" || !timeline.baseline.startsWith(PNG_DATA_URL_PREFIX)) {
        errors.push(`${path}: raster timelapse baseline must be a PNG data URL`);
      } else if (timeline.baseline.length > MAX_RASTER_DATA_CHARS) {
        errors.push(`${path}: raster timelapse baseline exceeds max ${MAX_RASTER_DATA_CHARS} chars`);
      }
      if (!Array.isArray(timeline.events) || timeline.events.length > MAX_RASTER_TIMELAPSE_EVENTS) {
        errors.push(`${path}: raster timelapse events exceed max ${MAX_RASTER_TIMELAPSE_EVENTS}`);
      } else {
        for (let i = 0; i < timeline.events.length; i++) {
          const event = timeline.events[i];
          if (event.kind === "checkpoint") {
            if (typeof event.data !== "string" || !event.data.startsWith(PNG_DATA_URL_PREFIX) ||
                event.data.length > MAX_RASTER_DATA_CHARS) {
              errors.push(`${path}: raster timelapse checkpoint ${i + 1} is invalid`);
            }
          } else if (event.kind === "stroke") {
            if (!Number.isInteger(event.strokeIndex) || event.strokeIndex < 0) {
              errors.push(`${path}: raster timelapse stroke ${i + 1} index must be a non-negative integer`);
            }
            if (!event.stroke || event.stroke.points.length > MAX_POINTS_PER_STROKE) {
              errors.push(`${path}: raster timelapse stroke ${i + 1} exceeds point limit`);
            }
          } else {
            errors.push(`${path}: raster timelapse event ${i + 1} has an unknown kind`);
          }
        }
      }
    }
  }
}

function validateSubPanelTree(subs: SubPanel[], pathPrefix: string, errors: string[]): void {
  for (let si = 0; si < subs.length; si++) {
    const sub = subs[si];
    const path = `${pathPrefix} sub-panel ${si + 1}`;
    if (sub.locked !== undefined && typeof sub.locked !== "boolean") {
      errors.push(`${path}: locked must be a boolean`);
    }
    if (!Number.isFinite(sub.bounds.x) || !Number.isFinite(sub.bounds.y) ||
        !Number.isFinite(sub.bounds.w) || !Number.isFinite(sub.bounds.h)) {
      errors.push(`${path}: bounds must be finite numbers`);
    }
    if (sub.shape === "custom") {
      if (!sub.points || sub.points.length < 3) {
        errors.push(`${path}: custom shape needs at least 3 points`);
      } else if (sub.points.length > MAX_SUBPANEL_POINTS) {
        errors.push(`${path}: ${sub.points.length} custom points exceeds max ${MAX_SUBPANEL_POINTS}`);
      } else {
        for (let pi2 = 0; pi2 < sub.points.length; pi2++) {
          const p = sub.points[pi2];
          if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) {
            errors.push(`${path}: custom point ${pi2 + 1} must be finite`);
            break;
          }
        }
      }
    }
    if (sub.layers.length > MAX_LAYERS_PER_PANEL) {
      errors.push(`${path}: ${sub.layers.length} layers exceeds max ${MAX_LAYERS_PER_PANEL}`);
    }
    for (let li = 0; li < sub.layers.length; li++) {
      if (!Number.isFinite(sub.layers[li].opacity) || sub.layers[li].opacity < 0 || sub.layers[li].opacity > 1) {
        errors.push(`${path} layer ${li + 1}: opacity must be between 0 and 1`);
      }
      validateLayer(sub.layers[li], `${path} layer ${li + 1}`, errors);
    }
    validateSubPanelTree(sub.subPanels ?? [], path, errors);
  }
}

function validateReferenceImage(ref: ReferenceImage, path: string, errors: string[]): void {
  if (typeof ref.id !== "string" || !ref.id) {
    errors.push(`${path}: id is required`);
  }
  if (typeof ref.name !== "string" || !ref.name || ref.name.length > MAX_REFERENCE_NAME_CHARS) {
    errors.push(`${path}: name must be a non-empty string of at most ${MAX_REFERENCE_NAME_CHARS} characters`);
  }
  if (typeof ref.data !== "string" || !ref.data.startsWith(PNG_DATA_URL_PREFIX)) {
    errors.push(`${path}: data must be a PNG data URL`);
  }
  if (typeof ref.data === "string" && ref.data.length > MAX_RASTER_DATA_CHARS) {
    errors.push(`${path}: data ${ref.data.length} chars exceeds max ${MAX_RASTER_DATA_CHARS}`);
  }
  if (!Number.isFinite(ref.width) || !Number.isFinite(ref.height) ||
      ref.width < MIN_PROJECT_DIMENSION || ref.width > MAX_REFERENCE_DIMENSION ||
      ref.height < MIN_PROJECT_DIMENSION || ref.height > MAX_REFERENCE_DIMENSION) {
    errors.push(`${path}: dimensions ${ref.width}x${ref.height} out of bounds`);
  }
  if (!Number.isFinite(ref.x) || !Number.isFinite(ref.y)) {
    errors.push(`${path}: position must be finite`);
  }
  if (!Number.isFinite(ref.scale) || ref.scale <= 0) {
    errors.push(`${path}: scale must be a positive finite number`);
  }
  if (!Number.isFinite(ref.opacity) || ref.opacity < 0 || ref.opacity > 1) {
    errors.push(`${path}: opacity must be between 0 and 1`);
  }
  if (typeof ref.visible !== "boolean") {
    errors.push(`${path}: visible must be a boolean`);
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

  const refs = project.referenceImages ?? [];
  if (refs.length > MAX_REFERENCE_IMAGES) {
    errors.push(`${refs.length} reference images exceeds max ${MAX_REFERENCE_IMAGES}`);
  }
  for (let ri = 0; ri < refs.length; ri++) {
    validateReferenceImage(refs[ri], `reference image ${ri + 1}`, errors);
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
    const camera = panel.timelapse?.camera;
    if (camera) {
      if (!Array.isArray(camera) || camera.length > MAX_TIMELAPSE_CAMERA_KEYFRAMES) {
        errors.push(`panel ${pi + 1}: timelapse camera exceeds max ${MAX_TIMELAPSE_CAMERA_KEYFRAMES} keyframes`);
      } else {
        for (let ki = 0; ki < camera.length; ki++) {
          const keyframe = camera[ki];
          if (!Number.isFinite(keyframe.progress) || keyframe.progress < 0 || keyframe.progress > 1 ||
              !Number.isFinite(keyframe.centerX) || !Number.isFinite(keyframe.centerY) ||
              !Number.isFinite(keyframe.zoom) || keyframe.zoom < 1 || keyframe.zoom > 8) {
            errors.push(`panel ${pi + 1}: timelapse camera keyframe ${ki + 1} is out of bounds`);
          }
        }
      }
    }
    if (panel.layers.length > MAX_LAYERS_PER_PANEL) {
      errors.push(`panel ${pi + 1}: ${panel.layers.length} layers exceeds max ${MAX_LAYERS_PER_PANEL}`);
    }
    const totalSubs = countSubPanels(panel);
    if (totalSubs > MAX_SUBPANELS_PER_PANEL) {
      errors.push(`panel ${pi + 1}: ${totalSubs} sub-panels exceeds max ${MAX_SUBPANELS_PER_PANEL}`);
    }
    const depth = maxSubPanelDepth(panel);
    if (depth > MAX_SUBPANEL_DEPTH) {
      errors.push(`panel ${pi + 1}: sub-panel nesting depth ${depth} exceeds max ${MAX_SUBPANEL_DEPTH}`);
    }
    for (let li = 0; li < panel.layers.length; li++) {
      if (!Number.isFinite(panel.layers[li].opacity) || panel.layers[li].opacity < 0 || panel.layers[li].opacity > 1) {
        errors.push(`panel ${pi + 1} layer ${li + 1}: opacity must be between 0 and 1`);
      }
      validateLayer(panel.layers[li], `panel ${pi + 1} layer ${li + 1}`, errors);
    }
    validateSubPanelTree(panel.subPanels ?? [], `panel ${pi + 1}`, errors);
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

export function assertValidProject(project: Project): void {
  const result = validateProject(project);
  if (result.ok === false) throw new Error(`invalid project: ${result.errors.join("; ")}`);
}
