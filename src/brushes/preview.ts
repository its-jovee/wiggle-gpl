// ============================================================================
// brushes/preview.ts — deterministic UI previews for registry brushes.
//
// This is editor chrome only. It calls the same brush stamp function used by
// rendering, but with fixed tick/seed inputs so the selector preview is stable
// and never affects project data or export output.
// ============================================================================

import type { Brush } from "./registry";

export type BrushPreviewOptions = {
  width: number;
  height: number;
  color: string;
  bg: string;
  size: number;
};

const PREVIEW_TICK = 0;
const PREVIEW_SEED = 1049;
const PREVIEW_DELTA = { x: 1, y: 0.12 };

export function drawBrushPreview(
  ctx: CanvasRenderingContext2D,
  brush: Brush,
  opts: BrushPreviewOptions
): void {
  const { width, height, color, bg } = opts;
  const size = Math.max(1, opts.size * 0.9);
  const y = height / 2;
  const startX = Math.min(12, width / 4);
  const endX = Math.max(startX, width - startX);
  const step = Math.max(1, brush.spacing);

  ctx.clearRect(0, 0, width, height);
  ctx.save();
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  let sampleIndex = 0;
  for (let dist = 0; dist <= endX - startX + 1e-6; dist += step) {
    brush.stamp({
      ctx,
      pos: { x: startX + dist, y },
      delta: PREVIEW_DELTA,
      color: brush.erase ? "#f7f3df" : color,
      size,
      tick: PREVIEW_TICK,
      seed: PREVIEW_SEED + sampleIndex,
      bg,
      pressure: 1,
      dist,
    });
    sampleIndex++;
  }

  ctx.restore();
}
