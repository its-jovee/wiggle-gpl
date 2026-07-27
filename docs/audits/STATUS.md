# Audit status

Updated 2026-07-26.

The current branch is green after the raster/tone/export work: TypeScript and the
production Vite build pass, and the browser-backed suite passes when localhost
binding is permitted.

Completed high-value findings include Electron audio path allow-listing, CSP,
project-size validation caps, recovery quota handling, per-panel history sharing,
thumbnail budgeting, raw-layer cache preservation across Undo, idle-loop sleeping,
single-serialization autosave, changed-layer invalidation, stroke-length memoization,
and the Electron Undo/Redo menu bridge.

Current implementation focus:

- atomic Undo/Redo transitions, including delayed raster decode;
- idempotent canvas sizing and selective thumbnail invalidation;
- keyed timeline/layer reconciliation and deterministic render regression coverage;
- pinned FFmpeg assets, truthful File-menu affordances, and Space-key accessibility.

Deferred until measurement: dirty-rectangle raster history, MP4 worker rendering,
tile-based compositing, flood-fill stack changes, and broad `main.ts` extraction.

Source audits remain at the repository root for historical continuity:
`CODE_FABLE_CRIT.md`, `SECURITY_FABLE_CRIT.md`,
`UX_FABLE_CRIT.md`, `PRODUCT_FABLE_CRIT.md`, `DESIGN_FABLE_CRIT.md`,
`TACKLE_ORDER_FABLE_CRIT.md`, and `UNDO_PERF_AUDIT.md`.

`PERFORMANCE_FABLE_CRIT.md` was retired on 2026-07-24 and replaced by
`PERF_PLAN.md`: its three highest-severity findings (undo snapshot cost,
autosave double-serialization, the never-sleeping rAF loop) had all been fixed,
so it was actively misdirecting perf work. `PERF_PLAN.md` carries the measured
audit and the remediation that followed.
