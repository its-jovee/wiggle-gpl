// ============================================================================
// core/strokeSmoothing.ts — Krita-inspired live stroke input smoothing.
//
// This module filters editor pointer samples before they are stored as raw
// stroke geometry. It never touches render-time wiggle or export randomness.
// Concepts map to Krita's smoothing options and stabilizer delay, translated
// into a small deterministic TypeScript input pipeline.
// ============================================================================

import type { StrokeSmoothingSettings, Vec2 } from "./types";

export type StrokeSmoothingSample = {
  point: Vec2;
  pressure: number;
};

export type StrokeSmoothingSession = {
  settings: StrokeSmoothingSettings;
  start: StrokeSmoothingSample;
  lastRaw: StrokeSmoothingSample;
  lastOutput: StrokeSmoothingSample;
};

export const DEFAULT_STROKE_SMOOTHING: StrokeSmoothingSettings = {
  mode: "off",
  distance: 24,
  delayDistance: 16,
  finishStabilizedStroke: true,
  smoothPressure: false,
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function validMode(mode: unknown): StrokeSmoothingSettings["mode"] {
  return mode === "weighted" || mode === "stabilizer" ? mode : "off";
}

export function normalizeStrokeSmoothingSettings(
  settings: Partial<StrokeSmoothingSettings> | undefined
): StrokeSmoothingSettings {
  return {
    mode: validMode(settings?.mode),
    distance: clamp(settings?.distance ?? DEFAULT_STROKE_SMOOTHING.distance, 1, 128),
    delayDistance: clamp(settings?.delayDistance ?? DEFAULT_STROKE_SMOOTHING.delayDistance, 1, 128),
    finishStabilizedStroke: settings?.finishStabilizedStroke ?? DEFAULT_STROKE_SMOOTHING.finishStabilizedStroke,
    smoothPressure: settings?.smoothPressure ?? DEFAULT_STROKE_SMOOTHING.smoothPressure,
  };
}

export function createStrokeSmoothingSession(
  first: StrokeSmoothingSample,
  settings: Partial<StrokeSmoothingSettings> | undefined
): StrokeSmoothingSession {
  const normalized = normalizeStrokeSmoothingSettings(settings);
  const start = cloneSample(first);
  return {
    settings: normalized,
    start,
    lastRaw: cloneSample(start),
    lastOutput: cloneSample(start),
  };
}

function cloneSample(sample: StrokeSmoothingSample): StrokeSmoothingSample {
  return {
    point: { x: sample.point.x, y: sample.point.y },
    pressure: clamp(sample.pressure, 0, 1),
  };
}

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function maybeSmoothPressure(session: StrokeSmoothingSession, pressure: number): number {
  if (!session.settings.smoothPressure) return pressure;
  return session.lastOutput.pressure + (pressure - session.lastOutput.pressure) * 0.5;
}

function appendOff(session: StrokeSmoothingSession, raw: StrokeSmoothingSample): StrokeSmoothingSample[] {
  const output = cloneSample(raw);
  session.lastRaw = cloneSample(raw);
  session.lastOutput = cloneSample(output);
  return [output];
}

function appendWeighted(session: StrokeSmoothingSession, raw: StrokeSmoothingSample): StrokeSmoothingSample[] {
  const last = session.lastOutput;
  const dx = raw.point.x - last.point.x;
  const dy = raw.point.y - last.point.y;
  const d = Math.hypot(dx, dy);
  const strength = clamp(d / session.settings.distance, 0, 1);
  const alpha = 0.35 + strength * 0.35;
  const smoothed = {
    x: last.point.x + dx * alpha,
    y: last.point.y + dy * alpha,
  };

  // Keep the dominant movement axis responsive and damp the perpendicular
  // wobble; this preserves stroke progress while reducing hand jitter.
  const point = Math.abs(dx) >= Math.abs(dy)
    ? { x: raw.point.x, y: smoothed.y }
    : { x: smoothed.x, y: raw.point.y };

  const output = {
    point,
    pressure: maybeSmoothPressure(session, raw.pressure),
  };
  session.lastRaw = cloneSample(raw);
  session.lastOutput = cloneSample(output);
  return [output];
}

function appendStabilizer(session: StrokeSmoothingSession, raw: StrokeSmoothingSample): StrokeSmoothingSample[] {
  const leash = session.settings.delayDistance;
  const dx = raw.point.x - session.lastOutput.point.x;
  const dy = raw.point.y - session.lastOutput.point.y;
  const d = Math.hypot(dx, dy);
  session.lastRaw = cloneSample(raw);
  if (d <= leash) return [];

  const t = (d - leash) / d;
  const output = {
    point: {
      x: session.lastOutput.point.x + dx * t,
      y: session.lastOutput.point.y + dy * t,
    },
    pressure: maybeSmoothPressure(session, raw.pressure),
  };
  session.lastOutput = cloneSample(output);
  return [output];
}

export function appendStrokeSmoothingSample(
  session: StrokeSmoothingSession,
  sample: StrokeSmoothingSample
): StrokeSmoothingSample[] {
  const raw = cloneSample(sample);
  if (session.settings.mode === "weighted") return appendWeighted(session, raw);
  if (session.settings.mode === "stabilizer") return appendStabilizer(session, raw);
  return appendOff(session, raw);
}

export function finishStrokeSmoothingSession(session: StrokeSmoothingSession): StrokeSmoothingSample[] {
  if (session.settings.mode !== "stabilizer" || !session.settings.finishStabilizedStroke) return [];
  if (distance(session.lastRaw.point, session.lastOutput.point) < 0.5) return [];
  const output = {
    point: { ...session.lastRaw.point },
    pressure: maybeSmoothPressure(session, session.lastRaw.pressure),
  };
  session.lastOutput = cloneSample(output);
  return [output];
}
