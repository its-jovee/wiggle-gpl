# UNDO_PERF_AUDIT — Undo/Redo & Performance: Verified Audit + Execution Plan

Audited 2026-07-14 against branch `codex/brush-option-architecture`. Every finding
below was verified in the current code (file:line refs are from this audit; use the
named functions as anchors if lines drift). This doc supersedes the undo/perf items
in `PERFORMANCE_FABLE_CRIT.md` / `CODE_FABLE_CRIT.md` §6 — those were re-checked and
are folded in here where still true.

## Current implementation status

The previously listed Phase 1–3 items are now implemented in the branch, including
structural-sharing history, interaction guards, context restoration, thumbnail
budgeting, raw-cache preservation across Undo, memoized geometry, sleeping idle
frames, single-serialization autosave, and the changed-layer audit. The remaining
work is the atomic visual transition and keyed editor reconciliation described by
the current task. Raster dirty-rectangle history remains intentionally conditional
on a measured PNG-encode stall.

The second half is an **execution plan written for a Sonnet-class agent**: small,
ordered, independently shippable tasks, each with exact locations, an implementation
spec, and acceptance criteria. Do them in order; don't bundle tasks into one PR.

---

# Part 1 — Audit

## A. Undo/redo: what actually exists

There IS an undo system, and its coverage is broader than it feels:

- `src/core/history.ts` — whole-project JSON snapshot stack, depth 50, redo
  truncated on push. Pure, simple, correct for what it is.
- `commitHistory(changedLayers?)` (`main.ts:629`) — the single commit choke point:
  bumps layer versions, pushes a snapshot, marks dirty, invalidates caches.
  **114 call sites**, covering stroke commit (`commitLiveStroke`, `main.ts:887`),
  selection move/transform/delete/paste, layer ops, panel ops, timing changes,
  audio clip drags/trims, text edits, blend/clip/mask changes, guides, presets.
- Keyboard: `Cmd/Ctrl+Z` undo, `Shift+Cmd/Ctrl+Z` redo (`main.ts:7507`).
- `pointercancel` correctly restores scale-tool snapshots (`main.ts:2352`).

So the machinery is real. The reasons it doesn't *feel* like "a true Ctrl+Z flow":

## B. Undo/redo: verified defects

### U-1. Keyboard is the ONLY entry point — and the Electron menu is broken
`electron/main.cjs` sets **no application menu** (zero `Menu` references). Electron
therefore shows its **default** menu, whose Edit → Undo/Redo items use the native
`undo`/`redo` roles — those call `webContents.undo()` (text-field undo), **not the
app's history**. Clicking Edit → Undo in the desktop app does nothing to the
drawing. There are also no Undo/Redo entries in the command palette
(`commandList()`, `main.ts:~7000`) and no toolbar buttons. `Ctrl+Y` (Windows
convention) is not bound. Severity: **HIGH** — this alone explains "we don't have a
true undo flow".

### U-2. Undo during an in-flight interaction corrupts state
The undo handler (`main.ts:7507`) does not check `drawing`, `layerMoveDrag`,
`perspectiveDrag`, `selectDrag`, or `pendingRegionTransform` before swapping
`project = snap`. Example: press Cmd+Z mid-stroke → `liveStrokeLayer` now points at
a Layer object from the *discarded* project; on pointer-up `commitLiveStroke()`
pushes the stroke into that dead object (stroke silently vanishes) and pushes a
junk history entry. Same class of bug for the other drags. (`scaleToolDrag` IS
cleared — the others were missed.) Severity: **HIGH**.

### U-3. Coverage gap: stroke smoothing settings skip history
`setStrokeSmoothingSettings` (`main.ts:246`) mutates
`project.drawingSettings.smoothing` with only `markDirty()`. Consequences: the
change is not undoable, it silently rides into the *next* unrelated snapshot, and —
worse — a later undo of an unrelated edit reverts smoothing "randomly". This is the
only project-mutating path found without a commit (audio, guides, panels, layers
all commit). Severity: MEDIUM.

### U-4. Undo doesn't restore editing context
On undo, `activePanelIndex` is only clamped (`main.ts:7521`); the view stays
wherever it was, selection is cleared, active sub-panel reset. Undoing an edit made
on another panel looks like **nothing happened** (the only feedback is the status
toast). This is the biggest "undo feels unreliable" perception driver after U-1.
Severity: MEDIUM (UX).

### U-5. Whole-project snapshot per commit — cost and memory
`history.push` = `JSON.stringify(entire project)` on **every** commit, including
every stroke end — an O(project-size) stall at the exact moment the user lifts the
pen, growing linearly as the drawing grows. Stack holds up to 50 full copies
(multi-MB each on real projects). Undo also flushes the raw-layer render cache
(`clearRenderCache`, `main.ts:7519`) and marks **every** thumbnail dirty
(`main.ts:7516`), all re-rendered in one frame (`refreshThumbnails`,
`main.ts:3906`) → visible hitch on undo. Severity: **HIGH** (this is also perf
finding P-1).

### U-6. No commit coalescing
Every `onchange` of every inspector control pushes a full snapshot. Nudging a
number input 10× = 10 undo steps and 10 full serializations. Severity: LOW
(annoying, fix falls out of U-5's rework).

## C. Performance: verified hotspots (ordered by impact)

### P-1. History serialization on the stroke-commit hot path
See U-5. The single worst per-edit cost, paid on the most repeated action in the
app.

### P-2. `computeLayerStrokeLength` walks every stroke point, every layer, every frame
`drawLayerStack` calls it per visible layer per paint (`render.ts:395`,
implementation `render.ts:1712`) — it iterates **every point of every stroke**.
For a static heavy drawing at 60fps interaction / 8fps idle wiggle this is pure
recomputation of a value that only changes when strokes change — exactly what
`layerVersion` (`src/core/layerVersion.ts`) already tracks. Unmemoized today.
This is the likely cause of "drawing gets sluggish as the panel fills up".
Same pattern: `layerCentroid` (`main.ts:1454`) recomputed per overlay frame during
keyframe/move drags.

### P-3. The rAF loop never sleeps
`loop()` (`main.ts:3168`) unconditionally re-arms `requestAnimationFrame(loop)`
(`main.ts:~3336`). `shouldRenderIdleFrame` gates the *paint* but the JS wakeup,
clock math, `hasLiveEditorInteraction()`, and `trimFramePool()` run ~60×/s forever,
even idle in the background. Battery/thermals; also masks other jank in profiles.

### P-4. Autosave serializes the project twice per dirty cycle
`autosaveTick` (`main.ts:7382`): `projectHash(project)`
(`persistence.ts:63`, full serialize with `roundCoords` replacer) *just to
compare*, then `writeHandle`/`writeRecoverySnapshot` serialize **again**. 2× full
stringify every 5s while actively editing.

### P-5. Undo hitch: full cache flush + all-thumbnail refresh in one frame
See U-5. `refreshThumbnails` has no per-frame budget; a 50-panel project re-renders
50 `renderPanel` thumbs in one frame after undo.

### P-6. `commitHistory()` argless → `bumpAllProjectLayers()`
`main.ts:853`. Many call sites omit `changedLayers` (paste, delete, duplicate,
inspector toggles), so the common case is the O(all-layers) invalidation the
parameter exists to avoid. Each bump costs a layer re-hash on next render —
unchanged content still hits the raw cache, so it's re-hash cost, not re-stamp,
but on big projects it's real.

### P-7. Rebuild-the-world DOM
After most edits some combination of `buildTimeline(); buildLayers();
buildInspector(); buildEditContext()` runs; each does `innerHTML = ""` and full
reconstruction (21 sites). Heaviest on the timeline (one cell + canvas per panel).
Scroll/focus preservation hacks (`timelineScrollAfterRebuild`) are the tell.

### P-8. Clone-via-JSON
`JSON.parse(JSON.stringify(...))` ~19 sites; `structuredClone` is 2–5× faster and
semantically safer.

### P-9. MP4 export blocks the main thread
`exportMP4` renders + PNG-encodes every frame on the main thread; cancel only
polls between frames. (Bigger lift — backlog.)

**What's already good (don't re-do):** per-layer version keying, `layerSig`
memoization, raw-layer LRU keyed by content hash, deferred fill masks, base-frame
cache, incremental timelapse cache, deferred autosave clean-check, the
playback/idle render gating in `renderSchedule.ts`. Preserve all of it.

---

# Part 2 — Execution plan (for Sonnet)

## Ground rules
- One task per PR/commit. Run `npm run build` (tsc) and `npm test` after each.
- Never bake jitter, never touch determinism (`core/rng.ts`), never add
  `Math.random()` to render paths. See `HANDOFF.md` "load-bearing decisions".
- New tests go in `test/*.test.mjs` following the compile-with-tsc pattern in
  `test/sequence.test.mjs`.
- Perf tasks: measure before/after with the `?perf` overlay (append `?perf` to the
  dev URL) and `scripts/perf-project.mjs` / `scripts/gen-perf-fixture.mjs`.

---

## Phase 1 — Undo correctness & entry points (small, ship first)

### Task 1.1 — Extract `performUndoRedo(isRedo: boolean)`
**Where:** `src/main.ts:7507–7535` (inline in the `keydown` handler).
**Do:** Move the whole body (snapshot fetch, `project = snap`, dirty marking,
cache clears, UI rebuilds) into a top-level function `performUndoRedo(isRedo)`.
Keyboard handler calls it. No behavior change.
**Accept:** Cmd+Z / Shift+Cmd+Z behave exactly as before; tsc clean.

### Task 1.2 — Guard in-flight interactions before undo/redo
**Where:** top of `performUndoRedo`.
**Do:** Before swapping `project`, cleanly terminate any live interaction:
- if `drawing`: call `finishLiveStrokeSmoothing()`; drop the live stroke
  (do NOT commit it — undoing mid-stroke means the user wants out), then
  `drawing = false; drawingPointerId = null; clearLiveStrokeState()`.
- null out `layerMoveDrag`, `perspectiveDrag`, `selectDrag`,
  `pendingRegionTransform`, `subPanelDrag`, `transformSnapshots`, `keyframeArm`
  (mirror what the handler already does for `scaleToolDrag` at `main.ts:7526`).
**Accept:** Start a stroke, press Cmd+Z while the pen is down, release — no stroke
appears, no extra history entry, next undo/redo behaves normally. Same for a
layer-move drag.

### Task 1.3 — Fix the stroke-smoothing history gap
**Where:** `setStrokeSmoothingSettings` (`main.ts:246`).
**Do:** Replace `markDirty()` with `commitHistory([])` (smoothing is
project-level, no layer content changed; `commitHistory` already calls
`markDirty`). Ensure `updateSmoothingControls()` still runs after.
**Accept:** Change smoothing mode → Cmd+Z reverts it and the controls reflect the
revert (the undo path already calls `updateSmoothingControls()` at `main.ts:7528`).

### Task 1.4 — Add Undo/Redo entry points everywhere users look
**Where:** `commandList()` (`main.ts:~7000`); keyboard handler; the toolbar/edit
context UI (`buildEditContext` area).
**Do:**
1. Command palette: add `{ id: "edit-undo", label: "Undo", group: "Edit", shortcut: "⌘Z", enabled: () => history.canUndo(), run: () => performUndoRedo(false) }` and the Redo twin (`⇧⌘Z`).
2. Bind `Ctrl+Y` → redo (non-mac convention) in the keydown handler, same
   `inEditable` guard as Cmd+Z.
3. Add two icon buttons (undo/redo) to the main toolbar; disable via
   `history.canUndo()/canRedo()`. Refresh their disabled state inside
   `commitHistory()` and `performUndoRedo()` (one small
   `updateUndoRedoButtons()` helper; do NOT rebuild the whole toolbar).
**Accept:** Undo/redo reachable via palette, buttons, Cmd+Z/Shift+Cmd+Z/Ctrl+Y;
buttons gray out correctly at stack ends.

### Task 1.5 — Fix the Electron Edit menu
**Where:** `electron/main.cjs` (+ `electron/preload.cjs`).
**Do:** Build an application menu with `Menu.buildFromTemplate` that keeps the
standard roles EXCEPT Edit → Undo/Redo, which become custom items:
`click: () => win.webContents.send("menu:undo")` (and `menu:redo`), accelerators
`CmdOrCtrl+Z` / `Shift+CmdOrCtrl+Z`. Expose in `preload.cjs` via
`contextBridge` (`onMenuUndo(cb)`, `onMenuRedo(cb)`); in `main.ts`, subscribe and
call `performUndoRedo(...)`. Keep text-field editing working: in the renderer
listener, if `document.activeElement` is editable, call
`document.execCommand("undo")` instead (mirrors the keyboard handler's
`inEditable` branch).
**Accept:** In `npm run electron:dev`, Edit → Undo removes the last stroke; Cmd+Z
still works; undo inside a focused text input still does text undo.

### Task 1.6 — Restore editing context on undo/redo
**Where:** `src/core/history.ts`, `commitHistory`, `performUndoRedo`.
**Do:** Change history entries from `string` to
`{ json: string; activePanelIndex: number }` (module-internal; API becomes
`push(project, ctx)`, `undo(): { project, ctx } | null`). `commitHistory` passes
the current `activePanelIndex`. On undo/redo, set `activePanelIndex` to the
restored entry's value (clamped), then let the existing rebuilds
(`buildTimeline()` etc.) show the right panel. Also scroll the timeline to the
active cell if a helper exists (`timelineScroll*`).
**Accept:** Edit panel 3, switch to panel 7, Cmd+Z → view jumps to panel 3 and the
reverted content is visible. Unit-test the new history API shape in
`test/history.test.mjs` (new file, follow `test/sequence.test.mjs` compile
pattern): push/undo/redo/truncate-on-push/cap-at-50/ctx-roundtrip.

---

## Phase 2 — History engine rework (the big perf fix)

### Task 2.1 — Per-panel structural sharing in history
**Why:** kill the O(project) stringify on every stroke end (U-5/P-1) without
changing undo semantics or risking delta-application bugs.

**Design (implement exactly this):** each history entry stores the project split
into parts, sharing unchanged panel strings **by reference** with the previous
entry:

```ts
type HistoryEntry = {
  meta: string;          // JSON of Project minus `panels` (width, fps, presets, audio, groups, …)
  panels: string[];      // JSON per panel, in order; unchanged panels REUSE the
                         // exact same string reference as the previous entry
  activePanelIndex: number;  // from Task 1.6
};
```

- Keep a module-level `panelJson: Map<string /*panel.id*/, string>` cache of each
  panel's last serialization.
- `push(project, ctx, changedPanelIds?: Set<string>)`:
  - `meta` = `JSON.stringify({ ...project, panels: undefined })` (always — it's tiny).
  - For each panel: if `changedPanelIds` is provided and the id is NOT in it and
    the cache has an entry → reuse the cached string; otherwise
    `JSON.stringify(panel)` and update the cache.
  - If `changedPanelIds` is undefined → re-serialize every panel (correct
    fallback, same cost as today; used by global/structural ops).
- `undo()/redo()` reconstruct:
  `{ ...JSON.parse(entry.meta), panels: entry.panels.map(s => JSON.parse(s)) }`,
  then overwrite the `panelJson` cache from the entry (so the next push diffs
  against the restored state).
- `init(project)` seeds the cache and pushes a full entry.

**Wiring in `commitHistory` (`main.ts:629`):** derive `changedPanelIds` from
`changedLayers` — for each changed layer, find the owning panel (walk
`project.panels`, including each panel's `subPanels[].layers`; build the
layer→panel lookup in one pass per commit). ALWAYS also add the active panel's id
(cheap belt-and-braces: guides, bg, sub-panel bounds, texts all live on the active
panel). Call sites that pass `changedLayers` (non-empty or `[]`) get the fast
path; argless `commitHistory()` keeps the full-serialize fallback.

**Safety net:** behind a `?historycheck` URL flag, after each push, fully
serialize the project and assert it deep-equals the reconstruction of the new
entry; `console.error` with the operation name on mismatch. This catches any
mis-tagged call site during development at zero cost in normal use.

**Accept:**
- `test/history.test.mjs` extended: string-reference sharing across entries
  (assert `entries[n].panels[i] === entries[n-1].panels[i]` for untouched panels),
  fallback path, cache refresh after undo, redo truncation, depth cap.
- Manual: with a project of ~30 drawn panels and `?perf`, stroke-commit time no
  longer scales with total project size (only with the active panel).
- `?historycheck` stays silent through a full editing session (draw, fill, text,
  move layer, panel reorder, group, audio drag, undo/redo interleaved).

### Task 2.2 — Budgeted thumbnail refresh after undo
**Where:** `refreshThumbnails` (`main.ts:3906`) and its call in `loop()`
(`main.ts:3333`).
**Do:** Refresh at most N thumbnails per frame (start N=2, or a 4ms
`performance.now()` budget), leaving the rest in `dirtyThumbnailPanelIds` for
subsequent frames. Always refresh the active panel's thumb first
(`syncActiveThumb` already exists).
**Accept:** Undo on a 50-panel project produces no visible frame hitch; all thumbs
converge within ~1s.

### Task 2.3 — (Measure first) keep the raw-layer cache across undo
**Where:** `performUndoRedo` — the `clearRenderCache(displayRenderCache)` call.
**Do:** The raw-layer cache is keyed by content hash (`layerSig`) + tick, and
restored layers with identical content re-hash to the same sig — so the wholesale
clear may be unnecessary (its own comment at `main.ts:868` makes this argument for
edits). Try removing the clear; verify with `?perf` that post-undo frames hit the
cache and that no stale pixels appear (undo a stroke, redo it, edit again). If
anything renders stale, revert and leave a comment explaining why the clear is
load-bearing.
**Accept:** Undo → next repaint reuses cached layers (perf overlay shows no
re-stamp of unchanged layers), no visual regressions.

---

## Phase 3 — Steady-state performance

### Task 3.1 — Memoize `computeLayerStrokeLength` by layer version
**Where:** `src/core/render.ts:1712`, using `layerVersion` from
`src/core/layerVersion.ts`.
**Do:** Add at module scope:
`const _lengthMemo = new WeakMap<Layer, { v: number; len: number }>();` and inside
`computeLayerStrokeLength`, return the memo when
`_lengthMemo.get(layer)?.v === layerVersion(layer)`. WeakMap keying handles
undo/load rebuilding Layer objects automatically (same trick `layerVersion`
itself documents).
**Also:** memoize `layerCentroid` (`main.ts:1454`) the same way.
**Accept:** New unit test: length memo returns cached value until
`bumpLayerVersion`, then recomputes. `?perf` shows idle/interaction frame cost no
longer scaling with stroke count for static layers.

### Task 3.2 — Let the rAF loop sleep when idle
**Where:** `loop()` (`main.ts:3168`) and every state change that requires a repaint.
**Do:**
1. Add `let loopArmed = false;` and
   `function requestLoopFrame() { if (!loopArmed) { loopArmed = true; requestAnimationFrame(loop); } }`;
   `loop()` sets `loopArmed = false` on entry.
2. At the end of `loop()`, re-arm ONLY if any of: `playing`,
   `hasLiveEditorInteraction()`, `drawing`, `dirtyThumbnailPanelIds.size > 0`, an
   active drag/overlay animation (marching ants when a selection exists), or the
   wiggle needs to keep ticking for the idle preview.
3. For the idle wiggle: replace the "always run rAF to advance `wiggleTick`" with
   a `setInterval(1000 / project.wiggleFps)` that calls `requestLoopFrame()`
   (reset the interval when `project.wiggleFps` changes — the fps commit path in
   `buildInspector`). Keep tick derivation inside `loop()` unchanged so playback
   determinism is untouched.
4. Call `requestLoopFrame()` from: `commitHistory`, `performUndoRedo`, pointer
   handlers (`pointerdown/move` on the canvas), playback start, viewport
   pan/zoom, selection changes, and window resize/visibility events. Missing a
   wake shows up as "canvas frozen until I click" — sweep `markDirty`/`setStatus`
   call sites for anything that changes what's on screen.
**Accept:** With the app idle (no selection, not playing), CPU usage of the tab is
~0% between wiggle ticks (verify in the profiler / Activity Monitor); wiggle
preview still animates at `wiggleFps`; playback and drawing are unchanged.
`test/render-schedule.test.mjs` still passes.

### Task 3.3 — Single serialization per autosave
**Where:** `autosaveTick` (`main.ts:7382`), `projectHash`/`serialize`/`writeHandle`
(`src/core/persistence.ts`).
**Do:** Add `serializeProject(project): string` (the existing `serialize`) and
make `projectHash` accept a pre-serialized string
(`projectHashFromString(s)`), or return `{ hash, json }`. In `autosaveTick`,
serialize once, hash that string, and pass the same string into
`writeHandle`/`writeRecoverySnapshot` (add string-accepting variants).
**Accept:** Exactly one `JSON.stringify` of the project per autosave tick
(assert via a temporary counter or by code inspection in review); autosave tests
(if any) and manual save/recovery still work.

### Task 3.4 — Pass `changedLayers` at the top argless `commitHistory()` sites
**Where:** the argless calls flagged in P-6 — start with the highest-frequency
ones: selection move/transform commits (`main.ts:2240`, `2276`, `2298`, `2306`),
`deleteSelection`, `pasteSelection`, `duplicateSelection`, layer-move commit
(`main.ts:2322`).
**Do:** Each of these knows exactly which layers it touched (selection items carry
`ref.layer`; layer-move has `drag.layer` + `drag.dependents`). Collect the unique
layers and pass them. Do NOT guess at ambiguous sites — leave argless where the
touched set isn't obvious.
**Accept:** Behavior identical; with Task 2.1 in place these sites also get the
fast history path. `?historycheck` stays silent.

### Task 3.5 — `deepClone` helper on `structuredClone`
**Where:** the ~19 `JSON.parse(JSON.stringify(...))` sites in `main.ts`.
**Do:** `function deepClone<T>(v: T): T { return structuredClone(v); }` in a
shared spot; replace mechanically.
**Accept:** tsc clean, tests pass, copy/paste/duplicate still work.

---

## Phase 4 — Backlog (do not start without a fresh measurement)
- Keyed DOM reconcile for `buildTimeline`/`buildLayers` (P-7) — biggest remaining
  UI cost; design a 30-line keyed `replaceChildren` helper first.
- MP4 export in a worker with OffscreenCanvas (P-9) — keeps cancel responsive;
  determinism is safe since tick derives from frame index.
- Commit coalescing for repeated inspector nudges (U-6) — add an optional
  `coalesceKey` to `commitHistory`; consecutive pushes with the same key within
  ~800ms replace the top entry instead of pushing.
- Determinism regression test (from `TACKLE_ORDER_FABLE_CRIT.md` #15) — render a
  fixture project twice, hash frames, assert identical. Worth landing before or
  alongside Phase 2 if there's any appetite; Phase 2's `?historycheck` covers the
  undo-specific risk either way.

## Suggested order & sizing
| Order | Task | Size |
|---|---|---|
| 1 | 1.1 extract performUndoRedo | XS |
| 2 | 1.2 in-flight guards | S |
| 3 | 1.3 smoothing gap | XS |
| 4 | 1.4 entry points (palette/buttons/Ctrl+Y) | S |
| 5 | 1.5 Electron menu | S |
| 6 | 1.6 context restore + history tests | S |
| 7 | 2.1 per-panel history | M/L |
| 8 | 2.2 thumbnail budget | S |
| 9 | 3.1 stroke-length memo | S |
| 10 | 3.2 idle loop sleep | M |
| 11 | 3.3 autosave single-serialize | S |
| 12 | 3.4 changedLayers audit | S |
| 13 | 2.3 cache-across-undo (measure) | S |
| 14 | 3.5 deepClone | XS |
