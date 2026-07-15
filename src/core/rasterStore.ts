// ============================================================================
// core/rasterStore.ts — runtime pixel cache for raster layers.
//
// Layer.raster.data is the PERSISTED form (a PNG data URL, round-tripped in
// project JSON). This module holds the RUNTIME form: one live canvas per
// raster layer, keyed by layer.id (not object identity — undo/load rebuild
// Layer objects, so identity would miss every one of those swaps).
//
// The store lazily decodes `data` into a canvas, and re-decodes whenever the
// layer's `data` string no longer matches the string the entry was built
// from — that's the undo/redo/load invalidation, for free, by string
// comparison. Edits mutate the runtime canvas directly and must call
// markRasterEdited + syncRasterToLayer before commitHistory, so the JSON
// snapshot always contains the latest pixels.
// ============================================================================

import type { Layer } from "./types";

export type DecodedImage = { width: number; height: number } & CanvasImageSource;
export type ImageDecoder = (dataUrl: string) => Promise<DecodedImage>;
export type CanvasFactory = (width: number, height: number) => HTMLCanvasElement;

type RasterEntry = {
  canvas: HTMLCanvasElement;
  /** The `layer.raster.data` string this entry's pixels were decoded from. */
  sourceData: string;
  sourceWidth: number;
  sourceHeight: number;
  /** Bumped on every edit and every successful (re)decode. Mixed into the
   *  render sig so cached raw-layer frames invalidate correctly. */
  pixelVersion: number;
  decoding: boolean;
  nextStrokeIndex: number;
};

const store = new Map<string, RasterEntry>();
let readyCallback: (() => void) | null = null;

function defaultDecodeImage(dataUrl: string): Promise<DecodedImage> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("raster decode failed"));
    img.src = dataUrl;
  });
}

function defaultMakeCanvas(width: number, height: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  return c;
}

let decodeImage: ImageDecoder = defaultDecodeImage;
let makeCanvas: CanvasFactory = defaultMakeCanvas;

/** Test-only: swap the decode/canvas backends so node tests don't need a real
 *  Image element or DOM canvas. Call with no arguments to restore defaults. */
export function setRasterTestBackends(overrides?: { decodeImage?: ImageDecoder; makeCanvas?: CanvasFactory }): void {
  decodeImage = overrides?.decodeImage ?? defaultDecodeImage;
  makeCanvas = overrides?.makeCanvas ?? defaultMakeCanvas;
}

/** Registers a single callback fired after an async decode completes — wire
 *  this to a repaint trigger (bump a content version + request a frame). */
export function onRasterReady(cb: (() => void) | null): void {
  readyCallback = cb;
}

/** Returns the live canvas for a raster layer, or null while it's being
 *  (re)decoded. Safe to call every frame — decoding only (re)starts when the
 *  entry is missing or stale relative to layer.raster.data. */
export function getRasterCanvas(layer: Layer): HTMLCanvasElement | null {
  const raster = layer.raster;
  if (!raster) return null;

  const existing = store.get(layer.id);
  if (existing && existing.sourceData === raster.data &&
      existing.sourceWidth === raster.width && existing.sourceHeight === raster.height) {
    return existing.decoding ? null : existing.canvas;
  }

  const entry: RasterEntry = existing
    ? {
      ...existing,
      sourceData: raster.data,
      sourceWidth: raster.width,
      sourceHeight: raster.height,
      pixelVersion: existing.pixelVersion + 1,
      decoding: true,
    }
    : {
      canvas: makeCanvas(raster.width, raster.height),
      sourceData: raster.data,
      sourceWidth: raster.width,
      sourceHeight: raster.height,
      pixelVersion: 0,
      decoding: true,
      nextStrokeIndex: 0,
    };
  store.set(layer.id, entry);

  const requestedData = raster.data;
  const requestedWidth = raster.width;
  const requestedHeight = raster.height;
  decodeImage(requestedData)
    .then((img) => {
      const current = store.get(layer.id);
      // A newer edit or reload may have raced past this decode — drop stale results.
      if (!current || current.sourceData !== requestedData) return;
      current.canvas.width = requestedWidth;
      current.canvas.height = requestedHeight;
      const ctx = current.canvas.getContext("2d");
      ctx?.clearRect(0, 0, requestedWidth, requestedHeight);
      ctx?.drawImage(img, 0, 0);
      current.decoding = false;
      current.pixelVersion++;
      readyCallback?.();
    })
    .catch(() => {
      const current = store.get(layer.id);
      if (current && current.sourceData === requestedData) current.decoding = false;
    });

  return null;
}

/** Call after mutating a raster layer's runtime canvas directly. */
export function markRasterEdited(layer: Layer): void {
  const entry = store.get(layer.id);
  if (entry) entry.pixelVersion++;
}

/** Serializes the runtime canvas back into layer.raster.data. Call before
 *  commitHistory so the JSON snapshot contains the new pixels. Updates the
 *  entry's sourceData so this sync doesn't itself trigger a re-decode. */
export function syncRasterToLayer(layer: Layer): void {
  const entry = store.get(layer.id);
  if (!entry || !layer.raster) return;
  const data = entry.canvas.toDataURL("image/png");
  layer.raster.data = data;
  layer.raster.width = entry.canvas.width;
  layer.raster.height = entry.canvas.height;
  entry.sourceData = data;
  entry.sourceWidth = entry.canvas.width;
  entry.sourceHeight = entry.canvas.height;
}

/** Installs an already-rendered canvas as the live pixels for a raster layer. */
export function installRasterCanvas(layer: Layer, canvas: HTMLCanvasElement): void {
  if (!layer.raster) return;
  const data = canvas.toDataURL("image/png");
  layer.raster.data = data;
  layer.raster.width = canvas.width;
  layer.raster.height = canvas.height;
  const previous = store.get(layer.id);
  store.set(layer.id, {
    canvas,
    sourceData: data,
    sourceWidth: canvas.width,
    sourceHeight: canvas.height,
    pixelVersion: (previous?.pixelVersion ?? 0) + 1,
    decoding: false,
    nextStrokeIndex: previous?.nextStrokeIndex ?? 0,
  });
  readyCallback?.();
}

/** Returns a deterministic-in-session stroke seed for baked brush stamps. */
export function nextRasterStrokeIndex(layer: Layer): number {
  const entry = store.get(layer.id);
  if (!entry) return 0;
  const index = entry.nextStrokeIndex;
  entry.nextStrokeIndex++;
  return index;
}

/** 0 while undecoded — safe to mix into a render sig unconditionally. */
export function rasterPixelVersion(layer: Layer): number {
  return store.get(layer.id)?.pixelVersion ?? 0;
}

/** Drops entries for layers that no longer exist (call on project load and undo/redo). */
export function pruneRasterStore(liveIds: Set<string>): void {
  for (const id of store.keys()) {
    if (!liveIds.has(id)) store.delete(id);
  }
}
