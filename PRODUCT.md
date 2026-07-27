# Wigo Studio — Product

## What it is
A GPLv3 product fork of WiggleStudio for combining WiggleStudio's short-form
animation/export workflow with the strongest reusable ideas and GPL-compatible
code from Krita. It is allowed to take bigger swings than the MIT project,
including direct Krita-derived ports where they materially improve the drawing
experience.

## Who it's for
A solo content creator / indie animator who:
- likes the playful, jiggly, hand-drawn WigglyPaint aesthetic,
- makes multi-panel sequences (mini-comics, reaction bits, devlog cutaways),
- publishes vertically and wants clean MP4 out, not GIFs,
- wants control over color (per-panel palettes), not a fixed 1-bit look,
- wants a drawing surface that feels closer to a serious art tool than a toy.

## The core insight
WigglyPaint (and the Decker engine its brushes come from) throws away stroke
structure on export — it flattens to frames. Wigo Studio KEEPS the vector
structure (strokes = lists of points), which is what makes re-wiggling,
rescaling to 9:16, per-frame palette swaps, and frame-accurate export possible.
Vector-first is the whole product, not an implementation detail.

This GPL fork starts from that premise, but may challenge it if a Krita-derived
raster/tile workflow becomes clearly better for the product and community. That
decision is load-bearing and must be proposed explicitly before implementation.

## What's built (v8)
- Finite project canvases at their native aspect ratios on one continuous
  light dotted drafting workspace; brush bleed can remain visible outside the
  export frame.
- **40 brushes** using Decker's `(delta) => stamp` model, color-native,
  plus texture and scatter variants (watercolor, spray, foliage, etc.).
- **Multi-panel timeline** with frame groups, timelapse panels, drag reorder.
- **Layers** per panel: blend modes, masks, merge/duplicate, animation specs.
- **Tools**: bucket fill, text, sub-panels, selection/marquee, perspective guides.
- **Onion skinning** while editing (does not affect export).
- Three decoupled clocks (display / wiggle / sequence).
- Deterministic seeded wiggle (reproducible export).
- Per-panel Lospec palettes (load by slug) + six offline built-ins.
- **Project save/load** (JSON, File System Access + download fallback, autosave recovery).
- **Spatial Project Board** with aspect-ratio-accurate canvas previews and
  autosaving focus switches.
- **Audio timeline** with clip placement, fades, and MP4 mixdown (Electron desktop).
- Export: WebM (quick preview) and deterministic MP4 (bundled ffmpeg.wasm, H.264).
- **Electron desktop app** with cross-origin isolation for MP4 + audio export.

## Roadmap (near-term)
1. Krita research ledger and source pinning.
2. Drawing feel pass: input smoothing, cursor feedback, canvas navigation.
3. Tool/options structure inspired by Krita's brush option model.
4. Layer/timeline ergonomics pass.
5. Automated determinism regression test, unless a deliberate raster rewrite
   supersedes the current deterministic vector export model.

## Explicit non-goals (for now)
- NOT a general-purpose vector editor or a Procreate competitor.
- NOT 1-bit/ditherpunk-faithful to Decker — we deliberately chose color.
- NOT cloud / accounts / collaboration. Local-first, single user.
- NOT cross-project freeform export composition — the Project Board is a local
  navigator, while every project retains an explicit finite export frame.
- NO generative-AI image features.
- NOT an upstream Krita contribution workflow while Krita's AI development
  moratorium remains active.

## Success criteria
A creator can draw with a richer, more serious art-tool feel and still go from
blank canvas to a posted-ready 9:16 MP4 of a multi-panel wiggly animation
without manually assembling files in another editor.

## Attribution & licensing posture
Brush technique and any ported assets derive from Decker (MIT code / CC0
assets) by John Earnest. Keep the attribution intact.

This repository is GPLv3-only. Krita as a whole is GPLv3, and direct Krita-
derived imports are allowed here if they are tracked in
`docs/research/krita/IMPORT_LEDGER.md`. The original MIT sibling repository
(historically WiggleStudio) remains MIT and must not receive GPL-derived code
from this fork.
