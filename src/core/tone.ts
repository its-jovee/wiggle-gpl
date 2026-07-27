// ============================================================================
// core/tone.ts — static manga-tone raster generation for texture layers.
//
// Tone layers deliberately do not use the wiggle clock or brush RNG. Their
// saved settings rasterize identically in the editor and every export frame.
// ============================================================================

import type { ToneSettings, Vec2 } from "./types";

/** Apply a gradient drag to a tone. Empty painted-tone layers have no reveal
 * mask, so promote them to full coverage to make the new gradient visible. */
export function applyToneGradient(
  tone: ToneSettings,
  kind: "linear" | "radial",
  start: Vec2,
  end: Vec2,
  hasPaintedMask: boolean,
): void {
  tone.gradient = { kind, start: { ...start }, end: { ...end } };
  if (tone.coverage === "painted" && !hasPaintedMask) tone.coverage = "full";
}

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
  if (tone.gradient) {
    ctx.save();
    const { start, end } = tone.gradient;
    const radius = Math.max(1, Math.hypot(end.x - start.x, end.y - start.y));
    const gradient = tone.gradient.kind === "radial"
      ? ctx.createRadialGradient(start.x, start.y, 0, start.x, start.y, radius)
      : ctx.createLinearGradient(start.x, start.y, end.x, end.y);
    gradient.addColorStop(0, tone.gradient.reverse ? "rgba(0,0,0,0)" : "rgba(0,0,0,1)");
    gradient.addColorStop(1, tone.gradient.reverse ? "rgba(0,0,0,1)" : "rgba(0,0,0,0)");
    ctx.globalCompositeOperation = "destination-in";
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }
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
