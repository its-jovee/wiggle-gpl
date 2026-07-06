# ARCHITECTURE.md

How WiggleStudio works, in enough depth to extend it safely. For the *why*, see
PRODUCT.md; for working rules, AGENTS.md.

## Data model (`src/core/types.ts`)
```
Project { version, width=1080, height=1920, wiggleFps, panels[] }
Panel   { id, durationMs, bg, paletteId, strokes[] }
Stroke  { brush, color, size, points[] }   // points are RAW, un-jittered
```
The entire app state is one serializable `Project` object. Save/load is just
JSON in/out — no hidden state lives outside it (the only transient things are
the current tool selection and the clocks, which are UI state, not document
state).

Why raw points: storing un-jittered points means the wiggle can be recomputed at
any time, at any scale, deterministically. If we stored jittered points we'd
lose re-wiggling, clean rescale, and reproducible export — so this is fixed.

## The three clocks (`src/main.ts`)
Three independent time sources, deliberately not synced:

| Clock     | Rate                | Drives                                  |
|-----------|---------------------|-----------------------------------------|
| display   | requestAnimationFrame (~60fps) | how often we repaint the canvas |
| wiggle    | `project.wiggleFps` (~8)        | the `tick` that reshuffles jitter |
| sequence  | per-panel `durationMs`          | which panel is shown during playback |

While editing (not playing), the canvas repaints smoothly at display rate but
the *line* only re-jiggles when the wiggle tick advances — that's the chunky,
hand-animated feel. During playback, the active panel and its local time come
from `panelAtTime()`, and the tick is derived from local time so it's
reproducible.

## Rendering (`src/core/render.ts`)
`renderPanel(ctx, panel, tick, w, h)` is a **pure function of (panel, tick)** —
same inputs always produce the same pixels. This is the linchpin of export
correctness: the live preview, the WebM capture, and the MP4 frame loop all call
this same function; they differ only in how they pick `tick`.

Per stroke:
1. Jitter every control point for this `tick` (via `core/rng.ts`).
2. Walk each segment; every `brush.spacing * size` px, call `brush.stamp`.
3. The brush stamps color at the (already jittered) position, optionally using
   `delta` (travel direction) and `tick`/`seed` for its own variation.

This mirrors Decker's `draw_line`: march the line, call the brush function at
each step. The difference is we stamp real color to a 2D canvas instead of 1-bit
masks with dither patterns.

## Determinism (`src/core/rng.ts`)
`noise(a,b,c)` is a hash-based PRNG returning [-1,1], stable for identical
inputs. `jitter(tick, strokeIndex, pointIndex, amp)` and `pickIndex(tick, seed,
n)` are built on it. Because every random choice is a pure function of integer
seeds, the same `(project, tick)` renders identically everywhere. **Rule:** any
new stochastic brush behavior must seed through these helpers, never
`Math.random()`.

## Brushes (`src/brushes/registry.ts`)
A brush is `{ key, label, spacing, stamp(b: BrushContext) }`. `BrushContext`
gives the stamp function everything it needs: `ctx, pos, delta, color, size,
tick, seed`. This is the TS form of Decker's `brush[on Name delta do … end]`.
The registry is a flat array; the UI builds the brush bar from it; adding a
brush is adding an entry. Directional brushes use `heading(delta)`; "alive"
brushes use `pickIndex(tick, seed, n)` to choose among variants per tick.

Reference originals: Decker's `examples/decks/brushes.deck` (clone
https://github.com/JohnEarnest/Decker). The existing six brushes carry comments
linking each to its Decker source line.

## Palettes (`src/core/palette.ts`)
Lospec palettes are lists of hex strings, fetched from
`https://lospec.com/palette-list/<slug>.json`. Loaded palettes are cached in a
Map. Two built-ins ship for offline use. Palette is a **per-panel** property, so
different panels can use different palettes — this is what makes "every frame a
different look" possible without special-casing.

## Export (`src/core/export.ts`)
Two paths sharing one offscreen 1080×1920 canvas:

- **WebM** (`exportWebM`): `canvas.captureStream()` + `MediaRecorder`, driven by
  a real-time rAF loop. Easy, fast, good for previews. Timing is wall-clock so
  it's not frame-exact — fine for a quick share.
- **MP4** (`exportMP4`): the real deliverable. Computes `totalFrames`, then for
  each frame derives `elapsedMs` from the frame index (NOT a wall clock),
  renders deterministically, grabs a PNG, and feeds the sequence to ffmpeg.wasm
  → `libx264 -pix_fmt yuv420p -movflags +faststart`. Frame-accurate, exact fps,
  TikTok-compatible.

ffmpeg.wasm requires SharedArrayBuffer → COOP/COEP headers (see AGENTS.md). The
core is lazy-imported so it doesn't bloat first load.

## UI (`index.html` + `src/main.ts`)
Vanilla TS + DOM, no framework, intentionally small. `main.ts` owns the loop,
pointer input, and the control wiring; `index.html` carries the layout and
styles. The aside panel is built imperatively (`buildBrushBar`, `buildPalette`,
`buildTimeline`) and rebuilt on selection changes.

## Extension points at a glance
- New brush → `BRUSHES` array.
- New built-in palette → `BUILTIN_PALETTES`.
- New export format → new function in `export.ts` reusing `renderPanel`.
- New per-document state → add to `Project`/`Panel` types (it'll serialize for
  free once save/load exists).
```
