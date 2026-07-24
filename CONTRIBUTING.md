# CONTRIBUTING.md

Conventions for working on Wiggle GPL, whether you're the author, a
collaborator, or an AI agent (agents should also read AGENTS.md).

## Setup
```bash
git clone --recurse-submodules https://github.com/its-jovee/wiggle-gpl.git
cd wiggle-gpl
npm ci
npm run dev      # localhost dev server
npm run build    # tsc --noEmit equivalent + vite production build
```

Use Node.js 24 LTS (see `.nvmrc`). The browser-backed tests require Playwright's
Chromium build; install it locally with `npx playwright install chromium` if
`npm test` reports a missing browser executable.

## Before every commit
All checks must pass:
```bash
npm run verify
```
The repo ships green. Keep it that way.

## Code conventions
- Vanilla TypeScript + DOM. No framework unless discussed first.
- Core modules start with a comment block explaining their role and any
  non-obvious decision. Preserve and update these.
- Brushes carry a one-line comment citing their Decker original.
- Keep functions small and prefer pure functions in `core/` (especially
  anything in the render path).
- No `Math.random()` in render/brush code — use `core/rng.ts` (see why in
  ARCHITECTURE.md).

## Commit style
- One logical change per commit; reference the task from HANDOFF.md when relevant.
- Present-tense, imperative subject: "add onion skinning toggle".
- If you touch a load-bearing decision (see AGENTS.md), say so explicitly in the
  body and explain why it was necessary.

## Adding dependencies
Keep the dependency surface small. `package.json` is the authoritative list;
runtime code currently includes FFmpeg WebAssembly, Electron's updater, and
Reicon, while Vite, TypeScript, Playwright, Electron, and electron-builder are
development/build tools. Justify additions in the commit message and run
`npm run notices` whenever package metadata changes.

## Testing the determinism guarantee
The browser-backed determinism tests render independent caches and compare the
resulting frames. They run under `npm test`. For release-sensitive rendering
changes, also export the same project twice and compare decoded frames. Any
difference means randomness or time escaped the deterministic render inputs.

## Attribution
This tool ports a technique (and possibly CC0 assets) from Decker by John
Earnest. Keep the MIT attribution in README.md intact, and add attribution for
any further code or assets you bring in. Do not commit an asset until its
creator, source, license, and modification history are known.

Direct Krita-derived work is allowed in this GPL fork. Every import or close
port must update `docs/research/krita/IMPORT_LEDGER.md` in the same commit.
Include the upstream repo, commit, source files, local destination, and a short
description of what changed during adaptation.

## License
This project is GPLv3-only (see LICENSE). Brush techniques ported from Decker by
John Earnest remain under their original MIT/CC0 terms and are compatible with
this GPL fork. Do not copy GPL-derived code from this repository back into the
separate MIT WiggleStudio project.
