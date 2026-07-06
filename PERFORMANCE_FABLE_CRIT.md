# PERFORMANCE_FABLE_CRIT — Performance & Optimization Critique

Context: the team has clearly already done two rounds of render-perf work (per the
memory notes and the code): canvas pooling, per-layer version keying, sig
memoization, a raw-layer LRU, deferred fill masks, an incremental timelapse cache.
That work is real and well-reasoned. So this doc focuses on the layers *around* the
render core that haven't had the same attention, plus a few risks inside it.

---

## 1. Undo snapshot cost on the stroke-commit hot path — SEVERITY: HIGH

`commitHistory()` → `history.push()` → `JSON.stringify(entire project)` runs on
**every committed edit**, including finishing each stroke (main.ts:861). This is the
worst possible place for an O(project-size) operation: the user just lifted the pen
and is waiting to draw the next line. On a project with a few populated panels this
stringify + the 50-deep string array is the dominant cost of drawing, and it grows
with the drawing rather than staying constant.

Measure it, then fix with per-panel snapshots or command deltas (see CODE doc §6).
This is the highest-leverage perf fix in the app because it's on the one path a user
repeats hundreds of times per session.

## 2. Autosave stringifies the project up to twice per cycle — SEVERITY: MEDIUM

`autosaveTick` (main.ts:7185, every 5s) calls `projectHash(project)` which does a
full `serialize()` (JSON.stringify with the `roundCoords` replacer) *just to compare*,
then serializes **again** inside `writeHandle`/`writeRecoverySnapshot`. So a dirty
project is stringified twice every 5 seconds. The dirty-flag short-circuit
(`_isDirty`, `_recoveryClean`) is a good optimization that avoids this when idle —
but when actively editing, you pay 2× full serialization every tick regardless of how
small the change was. Cache the serialized string from the hash step and reuse it for
the write.

## 3. The rAF loop never sleeps — SEVERITY: MEDIUM (battery/thermals)

`loop()` unconditionally calls `requestAnimationFrame(loop)` (main.ts:3245) forever.
`shouldRenderIdleFrame`/`shouldRenderPlaybackFrame` correctly gate the expensive
*paint*, but the JS callback still fires ~60×/s doing clock math, `hasLiveEditorInteraction()`
checks, and `trimFramePool()` even when the app is idle, not playing, and nothing is
dirty. On a laptop this is measurable battery drain for an app that's often left open
between drawings.

Fix: when not playing, not drawing, and no dirty thumbnails, stop scheduling frames
and re-arm the loop from input/state-change events. The wiggle tick can advance on a
`setInterval(wiggleFps)` that only requests a frame when the tick changes. This is the
difference between "idle at 0% CPU" and "idle at a few %."

## 4. `getImageData` on the render path — SEVERITY: MEDIUM (already partly mitigated)

Fill-mask computation does a full-canvas `getImageData` (1080×1920 = 8.3M bytes) + CPU
flood fill — the code itself estimates **15–40ms** (render.ts:977). The deferred-mask
system (`deferFillMasks`, serve-stale-then-recompute-on-idle) is a smart mitigation
for the editor. But:

- **Export can't defer** (correctly — it needs sync deterministic masks). So an MP4 of
  a fill-heavy project pays 15–40ms × (fills) × (frames). At 30fps for a 10s clip
  that's 300 frames; if masks re-key per frame this dominates export time. Masks are
  keyed to *not* re-key across ticks (computed at amplitude 0), so this is usually
  amortized — but any per-frame-varying fill input (e.g. `visibleStrokes` reference
  mode with an animated reference layer) defeats it. Worth a targeted export benchmark.
- `getClipBoundaryCache` and `getFillScratch` use `willReadFrequently` (good). But the
  flood fill allocates a `new Uint8ClampedArray(img.data)` snapshot per fill
  (render.ts:1332) to diff before/after — that's another 8.3MB allocation per fill per
  recompute, pressuring GC.

## 5. Full-subtree DOM rebuilds — SEVERITY: MEDIUM

21 `innerHTML = ""`-then-rebuild sites. `buildTimeline`, `buildLayers`, `buildInspector`,
`buildEditContext` are frequently called *together* after a single edit (e.g.
`deleteSelection` calls all four, main.ts:1370–1373). Each throws away and recreates a
DOM subtree, re-runs layout, and re-attaches listeners. For the timeline especially
(one cell + thumbnail canvas per panel, up to 200 panels) this is a lot of node churn
on every panel operation. The scroll-restoration helper
(`timelineScrollAfterRebuild`) is a tell that the rebuild is heavy enough to be
user-visible. A keyed reconcile (see CODE doc §9) would cut this dramatically without
adding a framework.

## 6. `computeLayerStrokeLength` / centroid recomputed per frame — SEVERITY: LOW-MEDIUM

`drawLayerStack` calls `computeLayerStrokeLength(layer)` for every layer every frame
(render.ts:593), and it walks every point of every stroke. For static layers this is
pure waste — the length only changes when strokes change, which is exactly what
`layerVersion` already tracks. Memoize by `layerVersion` like `layerSig` already does.
Same pattern for `layerCentroid` (main.ts:1413), recomputed on every keyframe-overlay
draw and every move-drag frame.

## 7. `measureText` allocates/configures a canvas context per call — SEVERITY: LOW

`measureText` (main.ts:1089) sets `_measureCtx.font` and calls `measureText` on every
invocation, and it's called in hot loops: `boundsFromItems`, hit-testing, selection
overlays, per-text in `cutAtShape`. Font-string parsing on a 2D context isn't free.
Cache by `(fontFamily, fontSize, content)` — text content changes rarely relative to
how often bounds are queried during a drag.

## 8. Fill flood-fill is unbounded scanline with a number[] stack — SEVERITY: LOW

`floodFillImageData` (fill.ts) pushes `row*width+col` integers onto a plain JS
`number[]` stack. For a large fill region on a 1080×1920 canvas this array can grow to
hundreds of thousands of entries (boxed-number storage, GC pressure). A typed-array
stack or the existing span-based algorithm with a smaller frontier would help the
worst case. Low priority — fills are user-initiated, not per-frame.

## 9. Export writes PNGs through ffmpeg's virtual FS one at a time — SEVERITY: LOW-MEDIUM

`exportMP4` (export.ts:137) loops: render → `canvas.toBlob(png)` → `fetchFile` →
`ffmpeg.writeFile`. Each `toBlob('image/png')` PNG-encodes an 8MB frame on the main
thread (blocking), then it's copied into the wasm FS. PNG is lossless but slow to
encode and large; the frames are transient inputs to x264. Options: encode as a
faster intermediate, feed raw RGBA to ffmpeg via `rawvideo`, or at minimum run the
render+encode in a worker with OffscreenCanvas so the UI doesn't freeze during export
(right now a long MP4 export locks the whole app; the cancel button only checks
between frames). The determinism contract is preserved either way since tick derives
from frame index, not wall clock.

## 10. Micro / smaller items

- `syncPerfReport` runs `JSON.stringify(perfReport())` into a DOM dataset every 500ms
  when `?perf` is on (main.ts:399) — fine, it's opt-in, just noting it's not free.
- `bumpAllProjectLayers()` (main.ts:814) walks every layer of every panel and sub-panel
  whenever `commitHistory()` is called *without* `changedLayers`. Many call sites omit
  the arg (`commitHistory()` with no args — e.g. paste, delete, duplicate), so the
  common case is the O(all-layers) invalidation the `changedLayers` optimization exists
  to avoid. Audit those call sites and pass the touched layers.
- `refreshThumbnails()` renders a full `renderPanel` per dirty panel into a thumbnail
  canvas. Correct, but during a multi-panel undo *every* thumbnail is marked dirty
  (main.ts:7319) and they all re-render in one frame — a visible hitch on undo of a
  project with many panels. Spread the work across frames (a small per-frame budget).
- `antsOffset` marching-ants counter advances every idle frame even when no selection
  exists to animate (main.ts:3188). Trivial, but it's inside the always-run block.

---

## Bottom line

The render *core* is well-optimized; the *editor shell around it* is where the cheap
wins are — undo snapshotting (#1), the never-sleeping loop (#3), and double
serialization in autosave (#2) are the three I'd measure first because they hit
every session continuously, not just heavy projects.
