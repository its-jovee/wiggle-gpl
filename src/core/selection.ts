// ============================================================================
// core/selection.ts — selection geometry, masks, and transform math.
//
// Pure functions over shapes and stroke data. Editor wiring lives in main.ts;
// document-level clip shapes live on Fill.clipShape in types.ts.
// ============================================================================

import type { Fill, Layer, LayerMask, SelectionShape, Stroke, SubPanel, TextElement, Vec2 } from "./types";
import { SIMPLIFY_TOLERANCE } from "./input";

export type Rect = { x: number; y: number; w: number; h: number };

export type RasterSelectionPayload = {
  layer: Layer;
  /** Immutable, tightly-cropped selected pixels in their original orientation. */
  pixels: HTMLCanvasElement;
  /** Layer pixels with this selection removed. */
  base: HTMLCanvasElement;
  /** Unrotated destination frame in layer coordinates. */
  frame: Rect;
  rotation: number;
};

export type MarqueeRef =
  | { kind: "stroke"; layer: Layer; stroke: Stroke }
  | { kind: "fill"; layer: Layer; fill: Fill }
  | { kind: "text"; layer: Layer; text: TextElement }
  | { kind: "raster"; layer: Layer; selection: RasterSelectionPayload }
  | { kind: "subpanel"; subPanel: SubPanel };

export type MarqueeToolKind = "rect" | "ellipse" | "lasso";

export type TransformHandleId = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "rotate";
export type TransformCursor = "nwse-resize" | "nesw-resize" | "ns-resize" | "ew-resize" | string;

export type SelectionState =
  | {
      mode: "region";
      phase: "creating" | "idle" | "moving";
      shape: SelectionShape;
      tool: MarqueeToolKind;
      inverted?: boolean;
      featherPx?: number;
      lastPos?: Vec2;
      lassoPath?: Vec2[];
    }
  | {
      mode: "object";
      phase: "idle" | "moving" | "transforming";
      shape: SelectionShape;
      bounds: Rect;
      items: MarqueeRef[];
      lastPos?: Vec2;
      transformHandle?: TransformHandleId;
      transformPivot?: Vec2;
      transformStartBounds?: Rect;
      transformStartAngle?: number;
      transformStartDist?: number;
    };

const EPS = 1e-9;

function rasterPayloadBounds(selection: RasterSelectionPayload): Rect {
  const { frame, rotation } = selection;
  if (rotation === 0) return { ...frame };
  const width = Math.abs(frame.w * Math.cos(rotation)) + Math.abs(frame.h * Math.sin(rotation));
  const height = Math.abs(frame.w * Math.sin(rotation)) + Math.abs(frame.h * Math.cos(rotation));
  return {
    x: frame.x + frame.w / 2 - width / 2,
    y: frame.y + frame.h / 2 - height / 2,
    w: width,
    h: height,
  };
}

function dragBounds(
  a: Vec2,
  b: Vec2,
  constrainSquare: boolean,
  fromCenter: boolean
): Rect {
  let dx = b.x - a.x;
  let dy = b.y - a.y;
  if (constrainSquare) {
    const extent = Math.max(Math.abs(dx), Math.abs(dy));
    dx = (dx < 0 ? -1 : 1) * extent;
    dy = (dy < 0 ? -1 : 1) * extent;
  }
  if (fromCenter) {
    return {
      x: a.x - Math.abs(dx),
      y: a.y - Math.abs(dy),
      w: Math.abs(dx) * 2,
      h: Math.abs(dy) * 2,
    };
  }
  return {
    x: Math.min(a.x, a.x + dx),
    y: Math.min(a.y, a.y + dy),
    w: Math.abs(dx),
    h: Math.abs(dy),
  };
}

export function rectFromDrag(
  a: Vec2,
  b: Vec2,
  constrainSquare = false,
  fromCenter = false
): SelectionShape {
  const { x, y, w, h } = dragBounds(a, b, constrainSquare, fromCenter);
  return { kind: "rect", x, y, w, h };
}

export function ellipseFromDrag(
  a: Vec2,
  b: Vec2,
  constrainCircle = false,
  fromCenter = false
): SelectionShape {
  const { x, y, w, h } = dragBounds(a, b, constrainCircle, fromCenter);
  return { kind: "ellipse", cx: x + w / 2, cy: y + h / 2, rx: w / 2, ry: h / 2 };
}

/** Time-based marching-ants phase, independent of display refresh rate. */
export function marqueeAntsOffset(nowMs: number, cyclePx = 12, pxPerSecond = 24): number {
  const cycle = Math.max(1, cyclePx);
  const offset = (nowMs * pxPerSecond) / 1000;
  return ((offset % cycle) + cycle) % cycle;
}

export function polygonFromPoints(points: Vec2[]): SelectionShape {
  return { kind: "polygon", points: [...points] };
}

export function shapeBounds(shape: SelectionShape): Rect {
  if (shape.kind === "rect") {
    return { x: shape.x, y: shape.y, w: shape.w, h: shape.h };
  }
  if (shape.kind === "ellipse") {
    return {
      x: shape.cx - shape.rx,
      y: shape.cy - shape.ry,
      w: shape.rx * 2,
      h: shape.ry * 2,
    };
  }
  if (shape.points.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  let minX = shape.points[0].x, maxX = shape.points[0].x;
  let minY = shape.points[0].y, maxY = shape.points[0].y;
  for (const p of shape.points) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function shapeMeetsMinSize(shape: SelectionShape, min = 10): boolean {
  if (shape.kind === "polygon") {
    if (shape.points.length < 3) return false;
    let perimeter = 0;
    for (let i = 0; i < shape.points.length; i++) {
      const a = shape.points[i];
      const b = shape.points[(i + 1) % shape.points.length];
      perimeter += Math.hypot(b.x - a.x, b.y - a.y);
    }
    return perimeter >= min * 4;
  }
  const b = shapeBounds(shape);
  return b.w >= min && b.h >= min;
}

export function pointInRect(p: Vec2, r: Rect): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

export function pointInShape(p: Vec2, shape: SelectionShape): boolean {
  if (shape.kind === "rect") {
    return pointInRect(p, { x: shape.x, y: shape.y, w: shape.w, h: shape.h });
  }
  if (shape.kind === "ellipse") {
    if (shape.rx <= 0 || shape.ry <= 0) return false;
    const nx = (p.x - shape.cx) / shape.rx;
    const ny = (p.y - shape.cy) / shape.ry;
    return nx * nx + ny * ny <= 1;
  }
  return pointInPolygon(p, shape.points);
}

export function activeRegionContains(state: SelectionState | null, p: Vec2): boolean {
  if (!state || state.mode !== "region" || state.phase === "creating") return true;
  return pointInRegionSelection(p, state.shape, !!state.inverted);
}

export function pointInRegionSelection(p: Vec2, shape: SelectionShape, inverted = false): boolean {
  const inside = pointInShape(p, shape);
  return inverted ? !inside : inside;
}

export function pointInLayerMask(p: Vec2, mask: LayerMask | undefined): boolean {
  if (!mask || !mask.enabled) return true;
  const inside = pointInShape(p, mask.shape);
  return mask.mode === "reveal" ? inside : !inside;
}

export function pointInPolygon(p: Vec2, points: Vec2[]): boolean {
  if (points.length < 3) return false;
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i].x, yi = points[i].y;
    const xj = points[j].x, yj = points[j].y;
    const intersect = ((yi > p.y) !== (yj > p.y)) &&
      (p.x < ((xj - xi) * (p.y - yi)) / (yj - yi + EPS) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function segmentLineIntersection(
  a: Vec2, b: Vec2, c: Vec2, d: Vec2
): { t: number; point: Vec2 } | null {
  const dx1 = b.x - a.x, dy1 = b.y - a.y;
  const dx2 = d.x - c.x, dy2 = d.y - c.y;
  const denom = dx1 * dy2 - dy1 * dx2;
  if (Math.abs(denom) < EPS) return null;
  const t = ((c.x - a.x) * dy2 - (c.y - a.y) * dx2) / denom;
  const u = ((c.x - a.x) * dy1 - (c.y - a.y) * dx1) / denom;
  if (t <= EPS || t >= 1 - EPS || u < -EPS || u > 1 + EPS) return null;
  return { t, point: { x: a.x + dx1 * t, y: a.y + dy1 * t } };
}

export function segmentRectIntersections(a: Vec2, b: Vec2, r: Rect): { t: number; point: Vec2 }[] {
  const out: { t: number; point: Vec2 }[] = [];
  const x0 = r.x, x1 = r.x + r.w, y0 = r.y, y1 = r.y + r.h;
  const edges: [Vec2, Vec2][] = [
    [{ x: x0, y: y0 }, { x: x1, y: y0 }],
    [{ x: x1, y: y0 }, { x: x1, y: y1 }],
    [{ x: x1, y: y1 }, { x: x0, y: y1 }],
    [{ x: x0, y: y1 }, { x: x0, y: y0 }],
  ];
  for (const [c, d] of edges) {
    const hit = segmentLineIntersection(a, b, c, d);
    if (hit) out.push(hit);
  }
  out.sort((p, q) => p.t - q.t);
  for (let i = out.length - 1; i >= 1; i--) {
    if (Math.abs(out[i].t - out[i - 1].t) < 1e-6) out.splice(i, 1);
  }
  return out;
}

export function segmentShapeIntersections(a: Vec2, b: Vec2, shape: SelectionShape): { t: number; point: Vec2 }[] {
  if (shape.kind === "rect") {
    return segmentRectIntersections(a, b, { x: shape.x, y: shape.y, w: shape.w, h: shape.h });
  }
  if (shape.kind === "ellipse") {
    return segmentEllipseIntersections(a, b, shape);
  }
  return segmentPolygonIntersections(a, b, shape.points);
}

function segmentEllipseIntersections(a: Vec2, b: Vec2, e: SelectionShape & { kind: "ellipse" }): { t: number; point: Vec2 }[] {
  if (e.rx <= 0 || e.ry <= 0) return [];
  const out: { t: number; point: Vec2 }[] = [];
  const ox = a.x - e.cx, oy = a.y - e.cy;
  const dx = b.x - a.x, dy = b.y - a.y;
  const A = (dx * dx) / (e.rx * e.rx) + (dy * dy) / (e.ry * e.ry);
  const B = 2 * ((ox * dx) / (e.rx * e.rx) + (oy * dy) / (e.ry * e.ry));
  const C = (ox * ox) / (e.rx * e.rx) + (oy * oy) / (e.ry * e.ry) - 1;
  if (Math.abs(A) < EPS) return out;
  const disc = B * B - 4 * A * C;
  if (disc < 0) return out;
  const s = Math.sqrt(Math.max(0, disc));
  for (const t of [(-B - s) / (2 * A), (-B + s) / (2 * A)]) {
    if (t > EPS && t < 1 - EPS) {
      out.push({ t, point: { x: a.x + dx * t, y: a.y + dy * t } });
    }
  }
  out.sort((p, q) => p.t - q.t);
  return out;
}

function segmentPolygonIntersections(a: Vec2, b: Vec2, points: Vec2[]): { t: number; point: Vec2 }[] {
  const out: { t: number; point: Vec2 }[] = [];
  if (points.length < 2) return out;
  for (let i = 0; i < points.length; i++) {
    const c = points[i];
    const d = points[(i + 1) % points.length];
    const hit = segmentLineIntersection(a, b, c, d);
    if (hit) out.push(hit);
  }
  out.sort((p, q) => p.t - q.t);
  for (let i = out.length - 1; i >= 1; i--) {
    if (Math.abs(out[i].t - out[i - 1].t) < 1e-6) out.splice(i, 1);
  }
  return out;
}

export function splitStrokeAtShape(stroke: Stroke, shape: SelectionShape): { inside: Stroke[]; outside: Stroke[] } {
  const pts = stroke.points;
  const pres = stroke.pressures;
  const inside: Stroke[] = [];
  const outside: Stroke[] = [];
  if (pts.length === 0) return { inside, outside };

  type Pt = { x: number; y: number; pressure: number };
  let currentPts: Pt[] = [];
  let currentInside = pointInShape(pts[0], shape);
  currentPts.push({ x: pts[0].x, y: pts[0].y, pressure: pres?.[0] ?? 1 });

  const flush = () => {
    if (currentPts.length === 0) return;
    const seg: Stroke = {
      brush: stroke.brush, color: stroke.color, size: stroke.size,
      erase: stroke.erase,
      points: currentPts.map((p) => ({ x: p.x, y: p.y })),
      pressures: pres ? currentPts.map((p) => p.pressure) : undefined,
      brushSettings: stroke.brushSettings ? { ...stroke.brushSettings } : undefined,
    };
    (currentInside ? inside : outside).push(seg);
    currentPts = [];
  };

  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const pA = pres?.[i - 1] ?? 1;
    const pB = pres?.[i] ?? 1;
    const ints = segmentShapeIntersections(a, b, shape);
    if (ints.length === 0) {
      currentPts.push({ x: b.x, y: b.y, pressure: pB });
    } else {
      for (const inter of ints) {
        const pAtT = pA + (pB - pA) * inter.t;
        currentPts.push({ x: inter.point.x, y: inter.point.y, pressure: pAtT });
        flush();
        currentInside = !currentInside;
        currentPts.push({ x: inter.point.x, y: inter.point.y, pressure: pAtT });
      }
      currentPts.push({ x: b.x, y: b.y, pressure: pB });
    }
  }
  flush();
  return { inside, outside };
}

export function traceShapePath(ctx: CanvasRenderingContext2D, shape: SelectionShape): void {
  if (shape.kind === "rect") {
    ctx.rect(shape.x, shape.y, shape.w, shape.h);
    return;
  }
  if (shape.kind === "ellipse") {
    ctx.ellipse(shape.cx, shape.cy, shape.rx, shape.ry, 0, 0, Math.PI * 2);
    return;
  }
  if (shape.points.length === 0) return;
  ctx.moveTo(shape.points[0].x, shape.points[0].y);
  for (let i = 1; i < shape.points.length; i++) {
    ctx.lineTo(shape.points[i].x, shape.points[i].y);
  }
  ctx.closePath();
}

export function rasterizeShapeMask(shape: SelectionShape, width: number, height: number): Uint8Array {
  const mask = new Uint8Array(width * height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  traceShapePath(ctx, shape);
  ctx.fill();
  const img = ctx.getImageData(0, 0, width, height);
  for (let i = 0; i < width * height; i++) {
    mask[i] = img.data[i * 4 + 3] > 127 ? 1 : 0;
  }
  return mask;
}

export function applyShapeMaskToImageData(
  img: ImageData,
  shape: SelectionShape,
  width: number,
  height: number,
  inverted = false
): void {
  const mask = rasterizeShapeMask(shape, width, height);
  const d = img.data;
  for (let i = 0; i < width * height; i++) {
    const keep = inverted ? !mask[i] : !!mask[i];
    if (!keep) {
      const p = i * 4;
      d[p + 3] = 0;
    }
  }
}

export function mixSelectionShape(h: number, shape: SelectionShape | undefined, mixHash: (h: number, n: number) => number, mixFloat: (h: number, n: number) => number): number {
  if (!shape) return mixHash(h, 0);
  h = mixHash(h, 1);
  h = mixHash(h, shape.kind === "rect" ? 1 : shape.kind === "ellipse" ? 2 : 3);
  if (shape.kind === "rect") {
    h = mixFloat(h, shape.x);
    h = mixFloat(h, shape.y);
    h = mixFloat(h, shape.w);
    h = mixFloat(h, shape.h);
  } else if (shape.kind === "ellipse") {
    h = mixFloat(h, shape.cx);
    h = mixFloat(h, shape.cy);
    h = mixFloat(h, shape.rx);
    h = mixFloat(h, shape.ry);
  } else {
    h = mixHash(h, shape.points.length);
    for (const p of shape.points) {
      h = mixFloat(h, p.x);
      h = mixFloat(h, p.y);
    }
  }
  return h;
}

/** Simplify a freehand lasso path into a closed polygon. */
export function simplifyLassoPath(points: Vec2[], tolerance = SIMPLIFY_TOLERANCE): Vec2[] {
  if (points.length <= 3) return [...points];
  const closed = [...points, points[0]];
  const keep = new Array<boolean>(closed.length).fill(false);
  keep[0] = true;
  keep[closed.length - 1] = true;

  const rdp = (start: number, end: number) => {
    if (end <= start + 1) return;
    let maxDist = 0;
    let maxIdx = start;
    const a = closed[start], b = closed[end];
    for (let i = start + 1; i < end; i++) {
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      const dist = len === 0
        ? Math.hypot(closed[i].x - a.x, closed[i].y - a.y)
        : Math.abs(dy * closed[i].x - dx * closed[i].y + b.x * a.y - b.y * a.x) / len;
      if (dist > maxDist) { maxDist = dist; maxIdx = i; }
    }
    if (maxDist > tolerance) {
      keep[maxIdx] = true;
      rdp(start, maxIdx);
      rdp(maxIdx, end);
    }
  };
  rdp(0, closed.length - 1);
  const out: Vec2[] = [];
  for (let i = 0; i < closed.length - 1; i++) {
    if (keep[i]) out.push({ x: closed[i].x, y: closed[i].y });
  }
  return out.length >= 3 ? out : [...points];
}

export function rectCenter(r: Rect): Vec2 {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

export function transformPoint(
  p: Vec2,
  pivot: Vec2,
  scaleX: number,
  scaleY: number,
  angleRad: number
): Vec2 {
  let x = p.x - pivot.x;
  let y = p.y - pivot.y;
  x *= scaleX;
  y *= scaleY;
  if (angleRad !== 0) {
    const c = Math.cos(angleRad), s = Math.sin(angleRad);
    const rx = x * c - y * s;
    const ry = x * s + y * c;
    x = rx;
    y = ry;
  }
  return { x: x + pivot.x, y: y + pivot.y };
}

export function transformShape(shape: SelectionShape, pivot: Vec2, scaleX: number, scaleY: number, angleRad: number): SelectionShape {
  if (shape.kind === "rect") {
    const corners = [
      { x: shape.x, y: shape.y },
      { x: shape.x + shape.w, y: shape.y },
      { x: shape.x + shape.w, y: shape.y + shape.h },
      { x: shape.x, y: shape.y + shape.h },
    ].map((p) => transformPoint(p, pivot, scaleX, scaleY, angleRad));
    return polygonFromPoints(corners);
  }
  if (shape.kind === "ellipse") {
    const c = transformPoint({ x: shape.cx, y: shape.cy }, pivot, scaleX, scaleY, angleRad);
    return { kind: "ellipse", cx: c.x, cy: c.y, rx: shape.rx * Math.abs(scaleX), ry: shape.ry * Math.abs(scaleY) };
  }
  return polygonFromPoints(shape.points.map((p) => transformPoint(p, pivot, scaleX, scaleY, angleRad)));
}

const HANDLE_SIZE = 12;
const ROTATE_HANDLE_OFFSET = 36;
const ROTATE_CURSOR = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'%3E%3Cpath d='M17.6 6.4A7.9 7.9 0 0 0 4.8 10' fill='none' stroke='%230e0e16' stroke-width='5' stroke-linecap='round' stroke-linejoin='round'/%3E%3Cpath d='M17.6 6.4A7.9 7.9 0 0 0 4.8 10' fill='none' stroke='%23ffcd75' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'/%3E%3Cpath d='M17.5 2.5v4.2h-4.2' fill='none' stroke='%230e0e16' stroke-width='5' stroke-linecap='round' stroke-linejoin='round'/%3E%3Cpath d='M17.5 2.5v4.2h-4.2' fill='none' stroke='%23ffcd75' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'/%3E%3Cpath d='M6.4 17.6A7.9 7.9 0 0 0 19.2 14' fill='none' stroke='%230e0e16' stroke-width='5' stroke-linecap='round' stroke-linejoin='round'/%3E%3Cpath d='M6.4 17.6A7.9 7.9 0 0 0 19.2 14' fill='none' stroke='%23ffcd75' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'/%3E%3Cpath d='M6.5 21.5v-4.2h4.2' fill='none' stroke='%230e0e16' stroke-width='5' stroke-linecap='round' stroke-linejoin='round'/%3E%3Cpath d='M6.5 21.5v-4.2h4.2' fill='none' stroke='%23ffcd75' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") 12 12, grab`;

export function transformHandleVisualHalfSize(scale = 1): number {
  return HANDLE_SIZE / (2 * scale);
}

export function transformRotateHandleCenter(bounds: Rect, scale = 1): Vec2 {
  return { x: bounds.x + bounds.w / 2, y: bounds.y - ROTATE_HANDLE_OFFSET / scale };
}

/** True when `pos` is on the rotate knob or the stem that connects it to the
 *  top edge of `bounds`. The stem is part of the rotate chrome — clicks there
 *  must not fall through as "outside the selection". */
export function hitTestRotateHandle(pos: Vec2, bounds: Rect, scale = 1): boolean {
  const safeScale = Math.max(scale, 0.001);
  const hs = HANDLE_SIZE / safeScale;
  const rot = transformRotateHandleCenter(bounds, safeScale);
  // Generous knob hit — larger than the drawn circle so a fingertip/stylus
  // click on the visible handle still registers.
  if (Math.hypot(pos.x - rot.x, pos.y - rot.y) <= hs * 2) return true;
  // Stem between the top-center of the box and the knob. Skip the portion that
  // overlaps the north edge handle so scale-from-top still works.
  const stemTop = { x: bounds.x + bounds.w / 2, y: bounds.y - hs };
  if (stemTop.y <= rot.y) return false;
  const dx = rot.x - stemTop.x;
  const dy = rot.y - stemTop.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < EPS) return false;
  const t = Math.max(0, Math.min(1, ((pos.x - stemTop.x) * dx + (pos.y - stemTop.y) * dy) / len2));
  const nearestX = stemTop.x + t * dx;
  const nearestY = stemTop.y + t * dy;
  return Math.hypot(pos.x - nearestX, pos.y - nearestY) <= hs * 0.75;
}

export function hitTestTransformHandle(
  pos: Vec2,
  bounds: Rect,
  scale = 1
): TransformHandleId | null {
  const safeScale = Math.max(scale, 0.001);
  const hs = HANDLE_SIZE / safeScale;
  const corners: [TransformHandleId, Vec2][] = [
    ["nw", { x: bounds.x, y: bounds.y }],
    ["ne", { x: bounds.x + bounds.w, y: bounds.y }],
    ["se", { x: bounds.x + bounds.w, y: bounds.y + bounds.h }],
    ["sw", { x: bounds.x, y: bounds.y + bounds.h }],
  ];
  for (const [id, p] of corners) {
    if (Math.abs(pos.x - p.x) <= hs && Math.abs(pos.y - p.y) <= hs) return id;
  }
  const mids: [TransformHandleId, Vec2][] = [
    ["n", { x: bounds.x + bounds.w / 2, y: bounds.y }],
    ["e", { x: bounds.x + bounds.w, y: bounds.y + bounds.h / 2 }],
    ["s", { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h }],
    ["w", { x: bounds.x, y: bounds.y + bounds.h / 2 }],
  ];
  for (const [id, p] of mids) {
    if (Math.abs(pos.x - p.x) <= hs && Math.abs(pos.y - p.y) <= hs) return id;
  }
  // Rotate chrome sits above the box — checked after edge handles so the
  // north-edge scale grip keeps priority on the top-center square, while the
  // knob/stem above still rotate instead of starting a new marquee.
  if (hitTestRotateHandle(pos, bounds, safeScale)) return "rotate";
  return null;
}

export function transformCursorForHandle(handle: TransformHandleId): TransformCursor {
  if (handle === "nw" || handle === "se") return "nwse-resize";
  if (handle === "ne" || handle === "sw") return "nesw-resize";
  if (handle === "n" || handle === "s") return "ns-resize";
  if (handle === "e" || handle === "w") return "ew-resize";
  return ROTATE_CURSOR;
}

export function computeTransformFromHandle(
  handle: TransformHandleId,
  startBounds: Rect,
  pivot: Vec2,
  pos: Vec2,
  constrainAspect: boolean,
  fromCenter: boolean
): { scaleX: number; scaleY: number; angleRad: number } {
  if (handle === "rotate") {
    const angle = Math.atan2(pos.y - pivot.y, pos.x - pivot.x) - Math.PI / 2;
    return { scaleX: 1, scaleY: 1, angleRad: angle };
  }

  const opp: Record<string, Vec2> = {
    nw: { x: startBounds.x + startBounds.w, y: startBounds.y + startBounds.h },
    ne: { x: startBounds.x, y: startBounds.y + startBounds.h },
    se: { x: startBounds.x, y: startBounds.y },
    sw: { x: startBounds.x + startBounds.w, y: startBounds.y },
    n: { x: startBounds.x + startBounds.w / 2, y: startBounds.y + startBounds.h },
    s: { x: startBounds.x + startBounds.w / 2, y: startBounds.y },
    e: { x: startBounds.x, y: startBounds.y + startBounds.h / 2 },
    w: { x: startBounds.x + startBounds.w, y: startBounds.y + startBounds.h / 2 },
  };
  const anchor = fromCenter ? pivot : (opp[handle] ?? pivot);
  const startW = Math.max(EPS, startBounds.w);
  const startH = Math.max(EPS, startBounds.h);

  let scaleX = 1, scaleY = 1;
  if (handle === "e" || handle === "w" || handle === "ne" || handle === "nw" || handle === "se" || handle === "sw") {
    scaleX = Math.abs(pos.x - anchor.x) / (startW / 2);
    if (!fromCenter && (handle === "w" || handle === "nw" || handle === "sw")) scaleX = Math.abs(anchor.x - pos.x) / startW;
    if (fromCenter) scaleX = Math.abs(pos.x - pivot.x) / (startW / 2);
  }
  if (handle === "n" || handle === "s" || handle === "ne" || handle === "nw" || handle === "se" || handle === "sw") {
    scaleY = Math.abs(pos.y - anchor.y) / (startH / 2);
    if (!fromCenter && (handle === "n" || handle === "ne" || handle === "nw")) scaleY = Math.abs(anchor.y - pos.y) / startH;
    if (fromCenter) scaleY = Math.abs(pos.y - pivot.y) / (startH / 2);
  }

  if (constrainAspect) {
    const s = Math.max(scaleX, scaleY);
    scaleX = s;
    scaleY = s;
  }
  scaleX = Math.max(0.01, scaleX);
  scaleY = Math.max(0.01, scaleY);
  return { scaleX, scaleY, angleRad: 0 };
}

export type ItemSnapshot = {
  ref: MarqueeRef;
  strokePoints?: Vec2[];
  strokeSize?: number;
  strokePressures?: number[];
  fillPoint?: Vec2;
  fillClipShape?: SelectionShape;
  textX?: number;
  textY?: number;
  textSize?: number;
  textRotation?: number;
  subBounds?: Rect;
  subTail?: Vec2;
  subPoints?: Vec2[];
  rasterFrame?: Rect;
  rasterRotation?: number;
};

export function snapshotItems(items: MarqueeRef[]): ItemSnapshot[] {
  return items.map((ref) => {
    const snap: ItemSnapshot = { ref };
    if (ref.kind === "stroke") {
      snap.strokePoints = ref.stroke.points.map((p) => ({ x: p.x, y: p.y }));
      snap.strokeSize = ref.stroke.size;
      snap.strokePressures = ref.stroke.pressures ? [...ref.stroke.pressures] : undefined;
    } else if (ref.kind === "fill") {
      snap.fillPoint = { x: ref.fill.point.x, y: ref.fill.point.y };
      snap.fillClipShape = ref.fill.clipShape ? JSON.parse(JSON.stringify(ref.fill.clipShape)) : undefined;
    } else if (ref.kind === "text") {
      snap.textX = ref.text.x;
      snap.textY = ref.text.y;
      snap.textSize = ref.text.fontSize;
      snap.textRotation = ref.text.rotation ?? 0;
    } else if (ref.kind === "subpanel") {
      snap.subBounds = { ...ref.subPanel.bounds };
      snap.subTail = ref.subPanel.tail ? { ...ref.subPanel.tail } : undefined;
      snap.subPoints = ref.subPanel.points?.map((p) => ({ x: p.x, y: p.y }));
    } else if (ref.kind === "raster") {
      snap.rasterFrame = { ...ref.selection.frame };
      snap.rasterRotation = ref.selection.rotation;
    }
    return snap;
  });
}

export function restoreFromSnapshot(snap: ItemSnapshot): void {
  const ref = snap.ref;
  if (ref.kind === "stroke" && snap.strokePoints) {
    for (let i = 0; i < ref.stroke.points.length; i++) {
      ref.stroke.points[i].x = snap.strokePoints[i].x;
      ref.stroke.points[i].y = snap.strokePoints[i].y;
    }
    if (snap.strokeSize !== undefined) ref.stroke.size = snap.strokeSize;
    if (snap.strokePressures) ref.stroke.pressures = [...snap.strokePressures];
  } else if (ref.kind === "fill" && snap.fillPoint) {
    ref.fill.point.x = snap.fillPoint.x;
    ref.fill.point.y = snap.fillPoint.y;
    ref.fill.clipShape = snap.fillClipShape ? JSON.parse(JSON.stringify(snap.fillClipShape)) : undefined;
  } else if (ref.kind === "text" && snap.textX !== undefined && snap.textY !== undefined) {
    ref.text.x = snap.textX;
    ref.text.y = snap.textY;
    if (snap.textSize !== undefined) ref.text.fontSize = snap.textSize;
    ref.text.rotation = snap.textRotation ?? 0;
  } else if (ref.kind === "subpanel" && snap.subBounds) {
    ref.subPanel.bounds = { ...snap.subBounds };
    ref.subPanel.tail = snap.subTail ? { ...snap.subTail } : undefined;
    ref.subPanel.points = snap.subPoints?.map((p) => ({ x: p.x, y: p.y }));
  } else if (ref.kind === "raster" && snap.rasterFrame) {
    ref.selection.frame = { ...snap.rasterFrame };
    ref.selection.rotation = snap.rasterRotation ?? 0;
  }
}

export function applyTransformToSnapshot(
  snap: ItemSnapshot,
  pivot: Vec2,
  scaleX: number,
  scaleY: number,
  angleRad: number,
  allowRotation: boolean
): void {
  const ref = snap.ref;
  const sizeScale = Math.sqrt(Math.abs(scaleX * scaleY));
  if (ref.kind === "stroke" && snap.strokePoints) {
    for (let i = 0; i < ref.stroke.points.length; i++) {
      const t = transformPoint(snap.strokePoints[i], pivot, scaleX, scaleY, allowRotation ? angleRad : 0);
      ref.stroke.points[i].x = t.x;
      ref.stroke.points[i].y = t.y;
    }
    if (snap.strokeSize !== undefined) ref.stroke.size = snap.strokeSize * sizeScale;
  } else if (ref.kind === "fill" && snap.fillPoint) {
    const t = transformPoint(snap.fillPoint, pivot, scaleX, scaleY, allowRotation ? angleRad : 0);
    ref.fill.point.x = t.x;
    ref.fill.point.y = t.y;
    if (snap.fillClipShape) {
      ref.fill.clipShape = transformShape(snap.fillClipShape, pivot, scaleX, scaleY, allowRotation ? angleRad : 0);
    }
  } else if (ref.kind === "text" && snap.textX !== undefined && snap.textY !== undefined) {
    const t = transformPoint({ x: snap.textX, y: snap.textY }, pivot, scaleX, scaleY, allowRotation ? angleRad : 0);
    ref.text.x = t.x;
    ref.text.y = t.y;
    if (snap.textSize !== undefined) ref.text.fontSize = snap.textSize * sizeScale;
    if (allowRotation) ref.text.rotation = (snap.textRotation ?? 0) + angleRad;
  } else if (ref.kind === "subpanel" && snap.subBounds) {
    if (snap.subPoints && snap.subPoints.length >= 3) {
      const pts = snap.subPoints.map((p) => transformPoint(p, pivot, scaleX, scaleY, 0));
      let minX = pts[0].x, maxX = pts[0].x, minY = pts[0].y, maxY = pts[0].y;
      for (const c of pts) {
        minX = Math.min(minX, c.x); maxX = Math.max(maxX, c.x);
        minY = Math.min(minY, c.y); maxY = Math.max(maxY, c.y);
      }
      ref.subPanel.shape = "custom";
      ref.subPanel.points = pts;
      ref.subPanel.bounds = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
      ref.subPanel.tail = undefined;
    } else {
      const b = snap.subBounds;
      const corners = [
        { x: b.x, y: b.y },
        { x: b.x + b.w, y: b.y },
        { x: b.x + b.w, y: b.y + b.h },
        { x: b.x, y: b.y + b.h },
      ].map((p) => transformPoint(p, pivot, scaleX, scaleY, 0));
      let minX = corners[0].x, maxX = corners[0].x, minY = corners[0].y, maxY = corners[0].y;
      for (const c of corners) {
        minX = Math.min(minX, c.x); maxX = Math.max(maxX, c.x);
        minY = Math.min(minY, c.y); maxY = Math.max(maxY, c.y);
      }
      ref.subPanel.bounds = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
      if (snap.subTail) {
        const tt = transformPoint(snap.subTail, pivot, scaleX, scaleY, 0);
        ref.subPanel.tail = tt;
      }
    }
  } else if (ref.kind === "raster" && snap.rasterFrame) {
    const frame = snap.rasterFrame;
    const center = transformPoint(
      { x: frame.x + frame.w / 2, y: frame.y + frame.h / 2 },
      pivot,
      scaleX,
      scaleY,
      allowRotation ? angleRad : 0
    );
    const width = Math.max(0.01, frame.w * Math.abs(scaleX));
    const height = Math.max(0.01, frame.h * Math.abs(scaleY));
    ref.selection.frame = {
      x: center.x - width / 2,
      y: center.y - height / 2,
      w: width,
      h: height,
    };
    ref.selection.rotation = (snap.rasterRotation ?? 0) + (allowRotation ? angleRad : 0);
  }
}

export function boundsFromItems(items: MarqueeRef[], measureText?: (t: TextElement) => { width: number; height: number }): Rect {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const add = (x: number, y: number) => {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  };
  for (const ref of items) {
    if (ref.kind === "stroke") {
      for (const p of ref.stroke.points) add(p.x, p.y);
    } else if (ref.kind === "fill") {
      add(ref.fill.point.x, ref.fill.point.y);
    } else if (ref.kind === "text") {
      const m = measureText ? measureText(ref.text) : { width: ref.text.fontSize * 4, height: ref.text.fontSize * 1.2 };
      add(ref.text.x, ref.text.y);
      add(ref.text.x + m.width, ref.text.y + m.height);
    } else if (ref.kind === "subpanel") {
      const b = ref.subPanel.bounds;
      add(b.x, b.y);
      add(b.x + b.w, b.y + b.h);
    } else if (ref.kind === "raster") {
      const b = rasterPayloadBounds(ref.selection);
      add(b.x, b.y);
      add(b.x + b.w, b.y + b.h);
    }
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function moveMarqueeItems(items: MarqueeRef[], dx: number, dy: number): void {
  for (const ref of items) {
    if (ref.kind === "stroke") {
      for (const p of ref.stroke.points) { p.x += dx; p.y += dy; }
    } else if (ref.kind === "fill") {
      ref.fill.point.x += dx;
      ref.fill.point.y += dy;
      if (ref.fill.clipShape) ref.fill.clipShape = translateShape(ref.fill.clipShape, dx, dy);
    } else if (ref.kind === "text") {
      ref.text.x += dx;
      ref.text.y += dy;
    } else if (ref.kind === "subpanel") {
      ref.subPanel.bounds.x += dx;
      ref.subPanel.bounds.y += dy;
      if (ref.subPanel.points) {
        for (const p of ref.subPanel.points) { p.x += dx; p.y += dy; }
      }
      if (ref.subPanel.tail) {
        ref.subPanel.tail.x += dx;
        ref.subPanel.tail.y += dy;
      }
    } else if (ref.kind === "raster") {
      ref.selection.frame.x += dx;
      ref.selection.frame.y += dy;
    }
  }
}

export function translateShape(shape: SelectionShape, dx: number, dy: number): SelectionShape {
  if (shape.kind === "rect") {
    return { kind: "rect", x: shape.x + dx, y: shape.y + dy, w: shape.w, h: shape.h };
  }
  if (shape.kind === "ellipse") {
    return { kind: "ellipse", cx: shape.cx + dx, cy: shape.cy + dy, rx: shape.rx, ry: shape.ry };
  }
  return { kind: "polygon", points: shape.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) };
}

export function growSelectionShape(shape: SelectionShape, amount: number): SelectionShape {
  if (shape.kind === "rect") {
    const w = Math.max(0, shape.w + amount * 2);
    const h = Math.max(0, shape.h + amount * 2);
    return { kind: "rect", x: shape.x - amount, y: shape.y - amount, w, h };
  }
  if (shape.kind === "ellipse") {
    return {
      kind: "ellipse",
      cx: shape.cx,
      cy: shape.cy,
      rx: Math.max(0, shape.rx + amount),
      ry: Math.max(0, shape.ry + amount),
    };
  }
  const c = shape.points.reduce(
    (acc, p) => ({ x: acc.x + p.x / shape.points.length, y: acc.y + p.y / shape.points.length }),
    { x: 0, y: 0 }
  );
  return {
    kind: "polygon",
    points: shape.points.map((p) => {
      const dx = p.x - c.x;
      const dy = p.y - c.y;
      const len = Math.hypot(dx, dy);
      if (len === 0) return { ...p };
      const next = Math.max(0, len + amount);
      return { x: c.x + (dx / len) * next, y: c.y + (dy / len) * next };
    }),
  };
}

export function activeRegionShape(state: SelectionState | null): SelectionShape | null {
  if (!state) return null;
  if (state.mode === "region" && state.phase !== "creating") return state.shape;
  return null;
}

export function isObjectSelectionIdle(state: SelectionState | null): boolean {
  return !!state && state.mode === "object" && state.phase === "idle";
}
