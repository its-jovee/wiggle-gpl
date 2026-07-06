// ============================================================================
// brushes/textures.ts — procedural texture tiles for textured brushes.
//
// Every tile is generated ONCE at module init from the seeded noise() in
// core/rng.ts — fully deterministic, no shipped assets, export-safe. Tiles are
// grayscale-in-alpha (white RGB, grain lives in the alpha channel) with a
// radial falloff envelope so stamps have soft round edges instead of square
// tile artifacts. Each texture has 3 variants; stamp time picks one with
// pickIndex(tick, seed, 3) — the same "alive via variant pick" pattern the
// classic brushes use, so textures shimmer at wiggle cadence.
//
// Tinting: a tile is colored per stroke color via source-in fill, cached per
// (texture, variant, color). A stroke has one color, so steady state is tiny.
// ============================================================================

import { noise, pickIndex } from "../core/rng";
import type { BrushContext } from "./registry";

export type TextureKey = "paperGrain" | "canvasWeave" | "charcoalGrain" | "cloud" | "softDisc";

const TILE = 128;
const VARIANTS = 3;

// --- generation ---------------------------------------------------------------

/** Smoothly interpolated value noise in [0,1] on a lattice of `cell` px. */
function valueNoise(x: number, y: number, cell: number, seed: number): number {
  const gx = x / cell;
  const gy = y / cell;
  const ix = Math.floor(gx);
  const iy = Math.floor(gy);
  const fx = gx - ix;
  const fy = gy - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const v = (a: number, b: number) => (noise(a * 13.7, b * 7.3, seed) + 1) / 2;
  const v00 = v(ix, iy);
  const v10 = v(ix + 1, iy);
  const v01 = v(ix, iy + 1);
  const v11 = v(ix + 1, iy + 1);
  return v00 + (v10 - v00) * sx + ((v01 + (v11 - v01) * sx) - (v00 + (v10 - v00) * sx)) * sy;
}

/** Per-pixel grain value in [0,1] for one texture/variant. */
function grainAt(key: TextureKey, x: number, y: number, seed: number): number {
  switch (key) {
    case "paperGrain": {
      // High-frequency tooth: thresholded white noise with mid plateau.
      const n = (noise(x * 0.91, y * 1.17, seed) + 1) / 2;
      return n < 0.35 ? 0 : n < 0.7 ? 0.55 : 1;
    }
    case "charcoalGrain": {
      // Coarser, denser clumps than paper — two scales multiplied.
      const fine = (noise(x * 0.83, y * 0.79, seed) + 1) / 2;
      const clump = valueNoise(x, y, 9, seed + 31);
      const g = fine * (0.4 + 0.6 * clump);
      return g < 0.18 ? 0 : g;
    }
    case "canvasWeave": {
      // Row/column sinusoid product = woven threads, plus a little noise.
      const warp = 0.5 + 0.5 * Math.sin(x * 0.85 + noise(y * 0.2, 0, seed) * 0.9);
      const weft = 0.5 + 0.5 * Math.sin(y * 0.85 + noise(x * 0.2, 0, seed + 7) * 0.9);
      const thread = Math.max(warp, weft);
      const n = (noise(x * 0.91, y * 1.17, seed + 13) + 1) / 2;
      return 0.35 + 0.65 * thread * (0.7 + 0.3 * n);
    }
    case "cloud": {
      // 3-octave fractal value noise — soft billowy density.
      const o1 = valueNoise(x, y, 48, seed);
      const o2 = valueNoise(x, y, 21, seed + 17);
      const o3 = valueNoise(x, y, 9, seed + 53);
      return Math.min(1, o1 * 0.55 + o2 * 0.3 + o3 * 0.15 + 0.1);
    }
    case "softDisc":
      return 1; // pure falloff envelope below
  }
}

/** Radial falloff envelope, 1 at center → 0 at tile edge. */
function falloff(key: TextureKey, x: number, y: number): number {
  const half = TILE / 2;
  const dx = (x - half) / half;
  const dy = (y - half) / half;
  const r = Math.sqrt(dx * dx + dy * dy);
  if (r >= 1) return 0;
  if (key === "softDisc") {
    // Airbrush profile: smooth gaussian-ish falloff over the whole disc.
    const t = 1 - r;
    return t * t * (3 - 2 * t);
  }
  // Grain tiles: mostly flat body, soft shoulder near the rim.
  if (r < 0.7) return 1;
  const t = 1 - (r - 0.7) / 0.3;
  return t * t * (3 - 2 * t);
}

function makeTile(key: TextureKey, variant: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = TILE;
  c.height = TILE;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(TILE, TILE);
  const d = img.data;
  const seed = variant * 101.7 + keySeed(key);
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const a = grainAt(key, x, y, seed) * falloff(key, x, y);
      const i = (y * TILE + x) * 4;
      d[i] = 255;
      d[i + 1] = 255;
      d[i + 2] = 255;
      d[i + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function keySeed(key: TextureKey): number {
  switch (key) {
    case "paperGrain": return 11.3;
    case "canvasWeave": return 23.9;
    case "charcoalGrain": return 37.1;
    case "cloud": return 49.7;
    case "softDisc": return 61.3;
  }
}

// Tiles are generated lazily on first stamp (not at module init) so importing
// the brush registry stays DOM-free for headless tests. Generation is still
// deterministic — same key/variant always produces the same tile.
const _tiles = new Map<string, HTMLCanvasElement>();

function getTile(key: TextureKey, variant: number): HTMLCanvasElement {
  const id = `${key}:${variant}`;
  let tile = _tiles.get(id);
  if (!tile) {
    tile = makeTile(key, variant);
    _tiles.set(id, tile);
  }
  return tile;
}

// --- tinting -------------------------------------------------------------------

const _tinted = new Map<string, HTMLCanvasElement>();
const TINT_CACHE_MAX = 64;

function tintedTile(key: TextureKey, variant: number, color: string): HTMLCanvasElement {
  const cacheKey = `${key}:${variant}:${color}`;
  const cached = _tinted.get(cacheKey);
  if (cached) return cached;
  const src = getTile(key, variant);
  const c = document.createElement("canvas");
  c.width = TILE;
  c.height = TILE;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(src, 0, 0);
  ctx.globalCompositeOperation = "source-in";
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, TILE, TILE);
  if (_tinted.size >= TINT_CACHE_MAX) {
    _tinted.delete(_tinted.keys().next().value!);
  }
  _tinted.set(cacheKey, c);
  return c;
}

// --- stamping -------------------------------------------------------------------

export type StampTextureOpts = {
  /** Fixed rotation in radians; default = deterministic noise(tick, seed) spin. */
  angle?: number;
  /** Stretch factors applied before rotation (e.g. dry-brush ellipse). */
  stretchX?: number;
  stretchY?: number;
};

/** Stamp a tinted texture tile centered at b.pos, scaled to 2*radius. */
export function stampTexture(
  b: BrushContext,
  key: TextureKey,
  radius: number,
  alpha: number,
  opts?: StampTextureOpts
): void {
  const variant = pickIndex(b.tick, b.seed, VARIANTS);
  const tile = tintedTile(key, variant, b.color);
  const angle = opts?.angle ?? noise(b.tick, b.seed) * Math.PI;
  const { ctx, pos } = b;
  ctx.save();
  ctx.translate(pos.x, pos.y);
  ctx.rotate(angle);
  if (opts?.stretchX !== undefined || opts?.stretchY !== undefined) {
    ctx.scale(opts.stretchX ?? 1, opts.stretchY ?? 1);
  }
  ctx.globalAlpha = alpha * (b.flow ?? 1);
  ctx.drawImage(tile, -radius, -radius, radius * 2, radius * 2);
  ctx.restore();
}
