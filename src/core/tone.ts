// ============================================================================
// core/tone.ts — static manga-tone raster generation for texture layers.
//
// Tone layers deliberately do not use the wiggle clock or brush RNG. Their
// saved settings rasterize identically in the editor and every export frame.
// ============================================================================

import type { ToneSettings } from "./types";

/** Paint a static halftone, hatch, or crosshatch texture into a layer canvas. */
export function renderTone(
  ctx: CanvasRenderingContext2D,
  tone: ToneSettings,
  width: number,
  height: number
): void {
  const spacing = Math.max(4, tone.spacing);
  const extent = Math.hypot(width, height);
  ctx.save();
  ctx.fillStyle = tone.color;
  ctx.strokeStyle = tone.color;
  ctx.translate(width / 2, height / 2);
  ctx.rotate((tone.angle * Math.PI) / 180);
  if (tone.style === "halftone") {
    const radius = Math.min(spacing * 0.48, Math.max(0.5, tone.size / 2));
    for (let y = -extent / 2 - spacing; y <= extent / 2 + spacing; y += spacing) {
      for (let x = -extent / 2 - spacing; x <= extent / 2 + spacing; x += spacing) {
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  } else {
    ctx.lineWidth = Math.min(spacing * 0.8, Math.max(0.5, tone.size));
    ctx.lineCap = "butt";
    strokeHatch(ctx, spacing, extent);
    if (tone.style === "crosshatch") {
      ctx.rotate(Math.PI / 2);
      strokeHatch(ctx, spacing, extent);
    }
  }
  ctx.restore();
}

function strokeHatch(ctx: CanvasRenderingContext2D, spacing: number, extent: number): void {
  const start = -extent / 2 - spacing;
  const end = extent / 2 + spacing;
  for (let y = start; y <= end; y += spacing) {
    ctx.beginPath();
    ctx.moveTo(start, y);
    ctx.lineTo(end, y);
    ctx.stroke();
  }
}
