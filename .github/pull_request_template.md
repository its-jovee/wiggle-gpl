## What changed

Describe the user-visible result and the reason for the change.

## Verification

- [ ] `npm run typecheck`
- [ ] `npm run build`
- [ ] `npm test`
- [ ] I manually checked affected UI/export behavior when applicable.

## Determinism and architecture

- [ ] No render/brush path uses bare `Math.random()`.
- [ ] This does not silently reverse a load-bearing decision in `AGENTS.md`.

## Provenance

- [ ] New code and assets are mine, generated with redistribution rights, or
      documented with their source and license.
- [ ] Any direct or close Krita port updates
      `docs/research/krita/IMPORT_LEDGER.md` in this PR.
- [ ] Third-party dependency or notice changes update
      `THIRD_PARTY_NOTICES.md` via `npm run notices`.
