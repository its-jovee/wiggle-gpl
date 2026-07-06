// ============================================================================
// core/maskControls.ts — UI-facing helpers for selection-derived layer masks.
//
// These helpers only mutate Layer.mask state or transient overlay selection.
// They do not create editable mask content or change render/export behavior.
// ============================================================================

import type { Layer } from "./types";

export function layerMaskBadge(layer: Layer): "Mask" | null {
  return layer.mask ? "Mask" : null;
}

export function setMaskEnabled(layer: Layer, enabled: boolean): void {
  if (!layer.mask) return;
  layer.mask.enabled = enabled;
}

export function invertMask(layer: Layer): void {
  if (!layer.mask) return;
  layer.mask.mode = layer.mask.mode === "reveal" ? "hide" : "reveal";
}

export function deleteMask(layer: Layer): void {
  delete layer.mask;
}

export function setMaskOverlayLayer(
  currentLayerId: string | null,
  layerId: string,
  shown: boolean
): string | null {
  if (!shown) return currentLayerId === layerId ? null : currentLayerId;
  return layerId;
}
