// ============================================================================
// core/rasterEditing.ts — live pixel painting and editor-only raster selections.
//
// Raster layers never retain vector Stroke objects. RasterStrokeSession walks
// incoming smoothed samples once and stamps directly into the layer canvas.
// RasterSelectionPayload keeps extracted pixels plus a clean base canvas while
// a marquee move/transform is active; only the composed layer bitmap persists.
// ============================================================================

import type { Brush } from "../brushes/registry";
import type { Layer, SelectionShape, Stroke, Vec2 } from "./types";
import { effectiveBrushSettings } from "./brushSettings";
import type { RasterSelectionPayload } from "./selection";

export type RasterRect = { x: number; y: number; w: number; h: number };

function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(width));
  canvas.height = Math.max(1, Math.ceil(height));
  return canvas;
}

export function cloneRasterCanvas(source: HTMLCanvasElement): HTMLCanvasElement {
  const copy = makeCanvas(source.width, source.height);
  copy.getContext("2d")!.drawImage(source, 0, 0);
  return copy;
}

function traceShape(ctx: CanvasRenderingContext2D, shape: SelectionShape): void {
  if (shape.kind === "rect") {
    ctx.rect(shape.x, shape.y, shape.w, shape.h);
  } else if (shape.kind === "ellipse") {
    ctx.ellipse(shape.cx, shape.cy, shape.rx, shape.ry, 0, 0, Math.PI * 2);
  } else if (shape.points.length > 0) {
    ctx.moveTo(shape.points[0].x, shape.points[0].y);
    for (let i = 1; i < shape.points.length; i++) ctx.lineTo(shape.points[i].x, shape.points[i].y);
    ctx.closePath();
  }
}

function shapeRect(shape: SelectionShape): RasterRect {
  if (shape.kind === "rect") return { x: shape.x, y: shape.y, w: shape.w, h: shape.h };
  if (shape.kind === "ellipse") {
    return {
      x: shape.cx - shape.rx,
      y: shape.cy - shape.ry,
      w: shape.rx * 2,
      h: shape.ry * 2,
    };
  }
  if (shape.points.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  let minX = shape.points[0].x;
  let maxX = minX;
  let minY = shape.points[0].y;
  let maxY = minY;
  for (const point of shape.points) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function clampRect(rect: RasterRect, width: number, height: number): RasterRect {
  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(width, Math.ceil(rect.x + rect.w));
  const y1 = Math.min(height, Math.ceil(rect.y + rect.h));
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}

function selectionMask(
  shape: SelectionShape,
  width: number,
  height: number,
  inverted: boolean
): HTMLCanvasElement {
  const mask = makeCanvas(width, height);
  const ctx = mask.getContext("2d")!;
  ctx.fillStyle = "#fff";
  if (inverted) {
    ctx.fillRect(0, 0, width, height);
    ctx.globalCompositeOperation = "destination-out";
  }
  ctx.beginPath();
  traceShape(ctx, shape);
  ctx.fill();
  return mask;
}

function canvasHasVisiblePixel(canvas: HTMLCanvasElement): boolean {
  const data = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] !== 0) return true;
  }
  return false;
}

export function rasterContentBounds(canvas: HTMLCanvasElement): RasterRect | null {
  const { width, height } = canvas;
  const data = canvas.getContext("2d")!.getImageData(0, 0, width, height).data;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] === 0) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return maxX < minX
    ? null
    : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

export function extractRasterSelection(
  layer: Layer,
  source: HTMLCanvasElement,
  shape: SelectionShape,
  inverted = false
): RasterSelectionPayload | null {
  const mask = selectionMask(shape, source.width, source.height, inverted);
  const requested = inverted
    ? { x: 0, y: 0, w: source.width, h: source.height }
    : clampRect(shapeRect(shape), source.width, source.height);
  if (requested.w <= 0 || requested.h <= 0) return null;

  const pixels = makeCanvas(requested.w, requested.h);
  const pixelsCtx = pixels.getContext("2d")!;
  pixelsCtx.drawImage(
    source,
    requested.x, requested.y, requested.w, requested.h,
    0, 0, requested.w, requested.h
  );
  pixelsCtx.globalCompositeOperation = "destination-in";
  pixelsCtx.drawImage(
    mask,
    requested.x, requested.y, requested.w, requested.h,
    0, 0, requested.w, requested.h
  );
  pixelsCtx.globalCompositeOperation = "source-over";
  if (!canvasHasVisiblePixel(pixels)) return null;

  const base = cloneRasterCanvas(source);
  const baseCtx = base.getContext("2d")!;
  baseCtx.globalCompositeOperation = "destination-out";
  baseCtx.drawImage(mask, 0, 0);
  baseCtx.globalCompositeOperation = "source-over";
  return {
    layer,
    pixels,
    base,
    frame: { ...requested },
    rotation: 0,
  };
}

export function createRasterSelectionFromPixels(
  layer: Layer,
  layerCanvas: HTMLCanvasElement,
  pixels: HTMLCanvasElement,
  x: number,
  y: number
): RasterSelectionPayload {
  return {
    layer,
    pixels: cloneRasterCanvas(pixels),
    base: cloneRasterCanvas(layerCanvas),
    frame: { x, y, w: pixels.width, h: pixels.height },
    rotation: 0,
  };
}

export function rasterSelectionBounds(selection: RasterSelectionPayload): RasterRect {
  const { frame, rotation } = selection;
  if (rotation === 0) return { ...frame };
  const cx = frame.x + frame.w / 2;
  const cy = frame.y + frame.h / 2;
  const c = Math.cos(rotation);
  const s = Math.sin(rotation);
  const corners = [
    { x: -frame.w / 2, y: -frame.h / 2 },
    { x: frame.w / 2, y: -frame.h / 2 },
    { x: frame.w / 2, y: frame.h / 2 },
    { x: -frame.w / 2, y: frame.h / 2 },
  ].map((point) => ({
    x: cx + point.x * c - point.y * s,
    y: cy + point.x * s + point.y * c,
  }));
  let minX = corners[0].x;
  let maxX = minX;
  let minY = corners[0].y;
  let maxY = minY;
  for (const point of corners) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function renderRasterSelection(
  selection: RasterSelectionPayload,
  destination: HTMLCanvasElement
): void {
  const ctx = destination.getContext("2d")!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
  ctx.clearRect(0, 0, destination.width, destination.height);
  ctx.drawImage(selection.base, 0, 0);
  const { frame } = selection;
  ctx.save();
  ctx.translate(frame.x + frame.w / 2, frame.y + frame.h / 2);
  ctx.rotate(selection.rotation);
  ctx.drawImage(selection.pixels, -frame.w / 2, -frame.h / 2, frame.w, frame.h);
  ctx.restore();
}

/** Flattens the current transform into a clipboard-sized bitmap. */
export function flattenRasterSelection(selection: RasterSelectionPayload): HTMLCanvasElement {
  const bounds = rasterSelectionBounds(selection);
  const output = makeCanvas(Math.max(1, Math.ceil(bounds.w)), Math.max(1, Math.ceil(bounds.h)));
  const ctx = output.getContext("2d")!;
  const { frame } = selection;
  ctx.translate(
    frame.x + frame.w / 2 - bounds.x,
    frame.y + frame.h / 2 - bounds.y
  );
  ctx.rotate(selection.rotation);
  ctx.drawImage(selection.pixels, -frame.w / 2, -frame.h / 2, frame.w, frame.h);
  return output;
}

export class RasterStrokeSession {
  private readonly effective;
  private readonly strokeSeed: number;
  private lastPoint: Vec2;
  private lastPressure: number;
  private distanceToNextStamp: number;
  private walked = 0;
  private segmentIndex = 0;
  touched = false;

  constructor(
    private readonly ctx: CanvasRenderingContext2D,
    private readonly brush: Brush,
    private readonly stroke: Pick<Stroke, "color" | "erase" | "size" | "brushSettings">,
    layerIndex: number,
    strokeIndex: number,
    private readonly bg: string,
    firstPoint: Vec2,
    firstPressure: number
  ) {
    this.effective = effectiveBrushSettings(brush.spacing, stroke.size, stroke.brushSettings);
    this.strokeSeed = strokeIndex + layerIndex * 10000;
    this.lastPoint = { ...firstPoint };
    this.lastPressure = firstPressure;
    this.distanceToNextStamp = this.effective.spacing;
    this.stamp(firstPoint, { x: 1, y: 0 }, firstPressure, 0, 0);
  }

  append(point: Vec2, pressure: number): void {
    const a = this.lastPoint;
    const dx = point.x - a.x;
    const dy = point.y - a.y;
    const length = Math.hypot(dx, dy);
    if (length <= 1e-9) {
      this.lastPressure = pressure;
      return;
    }
    const ux = dx / length;
    const uy = dy / length;
    let along = this.distanceToNextStamp;
    while (along < length) {
      const t = along / length;
      const stampPressure = this.lastPressure + (pressure - this.lastPressure) * t;
      this.stamp(
        { x: a.x + ux * along, y: a.y + uy * along },
        { x: dx, y: dy },
        stampPressure,
        this.walked + along,
        this.segmentIndex
      );
      along += this.effective.spacing;
    }
    this.distanceToNextStamp = along - length;
    this.walked += length;
    this.segmentIndex++;
    this.lastPoint = { ...point };
    this.lastPressure = pressure;
  }

  private stamp(
    pos: Vec2,
    delta: Vec2,
    pressure: number,
    dist: number,
    segmentIndex: number
  ): void {
    const erases = this.brush.erase === true || this.stroke.erase === true;
    if (erases) {
      this.ctx.save();
      this.ctx.globalCompositeOperation = "destination-out";
    }
    this.brush.stamp({
      ctx: this.ctx,
      pos,
      delta,
      color: this.stroke.color,
      size: this.effective.stampSize(this.stroke.size, pressure),
      tick: this.strokeSeed,
      seed: this.strokeSeed * 100 + segmentIndex,
      bg: this.bg,
      pressure,
      flow: this.effective.stampFlow(pressure),
      dist,
    });
    if (erases) this.ctx.restore();
    this.touched = true;
  }
}
