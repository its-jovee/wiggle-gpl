# Eraser & Raster-Marquee Fix Plan

Audit of two reported issues and the implementation plan to fix them.

1. **Eraser** — very laggy, and shows a white line tracing the drag path instead of
   erasing "live" like other apps.
2. **Marquee on raster layers** — you can select pixels, but you can't move, rotate,
   or otherwise manipulate what you selected.

---

## Part 1 — Eraser

### Audit: what actually happens today

There are two separate problems that compound each other.

#### 1a. The white trace line is intentional UI, and it's non-standard

`drawEraserCursorOverlay` (`src/main.ts:3839`) → `drawEraserTracePreview`
(`src/core/eraserPreview.ts:29`) draws, on every rendered frame during an erase drag:

- a white 1.5px **polyline through every point of the live stroke so far**
  (`rgba(255,255,255,0.85)`), and
- a circle outline at the cursor position (radius `brushSize * 6`, which correctly
  matches the eraser stamp radius `6 * b.size` in `src/brushes/registry.ts`).

The polyline is the "white line where you're drawing what you want to erase." No
mainstream app does this — the standard is a plain brush-circle cursor plus pixels
visibly disappearing under it. The trace is also white regardless of background
(invisible on white canvases, a growing scribble on dark ones).

Because the trace overlay is cheap while the underlying erase render is expensive
(see 1b), on a laggy frame the *only* fresh feedback is the white line — which is
exactly the confusing behavior reported.

Related polish problem: the eraser sets `canvas.style.cursor = "none"`
(`src/main.ts:1776`), so when frames lag the OS cursor is hidden *and* the drawn
circle is stale — the pointer effectively disappears.

#### 1b. The lag: vector-layer erasing does a full uncached panel re-render every frame

Erase behavior forks by layer kind:

- **Raster layers** are fine: `RasterStrokeSession` stamps `destination-out`
  directly into the layer canvas per pointer sample (`src/main.ts:2604`,
  `src/core/rasterEditing.ts:242`), and the frame is composited through the normal
  cached path (`src/main.ts:4218`).
- **Vector layers** hit `drawLiveErasePreviewFrame` (`src/main.ts:3663`) on **every
  RAF frame while the pointer is down** (`shouldRenderIdleFrame` returns true
  whenever interacting). That function:
  1. temporarily pushes the live erase stroke into `layer.strokes`,
  2. calls `renderPanel` **without `renderCache`** (`src/main.ts:3673-3685`), i.e. a
     full re-render of *every layer, every stroke, every brush stamp* in the panel,
  3. pops the temp stroke.

  The cache is omitted deliberately: the temp push doesn't bump `layerVersion`, so
  the layer-signature memo (`src/core/render.ts:1310-1343`) would be stale and the
  cache would serve pre-erase bitmaps. The "fix" of skipping the cache makes cost
  per frame O(total stamps in the whole panel). Erasing gets slower the more you've
  drawn — the reported lag.

  Erasing must stay a replayed stroke on vector layers (strokes re-jitter every
  wiggle tick, so erase has to composite in layer order with `destination-out`
  each tick). The architecture is right; only the *live preview* path is wasteful.

#### 1c. Latent bug found during audit: onion-skin mode

When onion skin is enabled, `drawLiveErasePreviewFrame` routes through
`drawEditorPanelWithOnion` → `drawEditorActiveContent` (`src/main.ts:3613`), which
**does** pass `renderCache` + the stale layer signature. Consequences:

- between wiggle ticks the cached active layer is reused → the erase is invisible
  while dragging (only the white trace shows);
- on a tick-boundary re-render, the fresh render *includes* the temp erase
  segments but is stored under the **pre-erase** signature key — a poisoned cache
  entry that can briefly show erased content after undo/cancel.

The cache-correctness fix below resolves both.

### Fix plan

#### Step E1 — replace the trace with a standard cursor (small, independent)

- `src/core/eraserPreview.ts`: drop the polyline from `drawEraserTracePreview`;
  reduce it to a circle-outline cursor. Draw it dual-stroke (dark under light, like
  the marching ants at `src/main.ts:4030-4043`) so it reads on any background.
- `src/main.ts:3839` `drawEraserCursorOverlay`: pass only the current cursor point;
  delete the live-stroke-points branch.
- Update `test/eraser-preview.test.mjs` to match (no polyline expectations).

#### Step E2 — make the live-erase preview cache-correct and cheap

Goal: per-frame cost = re-render of the **active layer only**; all other layers and
onion frames come from cache.

- During a live vector erase, mix a **live-erase generation counter** into the
  active layer's signature (increment it in `appendSmoothedStrokeSamples` when the
  live stroke erases, reset on commit/cancel). Simplest concrete form: call
  `bumpLayerVersion(liveStrokeLayer)` per appended sample — versions are opaque
  monotonic counters, and commit/rollback already bump again.
- With signatures now truthful, `drawLiveErasePreviewFrame` passes
  `renderCache: displayRenderCache` (matching `drawEditorActiveContent`). Every
  other layer hits the raw-layer cache; only the active layer re-renders.
- This also fixes 1c automatically (onion path stops serving stale/poisoned
  entries), and the non-onion and onion branches can collapse into one.
- Verify with the existing `profileRender("live-erase", ...)` label and
  `npm run perf:project` that per-frame cost no longer scales with non-active
  layers.

#### Step E3 (only if needed) — incremental stamping for stroke-heavy layers

If erasing on a single very heavy layer is still slow after E2:

- At erase-drag start and on each wiggle tick, snapshot the active layer's raw
  render (without the live erase) to an offscreen.
- Per pointer sample, stamp `destination-out` incrementally into the snapshot
  (reuse the `RasterStrokeSession` walker — it's already ctx-agnostic).
- On tick change, re-render the snapshot with the new jitter and replay the
  accumulated stamps once (stamps are cheap fills).
- Composite below-cache + snapshot + above-cache per frame.

This makes between-tick frames O(new stamps). It needs a `render.ts` hook to
substitute one layer's raw bitmap, so keep it a separate PR and only do it if E2
profiling says so.

#### Step E4 — cursor polish (optional)

Once frames are fast, the drawn circle tracks well. Optionally move the eraser
circle to a DOM overlay positioned on `pointermove` so the cursor never freezes
even under load.

### Acceptance criteria

- Erasing on a vector layer shows pixels disappearing under the cursor in real
  time; no white trace line.
- Frame cost during erase is independent of how many *other* layers exist
  (verify via the perf overlay / `profileRender` stats).
- With onion skin enabled, live erase is visible while dragging and undo after an
  erase never flashes stale content.
- `npm run verify` passes; determinism tests unchanged (export path untouched).

---

## Part 2 — Marquee on raster layers

### Audit: why selections can't be moved or rotated

The marquee has two selection modes (`src/core/selection.ts:36`):

- **`region`** — just a boundary. Painting is clipped to it; dragging inside moves
  *the boundary itself*, not the content (`src/main.ts:2695-2702`, status text:
  "drag inside to move boundary").
- **`object`** — extracted items with move/scale/rotate. Transform handles are only
  drawn (`src/main.ts:4046`) and hit-tested (`src/main.ts:2677`) in this mode.

Finishing a marquee drag always lands in `region` mode (`src/main.ts:3187`). The
only ways to reach `object` mode are the **"Extract" button** buried in the Edit
context panel (`src/main.ts:4886`) or the **"Extract Selection"** command
(`src/main.ts:8610`) — neither of which is discoverable from the canvas. So the
user selects pixels, drags to move them, and instead the dashed boundary slides
around: "I can select things but I can't rotate, move or manipulate them."

Notably, all the machinery for direct manipulation already exists:
`beginObjectSelectionTransform` (`src/main.ts:1944`) even contains a
region→object promotion branch (`:1954-1966`, via `rasterSelectionAtShape` →
`extractRasterSelection`) — but it's unreachable from the marquee tool because
region-mode pointerdown never hit-tests handles and no handles are drawn.

One history-model detail matters for the fix: `extractSelection()` commits an undo
step at extraction time. If we auto-extract at drag start we must **not** commit
there, or every move becomes two undo steps.

### Fix plan

Direction: on **raster layers**, a marquee selection is directly manipulable —
handles appear immediately, dragging inside moves the pixels. Boundary-move stays
available behind a modifier. Vector layers keep today's behavior in phase 1
(region = paint clip is their primary use; extraction there splits strokes, a
bigger behavioral change).

#### Step M1 — draw handles on idle region selections (raster layers)

`drawSelectionOverlay` (`src/main.ts:4046`): also render the handle set + rotate
stem when `selectionState.mode === "region" && phase === "idle"` and the active
layer is raster. Reuse the existing object-mode drawing block.

#### Step M2 — promote region → object on canvas interaction

In the marquee pointerdown branch (`src/main.ts:2676`), for an idle **region**
selection on a raster layer:

1. **Handle hit** → call `beginObjectSelectionTransform(handle, pos)` — the
   existing promotion branch takes over; scale/rotate works immediately.
2. **Press inside the shape** (no modifier) → promote via
   `rasterSelectionAtShape`, build the object state, snapshot items, and enter
   `phase: "moving"` in the same gesture — pixels move under the cursor.
3. **Alt(⌥)-press inside** → today's boundary move (keep `phase: "moving"` on the
   region), for repositioning the mask without lifting pixels.
4. **Press outside** → unchanged (start a new marquee).

Promotion failure (`extractRasterSelection` returns null — empty pixels, layer
still decoding) falls back to boundary-move plus the existing status toast.

#### Step M3 — single undo step per gesture

Split extraction from committing: add an internal `promoteRegionSelection()` that
does what `extractSelection()` does **without** `commitHistory`. Canvas-initiated
promotion uses it; the existing pointerup handlers for `moving`/`transforming`
(`src/main.ts:3192`, `:3219`) already sync + commit once at gesture end. The
"Extract" button/command keeps committing immediately (it's a standalone action).
`pointercancel` (`src/main.ts:3299`) already restores snapshots; verify it also
restores the pre-promotion layer pixels (the promotion mutates the layer canvas
via `renderRasterSelection` — the restore path must recompose `base` + original
frame, which `restoreFromSnapshot` handles via the payload frame/rotation; add a
test).

#### Step M4 — cursor and hint text

- `updateCanvasCursor` (`src/main.ts:1780`): extend the handle/move cursor logic to
  idle region selections on raster layers.
- Update hints: canvas status (`src/main.ts:3189`) and Edit context copy
  (`src/main.ts:4864`, `:4877`) to "drag to move pixels · handles scale/rotate ·
  ⌥-drag moves boundary". Keep the Extract button for vector layers; on raster it
  becomes redundant and can be dropped from the region row.

#### Step M5 — tests

- `test/raster-editing.test.mjs`: promotion produces correct payload for normal
  and inverted selections; empty selection returns null.
- New coverage for the promote-without-commit flow: one history entry per
  select→drag→release gesture; pointercancel restores pristine pixels.
- Manual QA: rect/ellipse/lasso × move/scale/rotate × inverted × undo/redo ×
  onion on/off; vector-layer marquee unchanged.

#### Explicitly deferred

- Auto-extract for **vector** layers (drag-inside would `cutAtShape`-split
  strokes; worth a separate design pass).
- The handle hit-radius vs drawn-radius mismatch flagged in `UX_FABLE_CRIT.md:149`
  (hit boxes are larger than visuals, which is forgiving; align visuals later).

### Acceptance criteria

- On a raster layer: drag marquee → handles appear; dragging inside moves the
  pixels; corner/edge handles scale; the top handle rotates — no Extract step.
- ⌥-drag still moves just the boundary; painting stays clipped to a region
  selection exactly as before.
- One undo step per move/transform gesture; Esc/pointercancel restores exactly
  the pre-gesture pixels.
- Vector-layer marquee behavior is unchanged.

---

## Suggested order of work

| # | Change | Size | Risk |
|---|--------|------|------|
| 1 | E1 — remove trace, standard circle cursor | XS | none |
| 2 | E2 — cache-correct live erase (fixes lag + onion bug) | S | low (cache keys) |
| 3 | M1–M4 — direct-manipulation raster marquee | M | medium (history/cancel paths) |
| 4 | M5 + E acceptance passes, `npm run verify` | S | — |
| 5 | E3 — incremental stamping | M | only if profiling demands it |

Steps 1–2 and 3 are independent and can be separate PRs.
