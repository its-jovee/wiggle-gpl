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
  tiltX?: number;
  tiltY?: number;
};

export type PointerIdentityInput = {
  pointerType: string;
  pointerId: number;
  /** Chromium 128+ device identity. Zero means the browser did not expose it. */
  persistentDeviceId?: number;
};

/**
 * Remembers which PointerEvent streams belong to the pen and mouse. Some
 * tablet/Chromium combinations temporarily report the pen as `pointerType:
 * "mouse"` after the user switches devices. Pointer ids are the fallback;
 * persistentDeviceId makes the distinction durable when the browser exposes
 * it.
 */
export class PointerDeviceTracker {
  private sawPen = false;
  private readonly penPointerIds = new Set<number>();
  private readonly penDeviceIds = new Set<number>();
  private readonly mousePointerIds = new Set<number>();
  private readonly mouseDeviceIds = new Set<number>();

  private deviceId(e: PointerIdentityInput): number | null {
    const id = e.persistentDeviceId ?? 0;
    return Number.isFinite(id) && id > 0 ? id : null;
  }

  observePen(e: PointerIdentityInput): void {
    if (e.pointerType !== "pen") return;
    this.sawPen = true;
    this.penPointerIds.add(e.pointerId);
    this.mousePointerIds.delete(e.pointerId);
    const deviceId = this.deviceId(e);
    if (deviceId !== null) {
      this.penDeviceIds.add(deviceId);
      this.mouseDeviceIds.delete(deviceId);
    }
  }

  /** Record a pointer used for an unambiguously mouse-like action: clicking
   * editor chrome or panning the canvas. A stream already known as the pen is
   * deliberately not reclassified when Chromium merely changes its label. */
  observeMouse(e: PointerIdentityInput): void {
    if (e.pointerType !== "mouse" || this.isPenLike(e)) return;
    this.mousePointerIds.add(e.pointerId);
    const deviceId = this.deviceId(e);
    if (deviceId !== null) this.mouseDeviceIds.add(deviceId);
  }

  hasSeenPen(): boolean {
    return this.sawPen;
  }

  isPenLike(e: PointerIdentityInput): boolean {
    if (e.pointerType === "pen") return true;
    const deviceId = this.deviceId(e);
    return this.penPointerIds.has(e.pointerId)
      || (deviceId !== null && this.penDeviceIds.has(deviceId));
  }

  isKnownMouse(e: PointerIdentityInput): boolean {
    if (e.pointerType !== "mouse" || this.isPenLike(e)) return false;
    const deviceId = this.deviceId(e);
    return this.mousePointerIds.has(e.pointerId)
      || (deviceId !== null && this.mouseDeviceIds.has(deviceId));
  }

  /** A mouse-labelled stream from a different device can navigate the canvas
   * after a pen has been observed. The caller still applies a short hover-to-
   * contact grace period so a pen whose id changes is not mistaken for it. */
  isDistinctMouse(e: PointerIdentityInput): boolean {
    return this.sawPen && e.pointerType === "mouse" && !this.isPenLike(e);
  }

  /** Known mouse streams retain normal full-size mouse drawing. Unknown or
   * pen-owned mouse-labelled streams use stylus recovery while it is armed. */
  shouldRecoverPressure(e: PointerIdentityInput, recoveryArmed: boolean): boolean {
    if (e.pointerType !== "mouse") return recoveryArmed;
    if (this.isPenLike(e)) return true;
    return recoveryArmed && !this.isKnownMouse(e);
  }
}

export type PressureSample = {
  pressure: number;
  real: boolean;
};

export type PressureReadOptions = {
  /**
   * After mouse-wheel / keyboard interrupts, Chromium often demotes the stylus
   * to `pointerType: "mouse"` with the spec default pressure 0.5 (no variation).
   * When recovery is active, treat that as a synthetic pen sample instead of a
   * full-size mouse stroke.
   */
  recovery?: boolean;
  /** Filler used for synthetic samples during recovery / startup. */
  fallbackPressure?: number;
};

export const PEN_STARTUP_FALLBACK_PRESSURE = 0.25;
const MIN_REAL_PRESSURE = 0.01;

/** Spec default for devices that don't report pressure — also what Chromium
 *  commonly emits when a stylus stream has been demoted to mouse. */
export function isBrowserDefaultPressure(e: PointerPressureInput): boolean {
  return Math.abs(e.pressure - 0.5) < 1e-6;
}

export function readPointerPressure(
  e: PointerPressureInput,
  pressureEnabled: boolean,
  options: PressureReadOptions = {}
): PressureSample {
  const fallback = options.fallbackPressure ?? PEN_STARTUP_FALLBACK_PRESSURE;
  if (!pressureEnabled) {
    return { pressure: 1, real: true };
  }

  if (e.pointerType === "mouse") {
    // After wheel/undo the tablet often keeps delivering mouse events with the
    // browser default half-pressure. Some tablet drivers retain their varying
    // pressure values even while mislabelling the stream as mouse, so preserve
    // those real values and use the fallback only for the exact spec default.
    if (options.recovery) {
      if (e.pressure > 0 && !isBrowserDefaultPressure(e)) {
        return { pressure: Math.max(MIN_REAL_PRESSURE, Math.min(1, e.pressure)), real: true };
      }
      return { pressure: fallback, real: false };
    }
    return { pressure: 1, real: true };
  }

  if (e.pressure > 0) {
    // A real pen stream is authoritative. In particular, 0.5 is a perfectly
    // valid user pressure; treating it as synthetic freezes sensitivity after
    // an interrupt on tablets that do not report tilt.
    return { pressure: Math.max(MIN_REAL_PRESSURE, Math.min(1, e.pressure)), real: true };
  }

  return {
    pressure: e.buttons ? fallback : MIN_REAL_PRESSURE,
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

/** Replace the first `count` samples once the tablet reports a real pressure.
 *  Prefer this over value-matching when the synthetic filler is the last known
 *  real pressure (common after keyboard interrupts like undo). */
export function backfillLeadingPressures(
  pressures: number[],
  count: number,
  firstRealPressure: number
) {
  const n = Math.max(0, Math.min(count, pressures.length));
  for (let i = 0; i < n; i++) pressures[i] = firstRealPressure;
}
