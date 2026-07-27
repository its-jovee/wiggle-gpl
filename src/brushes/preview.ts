// ============================================================================
// brushes/preview.ts — deterministic UI previews for registry brushes.
//
// This is editor chrome only. It calls the same brush stamp function used by
// rendering, but with fixed tick/seed inputs so the selector preview is stable
// and never affects project data or export output.
//
// The stroke is drawn left→right at full force, then trails off in size and
// flow so the chip reads like a real pressure-sensitive dab.
// ============================================================================

import type { Brush } from "./registry";

export type BrushPreviewOptions = {
  width: number;
  height: number;
  color: string;
  bg: string;
  size: number;
  /** Preview this paint brush as an eraser without changing its registry entry. */
  erase?: boolean;
};

const PREVIEW_TICK = 0;
const PREVIEW_SEED = 1049;

/** Ease from full pressure (left) to a soft fade (right). */
function previewPressure(u: number): number {
  const t = Math.max(0, Math.min(1, u));
  // Hold near-full for the first ~20%, then ease down to a light trail.
  if (t < 0.2) return 0.92 + 0.08 * (t / 0.2);
  const trail = (t - 0.2) / 0.8;
  return Math.max(0.12, Math.pow(1 - trail, 1.55));
}

export function drawBrushPreview(
  ctx: CanvasRenderingContext2D,
  brush: Brush,
  opts: BrushPreviewOptions
): void {
  const { width, height, color, bg } = opts;
  const baseSize = Math.max(1, opts.size * 0.95);

  ctx.clearRect(0, 0, width, height);
  ctx.save();
  if (bg !== "transparent") {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);
  }
  const erases = brush.erase === true || opts.erase === true;
  if (erases) ctx.globalCompositeOperation = "destination-out";

  if (brush.radial) {
    const cx = width * 0.46;
    const cy = height * 0.5;
    const radius = Math.min(width, height) * 0.38;
    brush.stamp({
      ctx,
      pos: { x: cx, y: cy },
      delta: { x: radius, y: 0 },
      color: erases ? "#ffffff" : color,
      size: baseSize,
      tick: PREVIEW_TICK,
      seed: PREVIEW_SEED,
      bg,
      pressure: 1,
      flow: 1,
      dist: 0,
      radialRadius: radius,
    });
    ctx.restore();
    return;
  }

  const startX = Math.min(7, width * 0.14);
  const endX = Math.max(startX + 8, width - 5);
  const span = endX - startX;
  const midY = height / 2;
  // Slight arch so it reads as a stroke, not a flat rule.
  const arch = Math.min(2.2, height * 0.08);
  const step = Math.max(0.75, brush.spacing * 0.85);

  let sampleIndex = 0;
  let prevX = startX;
  let prevY = midY;
  for (let dist = 0; dist <= span + 1e-6; dist += step) {
    const u = span <= 1e-6 ? 0 : dist / span;
    const pressure = previewPressure(u);
    const x = startX + dist;
    const y = midY - Math.sin(u * Math.PI) * arch;
    const dx = x - prevX;
    const dy = y - prevY;
    const delta = Math.hypot(dx, dy) > 1e-6
      ? { x: dx, y: dy }
      : { x: 1, y: -0.08 };

    // Mirror render: size has pressure baked in; flow/pressure also passed for
    // texture / krita tips that read them separately.
    const stampSize = Math.max(0.35, baseSize * (0.28 + 0.72 * pressure));
    const flow = 0.18 + 0.82 * pressure;

    brush.stamp({
      ctx,
      pos: { x, y },
      delta,
      color: erases ? "#ffffff" : color,
      size: stampSize,
      tick: PREVIEW_TICK,
      seed: PREVIEW_SEED + sampleIndex,
      bg,
      pressure,
      flow,
      dist,
    });
    prevX = x;
    prevY = y;
    sampleIndex++;
  }

  ctx.restore();
}
