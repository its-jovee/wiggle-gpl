// ============================================================================
// core/brushPresets.ts — serializable project brush preset helpers.
//
// Presets are project data, not hidden app state. Applying one updates the
// active brush/size/settings tuple; color remains a palette/user choice.
// ============================================================================

import type { BrushPreset, BrushSettings } from "./types";
import { DEFAULT_BRUSH_SETTINGS, normalizeBrushSettings } from "./brushSettings";

/** Brush size is a stroke radius scale; allow hairlines down to 0.1. */
const MIN_BRUSH_SIZE = 0.1;
const MAX_BRUSH_SIZE = 200;
const clampSize = (v: number) =>
  Math.max(MIN_BRUSH_SIZE, Math.min(MAX_BRUSH_SIZE, Number.isFinite(v) ? v : 2));

export type BrushPresetApplyState = {
  brush: string;
  size: number;
  settings: BrushSettings;
};

export function normalizeBrushPreset(preset: Partial<BrushPreset>): BrushPreset {
  return {
    id: preset.id?.trim() || crypto.randomUUID(),
    name: preset.name?.trim() || "Brush Preset",
    brush: preset.brush?.trim() || "round",
    size: clampSize(preset.size ?? 2),
    settings: normalizeBrushSettings(preset.settings ?? DEFAULT_BRUSH_SETTINGS),
  };
}

export function brushPresetFromState(
  id: string,
  name: string,
  state: BrushPresetApplyState
): BrushPreset {
  return normalizeBrushPreset({
    id,
    name,
    brush: state.brush,
    size: state.size,
    settings: state.settings,
  });
}

export function applyBrushPreset(preset: BrushPreset): BrushPresetApplyState {
  const normalized = normalizeBrushPreset(preset);
  return {
    brush: normalized.brush,
    size: normalized.size,
    settings: normalized.settings,
  };
}

export function upsertBrushPreset(
  presets: BrushPreset[],
  preset: BrushPreset
): BrushPreset[] {
  const normalized = normalizeBrushPreset(preset);
  const index = presets.findIndex((p) => p.id === normalized.id);
  if (index < 0) return [...presets, normalized];
  const next = presets.slice();
  next[index] = normalized;
  return next;
}

export function deleteBrushPreset(presets: BrushPreset[], id: string): BrushPreset[] {
  return presets.filter((p) => p.id !== id);
}
