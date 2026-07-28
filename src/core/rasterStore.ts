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

import type { Layer, Project, SubPanel } from "./types";
import { appendRasterTimelapseCheckpoint, rasterTimelapseImages } from "./rasterTimelapse";

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

export type PreparedRaster = {
  layerId: string;
  sourceData: string;
  sourceWidth: number;
  sourceHeight: number;
  canvas: HTMLCanvasElement;
};

type PreparedTimelineImage = {
  data: string;
  canvas: HTMLCanvasElement;
};

export type RasterPreparation = {
  entries: PreparedRaster[];
  timelineImages: PreparedTimelineImage[];
};

const store = new Map<string, RasterEntry>();
const timelineImageStore = new Map<string, { canvas: HTMLCanvasElement; decoding: boolean }>();
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

function rasterLayersForProject(project: Project, panelIds?: Set<string>): Layer[] {
  const layers: Layer[] = [];
  for (const panel of project.panels) {
    if (panelIds && !panelIds.has(panel.id)) continue;
    layers.push(...panel.layers);
    const visit = (subs: SubPanel[] | undefined) => {
      for (const subPanel of subs ?? []) {
        layers.push(...subPanel.layers);
        visit(subPanel.subPanels);
      }
    };
    visit(panel.subPanels);
  }
  return layers.filter(layer => layer.kind === "raster" && !!layer.raster);
}

/** Decode target raster data without touching the live store. Undo/redo uses
 * this two-phase path so a delayed image decode cannot replace a complete
 * visible frame with a blank raster layer. */
export async function prepareRasterCanvases(
  project: Project,
  panelIds?: Iterable<string>
): Promise<RasterPreparation> {
  const ids = panelIds ? new Set(panelIds) : undefined;
  const entries: PreparedRaster[] = [];
  const timelineImages: PreparedTimelineImage[] = [];
  const preparedTimelineData = new Set<string>();
  for (const layer of rasterLayersForProject(project, ids)) {
    const raster = layer.raster!;
    const existing = store.get(layer.id);
    if (existing && existing.sourceData === raster.data &&
        existing.sourceWidth === raster.width && existing.sourceHeight === raster.height &&
        !existing.decoding) {
      // Current pixels are ready; timeline images below may still need decode.
    } else {
      const image = await decodeImage(raster.data);
      const canvas = makeCanvas(raster.width, raster.height);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("raster decode produced no 2D context");
      context.clearRect(0, 0, raster.width, raster.height);
      context.drawImage(image, 0, 0);
      entries.push({
        layerId: layer.id,
        sourceData: raster.data,
        sourceWidth: raster.width,
        sourceHeight: raster.height,
        canvas,
      });
    }

    for (const data of rasterTimelapseImages(layer)) {
      if (timelineImageStore.get(data)?.decoding === false || preparedTimelineData.has(data)) continue;
      const image = await decodeImage(data);
      const canvas = makeCanvas(raster.width, raster.height);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("raster timelapse decode produced no 2D context");
      context.clearRect(0, 0, raster.width, raster.height);
      context.drawImage(image, 0, 0);
      timelineImages.push({ data, canvas });
      preparedTimelineData.add(data);
    }
  }
  return { entries, timelineImages };
}

/** Atomically install a successful raster preparation after its project has
 * been selected. The existing stroke counter survives an undo swap. */
export function commitRasterPreparation(preparation: RasterPreparation): void {
  for (const prepared of preparation.entries) {
    const previous = store.get(prepared.layerId);
    store.set(prepared.layerId, {
      canvas: prepared.canvas,
      sourceData: prepared.sourceData,
      sourceWidth: prepared.sourceWidth,
      sourceHeight: prepared.sourceHeight,
      pixelVersion: (previous?.pixelVersion ?? 0) + 1,
      decoding: false,
      nextStrokeIndex: previous?.nextStrokeIndex ?? 0,
    });
  }
  for (const prepared of preparation.timelineImages ?? []) {
    timelineImageStore.set(prepared.data, { canvas: prepared.canvas, decoding: false });
  }
}

/** Call after mutating a raster layer's runtime canvas directly. */
export function markRasterEdited(layer: Layer): void {
  const entry = store.get(layer.id);
  if (entry) entry.pixelVersion++;
}

/** Serializes the runtime canvas back into layer.raster.data. Call before
 *  commitHistory so the JSON snapshot contains the new pixels. Updates the
 *  entry's sourceData so this sync doesn't itself trigger a re-decode. */
export function syncRasterToLayer(
  layer: Layer,
  timelineMode: "checkpoint" | "none" = "checkpoint",
): void {
  const entry = store.get(layer.id);
  if (!entry || !layer.raster) return;
  const beforeData = layer.raster.data;
  const data = entry.canvas.toDataURL("image/png");
  layer.raster.data = data;
  layer.raster.width = entry.canvas.width;
  layer.raster.height = entry.canvas.height;
  entry.sourceData = data;
  entry.sourceWidth = entry.canvas.width;
  entry.sourceHeight = entry.canvas.height;
  timelineImageStore.set(data, { canvas: cloneCanvas(entry.canvas), decoding: false });
  if (timelineMode === "checkpoint") {
    appendRasterTimelapseCheckpoint(layer, beforeData, data);
  }
}

function cloneCanvas(source: HTMLCanvasElement): HTMLCanvasElement {
  const canvas = makeCanvas(source.width, source.height);
  canvas.getContext("2d")?.drawImage(source, 0, 0);
  return canvas;
}

/** Returns a decoded checkpoint/baseline image, starting one async decode on
 *  demand when a legacy project was opened outside the prepared load path. */
export function getRasterTimelapseImage(
  data: string,
  width: number,
  height: number,
): HTMLCanvasElement | null {
  const existing = timelineImageStore.get(data);
  if (existing) return existing.decoding ? null : existing.canvas;
  const pending = { canvas: makeCanvas(width, height), decoding: true };
  timelineImageStore.set(data, pending);
  decodeImage(data).then((image) => {
    const current = timelineImageStore.get(data);
    if (!current) return;
    current.canvas.width = width;
    current.canvas.height = height;
    const context = current.canvas.getContext("2d");
    context?.clearRect(0, 0, width, height);
    context?.drawImage(image, 0, 0);
    current.decoding = false;
    readyCallback?.();
  }).catch(() => {
    const current = timelineImageStore.get(data);
    if (current) current.decoding = false;
  });
  return null;
}

export function installRasterTimelapseImage(data: string, canvas: HTMLCanvasElement): void {
  timelineImageStore.set(data, { canvas: cloneCanvas(canvas), decoding: false });
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
