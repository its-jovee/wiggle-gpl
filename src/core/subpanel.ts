// ============================================================================
// core/subpanel.ts — comic-panel shape geometry + border stamping.
//
// shapePoints(shape, bounds, tail?) returns a CLOSED polyline approximating
// the chosen shape. We then:
//   - clip to that polyline (Path2D) when rendering the sub-panel's interior,
//   - stamp the SAME polyline with an existing registry brush to produce a
//     wiggling border that follows the shape.
//
// Reusing the brush registry for border stamping is what gives sub-panels
// every brush style for free (round, hatch, sumi, chonk, etc.).
// ============================================================================

import { SubPanelShape, Vec2 } from "./types";
import { jitter } from "./rng";
import { brushByKey } from "../brushes/registry";

export function shapePoints(
  shape: SubPanelShape,
  bounds: { x: number; y: number; w: number; h: number },
  tail?: Vec2
): Vec2[] {
  const { x, y, w, h } = bounds;
  switch (shape) {
    case "rect":
      return [
        { x, y },
        { x: x + w, y },
        { x: x + w, y: y + h },
        { x, y: y + h },
      ];

    case "rounded": {
      const r = Math.min(w, h) * 0.12;
      const pts: Vec2[] = [];
      const arc = (cx: number, cy: number, a0: number, a1: number, steps: number) => {
        for (let i = 0; i <= steps; i++) {
          const a = a0 + (a1 - a0) * (i / steps);
          pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
        }
      };
      arc(x + r, y + r, Math.PI, Math.PI * 1.5, 4);
      arc(x + w - r, y + r, Math.PI * 1.5, Math.PI * 2, 4);
      arc(x + w - r, y + h - r, 0, Math.PI * 0.5, 4);
      arc(x + r, y + h - r, Math.PI * 0.5, Math.PI, 4);
      return pts;
    }

    case "balloon": {
      const rx = w / 2;
      const ry = h / 2;
      const cx = x + rx;
      const cy = y + ry;
      const steps = 36;
      const pts: Vec2[] = [];
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        pts.push({ x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry });
      }
      if (tail) {
        // Find the segment of the ellipse closest to the tail apex, replace
        // one vertex with the tail point — creates a triangular tail.
        let best = 0;
        let bestD = Infinity;
        for (let i = 0; i < pts.length; i++) {
          const d = Math.hypot(pts[i].x - tail.x, pts[i].y - tail.y);
          if (d < bestD) { bestD = d; best = i; }
        }
        pts[best] = { x: tail.x, y: tail.y };
      }
      return pts;
    }

    case "thought": {
      const rx = w / 2;
      const ry = h / 2;
      const cx = x + rx;
      const cy = y + ry;
      const bumps = 10;
      const steps = bumps * 6;
      const pts: Vec2[] = [];
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        const bumpPhase = Math.cos(a * bumps);
        const r = 1 + 0.1 * bumpPhase;
        pts.push({ x: cx + Math.cos(a) * rx * r, y: cy + Math.sin(a) * ry * r });
      }
      return pts;
    }

    case "burst": {
      const rx = w / 2;
      const ry = h / 2;
      const cx = x + rx;
      const cy = y + ry;
      const spikes = 12;
      const pts: Vec2[] = [];
      for (let i = 0; i < spikes * 2; i++) {
        const a = (i / (spikes * 2)) * Math.PI * 2;
        const r = i % 2 === 0 ? 1 : 0.62;
        pts.push({ x: cx + Math.cos(a) * rx * r, y: cy + Math.sin(a) * ry * r });
      }
      return pts;
    }
  }
  return [];
}

export function pointsToPath(pts: Vec2[]): Path2D {
  const path = new Path2D();
  if (pts.length === 0) return path;
  path.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) path.lineTo(pts[i].x, pts[i].y);
  path.closePath();
  return path;
}

export function isInsideBounds(
  x: number,
  y: number,
  bounds: { x: number; y: number; w: number; h: number }
): boolean {
  return x >= bounds.x && x <= bounds.x + bounds.w &&
         y >= bounds.y && y <= bounds.y + bounds.h;
}

/**
 * Stamp a closed polyline with the given registry brush. Uses jitter() for
 * per-vertex wiggle so border determinism matches stroke determinism.
 */
export function strokeBorder(
  ctx: CanvasRenderingContext2D,
  points: Vec2[],
  brushKey: string,
  color: string,
  thickness: number,
  tick: number,
  amplitude: number,
  baseSeed: number,
  bg: string
) {
  if (points.length < 2) return;
  const brush = brushByKey(brushKey);
  const stampTick = amplitude === 0 ? baseSeed : tick;
  const jittered: Vec2[] = amplitude === 0
    ? points
    : points.map((p, i) => {
        const j = jitter(tick, baseSeed + i, i, amplitude, points.length);
        return { x: p.x + j.dx, y: p.y + j.dy };
      });
  for (let k = 0; k < jittered.length; k++) {
    const a = jittered[k];
    const b = jittered[(k + 1) % jittered.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const segLen = Math.hypot(dx, dy) || 0.0001;
    const ux = dx / segLen;
    const uy = dy / segLen;
    const delta = { x: dx, y: dy };
    const step = brush.spacing * thickness;
    for (let d = 0; d < segLen; d += step) {
      brush.stamp({
        ctx,
        pos: { x: a.x + ux * d, y: a.y + uy * d },
        delta,
        color,
        size: thickness,
        tick: stampTick,
        seed: baseSeed * 100 + k,
        bg,
      });
    }
  }
}

/** Cheap stable hash of a string id → non-negative integer seed. */
export function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = ((h << 5) - h + id.charCodeAt(i)) | 0;
  return Math.abs(h);
}
