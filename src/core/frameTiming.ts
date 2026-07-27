// ============================================================================
// core/frameTiming.ts — exposure helpers for animation panels.
//
// Panel.durationMs remains the serialized timing source. These helpers only
// translate editor "hold for N wiggle ticks" / "hold for N seconds" controls
// into milliseconds. Timeline UI may toggle between frames and seconds;
// storage stays durationMs either way.
// ============================================================================

export type TimedPanel = {
  durationMs: number;
};

export type TimelineTimeUnit = "frames" | "seconds";

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

/** Absolute playhead / span length as whole wiggle ticks (frames). */
export function durationMsToAbsoluteTicks(durationMs: number, wiggleFps: number): number {
  const ms = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0;
  return Math.max(0, Math.round((ms / 1000) * safeFps(wiggleFps)));
}

export function absoluteTicksToMs(ticks: number, wiggleFps: number): number {
  const whole = Math.max(0, Math.round(Number.isFinite(ticks) ? ticks : 0));
  return Math.round((whole / safeFps(wiggleFps)) * 1000);
}

export function durationMsToSeconds(durationMs: number): number {
  const ms = Number.isFinite(durationMs) ? durationMs : 0;
  return Math.max(0, ms / 1000);
}

/** Panel holds clamp to >= 100ms to match existing duration editors. */
export function secondsToDurationMs(seconds: number): number {
  const s = Number.isFinite(seconds) ? seconds : 0.1;
  return Math.max(100, Math.round(s * 1000));
}

export function setPanelDurationSeconds(panel: TimedPanel, seconds: number): number {
  panel.durationMs = secondsToDurationMs(seconds);
  return panel.durationMs;
}

/** Compact seconds label for inputs (trim trailing zeros). */
export function formatSecondsValue(seconds: number): string {
  const s = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  if (Math.abs(s - Math.round(s)) < 1e-9) return String(Math.round(s));
  return String(Math.round(s * 1000) / 1000);
}

/** Format a timeline position for the active display unit. */
export function formatTimelineTime(
  durationMs: number,
  unit: TimelineTimeUnit,
  wiggleFps: number,
): string {
  if (unit === "frames") {
    return `${durationMsToAbsoluteTicks(durationMs, wiggleFps)}f`;
  }
  const totalSec = Math.max(0, Math.round(durationMsToSeconds(durationMs)));
  const min = Math.floor(totalSec / 60);
  const sec = String(totalSec % 60).padStart(2, "0");
  return `${min}:${sec}`;
}

/** Format a panel hold for tooltips / titles. */
export function formatHoldDuration(
  durationMs: number,
  unit: TimelineTimeUnit,
  wiggleFps: number,
): string {
  if (unit === "frames") {
    return `${durationMsToExposureTicks(durationMs, wiggleFps)}fr`;
  }
  return `${formatSecondsValue(durationMsToSeconds(durationMs))}s`;
}
