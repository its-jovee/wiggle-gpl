# Wiggle GPL — Continuation Brief

You're picking up the GPLv3-only Wiggle GPL experiment. It was seeded from a
working Vite + TypeScript WiggleStudio tree: a local, color-native alternative
to WigglyPaint with timeline sequencing, layers, audio, and native 9:16
(1080×1920) TikTok export.

This fork exists so GPL-compatible Krita-derived code and architecture can be
used directly when it materially improves the product. The separate MIT
WiggleStudio repository must remain free of GPL-derived code from this fork.

It should type-check, build, and test clean.
Start by running `npm install && npm run dev`, then read these files in order
before changing anything: `src/core/types.ts`, `src/core/rng.ts`,
`src/core/render.ts`, `src/brushes/registry.ts`, `src/main.ts`, then
`src/core/export.ts`. Read `README.md` and `PRODUCT.md` for context, and
`AGENTS.md` for working rules.

## Origin & design philosophy (do NOT undo these)
The brush model is ported from Decker (John Earnest, MIT license). A Decker
brush is a function `(delta) => image-to-stamp`, walked along the stroke
Bresenham-style; the "alive" wiggle is `random[...]` picking among pre-baked
variants per render. We reimplemented this in TS, color-native (real hex per
stroke, not Decker's 1-bit + dither). Preserve the Decker MIT attribution in
README and LICENSE if you lift any further code.

Four decisions are LOAD-BEARING. If a change seems to require reversing one,
stop and flag it rather than "fixing" it:
1. Strokes store RAW, un-jittered points. Wiggle is applied only at render time.
   Never bake jitter into stored data.
2. The three clocks (display 60fps / wiggle at project.wiggleFps / sequence on
   per-panel durations) are intentionally decoupled in the main loop.
3. Wiggle randomness is DETERMINISTIC and seeded (core/rng.ts) so the WebM and
   MP4 export paths render identical frames. Any new randomness must be seeded
   the same way — no bare Math.random() in render or brush code.
4. A brush is the registry shape `(BrushContext) => void`. Every brush is the
   same shape; new brushes are new registry entries, never engine changes.

This GPL fork may eventually decide that a Krita-derived raster/tile model is
worth replacing part of that architecture. That is a product-level fork decision
and must be proposed explicitly before implementation.

## Shipped in v8 (do not re-implement)
- **40 brushes** — Decker directional/soft/stipple family plus texture/scatter variants.
- **Onion skinning** — toggle + opacity while editing; export path ignores it.
- **Project save/load** — JSON via File System Access, download fallback, autosave recovery.
- **Spatial Project Board** — IndexedDB-backed finite project canvases on a
  light dotted drafting workspace, with cached previews, per-project
  panel/viewport restoration, and revision-aware autosave.
- **Layers** — per-panel stack, blend modes, masks, animation, merge/duplicate.
- **Audio timeline** — clip placement with fades; MP4 mixdown via Electron desktop bridge.
- **Electron shell** — COOP/COEP headers, local asset server, macOS build target.
- **Bundled ffmpeg** — `@ffmpeg/core` copied to `public/ffmpeg/` at install/build;
  MP4 export loads same-origin (no unpkg.com dependency).
- **CI** — GitHub Actions runs `npm ci`, `tsc`, build, and tests.
- **MIT LICENSE** — with Decker attribution block.

## GPL fork tasks (prioritized, one PR-sized commit each)

### 1. Krita source pin + provenance workflow
Add Krita as a pinned source reference, preferably as a shallow submodule under
`third_party/krita` from `https://invent.kde.org/graphics/krita.git`. If the
full source is too heavy for local development, document the pinned commit and
fetch steps in `docs/research/krita/`. Every direct import or close port must
update `docs/research/krita/IMPORT_LEDGER.md`.

### 2. Drawing feel pass
Study Krita's freehand/input/canvas behavior and implement a Wiggle-compatible
pass for cursor feedback, input smoothing/stabilization, zoom/pan ergonomics,
and stroke preview. Preserve raw stored points unless a design explicitly
changes the model.

### 3. Tool/options structure
Use Krita's brush option architecture as inspiration for splitting settings
data, model/dependency logic, and UI controls. Keep the implementation vanilla
TypeScript unless a larger rewrite is approved.

### 4. Layer/timeline ergonomics
Improve layer and animation timeline affordances using Krita's interaction
patterns where applicable.

### 5. Automated determinism test
Export the same fixture project to MP4 twice in a headless/browser harness and
assert byte-identical output (or at minimum frame-identical PNG hashes). This
guards the seeded RNG contract. See `test/` for existing Node test patterns.

### 6. Richer palette UX
Add palette preview swatches in the picker and a favorites list (in-memory,
not localStorage — see constraint below). Lospec errors are already surfaced
inline via `#lospec-error`.

### 7. Cross-platform Electron
Windows and Linux build targets in electron-builder config. Verify COOP/COEP +
ffmpeg.wasm work on each platform.

## Constraints
- No localStorage/sessionStorage if this ever runs as a Claude.ai artifact;
  for the local Vite app it's fine, but prefer in-memory + file save/load to
  keep it portable.
- MP4 export (ffmpeg.wasm) needs COOP/COEP cross-origin-isolation headers.
  These are configured in `vite.config.ts` (dev/preview) and applied by the
  Electron shell (production). ffmpeg core is bundled locally in `public/ffmpeg/`.
- Run `npx tsc --noEmit`, `npm run build`, and `npm test` before declaring any
  task done; all three must pass.

## Definition of done for each task
Type-checks, builds, tests pass, the feature works in `npm run dev`, and none
of the four load-bearing decisions were reversed. Commit per task with a clear
message.
