// ============================================================================
// core/frameTiming.ts — exposure helpers for animation panels.
//
// Panel.durationMs remains the serialized timing source. These helpers only
// translate editor "hold for N wiggle ticks" controls into milliseconds.
// ============================================================================

export type TimedPanel = {
  durationMs: number;
};

function safeFps(wiggleFps: number): number {
  return Number.isFinite(wiggleFps) && wiggleFps > 0 ? wiggleFps : 8;
}

export function exposureTicksToMs(ticks: number, wiggleFps: number): number {
  const wholeTicks = Math.max(1, Math.round(Number.isFinite(ticks) ? ticks : 1));
  return Math.max(1, Math.round((wholeTicks / safeFps(wiggleFps)) * 1000));
}

export function durationMsToExposureTicks(durationMs: number, wiggleFps: number): number {
  const ms = Number.isFinite(durationMs) ? durationMs : 0;
  return Math.max(1, Math.round((Math.max(1, ms) / 1000) * safeFps(wiggleFps)));
}

export function setPanelExposureTicks(panel: TimedPanel, ticks: number, wiggleFps: number): number {
  panel.durationMs = exposureTicksToMs(ticks, wiggleFps);
  return panel.durationMs;
}

export function adjustPanelExposureTicks(panel: TimedPanel, deltaTicks: number, wiggleFps: number): number {
  const nextTicks = durationMsToExposureTicks(panel.durationMs, wiggleFps) + deltaTicks;
  return setPanelExposureTicks(panel, nextTicks, wiggleFps);
}
