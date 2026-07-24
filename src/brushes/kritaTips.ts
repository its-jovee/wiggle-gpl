// ============================================================================
// brushes/kritaTips.ts — minimal stamp helpers for Krita-inspired raster brushes.
//
// Procedural tips, deterministic scatter/rotation, and soft texture masks.
// Visually inspired by Krita default Pixel / Quick / Spray / dry-media families
// (pinned krita @ bd6b58cbb8216b02740dab3241c25ac1fec0673d) — not a close port
// of KisBrush dab rendering or the tile engine. See
// docs/research/krita/RASTER_BRUSH_MAPPING.md.
//
// All variation goes through core/rng.ts. No Math.random().
// ============================================================================

import { noise, pickIndex } from "../core/rng";
import type { BrushContext } from "./registry";
import type { Vec2 } from "../core/types";

export type GeneratedTipKey =
  | "hardDisc"
  | "softDisc"
  | "pixelSquare"
  | "chalkGrain"
  | "dryTooth"
  | "bristleFan";

export type TipStampOpts = {
  /** Override rotation (radians). Default: noise spin from tick/seed. */
  angle?: number;
  /** Stretch before rotation. */
  stretchX?: number;
  stretchY?: number;
};

const TIP_SIZE = 64;
const TIP_VARIANTS = 3;
const _tips = new Map<string, HTMLCanvasElement>();

/** Map seeded noise to [0, 1). */
export function unit01(a: number, b: number = 0, c: number = 0): number {
  return (noise(a, b, c) + 1) / 2;
}

/** Deterministic offset inside a disc of the given radius. */
export function scatterOffset(
  tick: number,
  seed: number,
  particleIndex: number,
  radius: number
): Vec2 {
  const u = unit01(tick + particleIndex * 17.3, seed + particleIndex * 9.1, 1.7);
  const v = unit01(tick + particleIndex * 29.1, seed + particleIndex * 13.7, 3.3);
  const ang = u * Math.PI * 2;
  const r = Math.sqrt(v) * radius;
  return { x: Math.cos(ang) * r, y: Math.sin(ang) * r };
}

/** Rotation for a dab: fixed, noise-spun, or stroke heading. */
export function tipAngle(
  b: BrushContext,
  mode: "noise" | "heading" | "fixed" = "noise",
  fixed = 0
): number {
  if (mode === "fixed") return fixed;
  if (mode === "heading") return Math.atan2(b.delta.y, b.delta.x);
  return unit01(b.tick, b.seed, 41.2) * Math.PI * 2;
}

function tipSeed(key: GeneratedTipKey): number {
  switch (key) {
    case "hardDisc": return 101.1;
    case "softDisc": return 113.7;
    case "pixelSquare": return 127.3;
    case "chalkGrain": return 139.9;
    case "dryTooth": return 151.5;
    case "bristleFan": return 163.1;
  }
}

function tipAlphaAt(key: GeneratedTipKey, x: number, y: number, seed: number): number {
  const half = TIP_SIZE / 2;
  const dx = (x - half) / half;
  const dy = (y - half) / half;
  const r = Math.sqrt(dx * dx + dy * dy);

  switch (key) {
    case "hardDisc":
      return r <= 0.92 ? 1 : r < 1 ? (1 - r) / 0.08 : 0;
    case "softDisc": {
      if (r >= 1) return 0;
      const t = 1 - r;
      return t * t * (3 - 2 * t);
    }
    case "pixelSquare": {
      const s = Math.max(Math.abs(dx), Math.abs(dy));
      return s <= 0.88 ? 1 : 0;
    }
    case "chalkGrain": {
      if (r >= 1) return 0;
      const n = unit01(x * 1.7, y * 1.3, seed);
      const body = r < 0.75 ? 1 : Math.max(0, 1 - (r - 0.75) / 0.25);
      if (n < 0.28) return 0;
      return body * (n < 0.55 ? 0.45 : 0.95);
    }
    case "dryTooth": {
      if (r >= 1) return 0;
      const n = unit01(x * 0.9, y * 1.1, seed);
      const clump = unit01(Math.floor(x / 5), Math.floor(y / 5), seed + 7);
      const g = n * (0.35 + 0.65 * clump);
      const rim = r < 0.7 ? 1 : Math.max(0, 1 - (r - 0.7) / 0.3);
      return g < 0.22 ? 0 : g * rim;
    }
    case "bristleFan": {
      // Vertical soft streaks — rotated at stamp time for direction.
      if (Math.abs(dx) > 0.95 || Math.abs(dy) > 0.95) return 0;
      const strand = 1 - Math.min(1, Math.abs(dx) * 4.2);
      const taper = 1 - Math.abs(dy);
      const n = unit01(Math.floor(x / 2), y * 0.4, seed);
      if (n < 0.35) return 0;
      return Math.max(0, strand * taper * (0.5 + 0.5 * n));
    }
  }
}

function makeTip(key: GeneratedTipKey, variant: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = TIP_SIZE;
  c.height = TIP_SIZE;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(TIP_SIZE, TIP_SIZE);
  const d = img.data;
  const seed = variant * 97.3 + tipSeed(key);
  for (let y = 0; y < TIP_SIZE; y++) {
    for (let x = 0; x < TIP_SIZE; x++) {
      const a = tipAlphaAt(key, x, y, seed);
      const i = (y * TIP_SIZE + x) * 4;
      d[i] = 255;
      d[i + 1] = 255;
      d[i + 2] = 255;
      d[i + 3] = Math.round(Math.max(0, Math.min(1, a)) * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function getTip(key: GeneratedTipKey, variant: number): HTMLCanvasElement {
  const id = `${key}:${variant}`;
  let tip = _tips.get(id);
  if (!tip) {
    tip = makeTip(key, variant);
    _tips.set(id, tip);
  }
  return tip;
}

const _tinted = new Map<string, HTMLCanvasElement>();
const TINT_CACHE_MAX = 64;

function tintedTip(key: GeneratedTipKey, variant: number, color: string): HTMLCanvasElement {
  const cacheKey = `${key}:${variant}:${color}`;
  const cached = _tinted.get(cacheKey);
  if (cached) return cached;
  const src = getTip(key, variant);
  const c = document.createElement("canvas");
  c.width = TIP_SIZE;
  c.height = TIP_SIZE;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(src, 0, 0);
  ctx.globalCompositeOperation = "source-in";
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, TIP_SIZE, TIP_SIZE);
  if (_tinted.size >= TINT_CACHE_MAX) {
    _tinted.delete(_tinted.keys().next().value!);
  }
  _tinted.set(cacheKey, c);
  return c;
}

/** Stamp a generated (bitmap-like) tip centered at b.pos. */
export function stampGeneratedTip(
  b: BrushContext,
  key: GeneratedTipKey,
  radius: number,
  alpha: number,
  opts?: TipStampOpts
): void {
  const variant = pickIndex(b.tick, b.seed, TIP_VARIANTS);
  const tip = tintedTip(key, variant, b.color);
  const angle = opts?.angle ?? tipAngle(b, "noise");
  const { ctx, pos } = b;
  ctx.save();
  ctx.translate(pos.x, pos.y);
  ctx.rotate(angle);
  if (opts?.stretchX !== undefined || opts?.stretchY !== undefined) {
    ctx.scale(opts.stretchX ?? 1, opts.stretchY ?? 1);
  }
  ctx.globalAlpha = alpha * (b.flow ?? 1);
  ctx.drawImage(tip, -radius, -radius, radius * 2, radius * 2);
  ctx.restore();
}

/** Hard filled disc (Quick / pixel-hard style). */
export function stampHardDisc(b: BrushContext, radius: number): void {
  const { ctx, pos, color } = b;
  ctx.save();
  ctx.globalAlpha *= b.flow ?? 1;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Soft disc via generated tip. */
export function stampSoftDisc(b: BrushContext, radius: number, alpha = 0.55): void {
  stampGeneratedTip(b, "softDisc", radius, alpha, { angle: 0 });
}

/** Aliased pixel square snapped to integer pixels. */
export function stampPixelSquare(b: BrushContext, sizePx: number): void {
  const s = Math.max(1, Math.round(sizePx));
  const half = Math.floor(s / 2);
  const { ctx, pos, color } = b;
  ctx.save();
  ctx.globalAlpha *= b.flow ?? 1;
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(pos.x) - half, Math.round(pos.y) - half, s, s);
  ctx.restore();
}

/**
 * Bounded deterministic spray: `count` particles inside `radius`, with
 * per-particle size/opacity variation. Caps work for large brushes.
 */
export function stampSprayParticles(
  b: BrushContext,
  radius: number,
  count: number,
  particleRadius: number,
  baseAlpha = 0.75
): void {
  const n = Math.max(0, Math.min(48, Math.floor(count)));
  const { ctx, pos, color } = b;
  ctx.save();
  ctx.fillStyle = color;
  for (let i = 0; i < n; i++) {
    const off = scatterOffset(b.tick, b.seed, i, radius);
    const pr =
      particleRadius *
      (0.35 + 0.65 * unit01(b.tick + i * 41, b.seed + i * 23, 5.5));
    const a =
      baseAlpha *
      (0.35 + 0.65 * unit01(b.tick + i * 7, b.seed + i * 11, 8.1)) *
      (b.flow ?? 1);
    ctx.globalAlpha = a;
    ctx.beginPath();
    ctx.arc(pos.x + off.x, pos.y + off.y, pr, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** Clear tip caches (tests only). */
export function __resetKritaTipCachesForTests(): void {
  _tips.clear();
  _tinted.clear();
}
