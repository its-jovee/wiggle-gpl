// ============================================================================
// core/brushSettings.ts — serializable brush option controls for strokes.
//
// Krita's brush options split serializable option data, normalized effective
// paint settings, and UI widgets. Wiggle keeps the same smaller split: options
// are data here, the registry remains `{ key, label, spacing, stamp }`, and
// render consumes one normalized effective settings object per stroke.
// ============================================================================

import type { BrushSettings } from "./types";

export type BrushOptionKey = keyof BrushSettings;

export type BrushOption = {
  key: BrushOptionKey;
  label: string;
  kind: "range" | "toggle";
  defaultValue: number | boolean;
  min?: number;
  max?: number;
  step?: number;
};

export type EffectiveBrushSettings = {
  settings: BrushSettings;
  spacing: number;
  stampSize: (strokeSize: number, pressure: number) => number;
  stampFlow: (pressure: number) => number;
};

export const BRUSH_OPTIONS = [
  {
    key: "spacingScale",
    label: "Spacing",
    kind: "range",
    defaultValue: 1,
    min: 0.5,
    max: 3,
    step: 0.1,
  },
  {
    key: "flow",
    label: "Flow",
    kind: "range",
    defaultValue: 1,
    min: 0.1,
    max: 1,
    step: 0.05,
  },
  {
    key: "pressureSize",
    label: "Pressure size",
    kind: "toggle",
    defaultValue: true,
  },
  {
    key: "pressureFlow",
    label: "Pressure flow",
    kind: "toggle",
    defaultValue: false,
  },
] as const satisfies readonly BrushOption[];

const optionByKey = new Map<BrushOptionKey, BrushOption>(
  BRUSH_OPTIONS.map((option) => [option.key, option])
);

function optionDefault<T extends BrushOptionKey>(key: T): BrushSettings[T] {
  return optionByKey.get(key)!.defaultValue as BrushSettings[T];
}

export const DEFAULT_BRUSH_SETTINGS: BrushSettings = {
  spacingScale: optionDefault("spacingScale"),
  flow: optionDefault("flow"),
  pressureSize: optionDefault("pressureSize"),
  pressureFlow: optionDefault("pressureFlow"),
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function normalizeRange(value: unknown, key: BrushOptionKey): number {
  const option = optionByKey.get(key)!;
  const fallback = option.defaultValue as number;
  const n = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return clamp(n, option.min ?? n, option.max ?? n);
}

function normalizeToggle(value: unknown, key: BrushOptionKey): boolean {
  return typeof value === "boolean" ? value : (optionByKey.get(key)!.defaultValue as boolean);
}

export function normalizeBrushSettings(settings: Partial<BrushSettings> | undefined): BrushSettings {
  return {
    spacingScale: normalizeRange(settings?.spacingScale, "spacingScale"),
    flow: normalizeRange(settings?.flow, "flow"),
    pressureSize: normalizeToggle(settings?.pressureSize, "pressureSize"),
    pressureFlow: normalizeToggle(settings?.pressureFlow, "pressureFlow"),
  };
}

export function brushSettingsSignatureValues(
  settings: Partial<BrushSettings> | undefined
): BrushSettings {
  return normalizeBrushSettings(settings);
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

export function effectiveBrushSettings(
  baseSpacing: number,
  strokeSize: number,
  settings: Partial<BrushSettings> | undefined
): EffectiveBrushSettings {
  const normalized = normalizeBrushSettings(settings);
  return {
    settings: normalized,
    spacing: brushSpacing(baseSpacing, strokeSize, normalized),
    stampSize: (size, pressure) => brushStampSize(size, pressure, normalized),
    stampFlow: (pressure) => brushStampFlow(pressure, normalized),
  };
}
