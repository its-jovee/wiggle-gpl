# Infinite Canvas Board — Implementation Plan

## Vision

The Project Board stops being a modal overlay you visit and becomes the default,
always-on state of the workspace: one infinite canvas holding every project.
The active project is live and editable in place; every other project is a
(possibly low-res) preview card. Switching projects is spatial — zoom out, see
everything, zoom into another project. The "Projects" button becomes a
hide/show toggle (default: shown), with "Fit all" and "Organize" actions.

## Where we are today

Most of the primitives already exist — the change is architectural, not greenfield:

- `src/core/projectLibrary.ts` — IndexedDB records per project (`json`,
  `previewDataUrl`, `x`, `y`, per-project editor `viewport`), plus board meta
  (`camera`, `activeProjectId`). Camera zoom math (`zoomBoardCamera`,
  `clampBoardScale`) lives here.
- `src/main.ts:8882–9460` — board build/pan/zoom/drag/fit, `showProjectBoard` /
  `hideProjectBoard`, `focusProjectFromBoard` (full session swap:
  `flushAutosave(true)` → load record → `resetProjectSession`).
- `src/main.ts:5076` `renderProjectPreview` — 360px JPEG preview, refreshed on
  autosave/save.
- Editor viewport (`src/core/viewport.ts`, `viewport` state in `main.ts:603`)
  is a CSS transform on the single big drawing canvas inside `.stage-area`.

The board today is `#project-board`, a fullscreen `<section>`; opening it sets
`body.project-board-open` which hides `.app-grid` entirely (index.html:1543).
That modal split is the thing to remove.

## Core architectural decision: one camera, one world

Merge the two coordinate systems. Today there are two independent transforms:
the board camera (over preview cards at ~0.24× "display size") and the editor
viewport (over the live canvas). The unified model:

1. **World space = project pixels.** A project card's world footprint is its
   real pixel size (e.g. 1080×1080), not the shrunken
   `projectBoardCanvasSize`. Migrate existing record `x`/`y` (currently laid
   out on a ~560px grid) by scaling positions up on first load (bump
   `DB_VERSION` or do a one-time in-place rewrite keyed off a meta flag).
2. **One camera** (`ProjectBoardMeta.camera`) drives everything. The world
   container gets `translate(tx,ty) scale(s)`; the active project's live
   canvas is absolutely positioned inside the world at `record.x/y` (minus
   overscan offset). Editing at "100%" simply means camera scale ≈ 1.
3. **Widen the scale clamp.** Editor needs up to ×8 (`viewport.ts` MAX_SCALE);
   board overview needs far below the current 0.2 floor — with full-pixel world
   coords, ~0.01–8. Replace `clampBoardScale` and `clampScale` call sites with
   one shared clamp.
4. **Per-record `viewport` becomes legacy.** The saved board camera is the
   single restored view. Keep reading old records' `viewport` for migration,
   then stop writing it (or keep it only as a "last focused framing" used by
   the focus animation target).

Why this works without rewriting the tools: pointer→canvas mapping
(`screenToCanvas`, viewport.ts:33) is `getBoundingClientRect()`-based, so it
survives arbitrary ancestor transforms. Drawing code doesn't need to know the
canvas now lives inside a transformed world div. The functions that DO need
rework are the ones that *set* the transform: `applyViewport`, `fitViewport`,
`resetViewport`, `zoomAboutPoint` uses in wheel/pinch handlers — they must
write to the shared camera, targeting the active project's world rect.

## Phases

### Phase 1 — Board becomes the base layer (biggest, do first)

- **DOM restructure** (index.html): move `#project-board-world` inside
  `.stage-area` (or make `.stage-area` itself the board surface). Delete the
  `body.project-board-open { .app-grid: hidden }` modality. The live drawing
  canvas becomes a child of the world container, positioned at the active
  record's world x/y. Neighbor cards render as siblings in the same world.
- **Camera unification** (main.ts): replace `viewport` state usage for
  pan/zoom with `projectBoardMeta.camera`. Rewrite `applyViewport` to apply
  one transform to the world container; rewrite `fitViewport`/`resetViewport`
  to compute a camera that frames the active record's world rect; keep the
  `zoom-label`, `zoom-fit` controls working against the shared camera.
- **Input routing** on the stage: pointer-down on the live canvas → existing
  draw/tool path, unchanged. Pointer-down on empty world space → pan (reuse
  the board surface pan handler, main.ts:9407). Wheel/pinch → shared camera
  zoom about cursor (merge the two existing wheel handlers). Card title-bar
  drag → move card (already exists, divide by camera scale as today). Card
  preview click → focus (Phase 2).
- **Startup**: `initializeProjectLibrary` (main.ts:9126) already restores the
  active record; additionally render all cards immediately and restore the
  saved board camera (fall back to "fit active project"). Board is visible by
  default — no `showProjectBoard` call needed.
- **Active card = live canvas**: `buildProjectBoard` skips building a preview
  card for `activeLibraryProjectId`; the live canvas occupies that slot. Card
  chrome (title, meta) can render above the live canvas too, so the active
  project is draggable/renamable like any other card.
- **Overscan handling**: the drawing canvas is `project size + 2×50%` overscan
  (main.ts:551). Clip it (`clip-path` or a wrapper with `overflow:hidden`
  sized to the frame) so out-of-frame stroke spill doesn't paint over
  neighboring cards. Verify strokes beyond the frame still work (they draw
  into the backing store regardless of CSS clipping).

Fallback path: when IndexedDB is unavailable (`projectLibraryAvailable()`
false) keep today's single-project behavior — board hidden, solo editor.
The `?project=` perf-harness URL keeps bypassing the board.

### Phase 2 — Spatial project switching

- **Focus by click/zoom-in**: clicking a preview card animates the camera
  (ease ~250–400ms, rAF tween) to frame that card, then runs the existing
  `focusProjectFromBoard` swap. The preview card stays visible until the
  session is ready, then the live canvas swaps in — this is what makes "it's
  fine if it takes a second" true: you're looking at the preview the whole
  time, no blank flash.
- **Session swap stays as-is** (`flushAutosave(true)` → `getProjectLibraryRecord`
  → `migrateProject` → `resetProjectSession`), except it must not touch the
  camera (no `applyViewport`/`fitViewport` reset — the camera already animated
  there) and must re-render the *outgoing* project's preview at its card
  (already handled by `flushAutosave(true)`).
- **Zoom-out keeps the project live.** No deactivation threshold — the active
  canvas just gets small. Optional polish: below ~15% screen coverage,
  ignore draw-tool pointer-downs on the active canvas (treat as pan) so users
  can't scribble accidentally at map zoom; add hysteresis so it doesn't flap.
- **UI chrome** (timeline, sidebars, toolbox) stays screen-fixed and always
  reflects the active project. Optional later: dim/collapse chrome when zoomed
  far out ("board mode" feel), but not required for v1.

### Phase 3 — Toolbar & controls rework

- **"Projects" button → "Hide board / Show board"** toggle, default shown.
  Hidden = today's solo look: neighbor cards `display:none`, plain stage
  background; camera unchanged (or refit to active project on hide).
  Persist the toggle in `ProjectBoardMeta`.
- **"Fit all"**: adapt `fitProjectBoard` (main.ts:9008) to the shared camera;
  expose in the top bar next to zoom controls and as a shortcut (e.g. `Shift+0`,
  alongside existing fit-active). Add to the command palette (`view-fit`
  pattern, main.ts:8579).
- **"Organize"**: auto-layout all cards on a grid (generalize
  `nextProjectBoardPosition` to reflow every record, sorted by `updatedAt`),
  animated via CSS transition on card left/top, then persist all records.
- **New project / Open file** stay (currently in the board toolbar,
  index.html:2156–2159) but move into the main top bar / file menu since the
  board toolbar as a separate modal surface goes away. New projects spawn at
  the next free world position near the current view center, and the camera
  animates to them.
- Remove `project-board-back` ("Back to project") — meaningless once the board
  isn't a place you leave. Update the help-text line and shortcuts overlay.

### Phase 4 — Performance & polish

- **Preview tiers**: 360px JPEG is fine at overview zoom. Lazily re-render a
  higher-res preview (e.g. 1080px) for cards that occupy a large screen area,
  so a half-zoomed-in neighbor doesn't look mushy. Throttle to one upgrade
  per idle frame.
- **Culling**: skip/`display:none` cards fully outside viewport ± margin once
  libraries grow past a few dozen (recompute on camera settle, not per-frame).
- **Wiggle loop at far zoom**: the animation loop re-renders the live canvas
  at `wiggleFps` regardless of its on-screen size; when active-project screen
  coverage is tiny, drop to a low fps or pause wiggle re-render (previews are
  static anyway).
- **Camera persistence** already debounced (`saveProjectBoardMetaSoon`); keep.
- **Preview freshness**: `flushAutosave(refreshPreview)` already refreshes on
  save; also refresh on a slow timer while editing (e.g. every 30s) so the
  zoomed-out view of the active project isn't stale after long sessions.

## Testing

- Extract pure math into `projectLibrary.ts` (or a new `boardCamera.ts`):
  position migration (old grid → pixel world), unified clamp, fit-all rect
  math, organize layout, focus-tween interpolation, coverage threshold with
  hysteresis. Cover with `test/*.test.mjs` like the existing suites.
- Manual verification matrix: draw at 100% / zoomed out; pan on empty space vs.
  draw on canvas; pinch-zoom continuity across the old board/editor boundary;
  switch projects with unsaved changes (autosave flush); reload restores
  camera + active project; no-IndexedDB fallback; `?project=` harness.

## Risks / open questions

1. **Transform-sensitive editor code.** Anything reading `canvas.offsetLeft` /
   `stageArea.getBoundingClientRect()` to *compute the transform*
   (`fitViewport`/`resetViewport` at main.ts:613/628, `zoomAboutPoint` calls in
   the stage wheel handler at main.ts:3467) breaks under the new hierarchy and
   is rewritten in Phase 1. Rect-based *input* mapping is safe: draw pointer
   events go through `screenToCanvas(canvas, …)` (main.ts:2603), which is
   `getBoundingClientRect`-based and survives arbitrary ancestor transforms.
   Overlays are the subtle case — the eraser cursor (main.ts:3943) positions
   itself screen-fixed against `stageArea` (safe) but sizes its ring with
   `viewport.scale` (main.ts:3957); every such `viewport.scale` read must switch
   to the shared camera scale. Audit the same for marquee/selection and the
   text-tool overlay.
2. **Huge-canvas compositing at tiny scale**: browsers handle downscaled large
   canvases fine, but the 50% overscan doubles the texture area; watch GPU
   memory with several large projects opened in one session (only one live
   canvas exists at a time, so this should be bounded).
3. **Scale range** (~0.01–8) may expose float precision in stroke input at
   extreme zoom-out — mitigated by disabling draw input below the coverage
   threshold (Phase 2 polish).
4. **Migration**: old records carry display-size positions and per-project
   viewports. One-way migration keyed on a meta flag; harmless if a user never
   opened the board before (positions regenerate via Organize).

## Suggested order of work

Phase 1 is the load-bearing change and should land as one PR (board as base
layer, unified camera, input routing). Phase 2 (focus animation + swap) is a
small follow-up since `focusProjectFromBoard` already does the hard part.
Phase 3 is UI-only. Phase 4 items are independent and can trickle in.
