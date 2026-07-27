# PERF_PLAN — measured audit and remediation plan

Date: 2026-07-24. Branch: `feat/infinite-canvas-board`.

**Verdict: yes, there is a real performance problem — but it is not where
`PERFORMANCE_FABLE_CRIT.md` says it is.** That doc is stale (see §0). The actual
bottleneck is per-layer full-frame canvas compositing, and it is measurable,
reproducible, and largely fixable.

---

## How this was measured

- Harness: `scripts/browser-perf.mjs` (Playwright + the app's own `?perf=1`
  instrumentation) against `test/fixtures/perf-heavy.json`, plus an ad-hoc
  8-layer variant.
- CPU profile: CDP `Profiler` at 100µs sampling over 6s of idle rendering,
  aggregated by self time.
- Correctness: `npm test` (179 tests).

**Caveat, stated up front:** headless Chromium software-rasterizes canvas
(SwiftShader). Absolute milliseconds here are therefore *pessimistic* versus
GPU-accelerated Electron on real hardware. The **relative** deltas and the
**scaling law** below are what matter and both hold regardless of rasterizer.
Step 0 of the plan is to re-baseline on real hardware before trusting any
absolute target.

---

## §0. The existing perf doc is stale — do not plan from it

Verified fixed in current code:

| `PERFORMANCE_FABLE_CRIT.md` claim | Status |
|---|---|
| #1 HIGH — undo `JSON.stringify(entire project)` per stroke | **Fixed.** `core/history.ts` does per-panel snapshots with reference reuse. |
| #2 MED — autosave serializes twice per cycle | **Fixed.** `core/autosave.ts` `AutosaveSerializationCache` is revision-keyed. |
| #3 MED — rAF loop never sleeps | **Fixed.** `loopArmed` + `requestLoopFrame` + wiggle `setInterval`; loop re-arms only when needed. |
| #6 — `computeLayerStrokeLength` per frame | **Fixed.** Memoized on `layerVersion`. |

Still open: #5 (24 `innerHTML=""` rebuild sites), #7 (`measureText` uncached),
#9 (export on main thread). These are real but *not* the main cost.

**Action: replace `PERFORMANCE_FABLE_CRIT.md` with this doc** so the next person
doesn't re-plan against solved problems.

---

## §1. Root cause: cost scales with layer count, not drawing content

Two fixtures, same canvas, same brush:

| Fixture | Layers/panel | Points/layer | idle-main avg |
|---|---|---|---|
| `perf-heavy` | 3 | ~2160 | **47.3 ms** |
| 8-layer variant | 8 | ~480 | **75.0 ms** |

Eight layers holding **less than a quarter** of the drawing are **59% slower**.
Cost tracks layer count, not strokes or points.

The CPU profile says the same thing — JS is not the problem:

```
 82.9%  (idle)
  6.8%  drawImage        408ms   <- bulk pixel movement
  3.7%  setTransform     225ms
  2.9%  restore          175ms
  0.0%  walkLayerStrokes   2ms   <- all stroke marching
  0.0%  dot @ registry.ts  3ms   <- all brush stamping
```

Stroke marching and brush stamping together are ~5ms out of ~6s. **Every
millisecond that matters is spent moving full 1080×1920 buffers around.** Each
visible layer per tick costs a full-frame allocate + `clearRect` + composite +
blend blit, whether the layer covers the whole frame or 200 pixels of it.

---

## §2. Findings, in priority order

### A. Clip-base snapshot taken for every layer even when nothing clips — VALIDATED FIX

`drawLayerStack` (`src/core/render.ts:707`) runs, for every visible layer:

```ts
if (!layer.clipToBelow) {
  clipBase = { mask: detachOwnedCanvas(stamped, width, height), ... };
}
```

`detachOwnedCanvas` allocates a **fresh 1080×1920 canvas (8.3 MB)** and does a
full-frame `drawImage` — speculatively, in case a *later* layer sets
`clipToBelow`. When no layer clips (the overwhelmingly common case; zero layers
in either fixture) this is 100% waste: N wasted 8.3 MB allocations and N wasted
full-frame blits per layer per tick, plus the GC pressure.

Fix is two lines — hoist `const anyClips = layers.some(l => l.visible && l.clipToBelow)`
and gate the snapshot on it. Safe because `clipBase` is only ever *read* under
`layer.clipToBelow &&`.

The initial audit prototype produced these measurements:

| | before | after | |
|---|---|---|---|
| idle-main avg (3 layers) | 47.3 ms | **19.8 ms** | −58% |
| idle-main **max** (3 layers) | 121.3 ms | **22.4 ms** | −82% |
| idle-main avg (8 layers) | 75.0 ms | **52.9 ms** | −30% |
| playback-main avg (8 layers) | 47.7 ms | **27.7 ms** | −42% |

`npm test`: 177 pass / 2 fail — the **same two** failures as on a clean tree
(`drawBrushPreview…`, `studio icon catalog…`, both in files with unrelated
uncommitted work). Zero regressions from this change.

The 121ms → 22ms max is the important number: that spike is a visible hitch.

The prototype was initially reverted for isolation, then implemented with the
rest of the remediation described in §4. The current tree includes the
`anyClips` gate and its regression coverage.

### B. Raw-layer cache has a 0% hit rate while idle — HIGH

Measured idle: `rawLayerHits: 0, rawLayerMisses: 33`.

`rawLayerCacheKey` (`src/core/renderSchedule.ts:87`) includes `tick`. The wiggle
tick advances 8×/s, so every entry is invalidated 8×/s. For jittered ink that is
correct — the geometry genuinely changes.

But it is **provably unnecessary in three cases**, and in each the key still
forces a guaranteed miss:

1. **Raster layers** — `drawLayerRaw` just blits `getRasterCanvas(layer)`. No
   tick input at all.
2. **Tone layers** — rendered at amplitude 0; the code comments explicitly state
   they are "intentionally static… identical on every wiggle tick."
3. **Jitter disabled globally** (`skipJitter`) — `wiggleAmp` becomes 0, and in
   `walkLayerStrokes` amplitude 0 means `jittered = pts` *and*
   `stampTick = strokeSeed`, so even "alive" brushes stop varying. Output is
   fully tick-independent — yet the app still re-renders every layer 8×/s to
   produce byte-identical pixels.

Fix: derive `tickForKey = layerIsTickDependent(layer, opts) ? tick : 0`. Same
canonicalization pattern the file already uses for
`canonicalRawLayerLocalMs`/`canonicalRawLayerContainerDurMs`.

This is a code-reading finding — I have not measured it. Validate it first
(easiest: toggle jitter off and check `rawLayerHits`), then implement.

### C. Render cache can hold ~2.1 GB of canvas backing store — HIGH (memory)

`createRenderCache(64)` (`src/main.ts:546`) holds 64 entries, and it **does
reach the cap in normal use** — the playback run reported
`rawLayerEntries: 64, rawLayerEvictions: 2`.

An entry is not 1080×1920. `EDITOR_OVERSCAN = 0.5` bleeds 50% on every side, so
`renderPanel` works on a 2160×3840 buffer — **4× the visible frame** — making
each entry 33 MB and the ceiling **~2.1 GB**. (An earlier draft of this doc said
506 MB; that figure ignored overscan.) The 4× multiplier is itself the reason
per-layer full-frame work is so expensive, and is worth questioning separately.

This is invisible to JS heap profilers (canvas backing store lives outside it),
which is likely why it hasn't been noticed. On a memory-constrained machine this
alone can cause swapping and stutter that reads as "the app is slow."

Fix: budget the cache in **bytes**, not entries — evict on a total-pixel budget
(e.g. 96–128 MB) scaled to the actual canvas size, rather than a fixed count
sized for a canvas 6× smaller than the real one.

### D. Everything is full-frame; there are no layer bounds — HIGH (structural)

The renderer has no concept of a layer's bounding box. A layer with one 200px
scribble costs exactly as much as one covering the whole 1080×1920 frame:
full-frame allocate, `clearRect`, composite, blit.

This is the structural reason B and C are expensive at all, and it's what still
leaves 53ms on the 8-layer fixture after fix A.

Fix: track a dirty/content rect per layer (cheap — `layerVersion` already marks
when to recompute) and confine `clearRect`, `composeLayerCanvas` and the final
blit to that rect. This is the single biggest remaining win but also the largest
change; it should come after the cheap wins land and the benchmark is trustworthy.

### E. Export blocks the main thread — MEDIUM

`exportMP4` (`src/core/export.ts:290`) loops: render → `canvas.toBlob('image/png')`
→ `fetchFile` → `await ffmpeg.writeFile`, sequentially, on the main thread. PNG-
encoding an 8 MB frame is slow and lossless-but-pointless for a transient x264
input. A long export freezes the UI; cancel only responds between frames.

Fix, in increasing order of effort: pipeline the encode/write so they overlap;
feed ffmpeg raw RGBA (`-f rawvideo`) instead of PNG; move render+encode to a
worker with `OffscreenCanvas`. Determinism is preserved either way — tick derives
from frame index, not wall clock.

### F. Lower priority

- `measureText` (`src/main.ts:1896`) re-sets `.font` and re-measures per call, in
  hot loops (`boundsFromItems`, hit-testing, selection overlays). Cache by
  `(family, size, content)`.
- 24 `innerHTML = ""` full-subtree rebuilds; `buildTimeline` is called from 51
  sites and often together with `buildLayers`/`buildInspector` after one edit.
  Keyed reconcile would cut node churn. Worth doing for the timeline only.
- One CSP console error on load (inline script blocked). Not perf, but it's
  noise in every run and worth clearing.

---

## §3. Implementation plan (completed)

This was the implementation sequence used for the completed work in §4; it is
retained as the audit trail, not as a pending task list.

### Phase 0 — trust the numbers (do this first)
1. Re-baseline on **real hardware / Electron**, not headless, to get honest
   absolute numbers and set a real budget (suggested: idle-main < 8ms, so a
   wiggle tick never threatens a dropped frame).
2. Add a layer-count fixture (`perf-layers8`) alongside `perf-heavy` — the
   current fixture's 3 layers/panel hides the dominant scaling factor entirely.
3. Record `rawLayerHits/Misses` and `rawLayerEntries` as first-class outputs, and
   fail CI on regression beyond a threshold.

### Phase 1 — cheap, validated wins
1. **Gate the clip-base snapshot on `anyClips`** (Finding A). Measured −58% idle,
   −82% worst-case, zero regressions. Ship this first.
2. **Canonicalize `tick` out of the cache key** for raster/tone/jitter-off layers
   (Finding B). Validate the hit-rate change before/after.
3. **Byte-budget the render cache** (Finding C).
4. Cache `measureText` (Finding F).

### Phase 2 — structural
5. **Per-layer bounds + dirty rects** (Finding D). Confine clear/composite/blit
   to the layer's content rect. Expect this to be where the remaining ~50ms on
   layer-heavy projects goes.
6. Keyed reconcile for `buildTimeline` (Finding F).

### Phase 3 — export
7. Pipeline encode/write, then raw RGBA, then worker + `OffscreenCanvas`
   (Finding E). Guard with a frame-hash test to prove determinism is intact.

### Phase 4 — housekeeping
8. Delete/replace `PERFORMANCE_FABLE_CRIT.md`; it will otherwise keep sending
   people at three already-solved problems.

---

## §4. Outcome — all phases implemented 2026-07-24

Measured with `npm run perf:bench` (add `--gpu` for hardware-accelerated
numbers). Baselines live in `test/fixtures/perf-baseline.json`, keyed per
renderer; the bench fails on a >25% regression.

### Software rasterization (headless / no GPU)

| | before | after | |
|---|---|---|---|
| perf-heavy idle avg | 27.5 ms | **5.99 ms** | −78% |
| perf-heavy playback | 16.0 ms | **1.27 ms** | −92% |
| perf-layers8 idle avg | 73.7 ms | **12.4 ms** | −83% |
| perf-layers8 idle max | 103.0 ms | **15.2 ms** | −85% |
| perf-layers8 playback | 44.6 ms | **2.36 ms** | −95% |

### GPU-accelerated (median of 3 runs; this is what ships)

| | before | after | |
|---|---|---|---|
| perf-heavy idle avg | 3.82 ms | **2.07 ms** | −46% |
| perf-heavy playback | 1.05 ms | **0.58 ms** | −45% |
| perf-layers8 idle avg | 7.01 ms | **4.96 ms** | −29% |
| perf-layers8 playback | 1.96 ms | **1.18 ms** | −40% |

Both fixtures now sit inside the 8 ms idle budget on GPU, with the layer-heavy
case improved the most — which was the point, since layer count was the thing
that scaled badly.

### Raw-layer cache memory

Entries are now cropped to the layer's ink instead of the whole overscanned
buffer, so a cache entry is typically 1–2 orders of magnitude smaller:

| | before | after |
|---|---|---|
| ceiling | 64 entries x 33 MB = **~2.1 GB** | 384 MB byte budget |
| measured during playback | cap reached (64 entries) | **24–26 MB** |

### What each phase actually bought

- **1.1 clip-base gate** — biggest single win before cropping; also removed a
  121 ms worst-case hitch.
- **1.2 tick canonicalization** — no effect while wiggle is on (correctly: the
  ink really does change per tick). With wiggle **off** it takes the raw-layer
  cache from **0% → 62% hits** and idle render from 51.9 ms → 13.0 ms.
- **1.3 byte budget** — on its own this *regressed* GPU playback 2–3x, because
  a memory cap starves a working set made of 33 MB entries. Only safe once
  paired with cropping. Worth remembering: capping this cache without shrinking
  the entries is a false economy.
- **2.5 bounds + cropped cache entries** — the structural fix, and the one that
  made everything else work.
- **2.6 timeline selection fast path** — panel switch on a 60-panel project
  5.49 ms → 2.76 ms median. A full keyed reconcile was measured first and
  rejected: the remaining cost didn't justify the regression risk.
- **3.7 export pipelining** — encode/write now overlap the next frame's render.

### Correctness

Two new harnesses guard the risky parts, and both were verified to fail when
the invariant is deliberately broken (a wrong stamp-spread; a 3px crop offset;
a dropped write-ordering await):

- `test/layer-bounds.test.mjs` — every painted pixel must fall inside the
  computed bounds, across 16 brushes x 3 sizes x 3 ticks; and a cropped render
  must paint the exact same *set* of pixels as the full-buffer render.
- `test/export-pipeline.test.mjs` — pipelined frame staging must match a
  strictly serial reference byte-for-byte, in order, and still honour cancel.

### Notes for whoever picks this up next

- The **50% editor overscan** (`EDITOR_OVERSCAN`) means every layer buffer is 4x
  the visible frame. That multiplier is why per-layer full-frame work was so
  expensive, and it is worth questioning independently.
- Cropping is deliberately conservative: layers with fills, text, masks, tone,
  raster or noise-displace opt out and render full-size (`layerInkBounds`
  returns null). Extending it to text would need font metrics in `render.ts`;
  extending it to fills needs a bound on flood extent.
- The cropped and full paths differ by ≤8 per channel on antialiased edges,
  because the full path quantizes through one extra intermediate blit. Coverage
  is identical; only edge precision differs, and the cropped path is the more
  accurate of the two.
- Headless numbers are ~5x worse than GPU across the board. Compare like for
  like, and don't set budgets from SwiftShader runs.

The encouraging part, still true: the stroke/brush/jitter core — the part that
looks expensive and is the app's whole identity — was already fast. All of the
cost was buffer plumbing around it.
