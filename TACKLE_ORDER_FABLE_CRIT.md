# TACKLE_ORDER_FABLE_CRIT — Prioritized Plan of Attack

A single ordered backlog across all five critique docs
(`CODE_`, `SECURITY_`, `PERFORMANCE_`, `UX_`, `PRODUCT_`, `DESIGN_FABLE_CRIT.md`).
Ordered by **(impact × risk-reduction) ÷ effort**, and sequenced so foundational work
lands before the things built on top of it. Each item cites its source doc.

Effort key: **S** = <½ day · **M** = ~1–3 days · **L** = ~1 week+.

---

## Phase 0 — Stop the bleeding (do first, cheap, high-consequence)

These are small, isolated, and each closes a real hole. Do them before any refactor.

1. **Sandbox the Electron audio IPC paths** — SECURITY §1 — **S/M**
   Allow-list `audio:read-file` / `save-recording` to the app's known audio roots,
   ignore caller-supplied `directory`. Reuse the traversal guard already correct in
   `filePathForRequest`. *Highest-severity finding; desktop file read/write.*

2. **Tighten project validation limits** — SECURITY §3 — **S**
   Drop `MAX_POINTS_PER_STROKE` to a human value, add `MAX_LAYERS_PER_PANEL` /
   `MAX_SUBPANELS` / `MAX_TEXTS`, clamp/coerce numeric fields (`durationMs`, `opacity`,
   anim transforms) in `capProjectFillLimits`. Guards against malicious *and*
   accidentally-huge files hanging the tab.

3. **Add a CSP** (Electron `onHeadersReceived` + `<meta>`) — SECURITY §2 — **S**
   Defense-in-depth over the 21 `innerHTML` sites; makes the whole XSS class
   non-exploitable even if a future edit introduces a sink.

4. **Pin the ffmpeg loader versions + hash-check the bundled wasm** — SECURITY §6 — **S**
   Remove the `^` on `@ffmpeg/ffmpeg`/`@ffmpeg/util`; compare `ffmpeg-core.wasm` against
   a committed SHA in `copy-ffmpeg.mjs`.

5. **Fix the Recent Files menu** (open the actual file, or remove the section) — UX §3 — **S**
   It currently lies to the user. If keeping: persist FS handles in IndexedDB.

6. **Wrap recovery-snapshot writes in try/catch + surface quota failure** — SECURITY §5 / PRODUCT §5 — **S**

> **Milestone:** no known security holes; malformed files can't hang the app; the File
> menu tells the truth.

---

## Phase 1 — Make the core loop feel finished (highest user-visible ROI)

The product's problem isn't capability, it's flow and legibility. These are mostly
small-to-medium and directly serve the target user's daily loop.

7. **Single-key tool + brush/eraser/fill/select shortcuts, and an eyedropper (Alt-click)**
   — UX §1 / DESIGN §1 — **M**
   The #1 friction. `B/E/G/V/M/T`, plus "duplicate panel & advance" on a key. Eyedropper
   is a glaring omission for a color-native tool.

8. **Fix Space stealing button activation + reduced-motion + slider aria** — UX §7 — **S**
   Only preventDefault Space when focus is on the canvas/stage, not on any button.
   Real a11y bug hiding behind the pan feature.

9. **Route preset save/rename/delete through the real modal system** (kill `window.prompt`/
   `confirm`) — UX §5 / CODE §13 — **S**

10. **Name exports after the project + add seamless-loop export** — UX §10 / PRODUCT §4 — **S/M**
    `wiggle.mp4` overwrites every time and carries no identity; loop export is the
    single most-wanted short-form property and the loop already supports it.

11. **Timeline speaks frames, and cell width reflects duration** — DESIGN §3, §4 — **M**
    Make exposure-in-frames primary (ms derived); size filmstrip cells by hold time so
    *rhythm is visible*. This is the animator's native language.

12. **Onion skin: always-available + hotkey; surface it as a first-class drawing aid**
    — DESIGN §1 — **S**

13. **Surface the differentiators**: in-context explainers for timelapse panels, frame
    groups, deterministic re-wiggle; a designed starter template on first run — PRODUCT §3 / UX §4 / DESIGN §5 — **M**

> **Milestone:** the blank→draw→advance→export loop is fast, legible, and its unique
> features are discoverable.

---

## Phase 2 — Foundational refactors (unlock everything after)

Do these once the above proves what the product should be — refactoring toward a moving
target is waste. These pay for themselves on every subsequent change.

14. **Replace whole-project undo snapshots with per-panel snapshots or command deltas**
    — CODE §6 / PERFORMANCE §1 — **M/L**
    Biggest hot-path perf win (fires on every stroke commit) *and* removes the full
    cache flush on undo. High value, touches core — do it deliberately with the
    determinism test (below) as a guard.

15. **Ship the determinism regression test** (export a fixture twice → identical frame
    hashes) — PRODUCT §7 / CODE §12 — **M**
    The product's crown-jewel promise is currently unguarded. Do this *before* #14 so the
    undo refactor can't silently break reproducibility. Wire it into CI (which already
    installs Playwright but never opens a browser).

16. **Extract tools into a `tools/` module with a `Tool` interface; replace sentinel
    strings with a discriminated union** — CODE §1, §3 — **L**
    Dissolves the 280-line `pointerdown` handler and the implicit
    `currentBrush × selectionState × keyframeArm` state machine. The single biggest
    structural risk-reducer for `main.ts`.

17. **Move pure math out of `main.ts`** (`perspective.ts`, and bundle render-module
    singletons into a `RenderContext`) — CODE §1, §8 — **M**
    Makes the fisheye/VP math testable and unblocks worker-based export.

18. **Add Biome (lint+format) and extract CSS to a stylesheet** — CODE §2, §12 — **S**
    One dep, one config; stops style drift across the multi-agent workflow.

> **Milestone:** `main.ts` is no longer a god file, motion/tool state is typed, and the
> determinism contract is enforced by CI.

---

## Phase 3 — Performance polish (measure first)

Now that structure is sane, chase the remaining perf with a profiler, not a hunch.

19. **Stop the rAF loop when fully idle** — PERFORMANCE §3 — **M** (battery)
20. **Cache the autosave serialization; stop double-stringifying** — PERFORMANCE §2 — **S**
21. **Memoize `computeLayerStrokeLength` / `layerCentroid` by `layerVersion`** — PERFORMANCE §6 — **S**
22. **Audit `commitHistory()` call sites to pass `changedLayers`** (avoid `bumpAllProjectLayers`) — PERFORMANCE §10 — **S**
23. **Keyed DOM reconcile for timeline/layers/inspector rebuilds** — CODE §9 / PERFORMANCE §5 / UX §8 — **M**
24. **Move MP4 export to a worker + OffscreenCanvas; keep cancel responsive; show frame ETA** — PERFORMANCE §9 / UX §10 — **L**

---

## Phase 4 — Product & design deepening (strategic, after the loop is tight)

25. **Re-anchor scope + reconcile docs with code** — PRODUCT §1, §2 — **M**
    Declare the v1 core loop; rank features core/support/speculative; update
    ARCHITECTURE.md (v1 model → v8), the 9:16 non-goal vs canvas presets, and the
    version/count sources of truth.

26. **Unify or progressively-disclose the three motion systems** — DESIGN §2 — **L**
    One keyframe model (or ruthless hiding of the advanced ones). Big design lift; do it
    only after the tool refactor (#16) gives a clean place to put it.

27. **Make the finish line feel good** — DESIGN §6 / PRODUCT §4 — **S/M**
    In-app preview of the exported clip, a bit of celebration on export, export presets
    (TikTok/Reels/Shorts).

28. **Let the product's personality match its output** (wiggly UI accents / playful empty
    states) — PRODUCT §6 — **S/M** (brand, low urgency)

29. **Self-host fonts** (privacy + offline + COEP robustness) — SECURITY §7 — **S**
    Small but supports the offline/private positioning.

---

## Cross-cutting: don't skip these habits

- **Land the determinism test (#15) before the undo refactor (#14).** Sequence matters.
- Every Phase-2 refactor should be a behavior-preserving PR with tests green, not
  bundled with features.
- Keep the `changedLayers`/version-cache discipline intact through the undo rewrite —
  it's the app's best existing engineering.

---

## TL;DR ordering

**Security holes → core-loop UX polish → foundational refactor (with determinism test
as guardrail) → measured perf → product/design deepening.**

If you only do five things: **#1 (Electron IPC), #7 (tool shortcuts + eyedropper),
#15 (determinism test), #14 (undo cost), #11 (frames-based timeline).** Those five hit
the worst risk, the worst daily friction, the unguarded core promise, the worst
hot-path cost, and the biggest craft-legibility gap — one from each dimension.
