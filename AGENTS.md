# AGENTS.md — Working rules for AI coding agents

This file is the contract for any AI agent (Claude Code or otherwise) working in
this repo. Read it fully before editing. `HANDOFF.md` has the task list;
`PRODUCT.md` has the why; `ARCHITECTURE.md` has the how.

## GPL fork boundary
This is the GPLv3-only Wiggle GPL experiment, separate from the MIT
WiggleStudio repository. Direct Krita-derived code and GPL-compatible ports are
allowed here, but they must never be copied back into the MIT project. Track any
direct Krita-derived import in `docs/research/krita/IMPORT_LEDGER.md` with the
source repository, commit, files, license, local destination, and adaptation
notes.

Krita's upstream project currently has an AI-development moratorium. Do not
prepare or submit AI-assisted upstream Krita contributions from this repo while
that policy remains active.

## Golden rules
1. **Never reverse a load-bearing decision silently.** The four are listed below
   and in HANDOFF.md. If a task seems to need reversing one, STOP and flag it in
   your response — propose the change, don't just make it.
2. **Determinism is sacred.** No bare `Math.random()` anywhere in render or brush
   code paths. All randomness goes through `core/rng.ts` and is seeded by
   `(tick, stroke, point)` so the display, WebM, and MP4 paths agree frame-for-
   frame. If two exports of the same project differ, that's a P0 bug.
3. **Verify before declaring done.** Run `npx tsc --noEmit` AND `npx vite build`.
   Both must pass. The repo is currently green; keep it green.
4. **One task = one focused commit** with a message that names the task.
5. **Match the existing style.** Brushes get a comment citing their Decker
   original. Core modules keep their top-of-file explanation block.
6. **Keep GPL provenance auditable.** If a change is copied from or closely
   ports Krita, update the Krita import ledger in the same commit.

## The four load-bearing decisions
- Strokes store RAW points; jitter is render-time only.
- The three clocks (display / wiggle / sequence) stay decoupled.
- Wiggle randomness is deterministic + seeded.
- A brush is the registry shape `(BrushContext) => void`; extend by adding
  entries, never by changing the engine.

## Where things live
```
src/core/types.ts      data model (Project / Panel / Stroke) + constructors
src/core/rng.ts        deterministic noise/jitter — the determinism source
src/core/render.ts     renderPanel(panel, tick) — pure (panel,tick) -> pixels
src/core/export.ts     WebM (MediaRecorder) + MP4 (ffmpeg.wasm) paths
src/core/palette.ts    Lospec loading + built-in palettes
src/brushes/registry.ts brush definitions; add new brushes HERE
src/main.ts            DOM wiring, the three-clock loop, input, controls
index.html             app shell + styles
```

## Adding a brush (the common task)
1. Add an entry to `BRUSHES` in `src/brushes/registry.ts`.
2. Shape: `{ key, label, spacing, stamp(b: BrushContext) }`.
3. Use `b.delta` for direction (`heading()` helper), `b.tick`+`b.seed` for any
   variation (via `pickIndex`/`noise` from rng), `b.color`/`b.size` for style.
4. Comment the Decker original it maps to.
5. It auto-appears in the brush bar. No other file needs to change.

## Adding a palette
- Built-in: push to `BUILTIN_PALETTES` in `core/palette.ts`.
- Lospec: already loadable by slug via `loadLospecPalette`. Palette is a
  per-panel property (`Panel.paletteId`) — preserve that so frames can differ.

## Known pending item: MP4 cross-origin isolation
ffmpeg.wasm needs SharedArrayBuffer, which requires COOP/COEP headers. These are
already configured in `vite.config.ts` for `vite dev` and `vite preview`, and
applied by the Electron shell in production. The ffmpeg core WASM is bundled
locally at `public/ffmpeg/` (copied from `@ffmpeg/core` via
`scripts/copy-ffmpeg.mjs` on install and build) and loaded same-origin in
`core/export.ts` — no external CDN dependency under COEP.

## Constraints
- Prefer in-memory state + explicit file save/load over localStorage, to keep
  the code portable to a Claude.ai artifact context if ever needed.
- Keep dependencies minimal. Current deps: vite, typescript, @ffmpeg/core,
  @ffmpeg/ffmpeg, @ffmpeg/util. Justify any addition in the commit message.
- Don't introduce a framework (React/Vue) without flagging it first — the app is
  intentionally vanilla TS + DOM and small.

## What to do when unsure
Flag it in your response with a short options list and a recommendation. Don't
guess on anything touching determinism, the data model, or export output.
