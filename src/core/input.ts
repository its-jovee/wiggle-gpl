// ============================================================================
// core/input.ts — editor input cleanup helpers.
//
// Browser PointerEvents expose tablet data, but the first pen contact samples
// can report missing/zero pressure while the device handshake catches up. These
// helpers keep real pressure values intact and only patch that startup artifact.
// ============================================================================

import type { Vec2 } from "./types";

export const SIMPLIFY_TOLERANCE = 1.0; // px in canvas space; well under 2.5px wiggle amplitude
const PRESSURE_SIMPLIFY_TOLERANCE = 0.08;

function perpendicularDist(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  return Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / len;
}

function pressureDist(pressures: number[] | undefined, start: number, end: number, i: number): number {
  if (!pressures) return 0;
  const a = pressures[start] ?? 1;
  const b = pressures[end] ?? 1;
  const t = end === start ? 0 : (i - start) / (end - start);
  const expected = a + (b - a) * t;
  return Math.abs((pressures[i] ?? 1) - expected) / PRESSURE_SIMPLIFY_TOLERANCE;
}

function rdpMark(
  points: Vec2[],
  pressures: number[] | undefined,
  start: number,
  end: number,
  tol: number,
  keep: boolean[]
): void {
  if (end <= start + 1) return;
  let maxScore = 0;
  let maxIdx = start;
  for (let i = start + 1; i < end; i++) {
    const geomScore = perpendicularDist(points[i], points[start], points[end]) / tol;
    const score = Math.max(geomScore, pressureDist(pressures, start, end, i));
    if (score > maxScore) { maxScore = score; maxIdx = i; }
  }
  if (maxScore > 1) {
    keep[maxIdx] = true;
    rdpMark(points, pressures, start, maxIdx, tol, keep);
    rdpMark(points, pressures, maxIdx, end, tol, keep);
  }
}

/** Ramer-Douglas-Peucker simplification. Mutates the stroke in-place. */
export function simplifyStroke(
  stroke: { points: Vec2[]; pressures?: number[] },
  tolerance = SIMPLIFY_TOLERANCE
): void {
  const pts = stroke.points;
  if (pts.length <= 2) return;
  const keep = new Array<boolean>(pts.length).fill(false);
  keep[0] = true;
  keep[pts.length - 1] = true;
  rdpMark(pts, stroke.pressures, 0, pts.length - 1, tolerance, keep);
  const newPts: Vec2[] = [];
  const newPrs: number[] | undefined = stroke.pressures ? [] : undefined;
  for (let i = 0; i < pts.length; i++) {
    if (keep[i]) {
      newPts.push(pts[i]);
      if (stroke.pressures && newPrs) newPrs.push(stroke.pressures[i]);
    }
  }
  stroke.points = newPts;
  if (newPrs) stroke.pressures = newPrs;
}

export type PointerPressureInput = {
  pointerType: string;
  pressure: number;
  buttons: number;
};

export type PressureSample = {
  pressure: number;
  real: boolean;
};

export const PEN_STARTUP_FALLBACK_PRESSURE = 0.25;
const MIN_REAL_PRESSURE = 0.01;

export function readPointerPressure(
  e: PointerPressureInput,
  pressureEnabled: boolean
): PressureSample {
  if (!pressureEnabled || e.pointerType === "mouse") {
    return { pressure: 1, real: true };
  }

  if (e.pressure > 0) {
    return { pressure: Math.max(MIN_REAL_PRESSURE, Math.min(1, e.pressure)), real: true };
  }

  return {
    pressure: e.buttons ? PEN_STARTUP_FALLBACK_PRESSURE : MIN_REAL_PRESSURE,
    real: false,
  };
}

export function backfillSyntheticStartupPressures(
  pressures: number[],
  firstRealPressure: number,
  fallback = PEN_STARTUP_FALLBACK_PRESSURE
) {
  for (let i = 0; i < pressures.length; i++) {
    if (pressures[i] !== fallback) break;
    pressures[i] = firstRealPressure;
  }
}
