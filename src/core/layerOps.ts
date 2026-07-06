// ============================================================================
// core/layerOps.ts — vector-safe layer workflow operations.
//
// These helpers mutate the supplied layer array/layers in the same style as the
// editor state. They only move serialized vector objects; they never flatten
// pixels or alter raw stroke points.
// ============================================================================

import type { Fill, Layer, TextElement } from "./types";

type IdFactory = () => string;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isDrawLayer(layer: Layer): boolean {
  return (layer.kind ?? "draw") === "draw";
}

export function duplicateLayer(
  layers: Layer[],
  activeIndex: number,
  idFactory: IdFactory
): number {
  const layer = layers[activeIndex];
  if (!layer) return activeIndex;
  const copy = clone(layer);
  copy.id = idFactory();
  copy.name = `${copy.name} copy`;
  if (copy.texts) {
    copy.texts = copy.texts.map((text) => ({ ...text, id: idFactory() }));
  }
  layers.splice(activeIndex + 1, 0, copy);
  return activeIndex + 1;
}

export function clearLayerContents(layer: Layer): void {
  layer.strokes = [];
  layer.fills = [];
  if (layer.texts) layer.texts = [];
}

export function canMergeLayerDown(layers: Layer[], activeIndex: number): boolean {
  const active = layers[activeIndex];
  const below = layers[activeIndex - 1];
  if (!active || !below) return false;
  if (!isDrawLayer(active) || !isDrawLayer(below)) return false;
  if ((active.blendMode ?? "normal") !== "normal") return false;
  if (active.opacity !== 1) return false;
  if (active.mask) return false;
  if (active.animation) return false;
  if (active.clipToBelow) return false;
  return true;
}

function offsetFill(fill: Fill, strokeOffset: number): Fill {
  return {
    ...clone(fill),
    afterStrokeIndex: fill.afterStrokeIndex + strokeOffset,
  };
}

export function mergeLayerDown(
  layers: Layer[],
  activeIndex: number
): { merged: true; activeIndex: number } | { merged: false; reason: "no-below" | "unsafe" } {
  if (activeIndex <= 0) return { merged: false, reason: "no-below" };
  if (!canMergeLayerDown(layers, activeIndex)) return { merged: false, reason: "unsafe" };

  const below = layers[activeIndex - 1];
  const active = layers[activeIndex];
  const strokeOffset = below.strokes.length;
  below.strokes.push(...active.strokes.map(clone));
  below.fills.push(...active.fills.map((fill) => offsetFill(fill, strokeOffset)));
  const activeTexts = (active.texts ?? []).map(clone) as TextElement[];
  if (activeTexts.length > 0) {
    below.texts = [...(below.texts ?? []), ...activeTexts];
  }
  layers.splice(activeIndex, 1);
  return { merged: true, activeIndex: activeIndex - 1 };
}
