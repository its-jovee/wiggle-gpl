// ============================================================================
// core/rasterTimelapse.ts — persistent edit journal for raster-layer replay.
//
// Raster layers keep their flattened PNG as the canonical fast render path.
// The optional journal starts with the bitmap that existed before recording,
// then stores compact brush strokes and occasional PNG checkpoints for edits
// that cannot be represented as strokes (fill, paste, transform, merge, etc.).
// ============================================================================

import type { Layer, RasterTimelapseEvent, Stroke } from "./types";
import { MAX_RASTER_TIMELAPSE_EVENTS } from "./projectValidation";

export const RASTER_CHECKPOINT_WEIGHT = 1;

function cloneStroke(stroke: Stroke): Stroke {
  return JSON.parse(JSON.stringify(stroke)) as Stroke;
}

export function ensureRasterTimelapse(layer: Layer, baseline: string) {
  if (!layer.raster) throw new Error("raster timelapse requires raster pixel data");
  if (!layer.raster.timelapse) {
    layer.raster.timelapse = { baseline, events: [] };
  }
  return layer.raster.timelapse;
}

export function appendRasterTimelapseStroke(
  layer: Layer,
  stroke: Stroke,
  strokeIndex: number,
  baseline: string,
): boolean {
  const startsNewTimeline = !layer.raster?.timelapse ||
    layer.raster.timelapse.events.length >= MAX_RASTER_TIMELAPSE_EVENTS;
  if (startsNewTimeline && layer.raster) {
    // Keep editor-created projects within the same bound enforced on load.
    // When the journal fills, the pixels immediately before this stroke become
    // the new baseline; the flattened raster remains authoritative throughout.
    layer.raster.timelapse = { baseline, events: [] };
  }
  const timeline = ensureRasterTimelapse(layer, baseline);
  timeline.events.push({ kind: "stroke", stroke: cloneStroke(stroke), strokeIndex });
  return startsNewTimeline;
}

export function appendRasterTimelapseCheckpoint(
  layer: Layer,
  beforeData: string,
  afterData: string,
): boolean {
  if (beforeData === afterData) return false;
  if (layer.raster?.timelapse &&
      layer.raster.timelapse.events.length >= MAX_RASTER_TIMELAPSE_EVENTS) {
    layer.raster.timelapse = { baseline: beforeData, events: [] };
  }
  const timeline = ensureRasterTimelapse(layer, beforeData);
  const previous = timeline.events[timeline.events.length - 1];
  if (previous?.kind === "checkpoint" && previous.data === afterData) return false;
  timeline.events.push({ kind: "checkpoint", data: afterData });
  return true;
}

export function rasterTimelapseEventWeight(
  event: RasterTimelapseEvent,
  strokeLength: (stroke: Stroke) => number,
): number {
  return event.kind === "stroke"
    ? Math.max(1, strokeLength(event.stroke))
    : RASTER_CHECKPOINT_WEIGHT;
}

export function rasterTimelapseTotalWeight(
  layer: Layer,
  strokeLength: (stroke: Stroke) => number,
): number {
  return (layer.raster?.timelapse?.events ?? []).reduce(
    (total, event) => total + rasterTimelapseEventWeight(event, strokeLength),
    0,
  );
}

/** The image data URLs needed to replay a layer, de-duplicated in journal order. */
export function rasterTimelapseImages(layer: Layer): string[] {
  const timeline = layer.raster?.timelapse;
  if (!timeline) return [];
  const seen = new Set<string>();
  const images: string[] = [];
  const add = (data: string) => {
    if (seen.has(data)) return;
    seen.add(data);
    images.push(data);
  };
  add(timeline.baseline);
  for (const event of timeline.events) {
    if (event.kind === "checkpoint") add(event.data);
  }
  return images;
}
