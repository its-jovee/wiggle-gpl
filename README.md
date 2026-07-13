# Wiggle GPL

A GPLv3 experimental fork of WiggleStudio for aggressively exploring Krita-
inspired and Krita-derived drawing UX, brush systems, and artist workflow
patterns. The original WiggleStudio project stays MIT; this repository is where
GPL-compatible imports and ports are allowed.

## Run
```bash
npm install
npm run dev          # browser dev server (http://localhost:5173)
npm run electron:dev # desktop app (requires dev server running)
```

## macOS install and updates

Open the release DMG and drag **Wiggle GPL** into **Applications**. The desktop
app checks the public GitHub Releases feed at launch. When a newer signed
release is available, it asks before downloading and asks again before restart
and installation.

Releases are published by pushing a version tag, for example `v0.1.1`. Before
publishing, configure these GitHub Actions secrets: `CSC_LINK`,
`CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and
`APPLE_TEAM_ID`. macOS requires a signed application for in-app updates.

## What's here at fork time
- **Native 9:16 canvas** — draw directly at TikTok dimensions.
- **31 brushes** (`src/brushes/registry.ts`) — ported from Decker's
  `(delta) => stamp` model plus texture/scatter variants. Adding brushes = new
  registry entries, no engine refactor.
- **Layers & tools** — per-panel layer stack, masks, fills, text, sub-panels,
  selection, animation, and perspective guides.
- **Three-clock render loop** (`src/main.ts`) — display (60fps) / wiggle
  (project.wiggleFps) / sequence (per-panel durations) are decoupled.
- **Deterministic wiggle** (`src/core/rng.ts`) — seeded so export is reproducible.
- **Onion skinning** — ghost previous/next panels while drawing (export unaffected).
- **Per-panel Lospec palettes** (`src/core/palette.ts`) — load by slug; six
  built-ins for offline use.
- **Project save/load** (`src/core/persistence.ts`) — JSON via File System Access
  API, download fallback, autosave recovery.
- **Audio timeline** — clip placement with fades; mixed into MP4 export (Electron).
- **Export** (`src/core/export.ts`) — WebM (MediaRecorder preview) and MP4
  (deterministic frame-by-frame → bundled ffmpeg.wasm → H.264).
- **Electron shell** (`electron/`) — COOP/COEP headers + local asset server for
  desktop MP4 export with audio.

## GPL experiment scope
- Keep WiggleStudio's vector-first animation core unless a GPL import clearly
  earns a product-level rewrite.
- Use Krita as a source for drawing feel, canvas interaction, brush/preset
  architecture, layer ergonomics, dock/panel structure, shortcuts, and tool UX.
- Track every direct Krita-derived import in `docs/research/krita/IMPORT_LEDGER.md`.
- Prefer small, reviewable ports over wholesale rewrites.
- Do not send AI-assisted changes upstream to Krita while Krita's AI development
  moratorium remains in force.

## Verify
```bash
npx tsc --noEmit
npm run build
npm test
```

## Attribution
Brush behaviors are ported from Decker by John Earnest (MIT license); brush
frame-image assets in Decker are CC0. This project reimplements the technique
in TypeScript with full color.

This repository is licensed under GPLv3. Krita-derived code, algorithms, or UI
structure must keep source provenance in the import ledger. See `LICENSE` for
the GPLv3 terms.

## Docs
- **PRODUCT.md** — vision, users, scope, non-goals.
- **ARCHITECTURE.md** — how it works, in depth (data model, three clocks,
  determinism, brushes, export).
- **AGENTS.md** — working rules for AI coding agents (read before editing).
- **HANDOFF.md** — continuation brief and remaining work.
- **CONTRIBUTING.md** — setup, conventions, commit style.
- **docs/research/krita/** — Krita integration strategy and import ledger.
