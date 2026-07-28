// ============================================================================
// core/renderSchedule.ts — tiny policies for editor render cadence.
//
// The renderer itself stays pure and deterministic; this module only decides
// whether the editor shell needs to call it for idle canvas frames and timeline
// thumbnails.
// ============================================================================

import type { AnimationSpec, Layer, Panel, SubPanel } from "./types";

export type IdleRenderState = {
  tickChanged: boolean;
  interacting: boolean;
};

export function shouldRenderIdleFrame(state: IdleRenderState): boolean {
  return state.tickChanged || state.interacting;
}

export type DiscreteClockAdvance = {
  tick: number;
  lastMs: number;
  changed: boolean;
};

/** Advance a quantized clock from elapsed wall time, catching up across
 * throttled or delayed redraws without rendering the skipped ticks. */
export function advanceDiscreteClock(
  tick: number,
  lastMs: number,
  nowMs: number,
  fps: number
): DiscreteClockAdvance {
  const safeFps = Number.isFinite(fps) && fps > 0 ? fps : 8;
  const intervalMs = 1000 / safeFps;
  if (!Number.isFinite(nowMs)) return { tick, lastMs, changed: false };
  if (!Number.isFinite(lastMs) || nowMs < lastMs) {
    return { tick, lastMs: nowMs, changed: false };
  }
  const elapsedTicks = Math.floor((nowMs - lastMs) / intervalMs);
  if (elapsedTicks < 1) return { tick, lastMs, changed: false };
  return {
    tick: tick + elapsedTicks,
    lastMs: lastMs + elapsedTicks * intervalMs,
    changed: true,
  };
}

export const ONION_PREV_TINT = "#73eff7";
export const ONION_NEXT_TINT = "#ff8f5a";

export type EditorPreviewPass =
  | { kind: "onion-prev"; offset: number; alpha: number; tint: string }
  | { kind: "onion-next"; offset: number; alpha: number; tint: string }
  | { kind: "active"; offset: 0; alpha: 1 };

export type EditorPreviewPassState = {
  onionEnabled: boolean;
  prevAvailable: number;
  nextAvailable: number;
  prevCount: number;
  nextCount: number;
  opacity: number;
};

export function editorPreviewPasses(state: EditorPreviewPassState): EditorPreviewPass[] {
  const passes: EditorPreviewPass[] = [];
  if (state.onionEnabled) {
    const opacity = Math.max(0, Math.min(1, state.opacity));
    const prev = Math.min(clampOnionCount(state.prevCount), Math.max(0, state.prevAvailable));
    const next = Math.min(clampOnionCount(state.nextCount), Math.max(0, state.nextAvailable));
    for (let distance = prev; distance >= 1; distance--) {
      passes.push({
        kind: "onion-prev",
        offset: -distance,
        alpha: roundAlpha(opacity / distance),
        tint: ONION_PREV_TINT,
      });
    }
    for (let distance = next; distance >= 1; distance--) {
      passes.push({
        kind: "onion-next",
        offset: distance,
        alpha: roundAlpha(opacity / distance),
        tint: ONION_NEXT_TINT,
      });
    }
  }
  passes.push({ kind: "active", offset: 0, alpha: 1 });
  return passes;
}

export function playbackPreviewPasses(): EditorPreviewPass[] {
  return [{ kind: "active", offset: 0, alpha: 1 }];
}

function clampOnionCount(count: number): number {
  return Math.max(0, Math.min(3, Math.round(count) || 0));
}

function roundAlpha(alpha: number): number {
  return Math.round(alpha * 1000) / 1000;
}

export function shouldRefreshThumbnail(panelId: string, dirtyPanelIds: ReadonlySet<string>): boolean {
  return dirtyPanelIds.has(panelId);
}

export type BaseFrameCacheState = {
  panelId: string;
  contentVersion: number;
  tick: number;
  width: number;
  height: number;
  overscanX: number;
  overscanY: number;
  jitterEnabled: boolean;
  keyframeArm: string | null;
};

export function baseFrameCacheKey(state: BaseFrameCacheState): string {
  return [
    state.panelId,
    state.contentVersion,
    state.tick,
    state.width,
    state.height,
    state.overscanX,
    state.overscanY,
    state.jitterEnabled ? 1 : 0,
    state.keyframeArm ?? "",
  ].join(":");
}

export type RawLayerCacheState = {
  layerSig: string;
  layerIndex: number;
  tick: number;
  width: number;
  height: number;
  skipFills: boolean;
  skipJitter: boolean;
  localMs: number;
  containerDurMs: number;
  wiggleFps: number;
  skipAnim: boolean;
};

function hasAnimSpec(spec?: AnimationSpec): boolean {
  return !!spec && spec.kind !== "none";
}

/** True when drawLayerRaw output depends on localMs (animated texts). */
export function layerDependsOnLocalMs(layer: Layer, skipAnim: boolean): boolean {
  if (skipAnim) return false;
  return (layer.texts ?? []).some((t) => t.enter || t.exit);
}

export function canonicalRawLayerLocalMs(
  layer: Layer,
  skipAnim: boolean,
  localMs: number
): number {
  return layerDependsOnLocalMs(layer, skipAnim) ? localMs : 0;
}

export function canonicalRawLayerContainerDurMs(
  layer: Layer,
  skipAnim: boolean,
  containerDurMs: number
): number {
  return layerDependsOnLocalMs(layer, skipAnim) ? containerDurMs : 0;
}

/** Wiggle-quantized timelapse progress — matches seqTick cadence for consistent playback. */
export function timelapseProgressQuantized(
  localMs: number,
  durationMs: number,
  wiggleFps: number
): number {
  if (durationMs <= 0) return 1;
  const tick = Math.floor((localMs / 1000) * wiggleFps);
  const totalTicks = Math.max(1, Math.ceil((durationMs / 1000) * wiggleFps));
  const denom = Math.max(1, totalTicks - 1);
  return Math.min(1, tick / denom);
}

export function rawLayerCacheKey(state: RawLayerCacheState): string {
  return [
    state.layerSig,
    state.layerIndex,
    state.tick,
    state.width,
    state.height,
    state.skipFills ? 1 : 0,
    state.skipJitter ? 1 : 0,
    Math.round(state.localMs * 1000),
    Math.round(state.containerDurMs * 1000),
    state.wiggleFps,
    state.skipAnim ? 1 : 0,
  ].join(":");
}

function layerHasPlaybackContinuity(layer: Layer): boolean {
  if (layer.fadeIn || layer.fadeOut) return true;
  if (layer.animation?.enabled) return true;
  return (layer.texts ?? []).some(
    (t) => hasAnimSpec(t.enter) || hasAnimSpec(t.exit)
  );
}

/** Panel visuals change every playback frame (not just on wiggle ticks). */
export function panelHasPlaybackContinuity(panel: Panel): boolean {
  // Drawing reveal is wiggle-quantized, but an editable camera track glides at
  // display/export frame rate between distinct keyframes.
  if ((panel.timelapse?.camera?.length ?? 0) > 1) return true;
  if (hasAnimSpec(panel.enter) || hasAnimSpec(panel.exit)) return true;
  for (const layer of panel.layers) {
    if (layerHasPlaybackContinuity(layer)) return true;
  }
  const visit = (sp: SubPanel) => {
    if (hasAnimSpec(sp.enter) || hasAnimSpec(sp.exit)) return true;
    if (sp.animation?.enabled) return true;
    for (const layer of sp.layers) {
      if (layerHasPlaybackContinuity(layer)) return true;
    }
    for (const child of sp.subPanels ?? []) {
      if (visit(child)) return true;
    }
    return false;
  };
  for (const sp of panel.subPanels ?? []) {
    if (visit(sp)) return true;
  }
  return false;
}

export type PlaybackRenderState = {
  panelIndex: number;
  seqTick: number;
  lastPanelIndex: number;
  lastSeqTick: number;
  continuous: boolean;
};

export function shouldRenderPlaybackFrame(state: PlaybackRenderState): boolean {
  if (state.continuous) return true;
  return state.panelIndex !== state.lastPanelIndex || state.seqTick !== state.lastSeqTick;
}
