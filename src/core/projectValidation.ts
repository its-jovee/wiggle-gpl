// ============================================================================
// core/projectValidation.ts — guardrails for loaded / migrated projects.
//
// Hard limits reject corrupt or hostile files. Fill tolerance and gap-close
// are capped in place so slightly out-of-range editor values still load.
// ============================================================================

import type { Fill, Layer, Project, SubPanel } from "./types";

export const MAX_PROJECT_DIMENSION = 4096;
export const MIN_PROJECT_DIMENSION = 1;
export const MAX_PANELS = 200;
export const MAX_STROKES_PER_LAYER = 50_000;
export const MAX_POINTS_PER_STROKE = 500_000;
export const MAX_FILL_TOLERANCE = 64;
export const MAX_FILL_GAP_CLOSE = 64;

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

function validateLayer(layer: Layer, path: string, errors: string[]): void {
  if (layer.strokes.length > MAX_STROKES_PER_LAYER) {
    errors.push(`${path}: ${layer.strokes.length} strokes exceeds max ${MAX_STROKES_PER_LAYER}`);
  }
  for (let i = 0; i < layer.strokes.length; i++) {
    const count = layer.strokes[i].points.length;
    if (count > MAX_POINTS_PER_STROKE) {
      errors.push(`${path} stroke ${i + 1}: ${count} points exceeds max ${MAX_POINTS_PER_STROKE}`);
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
    for (let li = 0; li < panel.layers.length; li++) {
      validateLayer(panel.layers[li], `panel ${pi + 1} layer ${li + 1}`, errors);
    }
    for (let si = 0; si < (panel.subPanels ?? []).length; si++) {
      const sub = panel.subPanels![si];
      for (let li = 0; li < sub.layers.length; li++) {
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
