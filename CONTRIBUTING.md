# CONTRIBUTING.md

Conventions for working on Wiggle GPL, whether you're the author, a
collaborator, or an AI agent (agents should also read AGENTS.md).

## Setup
```bash
npm install
npm run dev      # localhost dev server
npm run build    # tsc --noEmit equivalent + vite production build
```

## Before every commit
Both must pass:
```bash
npx tsc --noEmit
npx vite build
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
Keep the dependency surface small. Current deps: `vite`, `typescript`,
`@ffmpeg/core`, `@ffmpeg/ffmpeg`, `@ffmpeg/util`. Justify any addition in the
commit message.

## Testing the determinism guarantee
There's no test harness yet, but the manual check is: export the same project to
MP4 twice and diff the files — they should be byte-stable (or at minimum,
frame-identical). If they diverge, some randomness escaped `core/rng.ts`. A
lightweight automated version of this check is a welcome contribution.

## Attribution
This tool ports a technique (and possibly CC0 assets) from Decker by John
Earnest. Keep the MIT attribution in README.md intact, and add attribution for
any further code or assets you bring in.

Direct Krita-derived work is allowed in this GPL fork. Every import or close
port must update `docs/research/krita/IMPORT_LEDGER.md` in the same commit.
Include the upstream repo, commit, source files, local destination, and a short
description of what changed during adaptation.

## License
This project is GPLv3-only (see LICENSE). Brush techniques ported from Decker by
John Earnest remain under their original MIT/CC0 terms and are compatible with
this GPL fork. Do not copy GPL-derived code from this repository back into the
separate MIT WiggleStudio project.
