# Wigo Studio

An experimental, local-first animation editor for hand-drawn, wiggly video.
This GPLv3-only fork of WiggleStudio is the home for GPL-compatible Krita ports,
drawing research, and artist workflow experiments. The separate MIT sibling
project (historically WiggleStudio) must not receive GPL-derived code from this
repository.

> **Project status:** pre-release. The source and browser development build are
> usable, but no signed public desktop release has been published yet.

## Highlights

- Native vertical-video canvas plus custom canvas sizes.
- Borderless editor bleed plus a spatial Project Board for local projects.
- Parallel vector and raster drawing engines, plus text, fill, tone, and
  sub-panel layers. Raster layers paint and erase live pixels and support
  marquee/lasso selection, move, scale, rotate, copy/cut/paste, and bucket fill.
- Deterministic seeded wiggle shared by display and export.
- Panel sequencing, onion skinning, editable timelapse camera keyframes,
  automatic raster edit recording, and an audio timeline.
- WebM preview and deterministic H.264 MP4 export through bundled ffmpeg.wasm.
- A hardened Electron shell for the macOS desktop build.

## Development setup

Requirements: Node.js 24 LTS, npm, and Git. The Krita source reference is only
needed for provenance/research; it is not compiled into the app.

```bash
git clone --recurse-submodules https://github.com/its-jovee/wiggle-gpl.git
cd wiggle-gpl
npm ci
npm run dev
```

Open `http://localhost:5173`. To run the desktop shell, keep the dev server open
and run `npm run electron:dev` in a second terminal.

If you cloned without submodules:

```bash
git submodule update --init --recursive
```

## macOS install and updates

Open the release DMG and drag **Wigo Studio** into **Applications**. The desktop
app checks the public GitHub Releases feed at launch. When a newer signed
release is available, it asks before downloading and asks again before restart
and installation.

Public releases require Apple Developer signing and notarization. Maintainers
should follow [`docs/RELEASING.md`](docs/RELEASING.md); pushing an arbitrary tag
without the matching package version and release credentials fails closed.

## GPL experiment scope
- Keep the vector-first animation core unless a GPL import clearly
  earns a product-level rewrite.
- Use Krita as a source for drawing feel, canvas interaction, brush/preset
  architecture, layer ergonomics, dock/panel structure, shortcuts, and tool UX.
- Track every direct Krita-derived import in `docs/research/krita/IMPORT_LEDGER.md`.
- Prefer small, reviewable ports over wholesale rewrites.
- Do not send AI-assisted changes upstream to Krita while Krita's AI development
  moratorium remains in force.

## Verify

```bash
npm run verify
```

This runs the required typecheck, production build, and browser-backed test
suite. Pull requests run the same checks in GitHub Actions.

## Privacy and network access

Project files, Project Board previews, autosave records, and recordings remain
on the local device. The app can make
outbound requests for Google Fonts, user-requested Lospec palettes, and desktop
update checks against GitHub Releases. There are no accounts, analytics, or
project uploads in this repository.

## Attribution
Brush behaviors are ported from Decker by John Earnest (MIT license); brush
frame-image assets in Decker are CC0. This project reimplements the technique
in TypeScript with full color.

This repository is licensed under GPL-3.0-only. Krita-derived code, algorithms,
or UI structure must keep source provenance in the import ledger. See
[`LICENSE`](LICENSE), [`NOTICE.md`](NOTICE.md), and
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

The bundled FFmpeg WebAssembly core is GPL-enabled. Its exact binary checksum,
source commit, build configuration, and source instructions are recorded in
[`docs/licenses/FFMPEG_WASM_SOURCE.md`](docs/licenses/FFMPEG_WASM_SOURCE.md).

## Docs
- **PRODUCT.md** — vision, users, scope, non-goals.
- **ARCHITECTURE.md** — how it works, in depth (data model, three clocks,
  determinism, brushes, export).
- **AGENTS.md** — working rules for AI coding agents (read before editing).
- **HANDOFF.md** — continuation brief and remaining work.
- **CONTRIBUTING.md** — setup, conventions, commit style.
- **SECURITY.md** — private vulnerability reporting policy.
- **docs/RELEASING.md** — signed macOS release procedure.
- **docs/research/krita/** — Krita integration strategy and import ledger.
