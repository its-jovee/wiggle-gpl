// ============================================================================
// core/noiseDisplace.ts — deterministic grid noise displacement for raster
// and tone layers.
//
// Stored pixels stay static. At render time we warp a coarse grid of cells with
// seeded noise(tick, cell, layerSeed) so display / WebM / MP4 agree. This is the
// raster analogue of stroke-point jitter: never bake motion into layer.raster
// or tone settings.
// ============================================================================

import { noise } from "./rng";
import type { Layer, LayerNoiseDisplace } from "./types";

export const DEFAULT_NOISE_DISPLACE: LayerNoiseDisplace = {
  enabled: false,
  amplitude: 6,
  cellSize: 48,
  speed: 1,
};

export function defaultNoiseDisplace(): LayerNoiseDisplace {
  return { ...DEFAULT_NOISE_DISPLACE };
}

export function layerSupportsNoiseDisplace(layer: Layer): boolean {
  const kind = layer.kind ?? "draw";
  return kind === "raster" || kind === "tone";
}

export function clampNoiseDisplace(settings: LayerNoiseDisplace): LayerNoiseDisplace {
  return {
    enabled: !!settings.enabled,
    amplitude: Math.max(0, Math.min(64, settings.amplitude)),
    cellSize: Math.max(8, Math.min(128, Math.round(settings.cellSize))),
    speed: Math.max(0, Math.min(4, settings.speed)),
  };
}

/** Active displace settings for this render, or null when disabled / gated off. */
export function activeNoiseDisplace(
  layer: Layer,
  skipJitter: boolean
): LayerNoiseDisplace | null {
  if (skipJitter) return null;
  if (!layerSupportsNoiseDisplace(layer)) return null;
  const raw = layer.noiseDisplace;
  if (!raw?.enabled || raw.amplitude <= 0) return null;
  return clampNoiseDisplace(raw);
}

/**
 * Push clamped noise-displace settings onto every eligible layer in a panel.
 * Raster always; tone only when `includeTone`. Returns layers that were written
 * (for history). Draw / text / other kinds are skipped.
 *
 * When `enabled` is false (Clear), existing amp/cell/speed are preserved and
 * layers with no displace settings are left untouched.
 */
export function applyNoiseDisplaceToPanelLayers(
  layers: Layer[],
  settings: LayerNoiseDisplace,
  opts: { includeTone: boolean; enabled: boolean }
): Layer[] {
  const next = clampNoiseDisplace({ ...settings, enabled: opts.enabled });
  const changed: Layer[] = [];
  for (const layer of layers) {
    if (!layerSupportsNoiseDisplace(layer)) continue;
    if (!opts.includeTone && (layer.kind ?? "draw") === "tone") continue;
    if (opts.enabled) {
      layer.noiseDisplace = { ...next };
    } else {
      if (!layer.noiseDisplace) continue;
      layer.noiseDisplace = clampNoiseDisplace({
        ...layer.noiseDisplace,
        enabled: false,
      });
    }
    changed.push(layer);
  }
  return changed;
}

/** Stable numeric seed from a layer id (same algorithm as subpanel.hashId). */
export function noiseDisplaceSeed(layerId: string): number {
  let h = 0;
  for (let i = 0; i < layerId.length; i++) h = ((h << 5) - h + layerId.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Deterministic per-cell offset in pixels. */
export function cellDisplaceOffset(
  tick: number,
  seed: number,
  cellX: number,
  cellY: number,
  amplitude: number,
  speed: number
): { dx: number; dy: number } {
  // Displacement is a boil animation: speed scales its deterministic phase.
  // Quantizing the phase makes fractional speeds real holds (0.25x changes
  // once every four wiggle ticks) instead of unrelated fractional hash inputs.
  // Speeds above 1x advance through multiple deterministic phases per tick.
  const t = Math.floor(tick * speed);
  return {
    dx: noise(t, seed + cellX * 17.1, cellY * 31.7) * amplitude,
    dy: noise(t + 50.5, seed + cellX * 23.3, cellY * 11.9) * amplitude,
  };
}
