// ============================================================================
// brushes/kritaRaster.ts — Krita-inspired raster-only brush presets.
//
// Fixed registry stamps with baked behavior. Visually inspired by default
// presets in Krita_4_Default_Resources.bundle @ bd6b58c (see
// docs/research/krita/RASTER_BRUSH_MAPPING.md). Not a close port of KisBrush
// dab rendering, tip bitmaps, or paintop option graphs.
//
// All entries set rasterOnly: true. Stamp contract remains (BrushContext)=>void.
// ============================================================================

import type { Brush, BrushContext } from "./registry";
import {
  stampGeneratedTip,
  stampHardDisc,
  stampPixelSquare,
  stampSoftDisc,
  tipAngle,
  unit01,
} from "./kritaTips";

function pressureFlow(b: BrushContext, base: number): number {
  const p = b.pressure ?? 1;
  return base * (0.25 + 0.75 * p) * (b.flow ?? 1);
}

/** Phase 2: Pixel, Quick, ink, pencil, marker, eraser, simple textured paint. */
const KRITA_EVERYDAY_BRUSHES: Brush[] = [
  // --- Pixel / Quick ----------------------------------------------------------
  {
    // Inspired by roundmarker / b)_Basic-1 (Quick Brush).
    key: "krita.quick",
    label: "Quick",
    spacing: 1,
    group: "Krita Pixel",
    rasterOnly: true,
    stamp: (b) => stampHardDisc(b, Math.max(0.5, 2.4 * b.size)),
  },
  {
    // Inspired by paintbrush / b)_Basic-5_Size_default.
    key: "krita.pixelHard",
    label: "Pixel Hard",
    spacing: 1,
    group: "Krita Pixel",
    rasterOnly: true,
    stamp: (b) => stampHardDisc(b, Math.max(0.5, 2.8 * b.size)),
  },
  {
    // Inspired by b)_Airbrush_Soft — soft falloff tip, not airbrush rate engine.
    key: "krita.pixelSoft",
    label: "Pixel Soft",
    spacing: 2,
    group: "Krita Pixel",
    rasterOnly: true,
    stamp: (b) => {
      const p = b.pressure ?? 1;
      stampSoftDisc(b, Math.max(1, 4.5 * b.size), 0.22 * (0.35 + 0.65 * p));
    },
  },
  {
    // Inspired by u)_Pixel_Art — aliased square.
    key: "krita.pixelArt",
    label: "Pixel Art",
    spacing: 1,
    group: "Krita Pixel",
    rasterOnly: true,
    stamp: (b) => stampPixelSquare(b, Math.max(1, 3 * b.size)),
  },

  // --- Ink --------------------------------------------------------------------
  {
    // Inspired by d)_Ink-1_Precision.
    key: "krita.inkPrecision",
    label: "Ink Precision",
    spacing: 1,
    group: "Krita Ink",
    rasterOnly: true,
    stamp: (b) => stampHardDisc(b, Math.max(0.4, 1.1 * b.size)),
  },
  {
    // Inspired by d)_Ink-2_Fineliner.
    key: "krita.inkFineliner",
    label: "Ink Fineliner",
    spacing: 1,
    group: "Krita Ink",
    rasterOnly: true,
    stamp: (b) => stampHardDisc(b, Math.max(0.4, 1.4 * b.size)),
  },
  {
    // Inspired by d)_Ink-3_Gpen — pressure via BrushContext size/flow.
    key: "krita.inkGpen",
    label: "Ink G-Pen",
    spacing: 1,
    group: "Krita Ink",
    rasterOnly: true,
    stamp: (b) => stampHardDisc(b, Math.max(0.5, 2.2 * b.size)),
  },

  // --- Marker -----------------------------------------------------------------
  {
    // Inspired by e)_Marker_Chisel_Smooth — fixed chisel, no tilt.
    key: "krita.markerChisel",
    label: "Marker Chisel",
    spacing: 1,
    group: "Krita Marker",
    rasterOnly: true,
    stamp: (b) => {
      const { ctx, pos, color, size } = b;
      ctx.save();
      ctx.translate(pos.x, pos.y);
      ctx.rotate(-0.65);
      ctx.globalAlpha = 0.42 * (b.flow ?? 1);
      ctx.fillStyle = color;
      ctx.fillRect(-2.8 * size, -0.85 * size, 5.6 * size, 1.7 * size);
      ctx.restore();
    },
  },
  {
    // Inspired by e)_Marker_Dry — chisel + light grain skip.
    key: "krita.markerDry",
    label: "Marker Dry",
    spacing: 2,
    group: "Krita Marker",
    rasterOnly: true,
    stamp: (b) => {
      const skip = unit01(b.tick, b.seed, 19.2);
      if (skip < 0.12) return;
      stampGeneratedTip(b, "dryTooth", 2.6 * b.size, pressureFlow(b, 0.55), {
        angle: -0.65,
        stretchX: 1.8,
        stretchY: 0.55,
      });
    },
  },

  // --- Pencil -----------------------------------------------------------------
  {
    // Inspired by c)_Pencil-1_Hard.
    key: "krita.pencilHard",
    label: "Pencil Hard",
    spacing: 1,
    group: "Krita Pencil",
    rasterOnly: true,
    stamp: (b) => {
      stampGeneratedTip(b, "dryTooth", 1.6 * b.size, pressureFlow(b, 0.7), {
        angle: tipAngle(b, "noise"),
      });
    },
  },
  {
    // Inspired by c)_Pencil-4_Soft.
    key: "krita.pencilSoft",
    label: "Pencil Soft",
    spacing: 2,
    group: "Krita Pencil",
    rasterOnly: true,
    stamp: (b) => {
      stampGeneratedTip(b, "chalkGrain", 2.4 * b.size, pressureFlow(b, 0.45), {
        angle: tipAngle(b, "noise"),
      });
    },
  },

  // --- Textured paint ---------------------------------------------------------
  {
    // Inspired by g)_Dry_Brushing — procedural weave, not random_particles.png.
    key: "krita.paintTextured",
    label: "Paint Textured",
    spacing: 3,
    group: "Krita Paint",
    rasterOnly: true,
    stamp: (b) => {
      stampGeneratedTip(b, "dryTooth", 3.6 * b.size, pressureFlow(b, 0.75), {
        angle: tipAngle(b, "heading"),
        stretchX: 1.35,
        stretchY: 0.7,
      });
    },
  },

  // --- Erasers ----------------------------------------------------------------
  {
    // Inspired by a)_Eraser_Circle.
    key: "krita.eraserHard",
    label: "Eraser Hard",
    spacing: 2,
    erase: true,
    group: "Krita Eraser",
    rasterOnly: true,
    stamp: (b) => {
      b.ctx.fillStyle = "#000";
      b.ctx.beginPath();
      b.ctx.arc(b.pos.x, b.pos.y, 5 * b.size, 0, Math.PI * 2);
      b.ctx.fill();
    },
  },
  {
    // Inspired by a)_Eraser_Soft.
    key: "krita.eraserSoft",
    label: "Eraser Soft",
    spacing: 2,
    erase: true,
    group: "Krita Eraser",
    rasterOnly: true,
    stamp: (b) => {
      // destination-out reads alpha; softDisc provides the falloff.
      stampGeneratedTip(
        { ...b, color: "#ffffff" },
        "softDisc",
        5.5 * b.size,
        0.85 * (b.flow ?? 1),
        { angle: 0 }
      );
    },
  },
];

/** Phase 3: chalk / dry media. */
const KRITA_CHALK_BRUSHES: Brush[] = [
  {
    // Inspired by h)_Chalk_Soft (Krita tip scribbles.png — procedural substitute).
    key: "krita.chalkSoft",
    label: "Chalk Soft",
    spacing: 3,
    group: "Krita Chalk",
    rasterOnly: true,
    stamp: (b) => {
      stampGeneratedTip(b, "chalkGrain", 3.2 * b.size, pressureFlow(b, 0.5), {
        angle: tipAngle(b, "noise"),
      });
    },
  },
  {
    // Inspired by h)_Chalk_Grainy.
    key: "krita.chalkGrainy",
    label: "Chalk Grainy",
    spacing: 3,
    group: "Krita Chalk",
    rasterOnly: true,
    stamp: (b) => {
      const p = b.pressure ?? 1;
      stampGeneratedTip(b, "dryTooth", 3.4 * b.size, pressureFlow(b, 0.62), {
        angle: tipAngle(b, "noise"),
      });
      // Second sparse speck for coarser tooth.
      if (unit01(b.tick, b.seed, 44) > 0.35) {
        const ox = (unit01(b.tick, b.seed, 45) - 0.5) * 2.2 * b.size;
        const oy = (unit01(b.tick, b.seed, 46) - 0.5) * 2.2 * b.size;
        stampGeneratedTip(
          { ...b, pos: { x: b.pos.x + ox, y: b.pos.y + oy } },
          "chalkGrain",
          2.2 * b.size,
          0.35 * (0.3 + 0.7 * p) * (b.flow ?? 1),
          { angle: tipAngle(b, "noise") }
        );
      }
    },
  },
  {
    // Inspired by h)_Chalk_Details.
    key: "krita.chalkDetail",
    label: "Chalk Detail",
    spacing: 2,
    group: "Krita Chalk",
    rasterOnly: true,
    stamp: (b) => {
      stampGeneratedTip(b, "chalkGrain", 1.8 * b.size, pressureFlow(b, 0.68), {
        angle: tipAngle(b, "noise"),
      });
    },
  },
  {
    // Inspired by h)_Charcoal_pencil_* family — one stick preset.
    key: "krita.charcoalStick",
    label: "Charcoal Stick",
    spacing: 3,
    group: "Krita Chalk",
    rasterOnly: true,
    stamp: (b) => {
      const p = b.pressure ?? 1;
      stampGeneratedTip(b, "dryTooth", 3.8 * b.size, pressureFlow(b, 0.8), {
        angle: tipAngle(b, "heading"),
        stretchX: 1.25,
        stretchY: 0.75,
      });
      stampGeneratedTip(b, "chalkGrain", 2.6 * b.size, 0.25 * (0.4 + 0.6 * p) * (b.flow ?? 1), {
        angle: tipAngle(b, "noise"),
      });
    },
  },
];

/** All Krita-inspired raster registry entries (phases accumulate here). */
export const KRITA_RASTER_BRUSHES: Brush[] = [
  ...KRITA_EVERYDAY_BRUSHES,
  ...KRITA_CHALK_BRUSHES,
];
