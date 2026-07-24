# RASTER_TONE_EXPORT_PLAN — Static Export, Paintable Tones, Raster Layers

Scoped 2026-07-14 against branch `codex/brush-option-architecture`, same method as
`UNDO_PERF_AUDIT.md`: every claim below was verified in the current code; line
numbers are anchors from this audit — trust the function names if they drift.

Three features, in ascending size:

- **A. Disable line jitter on export** — S (the plumbing already exists)
- **B. Paintable manga tones** — M (tone layers become maskable by strokes)
- **C. Raster layers** — L (new layer kind with real pixels; phased)

Written for a Sonnet-class agent. One task per PR, `npm run build` + `npm test`
green after each. The load-bearing rules in `HANDOFF.md` apply throughout —
especially: never bake jitter into stored *vector* data, and all render-path
randomness stays seeded through `core/rng.ts`.

---

# Feature A — Disable line jitter on export

## What exists (verified)
`RenderOpts.skipJitter` (`render.ts:55`) already turns off ALL wiggle:
stroke-point jitter (`render.ts:701`), text wiggle (`render.ts:903`), and
sub-panel border wiggle (`render.ts:961`). Crucially, at amplitude 0 the stroke
walker also pins `stampTick = strokeSeed` (`walkLayerStrokes`, `render.ts:~1608`),
so "alive" brushes stop re-rolling their stamp variants too — `skipJitter: true`
produces **fully static ink**, not just non-moving points. The editor already has
a working toggle (`jitterEnabled`, `main.ts:162`, button at `main.ts:4039`).

The ONLY gap: neither export path passes it. `exportWebM` (`export.ts:90`) and
`exportMP4` (`export.ts:151`) call `renderPanel` without `skipJitter`.

### Task A1 — Thread `skipJitter` through both exporters
**Where:** `src/core/export.ts`.
**Do:** Add `skipJitter?: boolean` to `ExportRenderOpts` (`export.ts:23`) and
`MP4ExportOptions` (`export.ts:29`). Pass `skipJitter: opts?.skipJitter ?? false`
into the `renderPanel` call in `exportWebM` (`export.ts:90`) and in `exportMP4`
(`export.ts:151`).
**Accept:** tsc clean; exporting with the flag unset produces byte-identical
frames to before (determinism untouched).

### Task A2 — Export-overlay checkbox
**Where:** the export overlay UI in `main.ts` (search `"export-overlay"` /
`index.html`) and every call site of `exportMP4`/`exportWebM` in `main.ts`.
**Do:** Add a checkbox row "Stroke wiggle" to the export overlay, checked by
default, **initialized from the editor's current `jitterEnabled`** each time the
overlay opens (the toggle the user already knows). Pass `skipJitter: !checked`
into every export call (full export, single-panel export, WebM preview).
**Accept:** Export an MP4 with the box unchecked → lines, text, and sub-panel
borders are completely static across the whole clip while panel sequencing,
enter/exit animations, layer keyframe animations, and audio still play (those are
`localMs`-driven, not jitter-driven — verified). With the box checked, output is
identical to today.

---

# Feature B — Paintable manga tones

## What exists (verified) and why it disappoints
A tone layer today is a **whole-canvas procedural texture**: `drawLayerRaw`
explicitly skips its strokes (`layer.kind === "tone" ? [] : walkLayerStrokes`,
`render.ts:702`) and paints the pattern edge-to-edge (`renderTone`,
`core/tone.ts`). Painting on a tone layer is even actively redirected to the
nearest draw layer (`main.ts:1942`). So "tones" = a full-bleed texture you can
only shape with the layer's rect/ellipse/polygon mask — not paintable.

## Design (implement exactly this — the decisions matter)
Strokes on a tone layer become a **reveal mask** for the pattern:

1. Render the layer's strokes into the layer offscreen exactly like a draw layer
   (any brush works — textured brushes give soft/feathered tones; eraser brushes
   already punch holes via `destination-out`).
2. Composite the tone pattern over it with `globalCompositeOperation =
   "source-in"` — pattern appears only where ink exists.

Why mask-based instead of a stamp-dots brush: `renderTone` paints in **canvas
space**, so the dot/hatch grid stays globally aligned no matter how strokes
overlap — overlapping strokes can never double-print or misalign the screen tone.
That's the manga-correct behavior and it's idempotent by construction.

Tones stay **static** (no wiggle clock): render the mask strokes at amplitude 0.
This preserves the documented tone contract (`core/tone.ts:4` — identical in
editor and every export frame) and the raw-cache friendliness. (Wiggly tone
edges could be a later opt-in; do not add now.)

Back-compat: existing tone layers keep their full-bleed look via a new
`coverage` field.

### Task B1 — Data model + migration (project v10)
**Where:** `src/core/types.ts`.
**Do:**
- `ToneSettings` gains `coverage: "full" | "painted"`.
- Bump `Project.version` to 10. Follow the existing migration-chain pattern
  (`migrateLegacyToV8` → … at `types.ts:424`): add `migrateV9toV10` which sets
  `coverage: "full"` on every existing tone layer's `tone` (including sub-panel
  layers), and a `normalizeV10` mirroring `normalizeV9` (`types.ts:544`).
  `migrateProject` dispatches version 10 as current, 9 through the new step.
- `newLayer(name, "tone")` (`types.ts:342`) creates `coverage: "painted"`.
- **Note for Feature C:** C1 also lands in v10 — if both features are being
  built, do B1 and C1 as ONE version bump (single `migrateV9toV10`). If B ships
  alone, C1 later just extends `normalizeV10` (optional fields need no version
  bump of their own).
**Accept:** New migration test in `test/` (follow `test-project-validation`
compile pattern): a v9 project with a tone layer loads as v10 with
`coverage: "full"`; new tone layers get `"painted"`; older versions still chain
through.

### Task B2 — Render the painted mode
**Where:** `drawLayerRaw` (`render.ts:646`) and the sig hash
(`mixLayerMaskState`, `render.ts:~1150`).
**Do:**
- Replace the tone branch: if `layer.kind === "tone" && layer.tone`:
  - `coverage === "full"` (or strokes absent): current behavior — skip strokes,
    `renderTone` over everything.
  - `coverage === "painted"`: call `walkLayerStrokes(oc, layer.strokes,
    layerIndex, tick, budget, bg, /*amplitude*/ 0)` first, then
    `oc.save(); oc.globalCompositeOperation = "source-in";
    renderTone(oc, layer.tone, width, height); oc.restore();`.
    Skip the fill-mask block for tone layers (fills unsupported on tone in v1).
- **Cache correctness:** `mixLayerMaskState` does not hash tone settings today
  (verified — it hashes blendMode/mask/strokes/fills/texts only). Add: when
  `layer.tone` exists, mix `style`, `color`, `spacing`, `size`, `angle`,
  `coverage`. (This also fixes a latent one-tick-stale render after editing tone
  settings.)
- **Timelapse:** add `layer.kind === "tone"` to `timelapseLayerNeedsFallback`
  (`render.ts:230`) so painted tone layers render whole rather than
  stroke-budgeted (a half-revealed mask under a full pattern looks broken).
**Accept:** Painted tone layer shows pattern only under strokes; dots/hatch stay
grid-aligned where strokes overlap; eraser removes tone; pattern is identical on
every wiggle tick; `coverage: "full"` layers look exactly as before. Export
(MP4) matches the editor.

### Task B3 — Allow painting on tone layers
**Where:** the redirect at `main.ts:1936–1950`.
**Do:** Change the condition so tone layers with `coverage === "painted"` accept
paint tools (strokes commit to the tone layer via the normal
`liveStroke`/`commitLiveStroke` path — `Layer.strokes` already exists on every
layer, so no pipeline change). Keep redirecting: text layers, and tone layers
with `coverage: "full"`. Block the bucket tool on tone layers with a status
toast ("Fills aren't supported on tone layers yet").
Live preview note: the live stroke overlay will show the raw brush color while
the pen is down and snap to tone on commit — acceptable for v1; leave a code
comment saying so.
**Accept:** Select a tone layer, draw → tone appears where you drew; undo/redo
works (strokes are ordinary vector data, so the existing history covers it);
accidental-stroke protection still works for text/full-tone layers.

### Task B4 — Tone tool UX
**Where:** `buildBrushBar` (`main.ts:~3341`), the layers panel
(`main.ts:5602` "+ Manga tone"), the tone inspector (`main.ts:5995–6035`).
**Do:**
- Add a "Tone" tool chip to the brush bar's draw-tools group: clicking it
  selects the active container's first `painted` tone layer (creating one if
  none exists, reusing the `addTone` logic at `main.ts:5605`) and keeps the
  current brush. Switching to any other tool restores the previously active
  layer (remember the index when the tool is engaged).
- In the tone inspector, add a "Cover entire layer" checkbox bound to
  `tone.coverage` (`full` ⇄ `painted`), committing via `commitHistory([layer])`.
- Update the layer-tag tooltip (`main.ts:5583`) — it currently says "Static
  raster texture layer".
**Accept:** One click gets you painting tones; the coverage toggle flips between
full-bleed and painted without losing strokes (strokes are preserved in the
data either way).

---

# Feature C — Raster layers

## Scope statement (read first)
This adds a new `LayerKind: "raster"` — real pixels you paint with the existing
brushes, erase, move, animate with the existing keyframe system, and export
deterministically. Raster pixels are **never jittered** (by nature — this is the
user-accepted trade). `HANDOFF.md` requires raster-model changes to be proposed
explicitly as a product decision: **this plan is that proposal** — it does NOT
replace the vector stroke model; it adds a parallel layer kind alongside it.

**Implementation update (2026-07-23):** the former v1 editing exclusions are
now implemented. Raster layers paint and erase incrementally during pointer
movement through `core/rasterEditing.ts`. Rectangle/ellipse/lasso selections
support clipping, extract, move, scale, rotate, copy, cut, paste, duplicate,
delete, grow/shrink/invert, masks, and bucket fill. Raster layers inside
timelapse panels still render whole (fallback), never progressively.

## Architecture (implement exactly this)
- **Persisted form:** `layer.raster = { data, width, height }` where `data` is a
  PNG data URL. It lives inside the project JSON, so save/load, autosave,
  recovery snapshots, and the JSON-snapshot undo system all keep working with no
  second persistence channel. (`serialize`'s `roundCoords` replacer only touches
  numbers — verified `persistence.ts:14` — so the base64 string is safe.)
- **Runtime form:** a live `HTMLCanvasElement` per raster layer, held in a new
  `core/rasterStore.ts` keyed by **`layer.id`** (NOT object identity — undo/load
  rebuild Layer objects). The store lazily decodes `data` → canvas and re-decodes
  whenever the layer's `data` string is not the one the entry was built from
  (that's the undo/redo/load invalidation, for free, by string comparison).
- **Sync rule:** every raster edit mutates the runtime canvas, then
  `syncRasterToLayer(layer)` (`canvas.toDataURL("image/png")`) **before**
  `commitHistory([layer])` — the JSON snapshot must contain the new pixels.
  Known cost: one PNG encode (~30–80ms at 1080×1920) per raster edit commit.
  Accept it for v1; C9 is the follow-up if it hurts.
- **Cache keying:** the store keeps a monotonically increasing `pixelVersion`
  per entry (bumped on every edit and re-decode). The render sig mixes
  `layer.id + pixelVersion` — never hash the base64.

### Task C1 — Data model, validation, constructors (shares v10 with B1)
**Where:** `src/core/types.ts`, `src/core/projectValidation.ts`.
**Do:**
- `LayerKind` gains `"raster"`. `Layer.raster?: { data: string; width: number;
  height: number }`.
- `newLayer(name, "raster")` initializes `raster` with an empty-canvas data URL
  sized to the project (pass width/height in — extend the signature with
  optional dims, defaulting to `TIKTOK_WIDTH/HEIGHT`).
- Validation (`projectValidation.ts`): raster layers must have `data` starting
  with `"data:image/png;base64,"`, dims within `MAX_PROJECT_DIMENSION`, and
  `data.length` under a new `MAX_RASTER_DATA_CHARS` (16_000_000 ≈ 12MB decoded —
  generous but bounded). Reject otherwise (hard error, like existing limits).
- Migration: extend `normalizeV10` — nothing to backfill (`raster` optional),
  just don't strip it.
**Accept:** Unit tests: constructor produces valid layer; validator rejects
oversized/malformed `data`; round-trip through `serialize`/`migrateProject`
preserves the data URL byte-for-byte.

### Task C2 — `core/rasterStore.ts`
**Where:** new file.
**Do:** Module with:
- `getRasterCanvas(layer): HTMLCanvasElement | null` — returns the live canvas;
  if the entry is missing or `entry.sourceData !== layer.raster.data`, starts an
  async decode (`new Image()` + `onload`, or `createImageBitmap`) and returns
  `null` until ready.
- `onRasterReady(cb)` — one registered callback (main.ts will pass a repaint
  trigger: `renderContentVersion++` + request a frame).
- `markRasterEdited(layer)` — bumps `pixelVersion`.
- `syncRasterToLayer(layer)` — `toDataURL` into `layer.raster.data` and updates
  `entry.sourceData` so the sync itself doesn't trigger a re-decode.
- `rasterPixelVersion(layer): number` — for the render sig (0 while undecoded).
- `pruneRasterStore(liveIds: Set<string>)` — drop entries for deleted layers;
  call it from project load and undo/redo.
**Accept:** Unit test the invalidation logic with a stubbed decoder (inject the
decode function so node tests don't need Image): edit → version bump; changed
`data` string → re-decode; same string → no re-decode.

### Task C3 — Render integration
**Where:** `drawLayerRaw` (`render.ts:646`), `mixLayerMaskState`
(`render.ts:~1150`), `timelapseLayerNeedsFallback` (`render.ts:230`),
`computeLayerStrokeLength` callers.
**Do:**
- In `drawLayerRaw`, for `layer.kind === "raster"`: skip stroke walking and
  fills; `const rc = getRasterCanvas(layer); if (rc) oc.drawImage(rc, 0, 0);`
  (inside the existing overscan translate — raster is frame-coordinate space).
  Layer mask (`applyLayerMask`), opacity, blend mode, `clipToBelow`, and
  `LayerAnimation` transforms all apply **after/around** the raw canvas in the
  existing pipeline — no changes needed there (verified: transforms and
  compositing in `drawLayerStack` are kind-agnostic).
- Sig: when `layer.kind === "raster"`, mix `layer.id` and
  `rasterPixelVersion(layer)` into `mixLayerMaskState`.
- `timelapseLayerNeedsFallback`: return true for raster layers.
- `renderPanel` is pure-of-(panel, tick) EXCEPT raster now reads the store —
  determinism holds because pixels only change via commits, never per tick.
  Add one comment in `drawLayerRaw` stating this contract.
**Accept:** A raster layer with decoded pixels renders in editor, thumbnails,
WebM, and MP4 identically; blend modes/opacity/masks/keyframe animation work on
it; while decoding (first frame after load) it renders empty then repaints when
ready (via the `onRasterReady` hook wired in C5).

### Task C4 — Painting and erasing on raster layers
**Where:** `commitLiveStroke` (`main.ts:887`), the layer-kind redirect
(`main.ts:1942`), and a new exported helper in `render.ts`.
**Do:**
- Export from `render.ts`: `stampStrokeToCanvas(ctx, stroke, layerIndex,
  strokeIndex, bg)` — a thin wrapper that calls `walkLayerStrokes(ctx, [stroke],
  layerIndex, /*tick*/ 0, {remaining: Infinity}, bg, /*amplitude*/ 0,
  strokeIndex)`. Amplitude 0 → raw points, pinned stamp tick; eraser brushes
  already composite `destination-out` inside the walker (verified
  `render.ts:1600`).
- In the redirect at `main.ts:1942`, let raster layers accept paint tools.
- In `commitLiveStroke`: if the target layer is raster, instead of
  `layer.strokes.push(...)`: get the runtime canvas (if still decoding, toast
  "Layer still loading" and drop the stroke), `stampStrokeToCanvas` each
  committed segment (the selection-clip `splitStrokeAtShape` path applies
  unchanged — it operates on the stroke before stamping), then
  `markRasterEdited(layer); syncRasterToLayer(layer); commitHistory([layer])`.
  Use a stable per-layer stroke counter for `strokeIndex` (e.g. increment a
  store-held counter) so texture brushes vary between strokes.
- Live preview: unchanged — the existing live-stroke overlay draws the pending
  stroke each frame; on commit the pixels land in the bitmap. The live-erase
  preview path (`drawLiveErasePreviewFrame`) treats the active layer's raw
  render as its base, which for raster is the bitmap — verify visually, and if
  erase preview mispaints, fall back to no-preview-for-raster-erase with a
  comment (correctness on commit is what matters).
**Accept:** Draw and erase on a raster layer with several brush types; strokes
bake (no wiggle on that layer, other layers still wiggle); undo removes the
whole stroke (bitmap reverts via history snapshot); redo restores it; save,
reload, and the pixels persist.

### Task C5 — UI, guards, and store wiring
**Where:** layers panel (`buildLayers`, `main.ts:~5400`), tool guards, `main.ts`
init.
**Do:**
- "+ Raster layer" button next to "+ Manga tone" (`main.ts:5602`); "PX" layer
  tag; tooltip "Raster layer — paints real pixels, never wiggles".
- Wire `onRasterReady(() => { renderContentVersion++; /* request a repaint —
  use requestLoopFrame() if UNDO_PERF_AUDIT Task 3.2 landed, else nothing extra
  since the loop free-runs */ })` and call `pruneRasterStore` on load and inside
  `performUndoRedo` (or the inline undo handler if the other plan hasn't landed).
- Guards with status toasts: marquee/select/scale tools on a raster layer →
  "Selection tools don't work on raster layers yet"; bucket → same (until C8).
  The move-layer tool: keyframe mode (animation) works as-is; the bake-move mode
  calls `moveLayerContents` (`main.ts:2315`) which shifts stroke points — extend
  it: for raster layers, redraw the bitmap into itself at the offset
  (draw to a scratch canvas, clear, drawImage back shifted), `markRasterEdited`
  + `syncRasterToLayer`.
- Layer ops (`layerOps.ts` / their main.ts callers): duplicate copies
  `raster` (new layer id — the store decodes fresh); merge-down involving a
  raster layer: v1 rule — allowed only when BOTH are raster (drawImage top onto
  bottom) or via C6's rasterize; otherwise toast.
**Accept:** Full layer lifecycle (add, rename, reorder, duplicate, hide, delete)
works; every excluded tool explains itself; nothing silently no-ops.

### Task C6 — "Rasterize layer" command
**Where:** layers panel row actions + `commandList()`.
**Do:** Convert a draw layer to raster: render the layer alone via the existing
raw pipeline at amplitude 0 (reuse `drawLayerRaw` with `skipJitter: true`,
no cache) into a fresh canvas, install it in the store, set
`layer.kind = "raster"`, populate `layer.raster`, clear `strokes/fills/texts`,
`commitHistory([layer])`. Confirm via the existing modal pattern (not
`window.confirm`) since it discards vector editability.
**Accept:** A wiggly draw layer becomes a static raster layer that looks like
one frozen frame of itself; undo restores the vector layer intact (JSON snapshot
carries both forms).

### Task C7 — Project resize + panel copy/paste
**Where:** wherever canvas presets rescale the project (search
`canvasPresets` usage in `main.ts` for the resize handler), and
`copyActivePanelContents`/`pasteIntoActivePanel`.
**Do:** When project dimensions change, rescale each raster bitmap
(drawImage into a new canvas at the new size, update `raster.width/height`,
sync). For panel-content copy/paste (it deep-clones layer JSON): ensure
`syncRasterToLayer` ran at the last commit (it always has, by the C4 sync rule)
and that pasted raster layers get fresh `id`s so store entries don't collide.
**Accept:** Resize a project with a raster layer → art scales with it; copy a
panel with a raster layer into another panel → independent pixels (editing one
doesn't change the other).

### Task C8 (stretch) — Bucket fill on raster
**Do:** Reuse `floodFillImageData` (`core/fill.ts`) directly on the runtime
canvas's ImageData at the click point with the current fill tolerance, then
`putImageData`, mark/sync/commit. Skip `gapClosePx`/reference modes in v1.
**Accept:** Fill behaves like any raster editor; undo reverts it.

### Task C9 (follow-up, only if raster commits feel slow) — Dirty-rect undo
Replace the full-bitmap `toDataURL` per edit with region snapshots: track the
stroke's bounding box, store before/after `ImageData` for that rect in a
side-stack aligned with history entries, and only `toDataURL` on save/autosave.
Do NOT build this preemptively — measure C4 first (`?perf`).

---

## Sequencing & sizing

| Order | Task | Size | Depends on |
|---|---|---|---|
| 1 | A1 export skipJitter plumbing | XS | — |
| 2 | A2 export overlay checkbox | XS | A1 |
| 3 | B1+C1 project v10 (one migration) | S | — |
| 4 | B2 painted-tone render + sig | S/M | B1 |
| 5 | B3 paint on tone layers | S | B2 |
| 6 | B4 tone tool UX | S | B3 |
| 7 | C2 rasterStore | S | C1 |
| 8 | C3 render integration | M | C2 |
| 9 | C4 paint/erase on raster | M | C3 |
| 10 | C5 UI + guards + wiring | M | C4 |
| 11 | C6 rasterize command | S | C5 |
| 12 | C7 resize + copy/paste | S | C5 |
| 13 | C8 raster bucket (stretch) | S | C5 |
| 14 | C9 dirty-rect undo (only if measured slow) | M | C4 |

Interlock with `UNDO_PERF_AUDIT.md`: raster layers put multi-MB strings inside
panel JSON, which makes that plan's **Task 2.1 (per-panel history sharing)**
much more valuable — ideally land it before C4 so raster edits don't stringify
unrelated panels' base64 on every commit. Not a hard blocker; the sync rule is
correct either way.

## Product notes (decisions made here, flag if you disagree)
- Tones are mask-revealed, canvas-grid-aligned, and static — the manga-correct
  reading of "paint tones". A wiggly-tone-edge option is deliberately deferred.
- Raster pixels live inside the project JSON as PNG data URLs — keeps the
  single-file save/undo/recovery story intact at the cost of file size and a
  per-edit PNG encode. Revisit (external blobs / tiles) only if C9's
  measurement says so.
- Raster layers never wiggle, and that's surfaced in the UI copy, not hidden.
