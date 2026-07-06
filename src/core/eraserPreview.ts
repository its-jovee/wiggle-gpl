// ============================================================================
// core/eraserPreview.ts — editor-only eraser cursor and trace overlays.
//
// Actual erasing still happens through the normal deterministic brush render
// path. These helpers only draw the transparent outline UI that sits above the
// rendered canvas while the user hovers or drags an eraser.
// ============================================================================

import type { Vec2 } from "./types";

export type ErasePreviewBrush = {
  erase?: boolean;
};

export type EraserTracePreviewOptions = {
  brushSize: number;
  points: Vec2[];
  color?: string;
};

export function isErasePreviewBrush(brush: ErasePreviewBrush | null | undefined): boolean {
  return brush?.erase === true;
}

export function eraserPreviewRadius(brushSize: number): number {
  return Math.max(1, brushSize * 6);
}

export function drawEraserTracePreview(
  ctx: CanvasRenderingContext2D,
  opts: EraserTracePreviewOptions
): void {
  const points = opts.points;
  const last = points[points.length - 1];
  if (!last) return;

  ctx.save();
  ctx.strokeStyle = opts.color ?? "rgba(255,255,255,0.85)";
  ctx.lineWidth = 1.5;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  if (points.length > 1) {
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.stroke();
  }

  ctx.beginPath();
  ctx.arc(last.x, last.y, eraserPreviewRadius(opts.brushSize), 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}
