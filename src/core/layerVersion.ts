// ============================================================================
// core/layerVersion.ts — per-layer edit counters for render memoization.
//
// layerSig() hashes a layer's full drawable content (every stroke point), so
// recomputing it on every render is too slow. Its memo is keyed on these
// counters: bump a layer whenever its strokes / fills / texts mutate and only
// that layer re-hashes — unedited layers keep their memoized sig and their
// raw-layer cache entries. Undo/redo and project load rebuild Layer objects
// from JSON, so the WeakMap misses and assigns fresh counters automatically.
//
// Over-bumping is cheap (one re-hash of one layer, never a re-render, because
// the raw-layer cache is keyed by the content hash itself). Under-bumping is
// the bug to avoid: a missed bump leaves a stale sig and a stale canvas.
// ============================================================================

import type { Layer } from "./types";

const _versions = new WeakMap<Layer, number>();
let _next = 1;

export function layerVersion(layer: Layer): number {
  let v = _versions.get(layer);
  if (v === undefined) {
    v = _next++;
    _versions.set(layer, v);
  }
  return v;
}

export function bumpLayerVersion(layer: Layer): void {
  _versions.set(layer, _next++);
}
