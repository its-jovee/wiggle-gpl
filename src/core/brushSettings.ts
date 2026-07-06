// ============================================================================
// core/brushSettings.ts — serializable brush preset controls for new strokes.
//
// These settings are stored on Stroke and interpreted at render time. They do
// not change the brush registry shape and do not introduce render randomness.
// ============================================================================

import type { BrushSettings } from "./types";

export const DEFAULT_BRUSH_SETTINGS: BrushSettings = {
  spacingScale: 1,
  flow: 1,
  pressureSize: true,
  pressureFlow: false,
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function normalizeBrushSettings(settings: Partial<BrushSettings> | undefined): BrushSettings {
  return {
    spacingScale: clamp(settings?.spacingScale ?? DEFAULT_BRUSH_SETTINGS.spacingScale, 0.5, 3),
    flow: clamp(settings?.flow ?? DEFAULT_BRUSH_SETTINGS.flow, 0.1, 1),
    pressureSize: settings?.pressureSize ?? DEFAULT_BRUSH_SETTINGS.pressureSize,
    pressureFlow: settings?.pressureFlow ?? DEFAULT_BRUSH_SETTINGS.pressureFlow,
  };
}

export function brushSpacing(baseSpacing: number, strokeSize: number, settings: BrushSettings): number {
  return baseSpacing * strokeSize * settings.spacingScale;
}

export function brushStampSize(strokeSize: number, pressure: number, settings: BrushSettings): number {
  return strokeSize * (settings.pressureSize ? pressure : 1);
}

export function brushStampFlow(pressure: number, settings: BrushSettings): number {
  return settings.flow * (settings.pressureFlow ? pressure : 1);
}
