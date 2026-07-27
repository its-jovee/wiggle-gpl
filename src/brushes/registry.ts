// ============================================================================
// brushes/registry.ts — the brush system, ported from Decker's model.
//
// In Decker (lil.js / brushes.deck) a brush is a Lil function:
//     brush[on Name delta do <returns an image to stamp> end]
// The engine walks the line (Bresenham) and at each step calls the function,
// stamping whatever image it returns. "Aliveness" comes from random[...] inside
// the function picking among pre-baked frame variants. `delta` = stroke
// direction, which directional brushes (hatch, dir*) use via `heading delta`.
//
// We keep that EXACT contract, but color-native and on canvas2d:
//     a Brush is (ctx) => stamp at the cursor, given delta + tick + style.
// Adding "all of Decker's brushes eventually" = adding entries here. No
// refactor needed because every brush is the same shape.
// ============================================================================

import { Vec2 } from "../core/types";
import { pickIndex, noise } from "../core/rng";
import { stampTexture } from "./textures";
import { KRITA_RASTER_BRUSHES } from "./kritaRaster";
import { MANGA_FX_BRUSHES } from "./mangaFx";

export type BrushContext = {
  ctx: CanvasRenderingContext2D;
  pos: Vec2;          // where to stamp (already jittered)
  delta: Vec2;        // direction of travel (for directional brushes)
  color: string;
  size: number;       // user size multiplier (pressure already baked in)
  tick: number;       // current wiggle tick (drives deterministic variation)
  seed: number;       // stable per-stroke seed
  bg: string;         // panel bg color (used by eraser; otherwise ignored)
  /** Raw pen pressure 0..1 at this stamp (1 when unavailable). Texture brushes
   *  use it to drive flow/opacity independently of size. Optional — classic
   *  brushes ignore it. */
  pressure?: number;
  /** Effective opacity/flow multiplier in [0.1, 1]. Brushes that set alpha
   *  internally multiply by this value; classic opaque brushes may ignore it. */
  flow?: number;
  /** Accumulated distance along the (jittered) stroke at this stamp, px.
   *  Deterministic per (tick, stroke). Optional. */
  dist?: number;
  /** Radial manga FX: ray length scales to this radius (px). Optional. */
  radialRadius?: number;
};

export type Brush = {
  key: string;
  label: string;
  /** spacing between stamps in px (smaller = denser line). */
  spacing: number;
  stamp: (b: BrushContext) => void;
  /** If true, the stroke is composited with destination-out so it punches
   *  transparent holes in its OWN layer's offscreen — lower layers then show
   *  through, and the user can re-draw on the same layer without dragging
   *  bg-colored crumbs behind every stamp. */
  erase?: boolean;
  /** Brush-bar section header ("Classic" when omitted). UI only. */
  group?: string;
  /** When true, the brush is offered only while a raster layer is paintable.
   *  UI metadata only — does not change stamp(BrushContext). */
  rasterOnly?: boolean;
  /** Click-drag radial tool: stroke stores center + radius edge in `points`;
   *  render passes `radialRadius` (px) into BrushContext. */
  radial?: boolean;
};

const heading = (d: Vec2) => Math.atan2(d.y, d.x);

// --- helpers shared by brushes ----------------------------------------------
function dot(b: BrushContext, r: number) {
  const { ctx, pos, color } = b;
  ctx.save();
  ctx.globalAlpha *= b.flow ?? 1;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// ============================================================================
// Brush definitions. Each is ~a few lines, just like the Lil originals.
// Names parallel brushes.deck so the mapping is obvious when porting the rest.
// ============================================================================

export const BRUSHES: Brush[] = [
  {
    key: "round",
    label: "Round",
    spacing: 2,
    stamp: (b) => dot(b, 3 * b.size),
  },
  {
    // Decker: soft/stipple family — low-alpha dot with deterministic grain.
    key: "pencil",
    label: "Pencil",
    spacing: 1,
    stamp: (b) => {
      const { ctx, pos, color, size, tick, seed } = b;
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.65;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, size * 1.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.3;
      for (let i = 0; i < 2; i++) {
        const ox = (noise(tick + i * 11, seed + i * 7) - 0.5) * size * 5;
        const oy = (noise(tick + i * 19, seed + i * 13) - 0.5) * size * 5;
        ctx.beginPath();
        ctx.arc(pos.x + ox, pos.y + oy, size * 0.7, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    },
  },
  {
    // Decker: round brush variant — opaque round nib with dense spacing.
    // G Pen (manga nib): round, fully opaque, spacing=1 for clean connected lines.
    // Width is driven purely by pressure — no directional bias, matching CSP behavior.
    key: "gpen",
    label: "G Pen",
    spacing: 1,
    stamp: (b) => dot(b, b.size * 2.2),
  },
  {
    // Decker: round brush variant — slightly translucent ink dot.
    key: "ink",
    label: "Ink",
    spacing: 1,
    stamp: (b) => {
      b.ctx.fillStyle = b.color;
      b.ctx.globalAlpha = 0.92;
      b.ctx.beginPath();
      b.ctx.arc(b.pos.x, b.pos.y, b.size * 2.2, 0, Math.PI * 2);
      b.ctx.fill();
      b.ctx.globalAlpha = 1;
    },
  },
  {
    // Decker: directional brush family — elongated stamp aligned to delta.
    key: "brushpen",
    label: "Brush Pen",
    spacing: 1,
    stamp: (b) => {
      const { ctx, pos, color, size } = b;
      const a = heading(b.delta);
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.88;
      ctx.save();
      ctx.translate(pos.x, pos.y);
      ctx.rotate(a);
      ctx.beginPath();
      ctx.ellipse(0, 0, size * 0.5, size * 3.0, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.globalAlpha = 1;
    },
  },
  {
    // Decker: brush[on velocityBrush delta do circle.scale[2|.5*mag delta 1] end]
    key: "velocity",
    label: "Velocity",
    spacing: 2,
    stamp: (b) => {
      const mag = Math.hypot(b.delta.x, b.delta.y);
      dot(b, Math.max(1, Math.min(6, 0.5 * mag)) * b.size);
    },
  },
  {
    // Decker: random[ss] — picks among soft dot variants each render.
    key: "softSml",
    label: "Soft S",
    spacing: 2,
    stamp: (b) => {
      const variants = [2, 2.6, 3.2];
      const r = variants[pickIndex(b.tick, b.seed, variants.length)];
      b.ctx.globalAlpha = 0.7;
      dot(b, r * b.size);
      b.ctx.globalAlpha = 1;
    },
  },
  {
    // Decker: brush[on StippleSml do random[s] end] — scattered specks.
    key: "stippleSml",
    label: "Stipple S",
    spacing: 4,
    stamp: (b) => {
      const ox = noise(b.tick, b.seed + 1) * 4 * b.size;
      const oy = noise(b.tick, b.seed + 2) * 4 * b.size;
      b.ctx.fillStyle = b.color;
      b.ctx.fillRect(b.pos.x + ox, b.pos.y + oy, b.size, b.size);
    },
  },
  {
    // Decker: brush[on hatch delta do random[dl[...heading delta...]] end]
    // Directional short strokes oriented to travel direction.
    key: "hatch",
    label: "Hatch",
    spacing: 6,
    stamp: (b) => {
      const a = heading(b.delta) + (noise(b.tick, b.seed) > 0 ? 0.4 : -0.4);
      const len = 6 * b.size;
      b.ctx.strokeStyle = b.color;
      b.ctx.lineWidth = b.size;
      b.ctx.beginPath();
      b.ctx.moveTo(b.pos.x - Math.cos(a) * len, b.pos.y - Math.sin(a) * len);
      b.ctx.lineTo(b.pos.x + Math.cos(a) * len, b.pos.y + Math.sin(a) * len);
      b.ctx.stroke();
    },
  },
  {
    // Decker: brush[on Dotted do i:i+1 if 2%i pix end end] — every other step.
    key: "dotted",
    label: "Dotted",
    spacing: 8,
    stamp: (b) => dot(b, 2 * b.size),
  },
  // --- directional family (dir*) ---------------------------------------------
  // Decker: brush[on dirSml delta do random[ds[...heading delta...]] end]
  // Small directional dash aligned to travel direction.
  ...(["dirSml", "dirMed", "dirLrg"] as const).map((key, i) => {
    const lengths = [3, 6, 10];
    const spacings = [3, 5, 7];
    const labels = ["Dir S", "Dir M", "Dir L"];
    return {
      key, label: labels[i], spacing: spacings[i],
      stamp: (b: BrushContext) => {
        const a = heading(b.delta);
        const len = lengths[i] * b.size;
        b.ctx.strokeStyle = b.color;
        b.ctx.lineWidth = b.size;
        b.ctx.beginPath();
        b.ctx.moveTo(b.pos.x - Math.cos(a) * len, b.pos.y - Math.sin(a) * len);
        b.ctx.lineTo(b.pos.x + Math.cos(a) * len, b.pos.y + Math.sin(a) * len);
        b.ctx.stroke();
      },
    };
  }),
  // --- offset family (off*) --------------------------------------------------
  // Decker: brush[on offSml delta do random[offs] end] — dots offset
  // perpendicular to travel direction, like a chisel-edge wiggle.
  ...(["offSml", "offMed", "offLrg"] as const).map((key, i) => {
    const radii = [1.5, 2.5, 4];
    const offsets = [2, 4, 7];
    const spacings = [2, 3, 5];
    const labels = ["Off S", "Off M", "Off L"];
    return {
      key, label: labels[i], spacing: spacings[i],
      stamp: (b: BrushContext) => {
        const a = heading(b.delta) + Math.PI / 2;
        const off = (noise(b.tick, b.seed) * offsets[i]) * b.size;
        const cx = b.pos.x + Math.cos(a) * off;
        const cy = b.pos.y + Math.sin(a) * off;
        b.ctx.fillStyle = b.color;
        b.ctx.beginPath();
        b.ctx.arc(cx, cy, radii[i] * b.size, 0, Math.PI * 2);
        b.ctx.fill();
      },
    };
  }),
  {
    // Decker: brush[on xsparse do random[sp] end] — extremely sparse specks.
    key: "xsparse",
    label: "X-Sparse",
    spacing: 14,
    stamp: (b) => {
      if (noise(b.tick, b.seed) < 0.2) return;
      const ox = noise(b.tick + 11, b.seed) * 3 * b.size;
      const oy = noise(b.tick + 22, b.seed) * 3 * b.size;
      b.ctx.fillStyle = b.color;
      b.ctx.fillRect(b.pos.x + ox, b.pos.y + oy, b.size, b.size);
    },
  },
  // --- Sumi velocity-pressure family (Sumi*) ---------------------------------
  // Decker: brush[on SumiSml delta do circle.scale[r|.5*mag delta 1] end]
  // Radius scales with stroke velocity (mag delta), mimicking ink pressure.
  ...(["SumiSml", "SumiMed", "SumiLrg"] as const).map((key, i) => {
    const base = [1, 2, 3];
    const cap = [4, 7, 11];
    const labels = ["Sumi S", "Sumi M", "Sumi L"];
    return {
      key, label: labels[i], spacing: 2,
      stamp: (b: BrushContext) => {
        const mag = Math.hypot(b.delta.x, b.delta.y);
        const r = Math.max(base[i], Math.min(cap[i], 0.5 * mag + base[i])) * b.size;
        dot(b, r);
      },
    };
  }),
  // --- soft + stipple size variants ------------------------------------------
  // Decker: random[sm] / random[sl] — medium and large soft dot variants.
  {
    key: "softMed", label: "Soft M", spacing: 3,
    stamp: (b) => {
      const variants = [3.5, 4.2, 5];
      const r = variants[pickIndex(b.tick, b.seed, variants.length)];
      b.ctx.globalAlpha = 0.6;
      dot(b, r * b.size);
      b.ctx.globalAlpha = 1;
    },
  },
  {
    key: "softLrg", label: "Soft L", spacing: 4,
    stamp: (b) => {
      const variants = [5.5, 6.5, 7.5];
      const r = variants[pickIndex(b.tick, b.seed, variants.length)];
      b.ctx.globalAlpha = 0.5;
      dot(b, r * b.size);
      b.ctx.globalAlpha = 1;
    },
  },
  {
    // Decker: brush[on StippleMed do random[sm] end]
    key: "stippleMed", label: "Stipple M", spacing: 5,
    stamp: (b) => {
      const ox = noise(b.tick, b.seed + 1) * 7 * b.size;
      const oy = noise(b.tick, b.seed + 2) * 7 * b.size;
      b.ctx.fillStyle = b.color;
      b.ctx.fillRect(b.pos.x + ox, b.pos.y + oy, b.size * 1.5, b.size * 1.5);
    },
  },
  {
    // Decker: brush[on StippleLrg do random[sl] end]
    key: "stippleLrg", label: "Stipple L", spacing: 6,
    stamp: (b) => {
      const ox = noise(b.tick, b.seed + 1) * 10 * b.size;
      const oy = noise(b.tick, b.seed + 2) * 10 * b.size;
      b.ctx.fillStyle = b.color;
      b.ctx.fillRect(b.pos.x + ox, b.pos.y + oy, b.size * 2, b.size * 2);
    },
  },
  {
    // Flipnote-inspired: chunky pixel pen. No anti-aliasing, snapped to grid.
    key: "chonk", label: "Chonk", spacing: 4,
    stamp: (b) => {
      const s = Math.max(4, Math.floor(8 * b.size));
      const half = Math.floor(s / 2);
      b.ctx.fillStyle = b.color;
      b.ctx.fillRect(Math.floor(b.pos.x) - half, Math.floor(b.pos.y) - half, s, s);
    },
  },
  {
    // True eraser: layer-local. The walker sets globalCompositeOperation =
    // destination-out around this brush's stamps so each disc punches a
    // transparent hole in just THIS layer's offscreen. Fill color doesn't
    // matter under destination-out, only alpha; we use opaque black so the
    // alpha=1 fill takes out the whole stamped region.
    key: "eraser", label: "Eraser", spacing: 2, erase: true,
    stamp: (b) => {
      b.ctx.fillStyle = "#000";
      b.ctx.beginPath();
      b.ctx.arc(b.pos.x, b.pos.y, 6 * b.size, 0, Math.PI * 2);
      b.ctx.fill();
    },
  },

  // ===========================================================================
  // Texture brushes — CSP / Photoshop-inspired. Tiles are procedural (see
  // textures.ts), tinted per stroke color, with 3 variants picked per tick so
  // the texture itself "boils" at wiggle cadence. All variation flows through
  // noise()/pickIndex() — export-safe.
  // ===========================================================================
  {
    // CSP Watercolor: translucent soft body that accumulates where stamps
    // overlap, with paper tooth showing through. Pressure drives flow.
    key: "watercolor", label: "Watercolor", spacing: 3, group: "Texture",
    stamp: (b) => {
      const p = b.pressure ?? 1;
      stampTexture(b, "softDisc", 5 * b.size, 0.10 * (0.35 + 0.65 * p));
      stampTexture(b, "paperGrain", 4.5 * b.size, 0.08);
    },
  },
  {
    // Gouache: opaque matte body with canvas weave — flat poster color.
    key: "gouache", label: "Gouache", spacing: 3, group: "Texture",
    stamp: (b) => stampTexture(b, "canvasWeave", 4 * b.size, 0.95),
  },
  {
    // Dry Brush (oil): weave stretched along the travel direction, so thin
    // streaks of canvas show through — pressure loads more paint.
    key: "oildry", label: "Dry Brush", spacing: 3, group: "Texture",
    stamp: (b) => {
      const p = b.pressure ?? 1;
      stampTexture(b, "canvasWeave", 4 * b.size, 0.4 + 0.5 * p, {
        angle: heading(b.delta), stretchX: 1.6, stretchY: 0.55,
      });
    },
  },
  {
    // Charcoal stick: heavy clumpy grain, darkens hard with pressure.
    key: "charcoal", label: "Charcoal", spacing: 3, group: "Texture",
    stamp: (b) => {
      const p = b.pressure ?? 1;
      const ox = noise(b.tick + 5, b.seed) * b.size;
      const oy = noise(b.tick + 9, b.seed) * b.size;
      stampTexture(
        { ...b, pos: { x: b.pos.x + ox, y: b.pos.y + oy } },
        "charcoalGrain", 3.5 * b.size, 0.5 + 0.4 * p
      );
    },
  },
  {
    // Chalk: light paper tooth, chalky skip.
    key: "chalk", label: "Chalk", spacing: 3, group: "Texture",
    stamp: (b) => stampTexture(b, "paperGrain", 3 * b.size, 0.55),
  },
  {
    // Pastel: two slightly offset grain stamps blend into a soft waxy lay-down.
    key: "pastel", label: "Pastel", spacing: 3, group: "Texture",
    stamp: (b) => {
      const ox = noise(b.tick, b.seed + 3) * 1.4 * b.size;
      const oy = noise(b.tick, b.seed + 5) * 1.4 * b.size;
      stampTexture(b, "paperGrain", 3.2 * b.size, 0.45);
      stampTexture(
        { ...b, pos: { x: b.pos.x + ox, y: b.pos.y + oy } },
        "paperGrain", 2.6 * b.size, 0.4
      );
    },
  },
  {
    // Airbrush: very low-alpha wide soft disc; pressure drives flow. Build up
    // gradients with repeated passes, like PS airbrush mode.
    key: "airbrush", label: "Airbrush", spacing: 2, group: "Texture",
    stamp: (b) => {
      const p = b.pressure ?? 1;
      stampTexture(b, "softDisc", 8 * b.size, 0.06 * (0.3 + 0.7 * p), { angle: 0 });
    },
  },
  {
    // Copic-style marker: flat translucent chisel at a fixed 40° — overlapping
    // strokes build darker bands like alcohol markers.
    key: "marker", label: "Marker", spacing: 1, group: "Texture",
    stamp: (b) => {
      const { ctx, pos, color, size } = b;
      ctx.save();
      ctx.translate(pos.x, pos.y);
      ctx.rotate(-0.7);
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = color;
      ctx.fillRect(-2.5 * size, -0.8 * size, 5 * size, 1.6 * size);
      ctx.restore();
    },
  },
  {
    // Maru (mapping) pen: fine manga nib — fast strokes thin out.
    key: "maru", label: "Maru Pen", spacing: 1, group: "Texture",
    stamp: (b) => {
      const mag = Math.hypot(b.delta.x, b.delta.y);
      dot(b, Math.max(0.7, 2 - 0.15 * mag) * b.size);
    },
  },
  {
    // Spray: layered scatter starts close to the tip and expands outward.
    key: "spray", label: "Spray", spacing: 5, group: "Scatter & FX",
    stamp: (b) => {
      const { ctx, pos, color, size } = b;
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.8;
      for (let i = 0; i < 12; i++) {
        const ring = (i + 1) / 12;
        const radius = (0.75 + ring * 5.25) * size;
        const angle = Math.PI * 2 * Math.abs(noise(b.tick + i * 13, b.seed + i * 7));
        const ox = Math.cos(angle) * radius * Math.abs(noise(b.tick + i * 29, b.seed + i * 17));
        const oy = Math.sin(angle) * radius * Math.abs(noise(b.tick + i * 37, b.seed + i * 31));
        const r = (0.2 + 0.55 * ring * Math.abs(noise(b.tick + i * 41, b.seed + i * 23))) * size;
        ctx.beginPath();
        ctx.arc(pos.x + ox, pos.y + oy, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    },
  },
  {
    // Glitter / bokeh: sparse soft specks that twinkle as the tick advances.
    key: "glitter", label: "Glitter", spacing: 8, group: "Scatter & FX",
    stamp: (b) => {
      for (let i = 0; i < 3; i++) {
        if (noise(b.tick + i * 31, b.seed + i * 11) < 0.25) continue;
        const ox = noise(b.tick + i * 7, b.seed + i * 19) * 8 * b.size;
        const oy = noise(b.tick + i * 23, b.seed + i * 37) * 8 * b.size;
        const r = (0.8 + 0.8 * Math.abs(noise(b.tick + i * 43, b.seed + i * 3))) * b.size;
        stampTexture(
          { ...b, pos: { x: b.pos.x + ox, y: b.pos.y + oy } },
          "softDisc", r * 2, 0.9, { angle: 0 }
        );
      }
    },
  },
  {
    // Cloud: huge fractal-noise puffs at whisper alpha — skies, smoke, fog.
    // Alpha ramps in over the first ~40px so stroke starts don't pop.
    key: "cloud", label: "Cloud", spacing: 6, group: "Scatter & FX",
    stamp: (b) => {
      const ramp = Math.min(1, ((b.dist ?? 40) + 14) / 54);
      stampTexture(b, "cloud", 10 * b.size, 0.06 * ramp);
    },
  },
  {
    // Foliage: fan of short blades around vertical — CSP-style background
    // scatter for grass and bushes.
    key: "foliage", label: "Foliage", spacing: 7, group: "Scatter & FX",
    stamp: (b) => {
      const { ctx, pos, color, size } = b;
      ctx.strokeStyle = color;
      ctx.lineWidth = size;
      ctx.lineCap = "round";
      const blades = 3 + (pickIndex(b.tick, b.seed, 3));
      for (let i = 0; i < blades; i++) {
        const a = -Math.PI / 2 + noise(b.tick + i * 17, b.seed + i * 29) * 0.55;
        const len = (5 + 6 * Math.abs(noise(b.tick + i * 7, b.seed + i * 13))) * size;
        const bend = noise(b.tick + i * 37, b.seed + i * 41) * 3 * size;
        ctx.beginPath();
        ctx.moveTo(pos.x, pos.y);
        ctx.quadraticCurveTo(
          pos.x + Math.cos(a) * len * 0.5 + bend,
          pos.y + Math.sin(a) * len * 0.5,
          pos.x + Math.cos(a) * len,
          pos.y + Math.sin(a) * len
        );
        ctx.stroke();
      }
    },
  },
  {
    // Grainy (kneaded) eraser: lifts pigment unevenly through charcoal grain
    // instead of punching clean holes. destination-out only reads alpha.
    key: "eraser_grain", label: "Grainy Eraser", spacing: 3, erase: true, group: "Scatter & FX",
    stamp: (b) => stampTexture(b, "charcoalGrain", 5 * b.size, 0.7),
  },

  // Manga FX — speed/focus lines and expression stamps (see mangaFx.ts).
  ...MANGA_FX_BRUSHES,

  // Krita-inspired raster-only presets (see kritaRaster.ts / RASTER_BRUSH_MAPPING.md).
  ...KRITA_RASTER_BRUSHES,
];

export const brushByKey = (k: string): Brush =>
  BRUSHES.find((b) => b.key === k) ?? BRUSHES[0];
