# CODE_FABLE_CRIT — Code Quality & Architecture Critique

Honest baseline first: the core of this codebase is **better than average**. Strict
TypeScript is on, `core/` modules are small and single-purpose, the data model is
documented with *why* comments, the migration chain (v1→v8) is disciplined, and the
render cache work (per-layer versioning, sig memoization, frame pool) is genuinely
sophisticated. The critique below is about where that discipline stops.

---

## 1. The god file — `src/main.ts` (7,419 lines) — SEVERITY: HIGH

This is the single biggest structural problem. One file owns:

- the render loop and all three clocks (`loop()` at main.ts:3078)
- pointer input for **eight** tools, each inlined into one giant `pointerdown` handler (main.ts:1664–1943)
- perspective-ruler math (fisheye circle geometry! main.ts:994–1084) — pure math living next to DOM wiring
- imperative UI construction for ~15 panels (`buildBrushBar`, `buildTimeline`, `buildLayers`, `buildInspector`, `buildEditContext`, `buildAudioTrackRow`, …)
- persistence glue, autosave, recovery UI
- export orchestration and overlay UI
- audio recording (MediaRecorder state machine)
- the command palette
- ~80 module-level mutable variables (`let drawing`, `let liveStroke`, `let keyframeArm`, `let selectionState`, `let scaleToolDrag`, …) forming an implicit, undocumented state machine

**Why it matters:** every feature added (and the git log shows a feature per commit)
lands in this file. Tool state interactions (`keyframeArm` × `currentBrush` ×
`selectionState` × `activeSubPanelId`) are only correct because someone holds the
whole graph in their head. This is where the next regression comes from.

**Concrete carve-outs, in order of value:**
1. `tools/` — one module per tool implementing a `{ onPointerDown, onPointerMove, onPointerUp, drawOverlay }` interface; `main.ts` dispatches to the active tool. Kills the 280-line `pointerdown` handler and the sentinel-string hack (see §3).
2. `ui/` — the `build*` functions, each taking explicit state instead of closing over module globals.
3. `perspective.ts` — the fisheye/VP math is already pure; it just lives in the wrong file. Free win, and it becomes unit-testable (it currently has zero tests despite being the most subtle math in the app).
4. `editorState.ts` — a single typed object for the tool/selection/clipboard state, so "what can be non-null when" is written down once.

## 2. `index.html` (1,062 lines) — inline everything — SEVERITY: MEDIUM

~1,000 lines of CSS live in a `<style>` tag inside the HTML shell. There's a real
design-token system in there (`--space-*`, `--radius-*`, `--z-*` — good!) but:
- No stylesheet file → no CSS tooling, no source maps, diffs on `index.html` are noise.
- Vite handles CSS imports natively; extracting `styles.css` is zero-cost.
- One rebuilt panel writes raw inline styles via `innerHTML` (main.ts:5303: `'<div style="font-size:11px;color:var(--dim);">…'`) — a second styling channel that escapes the token system.

## 3. Sentinel-string tool system — SEVERITY: MEDIUM

```ts
const BUCKET_KEY = "__bucket__";
const TEXT_KEY = "__text__"; // … 8 of these (main.ts:100–108)
```

`currentBrush: string` holds *either* a real brush key *or* a magic tool sentinel,
and every consumer must remember to check `TOOL_KEYS.has(...)` first. This is a type
system evasion in a strict-TS codebase. It should be a discriminated union:
`type ActiveTool = { kind: "brush"; key: BrushKey } | { kind: "bucket" } | …`.
The compiler would then enforce what today is enforced by grep and hope.

## 4. Magic numbers — SEVERITY: LOW-MEDIUM (but pervasive)

The core render constants are named (`WIGGLE_AMPLITUDE`, `BUDGET_EPS` — good).
The interaction layer is a numerology museum:

| Value | Where | Meaning |
|---|---|---|
| `40` | main.ts:1682 | tail-handle hit radius |
| `30` | main.ts:1800–1801 | keyframe A/B handle hit radius |
| `26` | main.ts:1471, 3224 | drawn handle radius (≠ the hit radius above!) |
| `24 / viewport.scale` | main.ts:1836 | perspective handle pick radius |
| `8` | main.ts:1069 | px of travel before perspective snap locks |
| `dx = 24, dy = 24` | main.ts:763 | duplicate-selection offset |
| `0.96` | main.ts:505 | fit-viewport margin factor |
| `1.25 / 0.8` | main.ts:7294–7299 | zoom step ratios |
| `3500` | main.ts:6704 | status toast ms |
| `5000` | main.ts:7253 | autosave interval ms |
| `50` | history.ts:11 | undo depth |
| `64` | main.ts:341 | render cache entries |
| `160` | main.ts:1604 | default layer-animation travel px |

Individually harmless; collectively they mean hit-testing feel, timing, and caching
can't be tuned without a scavenger hunt. One `constants.ts` (or per-module consts)
with a comment each. Note the drawn-radius vs hit-radius mismatch (26 vs 30/40) is
exactly the kind of bug this breeds — the hit target doesn't match the visual.

## 5. `JSON.parse(JSON.stringify(...))` ×19 — SEVERITY: LOW

Used for every clone (main.ts:636, 659, 687, 767, 1501, 1513, 1580, 1589, …).
`structuredClone()` is available in every target runtime, ~2–5× faster, and doesn't
silently drop `undefined`/`Infinity`. A `deepClone<T>()` helper would also give one
place to swap the implementation.

## 6. Undo/redo: whole-project JSON snapshots — SEVERITY: MEDIUM

`history.push()` (history.ts:20) stringifies the **entire project on every commit** —
every stroke end, every slider change. With `MAX_POINTS_PER_STROKE = 500_000` allowed
by validation, a single snapshot can be tens of MB, ×50 stack depth. Consequences:

- O(project) serialization cost on the hot path of *finishing a stroke* (the moment latency matters most).
- Undo across panels rebuilds every `Layer` object identity, forcing `clearRenderCache` (main.ts:7322) — undo is always a full cache flush.
- Memory ceiling is invisible until it isn't.

Structural fix: command-pattern deltas (push `{undo, redo}` closures per operation)
or per-panel snapshots. Cheap interim fix: snapshot only the panels whose layers were
in `changedLayers`.

## 7. Error handling patterns — SEVERITY: LOW-MEDIUM

- `const $ = (id: string) => document.getElementById(id)!` (main.ts:331) — every UI
  lookup is a non-null assertion. A typo'd id crashes at a distance with no useful
  message. A `$(id)` that throws `Unknown element #${id}` costs one line.
- `try { canvas.setPointerCapture(...) } catch {}` appears **10+ times** verbatim —
  should be one `capturePointer(e)` helper (which *exists* at main.ts:1650 and is
  used in only some branches).
- `catch (err) { setStatus("… failed: " + (err as Error).message) }` swallows stack
  traces app-wide. Fine for user display, but nothing is ever `console.error`'d, so
  field debugging gets a one-liner.
- `saveAsProject` rejection on user-cancel: `openProject`/`saveProject` handle
  `AbortError` (main.ts:6909), good — but `openProjectFromPicker` (persistence.ts:111)
  will throw on cancel and relies on every caller remembering that.

## 8. Module-level singleton state in `render.ts` — SEVERITY: MEDIUM

`_timelapseCache`, `_layerOff`, `_layerXform`, `_frameCanvasPool`, `_fillScratch`,
`_clipBoundaryCache` are file-scope mutable singletons. Today it works because all
renders are synchronous and single-threaded, but:

- **Export and the editor share these caches.** `exportMP4` calls `clearTimelapseCache()` and renders on the same shared offscreens while the rAF loop is still repainting the editor between awaits. Correctness currently depends on "no `await` inside `renderPanel`" — a constraint documented nowhere.
- It makes render.ts untestable in parallel and blocks any future OffscreenCanvas/worker export.

Fix: bundle this state into a `RenderContext` object owned by the caller (the
`RenderCache` param already points in this direction — finish the thought).

## 9. Rebuild-the-world UI — SEVERITY: MEDIUM (perf overlap, see PERFORMANCE doc)

Every state change calls some combination of `buildTimeline(); buildLayers();
buildInspector(); buildEditContext();` which `innerHTML = ""` and reconstruct entire
DOM subtrees (21 call sites of `innerHTML = ""`). This is the vanilla-JS equivalent
of re-rendering without a diff. It's also why focus, scroll position, and open
`<details>` state need manual preservation hacks (`timelineScrollAfterRebuild`).
The no-framework constraint in AGENTS.md is legitimate — but a 30-line
"replaceChildren + keyed reuse" helper would keep the constraint and stop the churn.

## 10. Duplicated shape-hashing / shape-walking code — SEVERITY: LOW

`mixShape` (render.ts:1136) and the `f.clipShape` hashing block (render.ts:1110–1131)
are the same rect/ellipse/polygon switch written twice. `traceLayerMaskPath`,
`traceShapePath` (selection.ts), and the fill clip-shape application all re-implement
"iterate a SelectionShape". One `visitShape(shape, handlers)` would collapse them.
Same story with `measureText` living in main.ts but needed by selection.ts (it's
passed as a parameter to six functions — a sign it wants to be in `core/text.ts`).

## 11. Dead/misleading bits — SEVERITY: LOW

- `Fill.seed` is set (`Date.now() & 0x7fffffff`, main.ts:1909) but appears unused by the fill renderer — vestigial field in the *persisted format*.
- `ARCHITECTURE.md` still describes the v1 data model (`Panel { strokes[] }`, "the aside panel", "two built-ins ship for offline") — three major versions stale. It ends with a stray ``` fence (ARCHITECTURE.md:106). For a repo whose docs are its onboarding, this is real debt.
- `PRODUCT.md` says "NOT freeform-canvas … draws natively at 9:16 by choice" while `canvasPresets.ts` now ships square/landscape presets. The docs and code disagree about a *product invariant*.
- Recents in the File menu don't open the named file — every entry just calls `openProject()` (main.ts:7112). Either wire it or drop it; as-is it's a lie in the UI (also filed in UX doc).

## 12. Tooling gaps — SEVERITY: MEDIUM

- **No linter, no formatter.** No eslint/prettier/biome config anywhere. In a 13.5k-line
  codebase with multiple agent contributors (AGENTS.md, HANDOFF.md), style consistency
  is currently maintained by vibes. Biome would be one dep and one config file.
- **CI runs tests but no browser tests.** Playwright is a devDependency and scripts
  exist (`scripts/browser-perf.mjs`), but CI never opens a browser. The entire render
  path — the product — has zero automated pixel coverage. The determinism test
  (HANDOFF.md task #1) is the single highest-value test this repo could have, and
  it's been on the roadmap since v8 shipped.
- **Tests only cover pure helpers.** 25 test files, all Node unit tests of `core/`
  logic. Nothing tests: main.ts (7.4k lines, 0%), render.ts compositing, brushes,
  fill correctness on real canvases, Electron IPC.
- `package.json` `"version": "0.1.0"` while docs speak of "v8" — two version schemes
  (schema vs app) that will confuse the first bug report.

## 13. Smaller nits

- `loop()` runs `requestAnimationFrame` unconditionally forever — even when the tab
  is idle and nothing is dirty. `shouldRenderIdleFrame` gates the *paint*, but the
  JS wakeup still happens 60×/s (battery; see PERFORMANCE doc).
- `window.prompt`/`window.confirm` for preset naming/deletion (main.ts:242, 273, 284) —
  blocks the event loop and looks foreign next to the polished custom modals that
  already exist (preset picker, about, export overlay).
- Keyboard handler prevents default on Space whenever focus isn't in an input
  (main.ts:7268) — this also swallows Space-activation of focused buttons
  (accessibility; also filed in UX doc).
- `migrateProject`'s nested-call chain (types.ts:338–344) works but is a pyramid;
  a `MIGRATIONS: Array<(p) => p>` loop from `version` upward is the standard shape
  and makes adding v9 a one-liner.
- `renderThumb`-style canvases and the `thumbCanvases` map: thumbnail invalidation is
  hand-rolled via `dirtyThumbnailPanelIds` — works, but it's a fourth cache
  invalidation scheme (layerVersion, contentVersion, baseFrameCache key, dirty-thumb
  set) each with its own rules. A short `docs/caching.md` inventory would prevent the
  next contributor from adding a fifth.
