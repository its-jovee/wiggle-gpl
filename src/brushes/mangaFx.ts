// ============================================================================
// brushes/mangaFx.ts — manga-style effect stamps for the brush registry.
//
// Speed/focus/action lines, expression marks (anger, sweat, emphasis). Each
// brush is a registry entry: walked along raw stroke points with deterministic
// variation via core/rng.ts (tick + seed). No Krita import — original stamps
// inspired by common manga/comic screentone conventions.
// ============================================================================

import { Vec2 } from "../core/types";
import { noise, pickIndex } from "../core/rng";
import type { Brush, BrushContext } from "./registry";

const heading = (d: Vec2) => Math.atan2(d.y, d.x);

function strokeSegment(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: string,
  width: number,
  alpha = 1
) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.globalAlpha *= alpha;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  ctx.restore();
}

/** Parallel lines perpendicular to stroke travel — classic speed lines. */
function stampParallelSpeed(b: BrushContext, opts: { count: number; spread: number; lenBase: number; lenVar: number; widthMul: number }) {
  const a = heading(b.delta);
  const perp = a + Math.PI / 2;
  const count = opts.count + pickIndex(b.tick, b.seed, 3);
  const spread = opts.spread * b.size;
  for (let i = 0; i < count; i++) {
    const t = count <= 1 ? 0 : i / (count - 1) - 0.5;
    const off = t * spread * 2;
    const cx = b.pos.x + Math.cos(perp) * off;
    const cy = b.pos.y + Math.sin(perp) * off;
    const len = (opts.lenBase + opts.lenVar * Math.abs(noise(b.tick, b.seed + i * 11))) * b.size;
    const taper = 0.25 + 0.75 * Math.abs(noise(b.tick + i, b.seed + 3));
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    strokeSegment(
      b.ctx,
      cx - ux * len * taper,
      cy - uy * len * taper,
      cx + ux * len,
      cy + uy * len,
      b.color,
      b.size * opts.widthMul,
      b.flow ?? 1
    );
  }
}

/** Radial burst — focus / action / impact lines. With `radialRadius` set, rays
 *  scale to the dragged radius; otherwise length follows brush size × opts. */
function stampRadialBurst(b: BrushContext, opts: { rays: number; lenBase: number; lenVar: number; inner: number; widthMul: number }) {
  const useRadius = b.radialRadius !== undefined && b.radialRadius > 0;
  const radiusScale = useRadius ? Math.min(28, Math.floor(b.radialRadius! / Math.max(3, b.size * 2))) : 0;
  const rays = opts.rays + radiusScale + pickIndex(b.tick, b.seed, 5);
  for (let i = 0; i < rays; i++) {
    const baseAngle = (i / rays) * Math.PI * 2;
    const wobble = noise(b.tick + i * 3, b.seed + i) * 0.12;
    const ang = baseAngle + wobble;
    const len = useRadius
      ? b.radialRadius! * (0.88 + 0.12 * Math.abs(noise(b.tick, b.seed + i * 7)))
      : (opts.lenBase + opts.lenVar * Math.abs(noise(b.tick, b.seed + i * 7))) * b.size;
    const progression = rays <= 1 ? 0 : i / (rays - 1);
    const innerNoise = 0.04 * Math.abs(noise(b.tick + i * 5, b.seed + i * 19));
    const inner = len * Math.min(0.72, opts.inner * (0.35 + progression * 1.65) + innerNoise);
    const ux = Math.cos(ang);
    const uy = Math.sin(ang);
    strokeSegment(
      b.ctx,
      b.pos.x + ux * inner,
      b.pos.y + uy * inner,
      b.pos.x + ux * len,
      b.pos.y + uy * len,
      b.color,
      b.size * opts.widthMul,
      b.flow ?? 1
    );
  }
}

export function isRadialMangaBrushKey(key: string): boolean {
  return MANGA_FX_BRUSHES.some((b) => b.key === key && b.radial === true);
}

export const MANGA_FX_BRUSHES: Brush[] = [
  {
    key: "mangaSpeed",
    label: "Speed Lines",
    spacing: 7,
    group: "Manga FX",
    stamp: (b) => stampParallelSpeed(b, { count: 5, spread: 5, lenBase: 5, lenVar: 9, widthMul: 0.72 }),
  },
  {
    key: "mangaAction",
    label: "Action Lines",
    spacing: 9,
    group: "Manga FX",
    radial: true,
    stamp: (b) => stampRadialBurst(b, { rays: 12, lenBase: 8, lenVar: 14, inner: 0.06, widthMul: 0.82 }),
  },
  {
    key: "mangaFocus",
    label: "Focus Lines",
    spacing: 11,
    group: "Manga FX",
    radial: true,
    stamp: (b) => stampRadialBurst(b, { rays: 10, lenBase: 7, lenVar: 12, inner: 0.09, widthMul: 0.68 }),
  },
  {
    key: "mangaImpact",
    label: "Impact Burst",
    spacing: 14,
    group: "Manga FX",
    radial: true,
    stamp: (b) => stampRadialBurst(b, { rays: 15, lenBase: 9, lenVar: 17, inner: 0.045, widthMul: 0.78 }),
  },
  {
    key: "mangaAnger",
    label: "Anger Mark",
    spacing: 10,
    group: "Manga FX",
    stamp: (b) => {
      const { ctx, pos, color, size } = b;
      const s = 5.5 * size;
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = size * 1.15;
      ctx.lineCap = "round";
      ctx.globalAlpha *= b.flow ?? 1;
      for (const sign of [-1, 1]) {
        const rot = sign * (0.35 + 0.08 * Math.abs(noise(b.tick, b.seed)));
        ctx.beginPath();
        ctx.moveTo(pos.x - Math.cos(rot) * s, pos.y - Math.sin(rot) * s * 0.9);
        ctx.quadraticCurveTo(pos.x, pos.y - s * 0.35, pos.x + Math.cos(rot) * s, pos.y + Math.sin(rot) * s * 0.85);
        ctx.stroke();
      }
      ctx.restore();
    },
  },
  {
    key: "mangaSweat",
    label: "Sweat Drop",
    spacing: 12,
    group: "Manga FX",
    stamp: (b) => {
      const { ctx, pos, color, size } = b;
      const h = 6.5 * size;
      const w = 2.8 * size;
      const tilt = noise(b.tick, b.seed) * 0.25;
      ctx.save();
      ctx.translate(pos.x, pos.y);
      ctx.rotate(tilt);
      ctx.globalAlpha *= b.flow ?? 1;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(0, -h);
      ctx.quadraticCurveTo(w, -h * 0.15, 0, h * 0.45);
      ctx.quadraticCurveTo(-w, -h * 0.15, 0, -h);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.globalAlpha *= 0.45;
      ctx.beginPath();
      ctx.ellipse(-w * 0.25, -h * 0.45, w * 0.22, h * 0.12, -0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    },
  },
  {
    key: "mangaEmphasis",
    label: "Emphasis Ticks",
    spacing: 6,
    group: "Manga FX",
    stamp: (b) => {
      const a = heading(b.delta) + Math.PI / 2;
      const ticks = 2 + pickIndex(b.tick, b.seed, 2);
      for (let i = 0; i < ticks; i++) {
        const off = (i - (ticks - 1) / 2) * 2.5 * b.size;
        const cx = b.pos.x + Math.cos(a) * off;
        const cy = b.pos.y + Math.sin(a) * off;
        const len = (3 + 2 * Math.abs(noise(b.tick, b.seed + i))) * b.size;
        const ux = Math.cos(a + Math.PI / 2);
        const uy = Math.sin(a + Math.PI / 2);
        strokeSegment(b.ctx, cx - ux * len, cy - uy * len, cx + ux * len, cy + uy * len, b.color, b.size * 0.9, b.flow ?? 1);
      }
    },
  },
];
