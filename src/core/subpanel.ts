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
//
// Custom outlines (from Cut Subpanel) store an explicit closed polygon on
// SubPanel.points; subPanelOutline() is the single source of truth for clip,
// border, hit-test, and further cuts.
// ============================================================================

import { SubPanel, SubPanelShape, Vec2 } from "./types";
import { jitter } from "./rng";
import { brushByKey } from "../brushes/registry";

export function shapePoints(
  shape: SubPanelShape,
  bounds: { x: number; y: number; w: number; h: number },
  tail?: Vec2,
  points?: Vec2[]
): Vec2[] {
  if (shape === "custom") {
    if (points && points.length >= 3) return points.map((p) => ({ x: p.x, y: p.y }));
    return shapePoints("rect", bounds);
  }
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

/** Closed clip/border outline for any sub-panel shape. */
export function subPanelOutline(
  sp: Pick<SubPanel, "shape" | "bounds" | "tail" | "points">
): Vec2[] {
  return shapePoints(sp.shape, sp.bounds, sp.tail, sp.points);
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

/** Ray-cast point-in-polygon (even-odd). Boundary counts as inside. */
export function pointInPolygon(p: Vec2, points: Vec2[]): boolean {
  if (points.length < 3) return false;
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i].x, yi = points[i].y;
    const xj = points[j].x, yj = points[j].y;
    const onEdge =
      Math.abs((yi - yj) * (p.x - xi) - (xi - xj) * (p.y - yi)) < 1e-6 &&
      p.x >= Math.min(xi, xj) - 1e-6 && p.x <= Math.max(xi, xj) + 1e-6 &&
      p.y >= Math.min(yi, yj) - 1e-6 && p.y <= Math.max(yi, yj) + 1e-6;
    if (onEdge) return true;
    const intersect = ((yi > p.y) !== (yj > p.y)) &&
      (p.x < ((xj - xi) * (p.y - yi)) / ((yj - yi) || 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Hit-test against the true outline (AABB early-out, then polygon). */
export function isInsideSubPanel(
  x: number,
  y: number,
  sp: Pick<SubPanel, "shape" | "bounds" | "tail" | "points">
): boolean {
  if (!isInsideBounds(x, y, sp.bounds)) return false;
  if (sp.shape === "rect") return true;
  return pointInPolygon({ x, y }, subPanelOutline(sp));
}

export function boundsFromPoints(points: Vec2[]): { x: number; y: number; w: number; h: number } {
  if (points.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  let minX = points[0].x, maxX = points[0].x, minY = points[0].y, maxY = points[0].y;
  for (let i = 1; i < points.length; i++) {
    minX = Math.min(minX, points[i].x);
    maxX = Math.max(maxX, points[i].x);
    minY = Math.min(minY, points[i].y);
    maxY = Math.max(maxY, points[i].y);
  }
  return { x: minX, y: minY, w: Math.max(0, maxX - minX), h: Math.max(0, maxY - minY) };
}

export function polygonArea(points: Vec2[]): number {
  if (points.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) * 0.5;
}

/** Translate bounds / custom points / tail together. */
export function translateSubPanel(
  sp: Pick<SubPanel, "bounds" | "points" | "tail">,
  dx: number,
  dy: number
): void {
  sp.bounds.x += dx;
  sp.bounds.y += dy;
  if (sp.points) {
    for (const p of sp.points) { p.x += dx; p.y += dy; }
  }
  if (sp.tail) {
    sp.tail.x += dx;
    sp.tail.y += dy;
  }
}

/**
 * Apply a new AABB to a custom sub-panel by translating + uniformly scaling
 * its stored polygon to match.
 */
export function setSubPanelBounds(
  sp: SubPanel,
  next: { x: number; y: number; w: number; h: number }
): void {
  const prev = sp.bounds;
  if (sp.shape === "custom" && sp.points && sp.points.length >= 3 &&
      prev.w > 1e-6 && prev.h > 1e-6) {
    const sx = next.w / prev.w;
    const sy = next.h / prev.h;
    for (const p of sp.points) {
      p.x = next.x + (p.x - prev.x) * sx;
      p.y = next.y + (p.y - prev.y) * sy;
    }
  }
  sp.bounds = { ...next };
}

type EdgeHit = {
  point: Vec2;
  edgeIndex: number;
  edgeT: number;
  lineT: number;
};

function almostEqual(a: Vec2, b: Vec2, eps = 1e-4): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) < eps;
}

/** Intersect infinite line through a→b with segment p→q. */
function lineSegmentIntersect(
  a: Vec2, b: Vec2, p: Vec2, q: Vec2
): { point: Vec2; edgeT: number; lineT: number } | null {
  const rx = b.x - a.x, ry = b.y - a.y;
  const sx = q.x - p.x, sy = q.y - p.y;
  const denom = rx * sy - ry * sx;
  if (Math.abs(denom) < 1e-10) return null;
  const t = ((p.x - a.x) * sy - (p.y - a.y) * sx) / denom;
  const u = ((p.x - a.x) * ry - (p.y - a.y) * rx) / denom;
  if (u < -1e-9 || u > 1 + 1e-9) return null;
  return {
    point: { x: a.x + t * rx, y: a.y + t * ry },
    edgeT: Math.max(0, Math.min(1, u)),
    lineT: t,
  };
}

function cleanupPolygon(points: Vec2[]): Vec2[] {
  if (points.length === 0) return [];
  const out: Vec2[] = [];
  for (const p of points) {
    if (out.length === 0 || !almostEqual(out[out.length - 1], p)) out.push({ x: p.x, y: p.y });
  }
  if (out.length > 1 && almostEqual(out[0], out[out.length - 1])) out.pop();
  return out;
}

/**
 * Split a closed polygon with an infinite line through `a`→`b`.
 * Returns two polygons when the line crosses the boundary exactly twice
 * (one chord). Concave multi-cross cuts are rejected.
 */
export function splitPolygonByLine(
  polygon: Vec2[],
  a: Vec2,
  b: Vec2
): [Vec2[], Vec2[]] | null {
  if (polygon.length < 3) return null;
  if (Math.hypot(b.x - a.x, b.y - a.y) < 1e-6) return null;

  const hits: EdgeHit[] = [];
  for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i];
    const q = polygon[(i + 1) % polygon.length];
    const hit = lineSegmentIntersect(a, b, p, q);
    if (!hit) continue;
    // Skip duplicates at shared vertices (prefer the outgoing edge).
    if (hits.some((h) => almostEqual(h.point, hit.point))) continue;
    hits.push({ point: hit.point, edgeIndex: i, edgeT: hit.edgeT, lineT: hit.lineT });
  }

  if (hits.length !== 2) return null;

  // Order hits along the polygon boundary.
  hits.sort((h0, h1) =>
    h0.edgeIndex !== h1.edgeIndex ? h0.edgeIndex - h1.edgeIndex : h0.edgeT - h1.edgeT
  );
  const [hitA, hitB] = hits;

  const walk = (from: EdgeHit, to: EdgeHit): Vec2[] => {
    const pts: Vec2[] = [from.point];
    let i = (from.edgeIndex + 1) % polygon.length;
    const end = (to.edgeIndex + 1) % polygon.length;
    // Collect vertices strictly after `from` until the start of `to`'s edge.
    let guard = 0;
    while (i !== end && guard++ < polygon.length + 2) {
      pts.push(polygon[i]);
      i = (i + 1) % polygon.length;
    }
    pts.push(to.point);
    return cleanupPolygon(pts);
  };

  const left = walk(hitA, hitB);
  const right = walk(hitB, hitA);
  if (left.length < 3 || right.length < 3) return null;
  if (polygonArea(left) < 4 || polygonArea(right) < 4) return null;
  return [left, right];
}

/**
 * Does the infinite line through a→b cross this sub-panel's outline (usable cut)?
 */
export function lineCrossesSubPanel(
  sp: Pick<SubPanel, "shape" | "bounds" | "tail" | "points">,
  a: Vec2,
  b: Vec2
): boolean {
  return splitPolygonByLine(subPanelOutline(sp), a, b) !== null;
}

/** Replace the sub-panel's outline with an explicit custom polygon. */
export function applyCustomOutline(sp: SubPanel, points: Vec2[]): void {
  sp.shape = "custom";
  sp.points = points.map((p) => ({ x: p.x, y: p.y }));
  sp.bounds = boundsFromPoints(sp.points);
  delete sp.tail;
}

/** Geometry-only cut: returns the two resulting outlines, or null if invalid. */
export function cutSubPanelGeometry(
  sp: Pick<SubPanel, "shape" | "bounds" | "tail" | "points">,
  a: Vec2,
  b: Vec2
): { first: Vec2[]; second: Vec2[] } | null {
  const pieces = splitPolygonByLine(subPanelOutline(sp), a, b);
  if (!pieces) return null;
  return { first: pieces[0], second: pieces[1] };
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
