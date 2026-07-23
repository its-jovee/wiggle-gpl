// ============================================================================
// core/render.ts — renders a panel to a canvas at a given wiggle tick.
//
// Render order (per layer):
//   1. Walk strokes with current wiggle → opaque stroke pixels on ctx.
//   2. Composite a cached fill mask via destination-over → fills slot UNDER
//      strokes. The mask is computed from un-jittered strokes so it stays
//      stable even as strokes wiggle.
//   3. Render TextElements on the layer (post-strokes; per-glyph wiggle).
//
// Then for each SubPanel (containers): apply animation transform, clip to the
// shape polyline, render its layers + texts, lift the clip, stamp the border.
//
// Finally paint the panel bg with destination-over so it sits behind
// everything. Whole-panel animations wrap the entire render.
// ============================================================================

import { Layer, LayerBlendMode, LayerMask, Panel, Stroke, SubPanel, TextElement, Vec2 } from "./types";
import { jitter, smoothJitterFromSamples, smoothJitterSamples, SmoothJitterSamples } from "./rng";
import { brushByKey } from "../brushes/registry";
import { floodFillImageData, hexToRgb } from "./fill";
import {
  computeAnim, applyAnimTransform, isIdentity,
  applyLayerAnimTransform, composeLayerAnim, computeLayerAnim,
  IDENTITY_LAYER_ANIM, isIdentityLayerAnim, LayerAnimState,
} from "./anim";
import { shapePoints, pointsToPath, strokeBorder, hashId } from "./subpanel";
import { renderTextElement } from "./text";
import { applyShapeMaskToImageData } from "./selection";
import {
  canonicalRawLayerContainerDurMs,
  canonicalRawLayerLocalMs,
  rawLayerCacheKey,
} from "./renderSchedule";
import { layerVersion } from "./layerVersion";
import {
  brushSettingsSignatureValues,
  effectiveBrushSettings,
} from "./brushSettings";
import { renderTone } from "./tone";
import { getRasterCanvas, rasterPixelVersion } from "./rasterStore";

const WIGGLE_AMPLITUDE = 2.5;
/** Float tolerance when comparing stroke-length budgets (accumulated segment lengths). */
const BUDGET_EPS = 1e-4;
/** Minimum progress step backward before timelapse cache invalidates. */
const TIMELAPSE_PROGRESS_EPS = 1e-6;

type StrokeBudget = { remaining: number; skip?: number };
type LayerBudgetPlan = number[];

export type RenderOpts = {
  skipBg?: boolean;
  skipFills?: boolean;
  skipAnim?: boolean;        // thumbnails / paused display
  skipJitter?: boolean;      // draw without wiggle jitter on stroke points
  layerPreviewOffset?: { layerId: string; dx: number; dy: number };
  allPanels?: Panel[];
  timelapseProgress?: number;
  localMs?: number;
  wiggleFps?: number;
  overscan?: { x: number; y: number }; // editor-only bleed margin
  overscanDim?: number;                 // 0-1 overlay opacity (default 0.55; 1 = opaque/playback)
  renderCache?: RenderCache;
  contentVersion?: number;              // editor content generation; keys the timelapse cache
  /** Editor-only: on a fill-mask cache miss, show the stale mask and recompute
   *  asynchronously instead of stalling the frame on getImageData+flood fill.
   *  Export must never set this — it needs synchronous, deterministic masks. */
  deferFillMasks?: boolean;
  /** Editor-only: compute fill masks but do not write fillMaskCache (live erase preview). */
  skipFillMaskCache?: boolean;
  /** When false, timelapse source panels use full drawLayerStack (tests / fallback). */
  timelapseIncremental?: boolean;
};

export type RenderCacheStats = {
  rawLayerHits: number;
  rawLayerMisses: number;
  rawLayerEvictions: number;
  rawLayerEntries: number;
};

export type RenderCache = {
  maxRawLayerEntries: number;
  rawLayers: Map<string, HTMLCanvasElement>;
  stats: RenderCacheStats;
};

export function createRenderCache(maxRawLayerEntries = 64): RenderCache {
  return {
    maxRawLayerEntries,
    rawLayers: new Map(),
    stats: {
      rawLayerHits: 0,
      rawLayerMisses: 0,
      rawLayerEvictions: 0,
      rawLayerEntries: 0,
    },
  };
}

export function clearRenderCache(cache: RenderCache): void {
  cache.rawLayers.clear();
  cache.stats.rawLayerEntries = 0;
}

export function clearTimelapseCache(): void {
  _timelapseCache = null;
}

export function resetRenderCacheStats(cache: RenderCache): void {
  cache.stats.rawLayerHits = 0;
  cache.stats.rawLayerMisses = 0;
  cache.stats.rawLayerEvictions = 0;
  cache.stats.rawLayerEntries = cache.rawLayers.size;
}

export function renderCacheStats(cache: RenderCache): RenderCacheStats {
  return { ...cache.stats, rawLayerEntries: cache.rawLayers.size };
}

export type StrokeRenderOpts = {
  layerIndex: number;
  strokeIndex: number;
  bg: string;
  skipJitter?: boolean;
};

export function renderPanel(
  ctx: CanvasRenderingContext2D,
  panel: Panel,
  tick: number,
  width: number,
  height: number,
  opts?: RenderOpts
) {
  beginFramePool();
  const ox = opts?.overscan?.x ?? 0;
  const oy = opts?.overscan?.y ?? 0;
  const bufW = width + 2 * ox;
  const bufH = height + 2 * oy;

  ctx.save();

  // Whole-panel animation wraps everything. Pivot at frame center in extended space.
  const skipAnim = opts?.skipAnim ?? false;
  const wiggleFps = opts?.wiggleFps ?? 8;
  const localMs = opts?.localMs ?? panel.durationMs;
  if (!skipAnim) {
    const panelAnim = computeAnim(panel.enter, panel.exit, localMs, panel.durationMs, wiggleFps);
    if (!isIdentity(panelAnim)) {
      applyAnimTransform(ctx, panelAnim, bufW / 2, bufH / 2);
    }
  }

  if (panel.kind === "timelapse") {
    renderTimelapse(ctx, panel, tick, width, height, opts);
    ctx.restore();
    return;
  }

  if (!opts?.skipBg) {
    ctx.clearRect(0, 0, bufW, bufH);
  }

  const budget = { remaining: Infinity };
  drawLayerStack(ctx, panel.layers, tick, budget, bufW, bufH, panel.bg, opts, localMs, panel.durationMs, wiggleFps, skipAnim);

  // Sub-panels on top (frame dims; translate handled inside renderSubPanel)
  (panel.subPanels ?? []).forEach((sp) => {
    renderSubPanel(ctx, sp, tick, width, height, panel.durationMs, opts, localMs, wiggleFps, skipAnim);
  });

  if (!opts?.skipBg) {
    const overscanDim = opts?.overscanDim ?? 0;
    if ((ox > 0 || oy > 0) && overscanDim < 1) {
      // Focus mode is visually continuous: the finite export background
      // extends beneath editor bleed without outlining the crop boundary.
      paintBgUnder(ctx, panel.bg, bufW, bufH);
    } else {
      paintBgUnder(ctx, panel.bg, width, height, ox, oy);
    }
    // Playback still masks editor-only bleed so the finite frame is explicit.
    if ((ox > 0 || oy > 0) && overscanDim >= 1) {
      paintOverscanOverlay(ctx, width, height, ox, oy, bufW);
    }
  }

  ctx.restore();
}

export function renderStroke(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  tick: number,
  opts: StrokeRenderOpts
) {
  const budget = { remaining: Infinity };
  walkLayerStrokes(
    ctx,
    [stroke],
    opts.layerIndex,
    tick,
    budget,
    opts.bg,
    opts.skipJitter ? 0 : WIGGLE_AMPLITUDE,
    opts.strokeIndex
  );
}

// ----------------------------------------------------------------------------
// Timelapse incremental cache. Commits stroke ink per layer so progress can
// advance without redrawing the full source panel each frame. Invalidated on
// scrub-backward, source edits (contentVersion), or wiggle tick changes.
// ----------------------------------------------------------------------------

type TimelapseLayerState = {
  canvas: HTMLCanvasElement;
  committedBudget: number;
};

type TimelapseFrameCache = {
  sourceId: string;
  contentVersion: number;
  width: number;
  height: number;
  tick: number;
  progress: number;
  skipJitter: boolean;
  bg: string;
  layers: TimelapseLayerState[];
};

let _timelapseCache: TimelapseFrameCache | null = null;

function timelapseLayerNeedsFallback(layer: Layer): boolean {
  if (layer.clipToBelow) return true;
  if ((layer.fills?.length ?? 0) > 0) return true;
  if ((layer.texts?.length ?? 0) > 0) return true;
  if (layer.animation?.enabled) return true;
  // A half-revealed mask under a full tone pattern looks broken — render whole.
  if (layer.kind === "tone") return true;
  // Raster layers have no stroke-budget concept — always render whole.
  if (layer.kind === "raster") return true;
  for (const stroke of layer.strokes) {
    if (brushByKey(stroke.brush).erase) return true;
  }
  return false;
}

function ensureTimelapseLayerCanvas(
  cache: TimelapseFrameCache,
  layerIndex: number,
  width: number,
  height: number
): TimelapseLayerState {
  while (cache.layers.length <= layerIndex) {
    const c = document.createElement("canvas");
    c.width = width;
    c.height = height;
    cache.layers.push({ canvas: c, committedBudget: 0 });
  }
  const state = cache.layers[layerIndex];
  if (state.canvas.width !== width) state.canvas.width = width;
  if (state.canvas.height !== height) state.canvas.height = height;
  return state;
}

function resetTimelapseLayerState(state: TimelapseLayerState, width: number, height: number): void {
  state.committedBudget = 0;
  const oc = state.canvas.getContext("2d")!;
  oc.setTransform(1, 0, 0, 1, 0, 0);
  oc.clearRect(0, 0, width, height);
}

function syncTimelapseCache(
  src: Panel,
  tick: number,
  progress: number,
  width: number,
  height: number,
  opts: RenderOpts | undefined
): TimelapseFrameCache {
  const contentVersion = opts?.contentVersion ?? 0;
  const skipJitter = opts?.skipJitter ?? false;
  const bg = src.bg;
  const c = _timelapseCache;

  if (
    !c ||
    c.sourceId !== src.id ||
    c.contentVersion !== contentVersion ||
    c.width !== width ||
    c.height !== height ||
    c.skipJitter !== skipJitter ||
    c.bg !== bg ||
    progress < c.progress - TIMELAPSE_PROGRESS_EPS
  ) {
    _timelapseCache = {
      sourceId: src.id,
      contentVersion,
      width,
      height,
      tick,
      progress,
      skipJitter,
      bg,
      layers: [],
    };
    return _timelapseCache;
  }

  if (c.tick !== tick) {
    for (const state of c.layers) {
      resetTimelapseLayerState(state, width, height);
    }
    c.tick = tick;
  }

  c.progress = progress;
  return c;
}

function renderTimelapseInkLayer(
  state: TimelapseLayerState,
  layer: Layer,
  layerIndex: number,
  tick: number,
  budgetAmount: number,
  layerLength: number,
  width: number,
  height: number,
  bg: string,
  wiggleAmp: number,
  opts: RenderOpts | undefined
): void {
  if (budgetAmount <= 0) return;

  const oc = state.canvas.getContext("2d")!;
  const ox = opts?.overscan?.x ?? 0;
  const oy = opts?.overscan?.y ?? 0;

  if (budgetAmount < state.committedBudget - BUDGET_EPS) {
    resetTimelapseLayerState(state, width, height);
  }

  const fullyRevealed = layerLength > 0 && budgetAmount >= layerLength - BUDGET_EPS;
  const targetBudget = fullyRevealed ? layerLength : budgetAmount;

  if (targetBudget <= state.committedBudget + BUDGET_EPS) return;

  const delta = targetBudget - state.committedBudget;
  oc.save();
  if (ox > 0 || oy > 0) oc.translate(ox, oy);
  walkLayerStrokes(
    oc,
    layer.strokes,
    layerIndex,
    tick,
    { remaining: delta, skip: state.committedBudget },
    bg,
    wiggleAmp
  );
  oc.restore();
  state.committedBudget = targetBudget;
}

function compositeTimelapseLayer(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  opacity: number
): void {
  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = opacity;
  ctx.drawImage(canvas, 0, 0);
  ctx.restore();
}

function renderTimelapseLayers(
  ctx: CanvasRenderingContext2D,
  src: Panel,
  tick: number,
  budgets: number[],
  width: number,
  height: number,
  progress: number,
  opts: RenderOpts | undefined,
  localMs: number,
  containerDurMs: number,
  wiggleFps: number
) {
  const wiggleAmp = opts?.skipJitter ? 0 : WIGGLE_AMPLITUDE;
  const cache = syncTimelapseCache(src, tick, progress, width, height, opts);
  const useIncremental = opts?.timelapseIncremental !== false &&
    src.layers.every((layer) => !timelapseLayerNeedsFallback(layer));

  if (!useIncremental) {
    drawLayerStack(ctx, src.layers, tick, budgets, width, height, src.bg, opts, localMs, containerDurMs, wiggleFps, true);
    return;
  }

  src.layers.forEach((layer, li) => {
    if (!layer.visible) return;
    const layerLength = computeLayerStrokeLength(layer);
    const budgetAmount = budgets[li] ?? 0;
    if (budgetAmount <= 0) return;

    const fullyRevealed = layerLength > 0 && budgetAmount >= layerLength - BUDGET_EPS;
    if (fullyRevealed) {
      const raw = drawLayerRaw(
        layer, li, tick,
        { remaining: Infinity },
        width, height, src.bg, opts,
        localMs, containerDurMs, wiggleFps, true, src.layers
      );
      compositeTimelapseLayer(ctx, raw, layer.opacity);
      return;
    }

    const state = ensureTimelapseLayerCanvas(cache, li, width, height);
    renderTimelapseInkLayer(
      state, layer, li, tick, budgetAmount, layerLength,
      width, height, src.bg, wiggleAmp, opts
    );
    compositeTimelapseLayer(ctx, state.canvas, layer.opacity);
  });
}

function renderTimelapse(
  ctx: CanvasRenderingContext2D,
  panel: Panel,
  tick: number,
  width: number,
  height: number,
  opts?: RenderOpts
) {
  const ox = opts?.overscan?.x ?? 0;
  const oy = opts?.overscan?.y ?? 0;
  const bufW = width + 2 * ox;
  const bufH = height + 2 * oy;

  const src = opts?.allPanels?.find((p) => p.id === panel.timelapse?.sourceId);
  if (!src) {
    if (!opts?.skipBg) {
      ctx.fillStyle = panel.bg;
      const overscanDim = opts?.overscanDim ?? 0;
      if ((ox > 0 || oy > 0) && overscanDim < 1) ctx.fillRect(0, 0, bufW, bufH);
      else ctx.fillRect(ox, oy, width, height);
    }
    ctx.fillStyle = "#888";
    ctx.font = "24px ui-monospace, monospace";
    ctx.fillText("source missing", ox + 24, oy + 48);
    return;
  }
  if (!opts?.skipBg) {
    ctx.clearRect(0, 0, bufW, bufH);
  }
  const progress = Math.max(0, Math.min(1, opts?.timelapseProgress ?? 1));
  const budget = allocateTimelapseLayerBudgets(src.layers, progress);
  const wiggleFps = opts?.wiggleFps ?? 8;
  const srcLocalMs = src.durationMs * progress;
  renderTimelapseLayers(
    ctx, src, tick, budget, bufW, bufH, progress, opts, srcLocalMs, src.durationMs, wiggleFps
  );
  if (progress >= 1) {
    (src.subPanels ?? []).forEach((sp) => {
      renderSubPanel(ctx, sp, tick, width, height, src.durationMs, opts, srcLocalMs, wiggleFps, true);
    });
  }
  if (!opts?.skipBg) {
    const overscanDim = opts?.overscanDim ?? 0;
    if ((ox > 0 || oy > 0) && overscanDim < 1) paintBgUnder(ctx, src.bg, bufW, bufH);
    else paintBgUnder(ctx, src.bg, width, height, ox, oy);
    if ((ox > 0 || oy > 0) && overscanDim >= 1) {
      paintOverscanOverlay(ctx, width, height, ox, oy, bufW);
    }
  }
}

function paintBgUnder(
  ctx: CanvasRenderingContext2D,
  bg: string,
  width: number,
  height: number,
  ox = 0,
  oy = 0
) {
  ctx.save();
  ctx.globalCompositeOperation = "destination-over";
  ctx.globalAlpha = 1;
  ctx.fillStyle = bg;
  ctx.fillRect(ox, oy, width, height);
  ctx.restore();
}

function paintOverscanOverlay(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  ox: number,
  oy: number,
  bufW: number
) {
  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = "#000000";
  if (oy > 0) {
    ctx.fillRect(0, 0, bufW, oy);
    ctx.fillRect(0, oy + height, bufW, oy);
  }
  if (ox > 0) {
    ctx.fillRect(0, oy, ox, height);
    ctx.fillRect(ox + width, oy, ox, height);
  }
  ctx.restore();
}

// Shared per-layer offscreen canvas. We render each layer into this canvas
// at full opacity (so eraser strokes can dest-out cleanly within just THIS
// layer), then composite it onto the target ctx with layer.opacity. Lower
// layers stay untouched because they're on the target ctx, not this one.
let _layerOff: HTMLCanvasElement | null = null;
let _layerOffCtx: CanvasRenderingContext2D | null = null;
let _layerXform: HTMLCanvasElement | null = null;
let _layerXformCtx: CanvasRenderingContext2D | null = null;
let _toneScratch: HTMLCanvasElement | null = null;
let _toneScratchCtx: CanvasRenderingContext2D | null = null;

// Frame-scoped canvas pool: lazily grown, index reset at the start of each
// renderPanel call. Eliminates per-frame HTMLCanvasElement allocation that
// was occurring 2×N_layers×60fps via cloneCanvas.
const _frameCanvasPool: HTMLCanvasElement[] = [];
let _framePoolIdx = 0;
let _framePoolHWM = 0;

function beginFramePool(): void {
  _framePoolHWM = Math.max(_framePoolHWM, _framePoolIdx);
  _framePoolIdx = 0;
}

export function trimFramePool(): void {
  // Capture the last renderPanel's slot count — beginFramePool only records
  // the previous call's idx, so the final render in a frame is otherwise missed.
  _framePoolHWM = Math.max(_framePoolHWM, _framePoolIdx);
  if (_frameCanvasPool.length > _framePoolHWM + 4) {
    _frameCanvasPool.length = _framePoolHWM + 4;
  }
  _framePoolHWM = 0;
}

function getLayerOffscreen(width: number, height: number) {
  if (!_layerOff || _layerOff.width !== width || _layerOff.height !== height) {
    _layerOff = document.createElement("canvas");
    _layerOff.width = width;
    _layerOff.height = height;
    _layerOffCtx = _layerOff.getContext("2d");
  }
  return { off: _layerOff!, oc: _layerOffCtx! };
}

/** Scratch canvas for painting a tone pattern before compositing it onto a
 *  layer with a single source-in draw. `renderTone` issues many separate
 *  fill/stroke calls; running those directly under source-in would intersect
 *  each dot/line against whatever the previous call left behind instead of
 *  masking the whole pattern against the ink in one shot. */
function getToneScratchOffscreen(width: number, height: number) {
  if (!_toneScratch || _toneScratch.width !== width || _toneScratch.height !== height) {
    _toneScratch = document.createElement("canvas");
    _toneScratch.width = width;
    _toneScratch.height = height;
    _toneScratchCtx = _toneScratch.getContext("2d");
  }
  return { off: _toneScratch!, oc: _toneScratchCtx! };
}

function getLayerTransformOffscreen(width: number, height: number) {
  if (!_layerXform || _layerXform.width !== width || _layerXform.height !== height) {
    _layerXform = document.createElement("canvas");
    _layerXform.width = width;
    _layerXform.height = height;
    _layerXformCtx = _layerXform.getContext("2d");
  }
  return { off: _layerXform!, oc: _layerXformCtx! };
}

type ClipBase = {
  mask: HTMLCanvasElement;
  transform: LayerAnimState;
};

function drawLayerStack(
  ctx: CanvasRenderingContext2D,
  layers: Layer[],
  tick: number,
  budget: StrokeBudget | LayerBudgetPlan,
  width: number,
  height: number,
  bg: string,
  opts: RenderOpts | undefined,
  localMs: number,
  containerDurMs: number,
  wiggleFps: number,
  skipAnim: boolean
) {
  let clipBase: ClipBase | null = null;
  let clipBaseLayer: Layer | undefined;
  layers.forEach((layer, li) => {
    if (!layer.visible) return;
    const budgetAmount = Array.isArray(budget) ? (budget[li] ?? 0) : budget.remaining;
    const layerLength = computeLayerStrokeLength(layer);
    const layerBudget: StrokeBudget = Array.isArray(budget)
      ? (layerLength > 0 && budgetAmount >= layerLength - BUDGET_EPS
        ? { remaining: Infinity }
        : { remaining: budgetAmount })
      : budget;
    const raw = drawLayerRaw(layer, li, tick, layerBudget, width, height, bg, opts, localMs, containerDurMs, wiggleFps, skipAnim, layers,
      (layer.clipToBelow && clipBase) ? clipBaseLayer : undefined);
    const ownAnim = skipAnim ? IDENTITY_LAYER_ANIM : computeLayerAnim(layer.animation, localMs, wiggleFps);
    const preview = opts?.layerPreviewOffset?.layerId === layer.id
      ? opts.layerPreviewOffset
      : null;
    const ownAnimWithPreview = preview
      ? { ...ownAnim, x: ownAnim.x + preview.dx, y: ownAnim.y + preview.dy }
      : ownAnim;
    const finalAnim = layer.clipToBelow && clipBase
      ? composeLayerAnim(clipBase.transform, ownAnimWithPreview)
      : ownAnimWithPreview;
    const needsCompose = !isIdentityLayerAnim(finalAnim) || layer.opacity !== 1;
    let stamped: HTMLCanvasElement;
    if (layer.clipToBelow && clipBase) {
      stamped = composeLayerCanvas(raw, finalAnim, width, height, layer.opacity);
      maskLayerCanvas(stamped, clipBase.mask, width, height);
    } else if (needsCompose) {
      stamped = composeLayerCanvas(raw, finalAnim, width, height, layer.opacity);
    } else {
      stamped = raw;
    }
    drawLayerWithBlend(ctx, stamped, layer.blendMode ?? "normal");
    if (!layer.clipToBelow) {
      // Detach: stamped may be a frame-pool slot or cache entry; clip masks must
      // outlive later pool slots in this drawLayerStack call.
      clipBase = {
        mask: detachOwnedCanvas(stamped, width, height),
        transform: ownAnimWithPreview,
      };
      clipBaseLayer = layer;
    }
  });
}

function canvasBlendMode(mode: LayerBlendMode): GlobalCompositeOperation {
  return mode === "normal" ? "source-over" : mode;
}

function drawLayerWithBlend(
  ctx: CanvasRenderingContext2D,
  layerCanvas: HTMLCanvasElement,
  mode: LayerBlendMode
) {
  ctx.save();
  ctx.globalCompositeOperation = canvasBlendMode(mode);
  ctx.globalAlpha = 1;
  ctx.drawImage(layerCanvas, 0, 0);
  ctx.restore();
}

function drawLayerRaw(
  layer: Layer,
  layerIndex: number,
  tick: number,
  budget: StrokeBudget,
  width: number,
  height: number,
  bg: string,
  opts: RenderOpts | undefined,
  localMs: number,
  containerDurMs: number,
  wiggleFps: number,
  skipAnim: boolean,
  referenceLayers: Layer[],
  clipLayer?: Layer
) {
  const ox = opts?.overscan?.x ?? 0;
  const oy = opts?.overscan?.y ?? 0;
  const skipAnimFlag = skipAnim;
  const cacheLocalMs = canonicalRawLayerLocalMs(layer, skipAnimFlag, localMs);
  const cacheContainerDurMs = canonicalRawLayerContainerDurMs(layer, skipAnimFlag, containerDurMs);
  // Prime raster invalidation before computing the raw-layer cache key. A
  // load/undo can replace the persisted PNG while keeping the same layer id;
  // getRasterCanvas bumps the pixel version so an old cached bitmap cannot be
  // reused during the async decode.
  if (layer.kind === "raster") getRasterCanvas(layer);
  const rawCacheKey = rawLayerRenderableFromCache(budget)
    ? rawLayerCacheKey({
      layerSig: layerSig(layer, bg, clipLayer, width, height, opts?.overscan),
      layerIndex,
      tick,
      width,
      height,
      skipFills: opts?.skipFills ?? false,
      skipJitter: opts?.skipJitter ?? false,
      localMs: cacheLocalMs,
      containerDurMs: cacheContainerDurMs,
      wiggleFps,
      skipAnim: skipAnimFlag,
    })
    : null;
  const cachedRaw = rawCacheKey && opts?.renderCache
    ? getCachedRawLayer(opts.renderCache, rawCacheKey)
    : null;
  if (cachedRaw) return cachedRaw;

  const renderTarget = rawCacheKey && opts?.renderCache
    ? acquireCacheOwnedCanvas(width, height)
    : null;
  const { off, oc } = renderTarget
    ? { off: renderTarget, oc: renderTarget.getContext("2d")! }
    : getLayerOffscreen(width, height);
  oc.setTransform(1, 0, 0, 1, 0, 0);
  oc.globalCompositeOperation = "source-over";
  oc.globalAlpha = 1;
  oc.clearRect(0, 0, width, height);

  // Translate so frame-coord strokes land in the centered frame region.
  if (ox > 0 || oy > 0) oc.translate(ox, oy);

  const wiggleAmp = opts?.skipJitter ? 0 : WIGGLE_AMPLITUDE;
  // Tone layers are intentionally static: their raster never receives
  // animated stroke jitter and is therefore identical on every wiggle tick.
  // Raster layers are real pixels — never jittered by nature, and painted
  // outside this function (paint/erase mutate the runtime canvas directly).
  // renderPanel is otherwise pure-of-(panel, tick): raster pixels only change
  // via commits (getRasterCanvas / rasterPixelVersion reads), never per tick.
  let drawn: boolean[];
  if (layer.kind === "raster") {
    drawn = [];
    const rc = layer.raster ? getRasterCanvas(layer) : null;
    if (rc) oc.drawImage(rc, 0, 0);
  } else if (layer.kind === "tone" && layer.tone) {
    if (layer.tone.coverage === "painted") {
      // Strokes act as a reveal mask (amplitude 0 — static ink); the pattern
      // is painted into a scratch canvas first, then clipped onto the ink
      // with a single source-in draw — renderTone issues many separate
      // fill/stroke calls, and running those directly under source-in would
      // intersect each dot/line against the previous call's leftovers instead
      // of masking the whole pattern against the ink in one shot.
      drawn = walkLayerStrokes(oc, layer.strokes, layerIndex, tick, budget, bg, 0);
      const { off: toneOff, oc: toneCtx } = getToneScratchOffscreen(width, height);
      toneCtx.setTransform(1, 0, 0, 1, 0, 0);
      toneCtx.globalCompositeOperation = "source-over";
      toneCtx.globalAlpha = 1;
      toneCtx.clearRect(0, 0, width, height);
      renderTone(toneCtx, layer.tone, width, height);
      oc.save();
      oc.globalCompositeOperation = "source-in";
      oc.drawImage(toneOff, 0, 0);
      oc.restore();
    } else {
      drawn = [];
      renderTone(oc, layer.tone, width, height);
    }
  } else {
    drawn = walkLayerStrokes(oc, layer.strokes, layerIndex, tick, budget, bg, wiggleAmp);
  }

  let usedStaleFillMask = false;
  if (layer.kind !== "tone" && layer.kind !== "raster" && !opts?.skipFills && layer.fills.length > 0) {
    const allGatedDrawn = layer.fills.every(
      (f) => f.afterStrokeIndex < 0 || drawn[f.afterStrokeIndex]
    );
    if (allGatedDrawn) {
      _fillMaskWasStale = false;
      const mask = getFillMask(
        layer, layerIndex, width, height, bg, clipLayer, opts?.overscan,
        opts?.deferFillMasks, referenceLayers, opts?.skipFillMaskCache
      );
      usedStaleFillMask = _fillMaskWasStale;
      if (mask) {
        oc.save();
        // Mask is in canvas pixel space — reset transform before compositing.
        if (ox > 0 || oy > 0) oc.setTransform(1, 0, 0, 1, 0, 0);
        oc.globalCompositeOperation = "destination-over";
        oc.drawImage(mask, 0, 0);
        oc.restore();
      }
    }
  }

  if (layer.texts && layer.texts.length > 0 && drawn.every(Boolean)) {
    layer.texts.forEach((t, ti) => renderText(oc, t, layerIndex, ti, tick, localMs, containerDurMs, wiggleFps, skipAnim, opts?.skipJitter ?? false));
  }

  applyLayerMask(oc, layer.mask, opts?.overscan);

  const raw = renderTarget ?? cloneCanvas(off, width, height);
  if (rawCacheKey && opts?.renderCache && !usedStaleFillMask) {
    putCachedRawLayer(opts.renderCache, rawCacheKey, raw);
  }
  return raw;
}

function applyLayerMask(
  ctx: CanvasRenderingContext2D,
  mask: LayerMask | undefined,
  overscan?: { x: number; y: number }
) {
  if (!mask?.enabled) return;
  const ox = overscan?.x ?? 0;
  const oy = overscan?.y ?? 0;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = mask.mode === "reveal" ? "destination-in" : "destination-out";
  ctx.beginPath();
  ctx.translate(ox, oy);
  traceLayerMaskPath(ctx, mask);
  ctx.fillStyle = "#000";
  ctx.fill();
  ctx.restore();
}

function traceLayerMaskPath(ctx: CanvasRenderingContext2D, mask: LayerMask) {
  const shape = mask.shape;
  if (shape.kind === "rect") {
    ctx.rect(shape.x, shape.y, shape.w, shape.h);
    return;
  }
  if (shape.kind === "ellipse") {
    ctx.ellipse(shape.cx, shape.cy, shape.rx, shape.ry, 0, 0, Math.PI * 2);
    return;
  }
  if (shape.points.length === 0) return;
  ctx.moveTo(shape.points[0].x, shape.points[0].y);
  for (let i = 1; i < shape.points.length; i++) ctx.lineTo(shape.points[i].x, shape.points[i].y);
  ctx.closePath();
}

function composeLayerCanvas(
  raw: HTMLCanvasElement,
  anim: LayerAnimState,
  width: number,
  height: number,
  opacity: number
): HTMLCanvasElement {
  const { off, oc } = getLayerTransformOffscreen(width, height);
  oc.setTransform(1, 0, 0, 1, 0, 0);
  oc.globalCompositeOperation = "source-over";
  oc.globalAlpha = 1;
  oc.clearRect(0, 0, width, height);
  oc.save();
  oc.globalAlpha = opacity;
  applyLayerAnimTransform(oc, anim, width / 2, height / 2);
  oc.drawImage(raw, 0, 0);
  oc.restore();
  return cloneCanvas(off, width, height);
}

function maskLayerCanvas(
  canvas: HTMLCanvasElement,
  mask: HTMLCanvasElement,
  width: number,
  height: number
) {
  const c = canvas.getContext("2d")!;
  c.save();
  c.globalCompositeOperation = "destination-in";
  c.globalAlpha = 1;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.drawImage(mask, 0, 0, width, height);
  c.restore();
}

function cloneCanvas(src: HTMLCanvasElement, width: number, height: number): HTMLCanvasElement {
  let c = _frameCanvasPool[_framePoolIdx];
  if (!c) {
    c = document.createElement("canvas");
    _frameCanvasPool[_framePoolIdx] = c;
  }
  _framePoolIdx++;
  if (c.width !== width) c.width = width;
  if (c.height !== height) c.height = height;
  const oc = c.getContext("2d")!;
  oc.setTransform(1, 0, 0, 1, 0, 0);
  oc.clearRect(0, 0, width, height);
  oc.drawImage(src, 0, 0);
  return c;
}

function rawLayerRenderableFromCache(budget: StrokeBudget): boolean {
  return budget.remaining === Infinity;
}

function acquireCacheOwnedCanvas(width: number, height: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  return c;
}

function detachOwnedCanvas(src: HTMLCanvasElement, width: number, height: number): HTMLCanvasElement {
  const c = acquireCacheOwnedCanvas(width, height);
  c.getContext("2d")!.drawImage(src, 0, 0);
  return c;
}

function getCachedRawLayer(cache: RenderCache, key: string): HTMLCanvasElement | null {
  const c = cache.rawLayers.get(key);
  if (!c) {
    cache.stats.rawLayerMisses++;
    cache.stats.rawLayerEntries = cache.rawLayers.size;
    return null;
  }
  cache.rawLayers.delete(key);
  cache.rawLayers.set(key, c);
  cache.stats.rawLayerHits++;
  cache.stats.rawLayerEntries = cache.rawLayers.size;
  // Callers must treat the returned canvas as read-only (drawImage only).
  return c;
}

function putCachedRawLayer(
  cache: RenderCache,
  key: string,
  src: HTMLCanvasElement,
): void {
  if (cache.maxRawLayerEntries <= 0) return;
  cache.rawLayers.set(key, src);
  while (cache.rawLayers.size > cache.maxRawLayerEntries) {
    const oldest = cache.rawLayers.keys().next().value;
    if (oldest === undefined) break;
    cache.rawLayers.delete(oldest);
    cache.stats.rawLayerEvictions++;
  }
  cache.stats.rawLayerEntries = cache.rawLayers.size;
}

function renderText(
  ctx: CanvasRenderingContext2D,
  t: TextElement,
  layerIndex: number,
  textIndex: number,
  tick: number,
  localMs: number,
  containerDurMs: number,
  wiggleFps: number,
  skipAnim: boolean,
  skipJitter = false
) {
  ctx.save();
  if (!skipAnim) {
    const anim = computeAnim(t.enter, t.exit, localMs, containerDurMs, wiggleFps);
    if (!isIdentity(anim)) {
      const cx = t.x;
      const cy = t.y + t.fontSize / 2;
      applyAnimTransform(ctx, anim, cx, cy);
    }
  }
  const seed = (hashId(t.id) + layerIndex * 10000 + textIndex * 17) | 0;
  renderTextElement(ctx, t, tick, seed, skipJitter);
  ctx.restore();
}

function renderSubPanel(
  ctx: CanvasRenderingContext2D,
  sp: SubPanel,
  tick: number,
  width: number,
  height: number,
  parentDurMs: number,
  opts: RenderOpts | undefined,
  parentLocalMs: number,
  wiggleFps: number,
  skipAnim: boolean
) {
  const ox = opts?.overscan?.x ?? 0;
  const oy = opts?.overscan?.y ?? 0;

  ctx.save();

  // Shift frame coords to canvas pixel coords for the sub-panel and all its contents.
  if (ox > 0 || oy > 0) ctx.translate(ox, oy);

  if (!skipAnim) {
    const anim = computeAnim(sp.enter, sp.exit, parentLocalMs, parentDurMs, wiggleFps);
    if (!isIdentity(anim)) {
      const cx = sp.bounds.x + sp.bounds.w / 2;
      const cy = sp.bounds.y + sp.bounds.h / 2;
      applyAnimTransform(ctx, anim, cx, cy);
    }
  }

  const pts = shapePoints(sp.shape, sp.bounds, sp.tail);
  const path = pointsToPath(pts);

  // Interior clip + layers + texts
  ctx.save();
  ctx.clip(path);
  if (sp.bg) {
    ctx.fillStyle = sp.bg;
    ctx.fill(path);
  }
  const innerBudget = { remaining: Infinity };
  // Strip overscan from opts: ctx is already translated, so offscreens use frame dims.
  const innerOpts = (ox > 0 || oy > 0) ? { ...opts, overscan: undefined } : opts;
  drawLayerStack(ctx, sp.layers, tick, innerBudget, width, height,
    sp.bg ?? "#000000", innerOpts, parentLocalMs, parentDurMs, wiggleFps, skipAnim);
  ctx.restore(); // lift clip

  // Border stamped along the polyline (wiggles!)
  strokeBorder(
    ctx,
    pts,
    sp.border.brush,
    sp.border.color,
    sp.border.thickness,
    tick,
    opts?.skipJitter ? 0 : sp.border.wiggleAmplitude,
    hashId(sp.id),
    sp.bg ?? "#000000"
  );

  ctx.restore();
}

// ----------------------------------------------------------------------------
// Fill mask cache. Computed against strokes at amplitude=0 so the fill region
// never moves with wiggle. The mask is dilated by ceil(WIGGLE_AMPLITUDE) so
// the fill extends past the un-jittered boundary, preventing white gaps when
// jitter shifts strokes inward. Invalidated when stroke/fill/bg changes.
// ----------------------------------------------------------------------------

const fillMaskCache = new WeakMap<Layer, { sig: string; canvas: HTMLCanvasElement | null }>();

// Deferred fill-mask recompute (editor hot path). A miss costs a full-canvas
// getImageData (sync GPU readback) + CPU flood fill — 15-40ms at 1080×1920 —
// so during editing we serve the stale mask and recompute off the frame.
const _pendingFillMasks = new WeakMap<Layer, string>();
let _onAsyncRenderInvalidate: (() => void) | null = null;
/** Editor shell hook: called after an async fill-mask recompute lands so the
 *  shell can invalidate its frame caches and repaint. */
export function setAsyncRenderInvalidate(cb: (() => void) | null): void {
  _onAsyncRenderInvalidate = cb;
}

// Set by getFillMask when it served a stale (deferred) mask; drawLayerRaw must
// then skip caching the raw canvas, or the stale pixels would be stored under
// the layer's NEW content hash and survive the recompute.
let _fillMaskWasStale = false;

function scheduleFillMaskRecompute(
  layer: Layer,
  layerIndex: number,
  width: number,
  height: number,
  bg: string,
  sig: string,
  clipLayer?: Layer,
  overscan?: { x: number; y: number },
  referenceLayers?: Layer[]
): void {
  if (_pendingFillMasks.get(layer) === sig) return;
  _pendingFillMasks.set(layer, sig);
  const run = () => {
    // Content may have moved on since scheduling — recompute against the
    // layer's current state and store under its current sig.
    const curSig = fillMaskSig(layer, bg, clipLayer, width, height, overscan, referenceLayers);
    const canvas = computeFillMask(layer, layerIndex, width, height, bg, clipLayer, overscan, referenceLayers);
    fillMaskCache.set(layer, { sig: curSig, canvas });
    if (_pendingFillMasks.get(layer) === sig) _pendingFillMasks.delete(layer);
    _onAsyncRenderInvalidate?.();
  };
  if (typeof requestIdleCallback === "function") {
    requestIdleCallback(() => run(), { timeout: 120 });
  } else {
    setTimeout(run, 0);
  }
}

type LayerSigMemo = {
  layerVersion: number;
  rasterPixelVersion: number;
  clipLayerVersion: number;
  bg: string;
  cw: number;
  ch: number;
  ox: number;
  oy: number;
  clipLayer: Layer | undefined;
  sig: string;
};

const _layerSigMemo = new WeakMap<Layer, LayerSigMemo>();

function mixHash(h: number, n: number): number {
  return Math.imul(h ^ (n | 0), 16777619);
}

function mixFloat(h: number, n: number): number {
  return mixHash(h, Math.round((Number.isFinite(n) ? n : 0) * 1024));
}

function mixString(h: number, s: string): number {
  for (let i = 0; i < s.length; i++) h = mixHash(h, s.charCodeAt(i));
  return mixHash(h, s.length);
}

function mixStroke(h: number, s: Stroke): number {
  h = mixString(h, s.brush);
  h = mixString(h, s.color);
  h = mixFloat(h, s.size);
  const brushSettings = brushSettingsSignatureValues(s.brushSettings);
  h = mixFloat(h, brushSettings.spacingScale);
  h = mixFloat(h, brushSettings.flow);
  h = mixHash(h, brushSettings.pressureSize ? 1 : 0);
  h = mixHash(h, brushSettings.pressureFlow ? 1 : 0);
  h = mixHash(h, s.points.length);
  for (const p of s.points) {
    h = mixFloat(h, p.x);
    h = mixFloat(h, p.y);
  }
  if (s.pressures) {
    h = mixHash(h, s.pressures.length);
    for (const p of s.pressures) h = mixFloat(h, p);
  } else {
    h = mixHash(h, -1);
  }
  return h;
}

function mixText(h: number, t: TextElement): number {
  h = mixString(h, t.content);
  h = mixString(h, t.fontFamily);
  h = mixString(h, t.color);
  h = mixFloat(h, t.x);
  h = mixFloat(h, t.y);
  h = mixFloat(h, t.fontSize);
  h = mixFloat(h, t.wiggleAmplitude);
  h = mixFloat(h, t.rotation ?? 0);
  h = mixString(h, t.enter ? `${t.enter.kind}:${t.enter.durationTicks}:${t.enter.startTick ?? -1}` : "");
  h = mixString(h, t.exit ? `${t.exit.kind}:${t.exit.durationTicks}:${t.exit.startTick ?? -1}` : "");
  return h;
}

function mixLayerMaskState(h: number, layer: Layer): number {
  h = mixString(h, layer.blendMode ?? "normal");
  if (layer.mask) {
    h = mixHash(h, layer.mask.enabled ? 1 : 0);
    h = mixString(h, layer.mask.mode);
    h = mixShape(h, layer.mask.shape);
  } else {
    h = mixHash(h, 0);
  }
  h = mixHash(h, layer.strokes.length);
  h = mixHash(h, layer.fills.length);
  // Texts render inside the raw layer canvas, so they must shape the sig —
  // the raw-layer cache is no longer cleared wholesale on every commit.
  h = mixHash(h, layer.texts?.length ?? 0);
  if (layer.texts) for (const t of layer.texts) h = mixText(h, t);
  for (const s of layer.strokes) h = mixStroke(h, s);
  for (const f of layer.fills) {
    h = mixString(h, f.color);
    h = mixFloat(h, f.tolerance ?? 0);
    h = mixFloat(h, f.gapClosePx ?? 0);
    h = mixString(h, f.referenceMode ?? "activeLayer");
    h = mixHash(h, f.clipInverted ? 1 : 0);
    h = mixFloat(h, f.point.x);
    h = mixFloat(h, f.point.y);
    h = mixHash(h, f.afterStrokeIndex);
    if (f.clipShape) {
      h = mixHash(h, f.clipShape.kind === "rect" ? 1 : f.clipShape.kind === "ellipse" ? 2 : 3);
      if (f.clipShape.kind === "rect") {
        h = mixFloat(h, f.clipShape.x);
        h = mixFloat(h, f.clipShape.y);
        h = mixFloat(h, f.clipShape.w);
        h = mixFloat(h, f.clipShape.h);
      } else if (f.clipShape.kind === "ellipse") {
        h = mixFloat(h, f.clipShape.cx);
        h = mixFloat(h, f.clipShape.cy);
        h = mixFloat(h, f.clipShape.rx);
        h = mixFloat(h, f.clipShape.ry);
      } else {
        h = mixHash(h, f.clipShape.points.length);
        for (const p of f.clipShape.points) {
          h = mixFloat(h, p.x);
          h = mixFloat(h, p.y);
        }
      }
    } else {
      h = mixHash(h, 0);
    }
  }
  if (layer.tone) {
    h = mixString(h, layer.tone.style);
    h = mixString(h, layer.tone.color);
    h = mixFloat(h, layer.tone.spacing);
    h = mixFloat(h, layer.tone.size);
    h = mixFloat(h, layer.tone.angle);
    h = mixString(h, layer.tone.coverage);
  }
  if (layer.kind === "raster" && layer.raster) {
    h = mixString(h, layer.id);
    h = mixHash(h, rasterPixelVersion(layer));
    h = mixFloat(h, layer.raster.width);
    h = mixFloat(h, layer.raster.height);
  }
  return h;
}

function mixShape(h: number, shape: LayerMask["shape"]): number {
  h = mixHash(h, shape.kind === "rect" ? 1 : shape.kind === "ellipse" ? 2 : 3);
  if (shape.kind === "rect") {
    h = mixFloat(h, shape.x);
    h = mixFloat(h, shape.y);
    h = mixFloat(h, shape.w);
    h = mixFloat(h, shape.h);
  } else if (shape.kind === "ellipse") {
    h = mixFloat(h, shape.cx);
    h = mixFloat(h, shape.cy);
    h = mixFloat(h, shape.rx);
    h = mixFloat(h, shape.ry);
  } else {
    h = mixHash(h, shape.points.length);
    for (const p of shape.points) {
      h = mixFloat(h, p.x);
      h = mixFloat(h, p.y);
    }
  }
  return h;
}

function layerSig(
  layer: Layer,
  bg: string,
  clipLayer?: Layer,
  cw = 0,
  ch = 0,
  overscan?: { x: number; y: number }
): string {
  const ox = overscan?.x ?? 0;
  const oy = overscan?.y ?? 0;
  const lv = layerVersion(layer);
  const rp = layer.kind === "raster" ? rasterPixelVersion(layer) : 0;
  const clv = clipLayer ? layerVersion(clipLayer) : 0;
  const memo = _layerSigMemo.get(layer);
  if (
    memo &&
    memo.layerVersion === lv &&
    memo.rasterPixelVersion === rp &&
    memo.clipLayerVersion === clv &&
    memo.bg === bg &&
    memo.cw === cw &&
    memo.ch === ch &&
    memo.ox === ox &&
    memo.oy === oy &&
    memo.clipLayer === clipLayer
  ) {
    return memo.sig;
  }

  let h = 2166136261;
  h = mixHash(h, cw);
  h = mixHash(h, ch);
  h = mixFloat(h, ox);
  h = mixFloat(h, oy);
  h = mixString(h, bg);
  h = mixLayerMaskState(h, layer);
  if (clipLayer) {
    h = mixHash(h, 1);
    h = mixLayerMaskState(h, clipLayer);
  } else {
    h = mixHash(h, 0);
  }
  const sig = (h >>> 0).toString(36);
  _layerSigMemo.set(layer, { layerVersion: lv, rasterPixelVersion: rp, clipLayerVersion: clv, bg, cw, ch, ox, oy, clipLayer, sig });
  return sig;
}

/** Fill-mask cache key — includes referenced visible layers when any fill uses visibleStrokes. */
function fillMaskSig(
  layer: Layer,
  bg: string,
  clipLayer: Layer | undefined,
  width: number,
  height: number,
  overscan: { x: number; y: number } | undefined,
  referenceLayers?: Layer[]
): string {
  let sig = layerSig(layer, bg, clipLayer, width, height, overscan);
  if (
    layer.fills.some((f) => (f.referenceMode ?? "activeLayer") === "visibleStrokes") &&
    referenceLayers
  ) {
    for (const ref of referenceLayers) {
      if (ref.visible) {
        sig += "|" + layerSig(ref, bg, undefined, width, height, overscan);
      }
    }
  }
  return sig;
}

function getFillMask(
  layer: Layer,
  layerIndex: number,
  width: number,
  height: number,
  bg: string,
  clipLayer?: Layer,
  overscan?: { x: number; y: number },
  defer = false,
  referenceLayers?: Layer[],
  skipCache = false
): HTMLCanvasElement | null {
  if (layer.fills.length === 0) return null;
  const sig = fillMaskSig(layer, bg, clipLayer, width, height, overscan, referenceLayers);
  const cached = fillMaskCache.get(layer);
  if (!skipCache && cached && cached.sig === sig) return cached.canvas;
  if (defer && cached && !skipCache) {
    _fillMaskWasStale = true;
    scheduleFillMaskRecompute(layer, layerIndex, width, height, bg, sig, clipLayer, overscan, referenceLayers);
    return cached.canvas;
  }
  const canvas = computeFillMask(layer, layerIndex, width, height, bg, clipLayer, overscan, referenceLayers);
  if (!skipCache) fillMaskCache.set(layer, { sig, canvas });
  return canvas;
}

// Reused readback scratch for fill-mask computation — avoids allocating a
// full-size willReadFrequently canvas on every recompute.
let _fillScratch: { off: HTMLCanvasElement; oc: CanvasRenderingContext2D } | null = null;

function getFillScratch(width: number, height: number) {
  if (!_fillScratch) {
    const off = document.createElement("canvas");
    off.width = width;
    off.height = height;
    _fillScratch = { off, oc: off.getContext("2d", { willReadFrequently: true })! };
  } else if (_fillScratch.off.width !== width || _fillScratch.off.height !== height) {
    _fillScratch.off.width = width;
    _fillScratch.off.height = height;
  }
  return _fillScratch;
}

function paintFillBoundary(
  oc: CanvasRenderingContext2D,
  layer: Layer,
  layerIndex: number,
  width: number,
  height: number,
  bg: string,
  clipLayer: Layer | undefined,
  overscan: { x: number; y: number } | undefined,
  referenceLayers: Layer[] | undefined,
  referenceMode: "activeLayer" | "visibleStrokes"
): void {
  const ox = overscan?.x ?? 0;
  const oy = overscan?.y ?? 0;
  oc.setTransform(1, 0, 0, 1, 0, 0);
  oc.globalCompositeOperation = "source-over";
  oc.globalAlpha = 1;
  oc.fillStyle = bg;
  oc.fillRect(0, 0, width, height);

  if (clipLayer) {
    applyClipBoundary(oc, clipLayer, width, height, bg, overscan);
  }

  const budget = { remaining: Infinity };
  if (ox > 0 || oy > 0) oc.translate(ox, oy);
  if (referenceMode === "visibleStrokes" && referenceLayers) {
    referenceLayers.forEach((refLayer, refIndex) => {
      if (!refLayer.visible) return;
      walkLayerStrokes(oc, refLayer.strokes, refIndex, 0, budget, bg, 0);
    });
  } else {
    walkLayerStrokes(oc, layer.strokes, layerIndex, 0, budget, bg, 0);
  }
  if (ox > 0 || oy > 0) oc.setTransform(1, 0, 0, 1, 0, 0);
}

function computeFillMask(
  layer: Layer,
  layerIndex: number,
  width: number,
  height: number,
  bg: string,
  clipLayer?: Layer,
  overscan?: { x: number; y: number },
  referenceLayers?: Layer[]
): HTMLCanvasElement | null {
  const ox = overscan?.x ?? 0;
  const oy = overscan?.y ?? 0;

  const { oc } = getFillScratch(width, height);
  const mask = new ImageData(width, height);
  const md = mask.data;
  let touched = false;

  for (const f of layer.fills) {
    const refMode = f.referenceMode ?? "activeLayer";
    paintFillBoundary(oc, layer, layerIndex, width, height, bg, clipLayer, overscan, referenceLayers, refMode);

    const img = oc.getImageData(0, 0, width, height);
    const gap = f.gapClosePx ?? 0;
    if (gap > 0) closeFillGapsImageData(img, bg, width, height, Math.ceil(gap));
    const before = new Uint8ClampedArray(img.data);
    const filled = floodFillImageData(
      img, f.point.x + ox, f.point.y + oy, f.color, width, height, f.tolerance ?? 0
    );
    if (filled && f.clipShape) {
      applyShapeMaskToImageData(img, f.clipShape, width, height, f.clipInverted ?? false);
    }
    if (!filled) continue;

    const ad = img.data;
    for (let i = 0; i < before.length; i += 4) {
      if (
        before[i] !== ad[i] ||
        before[i + 1] !== ad[i + 1] ||
        before[i + 2] !== ad[i + 2]
      ) {
        md[i] = ad[i];
        md[i + 1] = ad[i + 1];
        md[i + 2] = ad[i + 2];
        md[i + 3] = 255;
        touched = true;
      }
    }
  }
  if (!touched) return null;

  const mc = document.createElement("canvas");
  mc.width = width;
  mc.height = height;
  mc.getContext("2d")!.putImageData(mask, 0, 0);
  // Dilate so fill extends past the un-jittered boundary, preventing white gaps.
  dilateFillMaskCanvas(mc, Math.ceil(WIGGLE_AMPLITUDE));
  return mc;
}

// ----------------------------------------------------------------------------
// Clip-boundary cache. The boundary is computed from the clip base once and
// reused across many fill-mask computations — it survives invalidation of
// the fill mask itself (e.g., when Layer 2 adds a stroke, the fill mask must
// be recomputed but the clip boundary is unchanged).
// ----------------------------------------------------------------------------

// Multi-entry clip boundary cache — a single slot evicted itself whenever two
// clip-to-below layers existed in the same panel. Now holds up to 16 entries.
const _clipBoundaryCache = new Map<string, HTMLCanvasElement>();
const CLIP_BOUNDARY_CACHE_MAX = 16;

function clipBoundarySig(
  clipLayer: Layer,
  width: number,
  height: number,
  bg: string,
  overscan?: { x: number; y: number }
): string {
  return `clip:${layerSig(clipLayer, bg, undefined, width, height, overscan)}`;
}

function getClipBoundaryCanvas(
  clipLayer: Layer,
  width: number,
  height: number,
  bg: string,
  overscan?: { x: number; y: number }
): HTMLCanvasElement {
  const sig = clipBoundarySig(clipLayer, width, height, bg, overscan);
  const cached = _clipBoundaryCache.get(sig);
  if (cached) return cached;

  const ox = overscan?.x ?? 0;
  const oy = overscan?.y ?? 0;

  const flat = document.createElement("canvas");
  flat.width = width;
  flat.height = height;
  const fc = flat.getContext("2d", { willReadFrequently: true })!;
  fc.fillStyle = bg;
  fc.fillRect(0, 0, width, height);
  const budget = { remaining: Infinity };
  if (ox > 0 || oy > 0) fc.translate(ox, oy);
  walkLayerStrokes(fc, clipLayer.strokes, 0, 0, budget, bg, 0);
  if (ox > 0 || oy > 0) fc.setTransform(1, 0, 0, 1, 0, 0);
  const flatImg = fc.getImageData(0, 0, width, height);
  for (const f of clipLayer.fills) {
    floodFillImageData(flatImg, f.point.x + ox, f.point.y + oy, f.color, width, height);
  }

  // Paint sentinel wall outside silhouette
  const fd = flatImg.data;
  const [br, bgg, bb] = hexToRgb(bg);
  const sr = br ^ 0xff, sg = bgg ^ 0xff, sb = bb ^ 0xff;
  for (let i = 0; i < fd.length; i += 4) {
    if (fd[i] === br && fd[i + 1] === bgg && fd[i + 2] === bb) {
      fd[i] = sr; fd[i + 1] = sg; fd[i + 2] = sb; fd[i + 3] = 255;
    }
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")!.putImageData(flatImg, 0, 0);

  if (_clipBoundaryCache.size >= CLIP_BOUNDARY_CACHE_MAX) {
    _clipBoundaryCache.delete(_clipBoundaryCache.keys().next().value!);
  }
  _clipBoundaryCache.set(sig, canvas);
  return canvas;
}

// Paint the clip-base silhouette sentinel wall onto oc so the flood fill
// stays inside the clip region. Uses a cached boundary canvas.
function applyClipBoundary(
  oc: CanvasRenderingContext2D,
  clipLayer: Layer,
  width: number,
  height: number,
  bg: string,
  overscan?: { x: number; y: number }
): void {
  const boundary = getClipBoundaryCanvas(clipLayer, width, height, bg, overscan);
  oc.drawImage(boundary, 0, 0);
}

const DILATE_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [-1, 0], [1, 0], [0, -1], [0, 1],
  [-1, -1], [1, -1], [-1, 1], [1, 1],
];

function closeFillGapsImageData(
  img: ImageData,
  bg: string,
  width: number,
  height: number,
  radius: number
): void {
  if (radius <= 0) return;
  const [br, bgc, bb] = hexToRgb(bg);
  const isBoundary = (d: Uint8ClampedArray, p: number) =>
    d[p + 3] !== 0 && (d[p] !== br || d[p + 1] !== bgc || d[p + 2] !== bb);
  let src = new Uint8ClampedArray(img.data);
  let dst = new Uint8ClampedArray(img.data);
  for (let pass = 0; pass < radius; pass++) {
    dst.set(src);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const p = (y * width + x) * 4;
        if (!isBoundary(src, p)) continue;
        for (const [dx, dy] of DILATE_OFFSETS) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const q = (ny * width + nx) * 4;
          if (isBoundary(src, q)) continue;
          dst[q] = src[p];
          dst[q + 1] = src[p + 1];
          dst[q + 2] = src[p + 2];
          dst[q + 3] = src[p + 3];
        }
      }
    }
    const swap = src;
    src = dst;
    dst = swap;
  }
  img.data.set(src);
}

function dilateFillMaskCanvas(canvas: HTMLCanvasElement, radius: number): void {
  if (radius <= 0) return;
  const w = canvas.width;
  const h = canvas.height;
  const tmp = document.createElement("canvas");
  tmp.width = w;
  tmp.height = h;
  let src = canvas;
  let dst = tmp;
  for (let pass = 0; pass < radius; pass++) {
    const dc = dst.getContext("2d")!;
    dc.clearRect(0, 0, w, h);
    dc.drawImage(src, 0, 0);
    for (const [dx, dy] of DILATE_OFFSETS) {
      dc.drawImage(src, dx, dy);
    }
    const swap = src;
    src = dst;
    dst = swap;
  }
  if (src !== canvas) {
    canvas.getContext("2d")!.drawImage(src, 0, 0);
  }
}

// ----------------------------------------------------------------------------
// Jitter cache: SmoothJitterSamples are re-used across frames when tick hasn't
// changed (tick only advances at wiggleFps, typically 8fps, but renderPanel
// runs at 60fps). Jittered-point arrays are reused per-stroke — allocated once
// per stroke, mutated in-place on each tick change, and keyed by object
// identity via WeakMap (so removed strokes are GC'd automatically).
// ----------------------------------------------------------------------------

let _jitterSampleTick = -1;
const _jitterSampleCache = new Map<number, SmoothJitterSamples>();

type JitterEntry = { tick: number; seed: number; arr: Vec2[] };
const _jitterPointCache = new WeakMap<Stroke, JitterEntry>();

function getCachedSamples(tick: number, strokeSeed: number): SmoothJitterSamples {
  if (tick !== _jitterSampleTick) {
    _jitterSampleCache.clear();
    _jitterSampleTick = tick;
  }
  let s = _jitterSampleCache.get(strokeSeed);
  if (!s) {
    s = smoothJitterSamples(tick, strokeSeed);
    _jitterSampleCache.set(strokeSeed, s);
  }
  return s;
}

function getJitteredPoints(stroke: Stroke, strokeSeed: number, tick: number, amplitude: number): Vec2[] {
  const pts = stroke.points;
  const cached = _jitterPointCache.get(stroke);
  // Cache hit: same tick, same seed (guards against a shared Stroke object on
  // two layers with different layerIndex seeds), and no new points appended.
  if (cached && cached.tick === tick && cached.seed === strokeSeed && cached.arr.length === pts.length) {
    return cached.arr;
  }
  // Reuse the array allocation when only the tick changed (length is stable)
  const arr: Vec2[] = (cached && cached.arr.length === pts.length)
    ? cached.arr
    : pts.map(p => ({ x: p.x, y: p.y }));
  const samples = pts.length > 1 ? getCachedSamples(tick, strokeSeed) : null;
  for (let pi = 0; pi < pts.length; pi++) {
    const j = samples
      ? smoothJitterFromSamples(samples, pi, amplitude, pts.length)
      : jitter(tick, strokeSeed, pi, amplitude);
    arr[pi].x = pts[pi].x + j.dx;
    arr[pi].y = pts[pi].y + j.dy;
  }
  _jitterPointCache.set(stroke, { tick, seed: strokeSeed, arr });
  return arr;
}

// ----------------------------------------------------------------------------
// Shared stroke walker. amplitude=0 disables jitter for the fill-mask path.
// ----------------------------------------------------------------------------

function walkLayerStrokes(
  ctx: CanvasRenderingContext2D,
  strokes: Stroke[],
  layerIndex: number,
  tick: number,
  budget: StrokeBudget,
  bg: string,
  amplitude: number,
  strokeIndexOffset = 0
): boolean[] {
  const drawn = new Array<boolean>(strokes.length).fill(false);
  const layerSeed = layerIndex * 10000;
  let skip = budget.skip ?? 0;

  for (let si = 0; si < strokes.length; si++) {
    if (budget.remaining <= 0 && skip <= 0) break;
    const stroke = strokes[si];
    const brush = brushByKey(stroke.brush);
    const pts = stroke.points;
    if (pts.length === 0) { drawn[si] = true; continue; }

    const isErase = brush.erase === true;
    if (isErase) {
      ctx.save();
      ctx.globalCompositeOperation = "destination-out";
    }

    const effectiveStrokeIndex = strokeIndexOffset + si;
    const strokeSeed = effectiveStrokeIndex + layerSeed;
    const jittered = amplitude === 0 ? pts : getJitteredPoints(stroke, strokeSeed, tick, amplitude);
    const stampTick = amplitude === 0 ? strokeSeed : tick;
    const effectiveSettings = effectiveBrushSettings(brush.spacing, stroke.size, stroke.brushSettings);
    const spacing = effectiveSettings.spacing;

    const pressures = stroke.pressures;
    const pAt = (i: number) => pressures?.[i] ?? 1;

    if (jittered.length === 1) {
      const pointLen = 1;
      if (skip >= pointLen) {
        skip -= pointLen;
        budget.skip = skip;
      } else if (budget.remaining > 0) {
        brush.stamp({
          ctx, pos: jittered[0], delta: { x: 1, y: 0 },
          color: stroke.color, size: effectiveSettings.stampSize(stroke.size, pAt(0)), tick: stampTick,
          seed: strokeSeed, bg,
          pressure: pAt(0), flow: effectiveSettings.stampFlow(pAt(0)), dist: 0,
        });
        budget.remaining -= pointLen;
        drawn[si] = true;
      }
      if (isErase) ctx.restore();
      continue;
    }

    let carry = 0;
    let strokeComplete = true;
    let walked = 0; // accumulated distance along the jittered stroke
    for (let k = 0; k < jittered.length - 1; k++) {
      const a = jittered[k], b = jittered[k + 1];
      const dx = b.x - a.x, dy = b.y - a.y;
      const segLen = Math.hypot(dx, dy) || 0.0001;
      const ux = dx / segLen, uy = dy / segLen;
      const delta = { x: dx, y: dy };
      const pA = pAt(k), pB = pAt(k + 1);

      if (skip > 0) {
        if (skip >= segLen) {
          skip -= segLen;
          budget.skip = skip;
          let dist = -carry;
          while (dist < segLen) {
            dist += spacing;
          }
          carry = dist - segLen;
          walked += segLen; // keep BrushContext.dist stable across skipped segments
          continue;
        }
      }

      const segSkip = skip > 0 ? skip : 0;
      if (segSkip > 0) {
        skip = 0;
        budget.skip = 0;
      }

      const drawable = segLen - segSkip;
      const cap = Math.min(drawable, budget.remaining);
      let dist = -carry;
      while (dist < cap) {
        if (dist >= 0) {
          const along = segSkip + dist;
          const t = along / segLen;
          const p = pA + (pB - pA) * t;
          brush.stamp({
            ctx,
            pos: { x: a.x + ux * along, y: a.y + uy * along },
            delta,
            color: stroke.color,
            size: effectiveSettings.stampSize(stroke.size, p),
            tick: stampTick,
            seed: strokeSeed * 100 + k,
            bg,
            pressure: p,
            flow: effectiveSettings.stampFlow(p),
            dist: walked + along,
          });
        }
        dist += spacing;
      }
      budget.remaining -= cap;
      if (cap < drawable) { strokeComplete = false; break; }
      carry = dist - drawable;
      walked += segLen;
    }
    if (strokeComplete) drawn[si] = true;
    if (isErase) ctx.restore();
    if (budget.remaining <= 0 && skip <= 0) break;
  }
  return drawn;
}

/** Bake one raw vector stroke into a raster layer's pixel canvas. The zero
 * amplitude keeps stored points untouched and pins brush variation to the
 * stroke index, so raster edits do not depend on the wiggle clock. */
export function stampStrokeToCanvas(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  layerIndex: number,
  strokeIndex: number,
  bg: string
): void {
  walkLayerStrokes(
    ctx,
    [stroke],
    layerIndex,
    0,
    { remaining: Infinity },
    bg,
    0,
    strokeIndex
  );
}

export function computeStrokeLength(stroke: Stroke): number {
  const pts = stroke.points;
  if (pts.length <= 1) return pts.length === 1 ? 1 : 0;
  let total = 0;
  for (let k = 0; k < pts.length - 1; k++) {
    total += Math.hypot(pts[k + 1].x - pts[k].x, pts[k + 1].y - pts[k].y);
  }
  return total;
}

const _lengthMemo = new WeakMap<Layer, { v: number; len: number }>();

export function computeLayerStrokeLength(layer: Layer): number {
  const v = layerVersion(layer);
  const memo = _lengthMemo.get(layer);
  if (memo && memo.v === v) return memo.len;
  let total = 0;
  for (const stroke of layer.strokes) {
    total += computeStrokeLength(stroke);
  }
  _lengthMemo.set(layer, { v, len: total });
  return total;
}

export function allocateTimelapseLayerBudgets(layers: Layer[], progress: number): number[] {
  const p = Math.max(0, Math.min(1, progress));
  const lengths = layers.map((layer) => layer.visible ? computeLayerStrokeLength(layer) : 0);
  const total = lengths.reduce((sum, length) => sum + length, 0);
  let remaining = p * total;
  const budgets = layers.map(() => 0);

  for (let li = layers.length - 1; li >= 0; li--) {
    if (remaining <= 0) break;
    const amount = Math.min(lengths[li], remaining);
    budgets[li] = amount;
    remaining -= amount;
  }

  return budgets;
}

export function computeTotalLength(panel: Panel): number {
  return panel.layers.reduce(
    (total, layer) => total + (layer.visible ? computeLayerStrokeLength(layer) : 0),
    0
  );
}

export function panelAtTime(panels: Panel[], elapsedMs: number) {
  const total = panels.reduce((s, p) => s + p.durationMs, 0) || 1;
  let t = elapsedMs % total;
  for (let i = 0; i < panels.length; i++) {
    if (t < panels[i].durationMs) return { index: i, localMs: t };
    t -= panels[i].durationMs;
  }
  return { index: panels.length - 1, localMs: 0 };
}
