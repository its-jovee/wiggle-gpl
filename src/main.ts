// ============================================================================
// main.ts — app shell. Wires together drawing input, the three independent
// clocks (display / wiggle / sequence), the panel timeline, layers, tools
// (brush / bucket / text / sub-panel), inspectors, animations, undo/redo,
// save/load, and export.
// ============================================================================

import {
  Project, Stroke, Panel, Layer, Fill, SubPanel, TextElement, Vec2, SelectionShape,
  AnimationSpec, AnimationKind, SubPanelShape, LayerAnimation,
  EasingKind, LayerLoopKind, LayerAnimTransform, FrameGroup, BrushPreset,
  PerspectiveGuide, PerspectiveGuideKind, LayerBlendMode, BrushSettings,
  newProject as createProject, newPanel, newLayer, newSubPanel, newPerspectiveGuide, migrateProject,
} from "./core/types";
import {
  activeRegionContains, activeRegionShape, applyTransformToSnapshot, boundsFromItems, computeTransformFromHandle,
  ellipseFromDrag, growSelectionShape, hitTestTransformHandle, isObjectSelectionIdle, ItemSnapshot,
  MarqueeRef, MarqueeToolKind, moveMarqueeItems, pointInRegionSelection, Rect, rectCenter, rectFromDrag,
  restoreFromSnapshot, SelectionState, segmentShapeIntersections, shapeBounds, shapeMeetsMinSize,
  simplifyLassoPath, snapshotItems, splitStrokeAtShape, traceShapePath, translateShape,
  TransformHandleId, transformCursorForHandle, transformHandleVisualHalfSize, transformRotateHandleCenter,
} from "./core/selection";
import {
  clearRenderCache, clearTimelapseCache, createRenderCache, renderCacheStats, renderPanel, renderStroke,
  resetRenderCacheStats, computeTotalLength, trimFramePool, setAsyncRenderInvalidate,
} from "./core/render";
import {
  baseFrameCacheKey, editorPreviewPasses, panelHasPlaybackContinuity, shouldRefreshThumbnail,
  shouldRenderIdleFrame, shouldRenderPlaybackFrame, timelapseProgressQuantized,
} from "./core/renderSchedule";
import { StudioIcons, type IconNode } from "./icons/studio";
import { BRUSHES, brushByKey } from "./brushes/registry";
import { BUILTIN_PALETTES, loadLospecPalette, Palette } from "./core/palette";
import { exportWebM, exportMP4, downloadBlob } from "./core/export";
import { exportProgressStatus } from "./core/exportProgress";
import {
  AudioAsset, AudioClip, AudioTrack, ensureAudioProject,
  newAudioAsset, newAudioClip, newAudioTrack,
} from "./core/audioTypes";
import {
  findAsset, findClipTrack, moveClip, splitClip, totalAudioDuration,
  trimClipEnd, trimClipStart,
} from "./core/audioTimeline";
import {
  addPanelToGroup, applySanitizedGroups, createFrameGroup, expandedDurationMs,
  findGroupForPanel, formatSequenceCounter, groupAtPanelIndex,
  groupsForProject, moveGroup, movePanelBlock, onPanelDeleted, onPanelDuplicated,
  sequenceAtTime, setGroupRepeat, syncGroupPanelIds, ungroup,
  type SequencePosition,
} from "./core/sequence";
import { AudioPreview } from "./core/audioPreview";
import { audioBridge } from "./core/electronAudio";
import { audioDurationMs, drawWaveform, waveformPeaks } from "./core/waveform";
import { FONT_OPTIONS, DEFAULT_FONT } from "./core/fonts";
import { hashId, isInsideBounds, shapePoints, pointsToPath, strokeBorder } from "./core/subpanel";
import { easeProgress } from "./core/anim";
import { timelineScrollAfterRebuild } from "./core/timelineScroll";
import { backfillSyntheticStartupPressures, readPointerPressure, simplifyStroke } from "./core/input";
import { bumpLayerVersion } from "./core/layerVersion";
import { canMergeLayerDown, clearLayerContents, duplicateLayer, mergeLayerDown } from "./core/layerOps";
import {
  deleteMask as deleteMaskState,
  invertMask as invertMaskState,
  layerMaskBadge,
  setMaskEnabled as setMaskEnabledState,
  setMaskOverlayLayer,
} from "./core/maskControls";
import {
  applyTransform, clampScale, EDITOR_OVERSCAN, overscanPx, screenToCanvas,
  ViewportState, zoomAboutPoint,
} from "./core/viewport";
import {
  canUseFileSystemAccess, clearRecoverySnapshot, openProjectFromPicker,
  persistenceState, projectHash, readFallbackFile, readRecents,
  readRecoverySnapshot, recoverProject, resetCurrentFile, saveAsProject,
  saveProject as persistSaveProject, writeHandle, writeRecoverySnapshot,
} from "./core/persistence";
import {
  CANVAS_PRESETS, canvasPresetByKey, defaultCanvasPreset, formatCanvasDimensions,
} from "./core/canvasPresets";
import * as history from "./core/history";
import { drawBrushPreview } from "./brushes/preview";
import { drawEraserTracePreview, isErasePreviewBrush } from "./core/eraserPreview";
import {
  BRUSH_TOOLS, BrushToolKey, brushesForTool, brushToolForKey, defaultBrushForTool,
} from "./brushes/groups";
import { DEFAULT_BRUSH_SETTINGS, normalizeBrushSettings } from "./core/brushSettings";
import {
  appendStrokeSmoothingSample, createStrokeSmoothingSession,
  finishStrokeSmoothingSession, normalizeStrokeSmoothingSettings,
  type StrokeSmoothingSample, type StrokeSmoothingSession,
} from "./core/strokeSmoothing";
import {
  applyBrushPreset, brushPresetFromState, deleteBrushPreset, upsertBrushPreset,
} from "./core/brushPresets";
import {
  adjustPanelExposureTicks, durationMsToExposureTicks, setPanelExposureTicks,
} from "./core/frameTiming";
import {
  clonePanelForDuplicate, copyPanelContents, createBlankPanelFrom, pastePanelContents,
  regenerateSubPanelIds,
  type PanelContentsClipboard,
} from "./core/panelOps";

const BUCKET_KEY = "__bucket__";
const TEXT_KEY = "__text__";
const SUBPANEL_KEY = "__subpanel__";
const SELECT_KEY = "__select__";
const MARQUEE_KEY = "__marquee__";
const MOVE_LAYER_KEY = "__move_layer__";
const PERSPECTIVE_KEY = "__perspective__";
const SCALE_KEY = "__scale__";
const TOOL_KEYS = new Set([BUCKET_KEY, TEXT_KEY, SUBPANEL_KEY, SELECT_KEY, MARQUEE_KEY, MOVE_LAYER_KEY, PERSPECTIVE_KEY, SCALE_KEY]);

type TextRef = { layer: Layer; text: TextElement };

let project: Project = createProject();
let activePanelIndex = 0;
let rangeAnchorIndex: number | null = null;
let rangeEndIndex: number | null = null;
let lastSequencePosition: SequencePosition | null = null;
let activeSubPanelId: string | null = null;       // null = panel root
let selectedSubPanelId: string | null = null;     // for inspector
let selectedText: TextRef | null = null;
let selectionState: SelectionState | null = null;
let marqueeToolKind: MarqueeToolKind = "rect";
let transformSnapshots: ItemSnapshot[] | null = null;
let pendingRegionTransform: {
  pointerId: number;
  handle: TransformHandleId;
  startPos: Vec2;
} | null = null;
let lastCanvasPointerPos: Vec2 | null = null;
let antsOffset = 0;

type ScaleToolDragState = {
  items: MarqueeRef[];
  bounds: Rect;
  snapshots: ItemSnapshot[];
  handle: TransformHandleId;
  pivot: Vec2;
  startBounds: Rect;
  startAngle: number;
};
let scaleToolDrag: ScaleToolDragState | null = null;

let currentBrush = BRUSHES[0].key;
let currentColor = BUILTIN_PALETTES[0].colors[5];
let currentSize = 2;
let currentBrushSettings: BrushSettings = { ...DEFAULT_BRUSH_SETTINGS };
let activeBrushPresetId: string | null = null;
let closeBrushPicker: (() => void) | null = null;
const lastBrushByTool: Partial<Record<BrushToolKey, string>> = {};
let currentPalette: Palette = BUILTIN_PALETTES[0];
let currentFont = DEFAULT_FONT.family;
let currentFontSize = 64;
let currentTextWiggle = 1.5;
let currentFillTolerance = 0;
let currentFillGapClosePx = 0;
let currentFillReferenceMode: Fill["referenceMode"] = "activeLayer";
let pressureEnabled = true;
let jitterEnabled = true;
let layerClipboard: Layer | null = null;
let animationClipboard: LayerAnimation | null = null;
let selectionClipboard: { strokes: Stroke[]; fills: Fill[]; texts: TextElement[] } | null = null;
let maskOverlayLayerId: string | null = null;

// Dirty flag: set by commitHistory(), cleared on save. Replaces the expensive
// projectHash() call that was running every 500ms via updateFileChrome().
let _isDirty = false;
let _autosaveInFlight = false;
let _recoveryClean = false; // set after recovery write, cleared on any edit
const dirtyThumbnailPanelIds = new Set<string>();

function markDirty() { _isDirty = true; _recoveryClean = false; updateFileChrome(); }
function markClean() { _isDirty = false; updateFileChrome(); }
let keyframeArm: "from" | "to" | null = null;
let animHintShown = false;

const CANVAS_HINT_KEY = "wigglestudio-canvas-hint-dismissed";
const CMDK_HINT_KEY = "wigglestudio-cmdk-hint-shown";
let exportCancelled = false;

/**
 * Read pen pressure from a PointerEvent. Mouse input stays full-size, while pen
 * input keeps real positive pressure and only patches missing/zero startup
 * contact samples.
 */
function pressureForNewStroke(e: PointerEvent): number {
  const sample = readPointerPressure(e, pressureEnabled);
  liveStrokeHasRealPressure = sample.real;
  return sample.pressure;
}

function pressureForLiveStroke(e: PointerEvent): number {
  const sample = readPointerPressure(e, pressureEnabled);
  if (sample.real) {
    if (!liveStrokeHasRealPressure && liveStroke?.pressures) {
      backfillSyntheticStartupPressures(liveStroke.pressures, sample.pressure);
    }
    liveStrokeHasRealPressure = true;
  }
  return sample.pressure;
}

function updateBrushSettingsControls() {
  currentBrushSettings = normalizeBrushSettings(currentBrushSettings);
  const spacing = $("brush-spacing") as HTMLInputElement;
  const spacingVal = $("brush-spacing-val");
  const flow = $("brush-flow") as HTMLInputElement;
  const flowVal = $("brush-flow-val");
  const pressureSize = $("brush-pressure-size") as HTMLInputElement;
  const pressureFlow = $("brush-pressure-flow") as HTMLInputElement;
  spacing.value = String(currentBrushSettings.spacingScale);
  spacingVal.textContent = `${currentBrushSettings.spacingScale.toFixed(1)}x`;
  flow.value = String(currentBrushSettings.flow);
  flowVal.textContent = `${Math.round(currentBrushSettings.flow * 100)}%`;
  pressureSize.checked = currentBrushSettings.pressureSize;
  pressureFlow.checked = currentBrushSettings.pressureFlow;
}

function updateSmoothingControls() {
  project.drawingSettings.smoothing = normalizeStrokeSmoothingSettings(project.drawingSettings.smoothing);
  const smoothing = project.drawingSettings.smoothing;
  const mode = $("stroke-smoothing-mode") as HTMLSelectElement;
  const distance = $("stroke-smoothing-distance") as HTMLInputElement;
  const distanceVal = $("stroke-smoothing-distance-val");
  const delay = $("stroke-smoothing-delay") as HTMLInputElement;
  const delayVal = $("stroke-smoothing-delay-val");
  const finish = $("stroke-smoothing-finish") as HTMLInputElement;
  const pressure = $("stroke-smoothing-pressure") as HTMLInputElement;
  const delayRow = $("stroke-smoothing-delay-row") as HTMLElement;
  mode.value = smoothing.mode;
  distance.value = String(smoothing.distance);
  distanceVal.textContent = `${Math.round(smoothing.distance)}px`;
  delay.value = String(smoothing.delayDistance);
  delayVal.textContent = `${Math.round(smoothing.delayDistance)}px`;
  finish.checked = smoothing.finishStabilizedStroke;
  pressure.checked = smoothing.smoothPressure;
  delayRow.hidden = smoothing.mode !== "stabilizer";
  delay.hidden = smoothing.mode !== "stabilizer";
  delay.disabled = smoothing.mode !== "stabilizer";
  finish.disabled = smoothing.mode !== "stabilizer";
}

function setStrokeSmoothingSettings(update: Partial<Project["drawingSettings"]["smoothing"]>) {
  project.drawingSettings.smoothing = normalizeStrokeSmoothingSettings({
    ...project.drawingSettings.smoothing,
    ...update,
  });
  markDirty();
  updateSmoothingControls();
}

function updateBrushSizeControl() {
  const size = $("size") as HTMLInputElement | null;
  if (size) size.value = String(currentSize);
}

function activeBrushPreset(): BrushPreset | null {
  return project.brushPresets.find((p) => p.id === activeBrushPresetId) ?? null;
}

function applyBrushPresetById(id: string) {
  const preset = project.brushPresets.find((p) => p.id === id);
  if (!preset) return;
  const applied = applyBrushPreset(preset);
  currentBrush = brushByKey(applied.brush).key;
  currentSize = applied.size;
  currentBrushSettings = { ...applied.settings };
  activeBrushPresetId = preset.id;
  updateBrushSizeControl();
  updateBrushSettingsControls();
  buildBrushBar();
  buildBrushPresetControls();
  setStatus(`preset ${preset.name}`);
}

function saveCurrentBrushPreset() {
  const name = window.prompt("Preset name", brushByKey(currentBrush).label);
  if (!name) return;
  const preset = brushPresetFromState(crypto.randomUUID(), name, {
    brush: currentBrush,
    size: currentSize,
    settings: currentBrushSettings,
  });
  project.brushPresets = upsertBrushPreset(project.brushPresets, preset);
  activeBrushPresetId = preset.id;
  commitHistory([]);
  buildBrushPresetControls();
  setStatus(`saved preset ${preset.name}`);
}

function updateActiveBrushPreset() {
  const existing = activeBrushPreset();
  if (!existing) return;
  const preset = brushPresetFromState(existing.id, existing.name, {
    brush: currentBrush,
    size: currentSize,
    settings: currentBrushSettings,
  });
  project.brushPresets = upsertBrushPreset(project.brushPresets, preset);
  commitHistory([]);
  buildBrushPresetControls();
  setStatus(`updated preset ${preset.name}`);
}

function renameActiveBrushPreset() {
  const existing = activeBrushPreset();
  if (!existing) return;
  const name = window.prompt("Preset name", existing.name);
  if (!name) return;
  project.brushPresets = upsertBrushPreset(project.brushPresets, { ...existing, name });
  commitHistory([]);
  buildBrushPresetControls();
  setStatus(`renamed preset ${name.trim()}`);
}

function deleteActiveBrushPreset() {
  const existing = activeBrushPreset();
  if (!existing) return;
  if (!window.confirm(`Delete preset "${existing.name}"?`)) return;
  project.brushPresets = deleteBrushPreset(project.brushPresets, existing.id);
  activeBrushPresetId = null;
  commitHistory([]);
  buildBrushPresetControls();
  setStatus("deleted preset");
}

let playing = false;
let playStart = 0;
let playheadStartMs = 0;
let playheadMs = 0;
let lastPlaybackMs = 0;
let loopPlayback = true;
let onionEnabled = false;
let onionPrevCount = 1;
let onionNextCount = 0;
let onionOpacity = 0.25;
let panelContentClipboard: PanelContentsClipboard | null = null;
const recentSlugs: string[] = [];
const audioPreview = new AudioPreview();
let selectedAudioClipId: string | null = null;
let mediaRecorder: MediaRecorder | null = null;
let recordingChunks: Blob[] = [];
let recordingStartMs = 0;
let recordingStartedAt = 0;
let recordingStream: MediaStream | null = null;
let selectedInputDeviceId = "";

const ANIM_KINDS: AnimationKind[] = ["none", "pop", "fade", "jump", "squeeze"];
const SHAPES: SubPanelShape[] = ["rect", "rounded", "balloon", "thought", "burst"];
const EASINGS: EasingKind[] = ["linear", "easeIn", "easeOut", "easeInOut"];
const LAYER_LOOPS: LayerLoopKind[] = ["none", "repeat", "pingpong"];
const LAYER_BLEND_MODES: LayerBlendMode[] = [
  "normal",
  "multiply",
  "screen",
  "overlay",
  "darken",
  "lighten",
  "color-dodge",
  "color-burn",
  "hard-light",
  "soft-light",
  "difference",
];

const $ = (id: string) => document.getElementById(id)!;
const canvas = $("stage") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const stageArea = $("stage-area") as HTMLElement;
const loadProjectFile = $("load-project-file") as HTMLInputElement;

let overscanX = 0;
let overscanY = 0;
let renderContentVersion = 0;
let baseFrameCache: { key: string; canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null = null;
const displayRenderCache = createRenderCache(64);
const perfEnabled = new URLSearchParams(location.search).has("perf");
const perfProjectUrl = new URLSearchParams(location.search).get("project");

type PerfBucket = { count: number; totalMs: number; maxMs: number };
type PerfReport = {
  frames: number;
  wiggleTicks: number;
  buckets: Record<string, PerfBucket & { avgMs: number }>;
  cache: ReturnType<typeof renderCacheStats>;
};

const perfState = {
  frames: 0,
  wiggleTicks: 0,
  buckets: {} as Record<string, PerfBucket>,
};

function resetPerfState() {
  perfState.frames = 0;
  perfState.wiggleTicks = 0;
  perfState.buckets = {};
  resetRenderCacheStats(displayRenderCache);
}

function perfReport(): PerfReport {
  const buckets: Record<string, PerfBucket & { avgMs: number }> = {};
  for (const [key, bucket] of Object.entries(perfState.buckets)) {
    buckets[key] = {
      ...bucket,
      avgMs: bucket.count ? bucket.totalMs / bucket.count : 0,
    };
  }
  return {
    frames: perfState.frames,
    wiggleTicks: perfState.wiggleTicks,
    buckets,
    cache: renderCacheStats(displayRenderCache),
  };
}

function profileRender(label: string, fn: () => void) {
  if (!perfEnabled) {
    fn();
    return;
  }
  const start = performance.now();
  fn();
  const elapsed = performance.now() - start;
  const bucket = perfState.buckets[label] ?? { count: 0, totalMs: 0, maxMs: 0 };
  bucket.count++;
  bucket.totalMs += elapsed;
  bucket.maxMs = Math.max(bucket.maxMs, elapsed);
  perfState.buckets[label] = bucket;
}

function syncPerfReport() {
  if (!perfEnabled) return;
  document.documentElement.dataset.wigglePerf = JSON.stringify(perfReport());
}

function normalizePerfProjectUrl(raw: string): string {
  if (/^https?:\/\//.test(raw) || raw.startsWith("/@fs/")) return raw;
  if (raw.startsWith("/Users/") || raw.startsWith("/private/")) return `/@fs${raw}`;
  return raw.startsWith("/") ? raw : `/${raw}`;
}

async function loadPerfProjectFromParam() {
  if (!perfEnabled || !perfProjectUrl) return;
  try {
    const url = normalizePerfProjectUrl(perfProjectUrl);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const next = migrateProject(await res.json());
    resetCurrentFile(next);
    resetProjectSession(next, `perf fixture loaded: ${perfProjectUrl}`);
    resetPerfState();
    syncPerfReport();
  } catch (err) {
    setStatus("perf fixture load failed: " + (err as Error).message);
  }
}

if (perfEnabled) {
  window.setInterval(syncPerfReport, 500);
}

function syncCanvasAspect() {
  document.documentElement.style.setProperty("--canvas-aspect", `${project.width} / ${project.height}`);
}

function updateExportMenuLabels() {
  const dims = formatCanvasDimensions(project.width, project.height);
  $("export-webm-dims").textContent = `${dims} · .webm`;
  $("export-mp4-dims").textContent = `${dims} · .mp4`;
}

function resizeCanvasForProject() {
  const { x: ox, y: oy } = overscanPx(project.width, project.height);
  overscanX = ox;
  overscanY = oy;
  canvas.width = project.width + 2 * ox;
  canvas.height = project.height + 2 * oy;
  syncCanvasAspect();
  invalidateBaseFrameCache();
}

resizeCanvasForProject();

function svgIcon(node: IconNode, size = 15): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  for (const [tag, attrs] of node) {
    const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v !== undefined) el.setAttribute(k, String(v));
    }
    svg.appendChild(el);
  }
  return svg;
}

function iconButton(
  node: IconNode,
  title: string,
  onClick: (e: MouseEvent) => void,
  className = "cellbtn iconbtn"
): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = className;
  btn.title = title;
  btn.setAttribute("aria-label", title);
  btn.appendChild(svgIcon(node));
  btn.onclick = onClick;
  return btn;
}

history.init(project);
resetCurrentFile(project);

let viewport: ViewportState = { scale: 1, tx: 0, ty: 0 };
let spacePanDown = false;
let panDrag: { pointerId: number; x: number; y: number; tx: number; ty: number } | null = null;

function applyViewport() {
  applyTransform(canvas, viewport);
  $("zoom-label").textContent = `${Math.round(viewport.scale * 100)}%`;
}

function fitViewport() {
  const areaRect = stageArea.getBoundingClientRect();
  // cppx: CSS pixels per canvas logical pixel (canvas.offsetWidth is CSS layout size)
  const cppx = canvas.offsetWidth ? canvas.offsetWidth / canvas.width : 1 / (1 + 2 * EDITOR_OVERSCAN);
  const frameCssW = project.width * cppx;
  const frameCssH = project.height * cppx;
  const scale = clampScale(Math.min(areaRect.width / frameCssW, areaRect.height / frameCssH) * 0.96);
  viewport = {
    scale,
    tx: (areaRect.width - frameCssW * scale) / 2 - canvas.offsetLeft - overscanX * cppx * scale,
    ty: (areaRect.height - frameCssH * scale) / 2 - canvas.offsetTop - overscanY * cppx * scale,
  };
  applyViewport();
}

function resetViewport() {
  const areaRect = stageArea.getBoundingClientRect();
  const cppx = canvas.offsetWidth ? canvas.offsetWidth / canvas.width : 1 / (1 + 2 * EDITOR_OVERSCAN);
  const frameCssW = project.width * cppx;
  const frameCssH = project.height * cppx;
  viewport = {
    scale: 1,
    tx: (areaRect.width - frameCssW) / 2 - canvas.offsetLeft - overscanX * cppx,
    ty: (areaRect.height - frameCssH) / 2 - canvas.offsetTop - overscanY * cppx,
  };
  applyViewport();
}

window.addEventListener("resize", () => fitViewport());

// ---- container helpers ----------------------------------------------------

function activePanel(): Panel { return project.panels[activePanelIndex]; }

function audioProject() {
  project.audio = ensureAudioProject(project.audio);
  return project.audio;
}

function projectVisualDuration() {
  return expandedDurationMs(project);
}

function projectPlaybackDuration() {
  return Math.max(projectVisualDuration(), totalAudioDuration(project.audio));
}

function selectedAudioClip(): { track: AudioTrack; clip: AudioClip; asset: AudioAsset } | null {
  if (!selectedAudioClipId) return null;
  const audio = audioProject();
  const track = findClipTrack(audio, selectedAudioClipId);
  const clip = track?.clips.find((c) => c.id === selectedAudioClipId);
  const asset = clip ? findAsset(audio, clip.assetId) : undefined;
  return track && clip && asset ? { track, clip, asset } : null;
}

function activeContainer(): { layers: Layer[]; getActiveLayerIndex(): number; setActiveLayerIndex(i: number): void; isSubPanel: boolean; subPanel?: SubPanel } {
  const p = activePanel();
  if (activeSubPanelId) {
    const sp = (p.subPanels ?? []).find(s => s.id === activeSubPanelId);
    if (sp) return {
      layers: sp.layers,
      getActiveLayerIndex: () => sp.activeLayerIndex ?? 0,
      setActiveLayerIndex: (i) => { sp.activeLayerIndex = i; },
      isSubPanel: true,
      subPanel: sp,
    };
  }
  return {
    layers: p.layers,
    getActiveLayerIndex: () => p.activeLayerIndex ?? 0,
    setActiveLayerIndex: (i) => { p.activeLayerIndex = i; },
    isSubPanel: false,
  };
}

function activeLayer(): Layer | null {
  const c = activeContainer();
  return c.layers[c.getActiveLayerIndex()] ?? null;
}

/**
 * Commit an edit to undo history and invalidate render caches.
 *
 * `changedLayers` narrows cache invalidation: only those layers' versions are
 * bumped, so every other layer keeps its memoized sig AND its raw-layer cache
 * entries (no re-hash, no re-stamp). When omitted, every layer in the project
 * is bumped — always correct, costs one re-hash per layer next time it
 * renders, but unchanged content still re-hashes to the same sig so the
 * raw-layer cache keeps hitting.
 */
function commitHistory(changedLayers?: Layer[]) {
  if (changedLayers) {
    for (const l of changedLayers) bumpLayerVersion(l);
  } else {
    bumpAllProjectLayers();
  }
  history.push(project);
  markDirty();
  dirtyThumbnailPanelIds.add(activePanel().id);
  renderContentVersion++;
  invalidateBaseFrameCache();
  updateCanvasHint();
}

/** Bump versions of every layer a marquee selection touches (live drags mutate
 *  stroke points in place, so the render memo must see each intermediate state). */
function bumpMarqueeItemLayers(items: MarqueeRef[]) {
  for (const ref of items) {
    if (ref.kind === "stroke" || ref.kind === "fill" || ref.kind === "text") {
      bumpLayerVersion(ref.layer);
    }
  }
}

function scaleToolItems(): { items: MarqueeRef[]; bounds: Rect } | null {
  if (selectionState?.mode === "object" && isObjectSelectionIdle(selectionState)) {
    return { items: selectionState.items, bounds: selectionState.bounds };
  }
  const layer = activeLayer();
  if (!layer || !layer.visible) return null;
  const items: MarqueeRef[] = [
    ...layer.strokes.map(stroke => ({ kind: "stroke" as const, layer, stroke })),
    ...layer.fills.map(fill => ({ kind: "fill" as const, layer, fill })),
    ...(layer.texts ?? []).map(text => ({ kind: "text" as const, layer, text })),
  ];
  if (items.length === 0) return null;
  return { items, bounds: boundsFromItems(items, measureText) };
}


function copySelection() {
  if (!selectionState || selectionState.mode !== "object") return;
  const strokes: Stroke[] = [];
  const fills: Fill[] = [];
  const texts: TextElement[] = [];
  for (const ref of selectionState.items) {
    if (ref.kind === "stroke") strokes.push(JSON.parse(JSON.stringify(ref.stroke)));
    else if (ref.kind === "fill") fills.push(JSON.parse(JSON.stringify(ref.fill)));
    else if (ref.kind === "text") texts.push(JSON.parse(JSON.stringify(ref.text)));
  }
  selectionClipboard = { strokes, fills, texts };
  const count = strokes.length + fills.length + texts.length;
  buildEditContext();
  setStatus(`${count} item(s) copied · navigate to a frame and paste`);
}

function pasteSelection() {
  if (!selectionClipboard) return;
  if (activePanel().kind === "timelapse") { setStatus("Cannot paste onto a timelapse panel"); return; }
  let layer = activeLayer();
  if (!layer) return;
  // Redirect away from text layers (same restriction as brush drawing).
  if (layer.kind === "text") {
    const drawLayer = activeContainer().layers.find(l => l.kind !== "text" && l.visible);
    if (!drawLayer) { setStatus("No draw layer to paste into"); return; }
    layer = drawLayer;
  }
  bumpLayerVersion(layer);
  const { strokes, fills, texts } = selectionClipboard;
  for (const s of strokes) layer.strokes.push(JSON.parse(JSON.stringify(s)));
  for (const f of fills) layer.fills.push(JSON.parse(JSON.stringify(f)));
  for (const t of texts) {
    const copy: TextElement = JSON.parse(JSON.stringify(t));
    copy.id = crypto.randomUUID();
    if (!layer.texts) layer.texts = [];
    layer.texts.push(copy);
  }
  commitHistory();
  const count = strokes.length + fills.length + texts.length;
  setStatus(`Pasted ${count} item(s)`);
  buildEditContext();
}

function setLayerMaskFromSelection(mode: "reveal" | "hide") {
  const layer = activeLayer();
  const shape = activeRegionShape(selectionState);
  if (!layer || !shape) {
    setStatus("Create a region selection first");
    return;
  }
  const inverted = selectionState?.mode === "region" ? !!selectionState.inverted : false;
  const maskMode = inverted
    ? (mode === "reveal" ? "hide" : "reveal")
    : mode;
  layer.mask = {
    enabled: true,
    mode: maskMode,
    shape: JSON.parse(JSON.stringify(shape)) as SelectionShape,
  };
  commitHistory([layer]);
  buildLayers();
  buildInspector();
  buildEditContext();
  setStatus(mode === "reveal" ? "Layer mask reveals selection" : "Layer mask hides selection");
}

function setLayerMaskEnabled(enabled: boolean) {
  const layer = activeLayer();
  if (!layer?.mask) return;
  setMaskEnabledState(layer, enabled);
  commitHistory([layer]);
  buildLayers();
  buildInspector();
  buildEditContext();
}

function invertLayerMask() {
  const layer = activeLayer();
  if (!layer?.mask) return;
  invertMaskState(layer);
  commitHistory([layer]);
  buildLayers();
  buildInspector();
  buildEditContext();
}

function deleteLayerMask() {
  const layer = activeLayer();
  if (!layer?.mask) return;
  deleteMaskState(layer);
  maskOverlayLayerId = setMaskOverlayLayer(maskOverlayLayerId, layer.id, false);
  commitHistory([layer]);
  buildLayers();
  buildInspector();
  buildEditContext();
}

function setActiveMaskOverlay(shown: boolean) {
  const layer = activeLayer();
  if (!layer?.mask) return;
  maskOverlayLayerId = setMaskOverlayLayer(maskOverlayLayerId, layer.id, shown);
  buildLayers();
  buildInspector();
}

function invertActiveSelection() {
  if (!selectionState || selectionState.mode !== "region" || selectionState.phase === "creating") return;
  selectionState = { ...selectionState, inverted: !selectionState.inverted };
  buildEditContext();
}

function growActiveSelection(amount: number) {
  if (!selectionState || selectionState.mode !== "region" || selectionState.phase !== "idle") return;
  selectionState = { ...selectionState, shape: growSelectionShape(selectionState.shape, amount) };
  buildEditContext();
}

function cutSelection() {
  if (!selectionState) return;
  if (selectionState.mode === "region" && selectionState.phase === "idle") {
    extractSelection();
    return;
  }
  if (selectionState.mode !== "object" || !isObjectSelectionIdle(selectionState)) return;
  copySelection();
  deleteSelection();
}

function duplicateSelection() {
  if (!selectionState || selectionState.mode !== "object" || !isObjectSelectionIdle(selectionState)) return;
  const layer = activeLayer();
  if (!layer) return;
  const newItems: MarqueeRef[] = [];
  const dx = 24;
  const dy = 24;
  for (const ref of selectionState.items) {
    if (ref.kind === "stroke") {
      const copy: Stroke = JSON.parse(JSON.stringify(ref.stroke));
      for (const p of copy.points) { p.x += dx; p.y += dy; }
      ref.layer.strokes.push(copy);
      newItems.push({ kind: "stroke", layer: ref.layer, stroke: copy });
      bumpLayerVersion(ref.layer);
    } else if (ref.kind === "fill") {
      const copy: Fill = JSON.parse(JSON.stringify(ref.fill));
      copy.point.x += dx;
      copy.point.y += dy;
      if (copy.clipShape) copy.clipShape = translateShape(copy.clipShape, dx, dy);
      ref.layer.fills.push(copy);
      newItems.push({ kind: "fill", layer: ref.layer, fill: copy });
      bumpLayerVersion(ref.layer);
    } else if (ref.kind === "text") {
      const copy: TextElement = JSON.parse(JSON.stringify(ref.text));
      copy.id = crypto.randomUUID();
      copy.x += dx;
      copy.y += dy;
      if (!ref.layer.texts) ref.layer.texts = [];
      ref.layer.texts.push(copy);
      newItems.push({ kind: "text", layer: ref.layer, text: copy });
      bumpLayerVersion(ref.layer);
    } else if (ref.kind === "subpanel") {
      const copy = regenerateSubPanelIds(ref.subPanel, () => crypto.randomUUID());
      copy.bounds.x += dx;
      copy.bounds.y += dy;
      if (copy.tail) { copy.tail.x += dx; copy.tail.y += dy; }
      (activePanel().subPanels ??= []).push(copy);
      newItems.push({ kind: "subpanel", subPanel: copy });
    }
  }
  if (newItems.length === 0) return;
  selectionState = {
    mode: "object",
    phase: "idle",
    shape: translateShape(selectionState.shape, dx, dy),
    bounds: boundsFromItems(newItems, measureText),
    items: newItems,
  };
  commitHistory();
  buildTimeline();
  buildLayers();
  buildInspector();
  buildEditContext();
  setStatus(`Duplicated ${newItems.length} item(s)`);
}

function bumpAllProjectLayers() {
  for (const p of project.panels) {
    for (const l of p.layers) bumpLayerVersion(l);
    for (const sp of p.subPanels ?? []) {
      for (const l of sp.layers) bumpLayerVersion(l);
    }
  }
}

// When a deferred fill-mask recompute lands, repaint from fresh caches.
setAsyncRenderInvalidate(() => {
  invalidateBaseFrameCache();
  dirtyThumbnailPanelIds.add(activePanel().id);
});

function invalidateBaseFrameCache() {
  if (baseFrameCache) baseFrameCache.key = "";
  // NOTE: the raw-layer cache is intentionally NOT cleared here — its entries
  // are keyed by content hash (layerSig) + tick, so edits simply stop hitting
  // the old entries and the LRU evicts them. Wholesale clearing forced every
  // layer to re-stamp after every commit.
  clearTimelapseCache();
}

function clearLiveStrokeState() {
  liveStroke = null;
  liveStrokeLayer = null;
  liveStrokeLayerIndex = 0;
  liveStrokeStrokeIndex = 0;
  liveStrokeSubPanelId = null;
  liveSmoothingSession = null;
  perspectiveSnapLock = null;
}

function commitLiveStroke() {
  if (!liveStroke || !liveStrokeLayer) return;
  simplifyStroke(liveStroke);
  const clipShape = activeRegionShape(selectionState);
  if (clipShape) {
    const inverted = selectionState?.mode === "region" ? !!selectionState.inverted : false;
    const { inside, outside } = splitStrokeAtShape(liveStroke, clipShape);
    const segments = inverted ? outside : inside;
    for (const seg of segments) {
      if (seg.points.length >= 1) liveStrokeLayer.strokes.push(seg);
    }
  } else {
    liveStrokeLayer.strokes.push(liveStroke);
  }
  commitHistory([liveStrokeLayer]);
}

function ensureTextLayer(): Layer {
  const c = activeContainer();
  let tl = c.layers.find(l => l.kind === "text");
  if (!tl) {
    tl = newLayer("Text", "text");
    c.layers.push(tl);
    c.setActiveLayerIndex(c.layers.length - 1);
  }
  if (!tl.texts) tl.texts = [];
  return tl;
}

// ---- drawing input --------------------------------------------------------

let drawing = false;
let liveStroke: Stroke | null = null;
let liveStrokeLayer: Layer | null = null;
let liveStrokeLayerIndex = 0;
let liveStrokeStrokeIndex = 0;
let liveStrokeSubPanelId: string | null = null;
let drawingPointerId: number | null = null;
let liveStrokeHasRealPressure = false;
let liveSmoothingSession: StrokeSmoothingSession | null = null;
let layerMoveDrag: {
  pointerId: number;
  layer: Layer;
  dependents: Layer[];
  lastPos: Vec2;
  totalDx: number;
  totalDy: number;
  moved: boolean;
  keyframe: "from" | "to" | null;
} | null = null;
let subPanelDrag: { start: { x: number; y: number }; end: { x: number; y: number } } | null = null;
type SelectDrag =
  | { kind: "move"; subPanelId: string; offset: { x: number; y: number } }
  | { kind: "tail"; subPanelId: string; offset: { x: number; y: number } }
  | { kind: "text"; ref: TextRef; offset: { x: number; y: number } };
let selectDrag: SelectDrag | null = null;

// ---- Perspective ruler state ------------------------------------------------
type PerspectiveDragTarget = "horizon" | "radius" | "pole0" | "pole1" | "pole2" | "pole3" | number;
let perspectiveDrag: { target: PerspectiveDragTarget; pointerId: number } | null = null;
let perspectiveSnapLock: {
  origin: Vec2;
  guide: PerspectiveGuide;
  /** Chosen once ~8px into the stroke; null until the direction is decided. */
  proj: ((p: Vec2) => Vec2) | null;
} | null = null;

const FISHEYE_MIN_RADIUS = 60;

function fisheyeRadius(guide: PerspectiveGuide): number {
  return Math.max(FISHEYE_MIN_RADIUS, guide.radius ?? Math.min(project.width, project.height) * 0.48);
}

function fisheyeRotation(guide: PerspectiveGuide): number {
  return guide.rotation ?? 0;
}

function rotVec(v: Vec2, theta: number): Vec2 {
  const c = Math.cos(theta), s = Math.sin(theta);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}

/** World position of fisheye rim pole k (0..3, 90° apart starting at the
 *  lens rotation angle). Dragging a pole spins and resizes the lens. */
function fisheyePolePos(guide: PerspectiveGuide, k: number): Vec2 {
  const c = guide.vps[0];
  const R = fisheyeRadius(guide);
  const a = fisheyeRotation(guide) + (k * Math.PI) / 2;
  return { x: c.x + R * Math.cos(a), y: c.y + R * Math.sin(a) };
}

/** Drop rulers bound to layers that no longer exist anywhere in the panel. */
function prunePerspectiveGuides(panel: Panel) {
  if (!panel.guides || panel.guides.length === 0) return;
  const ids = new Set<string>();
  for (const l of panel.layers) ids.add(l.id);
  for (const sp of panel.subPanels ?? []) for (const l of sp.layers) ids.add(l.id);
  panel.guides = panel.guides.filter((g) => !g.layerId || ids.has(g.layerId));
}

/** The ruler that applies right now: the one bound to the active layer if
 *  any, else an unbound (all-layers) ruler. Rulers bound to other layers
 *  neither snap nor show, so they can't disturb work elsewhere. */
function activePerspectiveGuide(): PerspectiveGuide | null {
  const guides = activePanel().guides;
  if (!guides || guides.length === 0) return null;
  const layer = activeLayer();
  return (layer && guides.find((g) => g.layerId === layer.id))
    || guides.find((g) => !g.layerId)
    || null;
}

/** Unit directions a stroke may snap to: one per vanishing point (through the
 *  stroke origin) plus axis lines depending on the ruler kind. */
function perspectiveSnapCandidates(guide: PerspectiveGuide, origin: Vec2): Vec2[] {
  const out: Vec2[] = [];
  for (const vp of guide.vps) {
    const dx = origin.x - vp.x, dy = origin.y - vp.y;
    const d = Math.hypot(dx, dy);
    if (d > 1e-3) out.push({ x: dx / d, y: dy / d });
  }
  if (guide.kind === "grid" || guide.kind === "1p") {
    out.push({ x: 1, y: 0 }, { x: 0, y: 1 });
  } else if (guide.kind === "2p") {
    out.push({ x: 0, y: 1 });
  }
  return out;
}

function lineProjection(origin: Vec2, dir: Vec2): (p: Vec2) => Vec2 {
  return (p) => {
    const t = (p.x - origin.x) * dir.x + (p.y - origin.y) * dir.y;
    return { x: origin.x + dir.x * t, y: origin.y + dir.y * t };
  };
}

function circleProjection(center: Vec2, radius: number): (p: Vec2) => Vec2 {
  return (p) => {
    const dx = p.x - center.x, dy = p.y - center.y;
    const d = Math.hypot(dx, dy) || 1e-6;
    return { x: center.x + (dx / d) * radius, y: center.y + (dy / d) * radius };
  };
}

/** Fisheye guide line through `o` (relative to lens center): the circle of the
 *  meridian family (through the top/bottom poles) or the parallel family
 *  (through the left/right poles). Returns the circle plus its tangent at o,
 *  or a straight diameter when o sits on the family's axis. */
function fisheyeFamilyAt(
  o: Vec2,
  R: number,
  family: "meridian" | "parallel"
): { center: Vec2 | null; radius: number; tangent: Vec2 } {
  // For meridians: circle center lies on y=0 at x0 = (|o|² − R²) / (2·ox).
  // Parallels are the mirror with x/y swapped.
  const a = family === "meridian" ? o.x : o.y;
  if (Math.abs(a) < 1e-3) {
    // On the axis — the guide degenerates to the straight diameter.
    return {
      center: null,
      radius: 0,
      tangent: family === "meridian" ? { x: 0, y: 1 } : { x: 1, y: 0 },
    };
  }
  const k = (o.x * o.x + o.y * o.y - R * R) / (2 * a);
  const c = family === "meridian" ? { x: k, y: 0 } : { x: 0, y: k };
  const radius = Math.hypot(k, R);
  // Tangent at o = perpendicular of the radius vector.
  const rx = o.x - c.x, ry = o.y - c.y;
  const rl = Math.hypot(rx, ry) || 1e-6;
  return { center: c, radius, tangent: { x: -ry / rl, y: rx / rl } };
}

/** Pick the projection (line or curve) for a stroke starting at `origin`
 *  moving along unit vector `move`. */
function choosePerspectiveProjection(
  guide: PerspectiveGuide,
  origin: Vec2,
  move: Vec2
): ((p: Vec2) => Vec2) | null {
  if (guide.kind === "fisheye") {
    const c = guide.vps[0];
    if (!c) return null;
    const R = fisheyeRadius(guide);
    // Work in the lens frame: un-rotate the origin and travel direction, pick
    // the family there, then rotate the chosen circle/line back to world.
    const theta = fisheyeRotation(guide);
    const o = rotVec({ x: origin.x - c.x, y: origin.y - c.y }, -theta);
    const m = rotVec(move, -theta);
    let best: ((p: Vec2) => Vec2) | null = null;
    let bestDot = -1;
    for (const family of ["meridian", "parallel"] as const) {
      const f = fisheyeFamilyAt(o, R, family);
      const a = Math.abs(m.x * f.tangent.x + m.y * f.tangent.y);
      if (a <= bestDot) continue;
      bestDot = a;
      if (f.center) {
        const cw = rotVec(f.center, theta);
        best = circleProjection({ x: c.x + cw.x, y: c.y + cw.y }, f.radius);
      } else {
        best = lineProjection(origin, rotVec(f.tangent, theta));
      }
    }
    return best;
  }
  let bestDir: Vec2 | null = null;
  let bestDot = -1;
  for (const cand of perspectiveSnapCandidates(guide, origin)) {
    const a = Math.abs(move.x * cand.x + move.y * cand.y);
    if (a > bestDot) { bestDot = a; bestDir = cand; }
  }
  return bestDir ? lineProjection(origin, bestDir) : null;
}

/** Project a live-stroke sample onto the locked perspective guide line. The
 *  first ~8px of movement picks the line (nearest candidate to the travel
 *  direction); points collected before the lock are retro-projected. */
function applyPerspectiveSnap(pos: Vec2): Vec2 {
  const lock = perspectiveSnapLock;
  if (!lock) return pos;
  if (!lock.proj) {
    const dx = pos.x - lock.origin.x, dy = pos.y - lock.origin.y;
    const d = Math.hypot(dx, dy);
    if (d < 8) return pos;
    lock.proj = choosePerspectiveProjection(lock.guide, lock.origin, { x: dx / d, y: dy / d });
    if (!lock.proj) {
      perspectiveSnapLock = null;
      return pos;
    }
    if (liveStroke) {
      for (const p of liveStroke.points) {
        const q = lock.proj(p);
        p.x = q.x;
        p.y = q.y;
      }
    }
  }
  return lock.proj(pos);
}

// Shared offscreen for text bbox measurement.
const _measureCanvas = document.createElement("canvas");
const _measureCtx = _measureCanvas.getContext("2d")!;
function measureText(t: TextElement): { width: number; height: number } {
  _measureCtx.font = `${t.fontSize}px "${t.fontFamily}", sans-serif`;
  return { width: _measureCtx.measureText(t.content || " ").width, height: t.fontSize * 1.2 };
}

function hitTestText(pos: { x: number; y: number }): TextRef | null {
  const cont = activeContainer();
  // Top-most layer first; within layer, last text first.
  for (let li = cont.layers.length - 1; li >= 0; li--) {
    const layer = cont.layers[li];
    if (!layer.visible || !layer.texts) continue;
    for (let ti = layer.texts.length - 1; ti >= 0; ti--) {
      const t = layer.texts[ti];
      const m = measureText(t);
      if (pos.x >= t.x && pos.x <= t.x + m.width &&
          pos.y >= t.y && pos.y <= t.y + m.height) {
        return { layer, text: t };
      }
    }
  }
  return null;
}

function clearSelection() {
  selectionState = null;
  transformSnapshots = null;
  pendingRegionTransform = null;
  canvas.style.cursor = "";
}

function shapeFromCreating(state: SelectionState & { mode: "region"; phase: "creating" }): SelectionShape {
  const path = state.lassoPath ?? [];
  if (state.tool === "lasso") {
    return { kind: "polygon", points: simplifyLassoPath(path) };
  }
  const start = path[0] ?? { x: 0, y: 0 };
  const end = path[path.length - 1] ?? start;
  if (state.tool === "ellipse") return ellipseFromDrag(start, end);
  return rectFromDrag(start, end);
}

function marqueeTransformBounds(state: SelectionState): Rect | null {
  if (state.phase === "creating") return null;
  return state.mode === "object" ? state.bounds : shapeBounds(state.shape);
}

function pointInBounds(pos: Vec2, b: Rect): boolean {
  return pos.x >= b.x && pos.x <= b.x + b.w && pos.y >= b.y && pos.y <= b.y + b.h;
}

function selectionMoveCursorHit(pos: Vec2, state: SelectionState): boolean {
  if (state.phase !== "idle") return false;
  if (state.mode === "region") return activeRegionContains(state, pos);
  return pointInBounds(pos, state.bounds);
}

function updateCanvasCursor(pos?: Vec2) {
  canvas.style.cursor = "";
  if (playing || panDrag || spacePanDown) return;
  if (isEraseBrushKey(currentBrush)) {
    canvas.style.cursor = "none";
    return;
  }
  if (currentBrush === MARQUEE_KEY && selectionState) {
    const at = pos ?? lastCanvasPointerPos;
    const bounds = marqueeTransformBounds(selectionState);
    if (at && bounds && selectionState.phase === "idle") {
      const handle = hitTestTransformHandle(at, bounds, viewport.scale);
      if (handle) {
        canvas.style.cursor = transformCursorForHandle(handle);
        return;
      }
      if (selectionMoveCursorHit(at, selectionState)) {
        canvas.style.cursor = "move";
        return;
      }
    }
  } else if (currentBrush === SCALE_KEY) {
    const at = pos ?? lastCanvasPointerPos;
    const target = scaleToolDrag ? { bounds: scaleToolDrag.bounds } : scaleToolItems();
    if (at && target) {
      const handle = hitTestTransformHandle(at, target.bounds, viewport.scale);
      if (handle) {
        canvas.style.cursor = transformCursorForHandle(handle);
        return;
      }
    }
  }
}

function isEraseBrushKey(key: string): boolean {
  return isErasePreviewBrush(brushByKey(key));
}

function cutAtShape(shape: SelectionShape, inverted = false): MarqueeRef[] {
  const items: MarqueeRef[] = [];
  const cont = activeContainer();
  const panel = activePanel();
  const inSelection = (p: Vec2) => pointInRegionSelection(p, shape, inverted);

  if (!activeSubPanelId) {
    for (const sp of panel.subPanels ?? []) {
      const cx = sp.bounds.x + sp.bounds.w / 2;
      const cy = sp.bounds.y + sp.bounds.h / 2;
      if (inSelection({ x: cx, y: cy })) {
        items.push({ kind: "subpanel", subPanel: sp });
      }
    }
  }

  for (const layer of cont.layers) {
    if (!layer.visible) continue;
    const next: Stroke[] = [];
    for (const stroke of layer.strokes) {
      const allIn = stroke.points.length > 0 && stroke.points.every(inSelection);
      const anyIn = stroke.points.some(inSelection);
      let crosses = false;
      if (!anyIn) {
        for (let i = 1; i < stroke.points.length; i++) {
          if (segmentShapeIntersections(stroke.points[i - 1], stroke.points[i], shape).length > 0) {
            crosses = true; break;
          }
        }
      }
      if (allIn) {
        next.push(stroke);
        items.push({ kind: "stroke", layer, stroke });
      } else if (!anyIn && !crosses) {
        next.push(stroke);
      } else {
        const { inside, outside } = splitStrokeAtShape(stroke, shape);
        const selected = inverted ? outside : inside;
        const remaining = inverted ? inside : outside;
        for (const s of remaining) next.push(s);
        for (const s of selected) {
          next.push(s);
          items.push({ kind: "stroke", layer, stroke: s });
        }
      }
    }
    layer.strokes.length = 0;
    layer.strokes.push(...next);
    bumpLayerVersion(layer);

    for (const fill of layer.fills) {
      if (inSelection(fill.point)) {
        items.push({ kind: "fill", layer, fill });
      }
    }
    if (layer.texts) {
      for (const text of layer.texts) {
        const m = measureText(text);
        const cx = text.x + m.width / 2;
        const cy = text.y + m.height / 2;
        if (inSelection({ x: cx, y: cy })) {
          items.push({ kind: "text", layer, text });
        }
      }
    }
  }
  return items;
}

function extractSelection() {
  if (!selectionState || selectionState.mode !== "region" || selectionState.phase !== "idle") return;
  const shape = selectionState.shape;
  const inverted = !!selectionState.inverted;
  const items = cutAtShape(shape, inverted);
  if (items.length === 0) {
    clearSelection();
    setStatus("Nothing to extract in selection");
    return;
  }
  const bounds = boundsFromItems(items, measureText);
  selectionState = {
    mode: "object",
    phase: "idle",
    shape,
    bounds,
    items,
  };
  commitHistory();
  buildEditContext();
  setStatus(`${items.length} extracted · drag to move · Del to remove`);
}

function beginObjectSelectionTransform(handle: TransformHandleId, pos: Vec2): boolean {
  if (!selectionState) return false;

  let shape = selectionState.shape;
  let bounds: Rect;
  let items: MarqueeRef[];

  if (selectionState.mode === "object" && selectionState.phase === "idle") {
    bounds = selectionState.bounds;
    items = selectionState.items;
  } else if (selectionState.mode === "region" && selectionState.phase === "idle") {
    items = cutAtShape(selectionState.shape, !!selectionState.inverted);
    if (items.length === 0) {
      setStatus("Nothing to transform in selection");
      return false;
    }
    bounds = boundsFromItems(items, measureText);
  } else {
    return false;
  }

  const pivot = rectCenter(bounds);
  transformSnapshots = snapshotItems(items);
  selectionState = {
    mode: "object",
    phase: "transforming",
    shape,
    bounds,
    items,
    transformHandle: handle,
    transformPivot: pivot,
    transformStartBounds: { ...bounds },
    transformStartAngle: Math.atan2(pos.y - pivot.y, pos.x - pivot.x),
    lastPos: pos,
  };
  buildEditContext();
  return true;
}

function applyActiveSelectionTransform(pos: Vec2, shiftKey: boolean, altKey: boolean): boolean {
  if (selectionState?.mode !== "object" || selectionState.phase !== "transforming" ||
      !selectionState.transformHandle || !selectionState.transformPivot ||
      !selectionState.transformStartBounds || !transformSnapshots) {
    return false;
  }

  const pivot = selectionState.transformPivot;
  const handle = selectionState.transformHandle;
  if (handle === "rotate" && selectionState.transformStartAngle !== undefined) {
    const angleRad = Math.atan2(pos.y - pivot.y, pos.x - pivot.x) - selectionState.transformStartAngle;
    for (const snap of transformSnapshots) {
      restoreFromSnapshot(snap);
      applyTransformToSnapshot(snap, pivot, 1, 1, angleRad, true);
    }
    bumpMarqueeItemLayers(selectionState.items);
  } else {
    const t = computeTransformFromHandle(
      handle, selectionState.transformStartBounds, pivot, pos, shiftKey, altKey
    );
    for (const snap of transformSnapshots) {
      restoreFromSnapshot(snap);
      applyTransformToSnapshot(snap, pivot, t.scaleX, t.scaleY, 0, false);
    }
    bumpMarqueeItemLayers(selectionState.items);
  }
  selectionState = {
    ...selectionState,
    bounds: boundsFromItems(selectionState.items, measureText),
    lastPos: pos,
  };
  return true;
}

function deleteSelection() {
  if (!selectionState || selectionState.mode !== "object" || selectionState.phase !== "idle") return;
  const panel = activePanel();
  bumpMarqueeItemLayers(selectionState.items);
  for (const ref of selectionState.items) {
    if (ref.kind === "stroke") {
      const idx = ref.layer.strokes.indexOf(ref.stroke);
      if (idx >= 0) ref.layer.strokes.splice(idx, 1);
    } else if (ref.kind === "fill") {
      const idx = ref.layer.fills.indexOf(ref.fill);
      if (idx >= 0) ref.layer.fills.splice(idx, 1);
    } else if (ref.kind === "text") {
      const idx = ref.layer.texts?.indexOf(ref.text) ?? -1;
      if (idx >= 0) ref.layer.texts!.splice(idx, 1);
    } else if (ref.kind === "subpanel") {
      const arr = panel.subPanels ?? [];
      const idx = arr.indexOf(ref.subPanel);
      if (idx >= 0) arr.splice(idx, 1);
    }
  }
  clearSelection();
  commitHistory();
  buildTimeline();
  buildLayers();
  buildInspector();
  buildEditContext();
}

function moveLayerContents(layer: Layer, dx: number, dy: number) {
  bumpLayerVersion(layer);
  for (const stroke of layer.strokes) {
    for (const p of stroke.points) { p.x += dx; p.y += dy; }
  }
  for (const fill of layer.fills) {
    fill.point.x += dx;
    fill.point.y += dy;
  }
  for (const text of layer.texts ?? []) {
    text.x += dx;
    text.y += dy;
  }
}

function clippedDependentsFor(layer: Layer): Layer[] {
  if (layer.clipToBelow) return [];
  const layers = activeContainer().layers;
  const start = layers.indexOf(layer);
  if (start < 0) return [];
  const dependents: Layer[] = [];
  for (let i = start + 1; i < layers.length; i++) {
    if (!layers[i].clipToBelow) break;
    dependents.push(layers[i]);
  }
  return dependents;
}

function layerMovePreviewOffset() {
  if (!layerMoveDrag || layerMoveDrag.keyframe || !layerMoveDrag.moved) return undefined;
  return {
    layerId: layerMoveDrag.layer.id,
    dx: layerMoveDrag.totalDx,
    dy: layerMoveDrag.totalDy,
  };
}

function layerCentroid(layer: Layer): Vec2 {
  let cx = 0, cy = 0, count = 0;
  for (const s of layer.strokes) {
    for (const p of s.points) { cx += p.x; cy += p.y; count++; }
  }
  for (const f of layer.fills) {
    cx += f.point.x; cy += f.point.y; count++;
  }
  for (const t of layer.texts ?? []) {
    cx += t.x; cy += t.y; count++;
  }
  if (count === 0) return { x: project.width / 2, y: project.height / 2 };
  return { x: cx / count, y: cy / count };
}

function drawKeyframeOverlay(ctx: CanvasRenderingContext2D) {
  const layer = activeLayer();
  if (!layer || !layer.animation?.enabled) return;
  const anim = layer.animation;
  const cent = layerCentroid(layer);
  const ax = cent.x + anim.from.x, ay = cent.y + anim.from.y;
  const bx = cent.x + anim.to.x, by = cent.y + anim.to.y;
  const armed = keyframeArm;
  const accent = "#ff8f5a", yellow = "#ffcd75", dim = "rgba(255,143,90,0.35)";
  const inner = "#0e0e16";
  ctx.save();
  // Dashed motion path A→B
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx, by);
  ctx.strokeStyle = dim;
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 6]);
  ctx.stroke();
  ctx.setLineDash([]);
  // Arrowhead at B
  const angle = Math.atan2(by - ay, bx - ax);
  const aLen = 12;
  ctx.beginPath();
  ctx.moveTo(bx, by);
  ctx.lineTo(bx - aLen * Math.cos(angle - 0.4), by - aLen * Math.sin(angle - 0.4));
  ctx.moveTo(bx, by);
  ctx.lineTo(bx - aLen * Math.cos(angle + 0.4), by - aLen * Math.sin(angle + 0.4));
  ctx.strokeStyle = dim;
  ctx.lineWidth = 2;
  ctx.stroke();
  // Speed dots along eased path
  const dots = Math.min(16, Math.max(4, anim.durationTicks * 2));
  for (let i = 1; i < dots; i++) {
    const t = i / dots;
    const ep = easeProgress(anim.easing, t);
    const dx = ax + (bx - ax) * ep, dy = ay + (by - ay) * ep;
    ctx.beginPath();
    ctx.arc(dx, dy, 3, 0, Math.PI * 2);
    ctx.fillStyle = dim;
    ctx.fill();
  }
  // Handle A
  const rad = 26;
  ctx.beginPath();
  ctx.arc(ax, ay, rad, 0, Math.PI * 2);
  ctx.fillStyle = armed === "from" ? accent : yellow;
  ctx.fill();
  ctx.strokeStyle = inner;
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.fillStyle = inner;
  ctx.font = "bold 22px ui-monospace, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("A", ax, ay + 1);
  // Handle B
  ctx.beginPath();
  ctx.arc(bx, by, rad, 0, Math.PI * 2);
  ctx.fillStyle = armed === "to" ? accent : yellow;
  ctx.fill();
  ctx.strokeStyle = inner;
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.fillStyle = inner;
  ctx.font = "bold 22px ui-monospace, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("B", bx, by + 1);
  ctx.restore();
}

function cloneLayerForPaste(src: Layer): Layer {
  const copy = JSON.parse(JSON.stringify(src)) as Layer;
  copy.id = crypto.randomUUID();
  copy.name = `${copy.name} copy`;
  if (copy.texts) {
    copy.texts = copy.texts.map((t) => ({ ...t, id: crypto.randomUUID() }));
  }
  return copy;
}

function copyActiveLayer() {
  const layer = activeLayer();
  if (!layer) return;
  layerClipboard = JSON.parse(JSON.stringify(layer)) as Layer;
  buildLayers();
  buildInspector();
  setStatus(`copied ${layer.name}`);
}

function pasteLayerAboveActive() {
  if (!layerClipboard) return;
  const cont = activeContainer();
  const index = cont.getActiveLayerIndex();
  const pasted = cloneLayerForPaste(layerClipboard);
  cont.layers.splice(index + 1, 0, pasted);
  cont.setActiveLayerIndex(index + 1);
  commitHistory();
  buildLayers();
  buildInspector();
  setStatus(`pasted ${pasted.name}`);
}

function duplicateActiveLayer() {
  const cont = activeContainer();
  const index = cont.getActiveLayerIndex();
  const nextIndex = duplicateLayer(cont.layers, index, () => crypto.randomUUID());
  cont.setActiveLayerIndex(nextIndex);
  selectedText = null;
  selectedSubPanelId = null;
  clearSelection();
  commitHistory();
  buildLayers();
  buildInspector();
  setStatus(`duplicated ${cont.layers[nextIndex]?.name ?? "layer"}`);
}

function clearActiveLayer() {
  const layer = activeLayer();
  if (!layer) return;
  clearLayerContents(layer);
  selectedText = null;
  clearSelection();
  commitHistory([layer]);
  buildLayers();
  buildInspector();
  setStatus(`cleared ${layer.name}`);
}

function mergeActiveLayerDown() {
  const cont = activeContainer();
  const index = cont.getActiveLayerIndex();
  const result = mergeLayerDown(cont.layers, index);
  if (!result.merged) {
    setStatus(result.reason === "no-below" ? "No layer below" : "Layer cannot merge down safely");
    return;
  }
  cont.setActiveLayerIndex(result.activeIndex);
  selectedText = null;
  selectedSubPanelId = null;
  clearSelection();
  prunePerspectiveGuides(activePanel());
  commitHistory();
  buildLayers();
  buildInspector();
  setStatus("merged layer down");
}

function copyActiveLayerAnimation() {
  const anim = activeLayer()?.animation;
  if (!anim) return;
  animationClipboard = JSON.parse(JSON.stringify(anim)) as LayerAnimation;
  buildLayers();
  buildInspector();
  setStatus("copied layer animation");
}

function pasteAnimationToActiveLayer() {
  const layer = activeLayer();
  if (!layer || !animationClipboard) return;
  layer.animation = JSON.parse(JSON.stringify(animationClipboard)) as LayerAnimation;
  commitHistory();
  buildTimeline();
  buildLayers();
  buildInspector();
  setStatus(`pasted animation to ${layer.name}`);
}

function defaultLayerAnimation(): LayerAnimation {
  const totalTicks = Math.max(1, Math.round((activePanel().durationMs / 1000) * project.wiggleFps));
  return {
    enabled: true,
    startTick: 0,
    durationTicks: Math.min(8, totalTicks),
    from: { x: 0, y: 0, opacity: 1, scale: 1, rotation: 0 },
    to: { x: 160, y: 0, opacity: 1, scale: 1, rotation: 0 },
    easing: "easeInOut",
    loop: "none",
  };
}

function ensureLayerAnimation(layer: Layer): LayerAnimation {
  if (!layer.animation) layer.animation = defaultLayerAnimation();
  return layer.animation;
}

function armLayerKeyframe(which: "from" | "to") {
  const layer = activeLayer();
  if (!layer) return;
  const anim = ensureLayerAnimation(layer);
  anim.enabled = true;
  keyframeArm = which;
  currentBrush = MOVE_LAYER_KEY;
  buildTimeline();
  buildLayers();
  buildInspector();
  buildBrushBar();
  setStatus(`move layer to place ${which} keyframe`);
}

type WorkspaceMode = "draw" | "edit";

let workspaceMode: WorkspaceMode = "draw";
let timelineMode: "cells" | "tracks" = "cells";

function canvasPos(e: PointerEvent | MouseEvent) {
  const raw = screenToCanvas(canvas, e.clientX, e.clientY);
  return { x: raw.x - overscanX, y: raw.y - overscanY };
}

function shouldStartViewportPan(e: PointerEvent) {
  return spacePanDown || e.button === 1 || (e.buttons & 4) !== 0;
}

function beginViewportPan(e: PointerEvent) {
  panDrag = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, tx: viewport.tx, ty: viewport.ty };
  stageArea.classList.add("panning");
  try { canvas.setPointerCapture(e.pointerId); } catch {}
  e.preventDefault();
}

function capturePointer(e: PointerEvent) {
  try { canvas.setPointerCapture(e.pointerId); } catch {}
}

function appendLiveStrokeSample(e: PointerEvent) {
  if (!liveStroke || !liveSmoothingSession) return;
  const rawPos = canvasPos(e);
  const pressure = pressureForLiveStroke(e);
  const emitted = appendStrokeSmoothingSample(liveSmoothingSession, { point: rawPos, pressure });
  appendSmoothedStrokeSamples(emitted);
}

function appendSmoothedStrokeSamples(samples: StrokeSmoothingSample[]) {
  if (!liveStroke) return;
  for (const sample of samples) {
    const pos = applyPerspectiveSnap(sample.point);
    const last = liveStroke.points[liveStroke.points.length - 1];
    if (last && Math.hypot(pos.x - last.x, pos.y - last.y) < 1.0) continue;
    liveStroke.points.push(pos);
    liveStroke.pressures!.push(sample.pressure);
  }
}

function finishLiveStrokeSmoothing() {
  if (!liveSmoothingSession) return;
  appendSmoothedStrokeSamples(finishStrokeSmoothingSession(liveSmoothingSession));
}

canvas.addEventListener("pointerdown", (e) => {
  if (playing) return;
  e.preventDefault();
  if (shouldStartViewportPan(e)) {
    beginViewportPan(e);
    return;
  }
  const pos = canvasPos(e);

  // Select tool — universal mouse / picker. Priority: tail handle (when a
  // balloon/thought is selected) → text → sub-panel → deselect.
  if (currentBrush === SELECT_KEY) {
    const sps = activePanel().subPanels ?? [];
    if (selectedSubPanelId) {
      const sp = sps.find(s => s.id === selectedSubPanelId);
      if (sp && (sp.shape === "balloon" || sp.shape === "thought") && sp.tail) {
        const d = Math.hypot(pos.x - sp.tail.x, pos.y - sp.tail.y);
        if (d < 40) {
          selectDrag = { kind: "tail", subPanelId: sp.id, offset: { x: 0, y: 0 } };
          try { canvas.setPointerCapture(e.pointerId); } catch {}
          return;
        }
      }
    }
    const textHit = hitTestText(pos);
    if (textHit) {
      selectedSubPanelId = null;
      selectedText = textHit;
      selectDrag = {
        kind: "text", ref: textHit,
        offset: { x: pos.x - textHit.text.x, y: pos.y - textHit.text.y },
      };
      try { canvas.setPointerCapture(e.pointerId); } catch {}
      buildInspector();
      return;
    }
    for (let i = sps.length - 1; i >= 0; i--) {
      if (isInsideBounds(pos.x, pos.y, sps[i].bounds)) {
        selectedSubPanelId = sps[i].id;
        selectedText = null;
        selectDrag = {
          kind: "move", subPanelId: sps[i].id,
          offset: { x: pos.x - sps[i].bounds.x, y: pos.y - sps[i].bounds.y },
        };
        try { canvas.setPointerCapture(e.pointerId); } catch {}
        buildInspector();
        return;
      }
    }
    if (selectedSubPanelId || selectedText) {
      selectedSubPanelId = null;
      selectedText = null;
      buildInspector();
    }
    return;
  }

  // Marquee tool — region mask (clip draw/fill) or extracted object group.
  if (currentBrush === MARQUEE_KEY) {
    if (selectionState?.mode === "object" && selectionState.phase === "idle") {
      const handle = hitTestTransformHandle(pos, selectionState.bounds, viewport.scale);
      if (handle) {
        beginObjectSelectionTransform(handle, pos);
        try { canvas.setPointerCapture(e.pointerId); } catch {}
        return;
      }
      const b = selectionState.bounds;
      if (pos.x >= b.x && pos.x <= b.x + b.w && pos.y >= b.y && pos.y <= b.y + b.h) {
        selectionState = { ...selectionState, phase: "moving", lastPos: pos };
        try { canvas.setPointerCapture(e.pointerId); } catch {}
        return;
      }
      // Click outside bounds and handles — cancel selection before starting a new one.
      clearSelection();
      buildEditContext();
    }
    if (selectionState?.mode === "region" && selectionState.phase === "idle") {
      const bounds = shapeBounds(selectionState.shape);
      const handle = hitTestTransformHandle(pos, bounds, viewport.scale);
      if (handle) {
        pendingRegionTransform = { pointerId: e.pointerId, handle, startPos: pos };
        try { canvas.setPointerCapture(e.pointerId); } catch {}
        return;
      }
      if (activeRegionContains(selectionState, pos)) {
        selectionState = { ...selectionState, phase: "moving", lastPos: pos };
        try { canvas.setPointerCapture(e.pointerId); } catch {}
        buildEditContext();
        return;
      }
    }
    const startShape = marqueeToolKind === "ellipse"
      ? ellipseFromDrag(pos, pos, e.shiftKey)
      : rectFromDrag(pos, pos);
    selectionState = {
      mode: "region",
      phase: "creating",
      shape: startShape,
      tool: marqueeToolKind,
      lassoPath: [pos],
    };
    try { canvas.setPointerCapture(e.pointerId); } catch {}
    return;
  }

  // Scale tool — resize/rotate the active layer's content (or the current selection).
  if (currentBrush === SCALE_KEY) {
    const target = scaleToolItems();
    if (!target) return;
    const handle = hitTestTransformHandle(pos, target.bounds, viewport.scale);
    if (!handle) return;
    const pivot = rectCenter(target.bounds);
    scaleToolDrag = {
      items: target.items,
      bounds: target.bounds,
      snapshots: snapshotItems(target.items),
      handle,
      pivot,
      startBounds: { ...target.bounds },
      startAngle: Math.atan2(pos.y - pivot.y, pos.x - pivot.x),
    };
    try { canvas.setPointerCapture(e.pointerId); } catch {}
    return;
  }

  // Move Layer tool — shifts every drawable item in the active layer. This is
  // intentionally separate from marquee selection and keeps strokes raw.
  if (currentBrush === MOVE_LAYER_KEY) {
    const layer = activeLayer();
    if (!layer || !layer.visible) return;
    // Direct-drag A/B handles from the canvas
    if (!keyframeArm && layer.animation?.enabled) {
      const cent = layerCentroid(layer);
      const a = layer.animation;
      const ax = cent.x + a.from.x, ay = cent.y + a.from.y;
      const bx = cent.x + a.to.x, by = cent.y + a.to.y;
      if (Math.hypot(pos.x - ax, pos.y - ay) < 30) keyframeArm = "from";
      else if (Math.hypot(pos.x - bx, pos.y - by) < 30) keyframeArm = "to";
    }
    if (keyframeArm) {
      const anim = ensureLayerAnimation(layer);
      anim.enabled = true;
    }
    layerMoveDrag = {
      pointerId: e.pointerId,
      layer,
      dependents: clippedDependentsFor(layer),
      lastPos: pos,
      totalDx: 0,
      totalDy: 0,
      moved: false,
      keyframe: keyframeArm,
    };
    try { canvas.setPointerCapture(e.pointerId); } catch {}
    return;
  }

  // Perspective ruler tool: place / drag vanishing points and the horizon.
  if (currentBrush === PERSPECTIVE_KEY) {
    const panel = activePanel();
    prunePerspectiveGuides(panel);
    let guide = activePerspectiveGuide();
    if (!guide) {
      const layer = activeLayer();
      guide = newPerspectiveGuide("1p", project.width, project.height, layer?.id ?? null);
      (panel.guides ??= []).push(guide);
      commitHistory([]);
      buildPerspectiveInspector();
      setStatus(layer
        ? `Perspective ruler placed on “${layer.name}” · only strokes on that layer snap to it`
        : "Perspective ruler placed · drag the handles · strokes snap to its lines");
    }
    const pick = 24 / viewport.scale;
    let target: PerspectiveDragTarget | null = null;
    for (let i = 0; i < guide.vps.length; i++) {
      if (Math.hypot(pos.x - guide.vps[i].x, pos.y - guide.vps[i].y) < pick) { target = i; break; }
    }
    if (target === null && guide.kind === "fisheye" && guide.vps[0]) {
      // Rim poles spin + resize the lens; the rest of the rim just resizes.
      for (let k = 0; k < 4 && target === null; k++) {
        const p = fisheyePolePos(guide, k);
        if (Math.hypot(pos.x - p.x, pos.y - p.y) < pick) target = `pole${k}` as PerspectiveDragTarget;
      }
      if (target === null) {
        const d = Math.hypot(pos.x - guide.vps[0].x, pos.y - guide.vps[0].y);
        if (Math.abs(d - fisheyeRadius(guide)) < pick) target = "radius";
      }
    }
    if (target === null && guide.kind !== "fisheye" && Math.abs(pos.y - guide.horizonY) < pick) {
      target = "horizon";
    }
    if (target !== null) {
      perspectiveDrag = { target, pointerId: e.pointerId };
      capturePointer(e);
    }
    return;
  }

  // Sub-panel tool: drag-create
  if (currentBrush === SUBPANEL_KEY) {
    subPanelDrag = { start: pos, end: pos };
    capturePointer(e);
    return;
  }

  // Text tool: open inline input at click. Route into the sub-panel at the
  // click point if the user is at panel root.
  if (currentBrush === TEXT_KEY) {
    maybeEnterSubPanelAt(pos);
    openTextInputAt(pos);
    return;
  }

  // Draw / bucket — auto-enter the sub-panel under the cursor if any, so the
  // stroke goes where the user expects (not on the parent panel underneath).
  maybeEnterSubPanelAt(pos);

  const panel = activePanel();
  if (panel.kind === "timelapse") return;
  let layer = activeLayer();
  if (!layer || !layer.visible) return;
  // Drawing into a text layer is disallowed; switch to first draw layer.
  if (layer.kind === "text") {
    const c = activeContainer();
    const idx = c.layers.findIndex(l => l.kind !== "text");
    if (idx < 0) return;
    c.setActiveLayerIndex(idx);
    buildLayers();
    layer = activeLayer();
    if (!layer || !layer.visible) return;
  }

  const regionClip = activeRegionShape(selectionState);
  if (regionClip && !activeRegionContains(selectionState, pos) &&
      currentBrush !== MARQUEE_KEY && currentBrush !== SELECT_KEY && currentBrush !== MOVE_LAYER_KEY) {
    setStatus("Click inside the selection");
    return;
  }

  if (currentBrush === BUCKET_KEY) {
    const layer2 = activeLayer()!;
    const clipShape = regionClip;
    const fill: Fill = {
      point: pos,
      color: currentColor,
      seed: Date.now() & 0x7fffffff,
      afterStrokeIndex: layer2.strokes.length - 1,
      tolerance: currentFillTolerance,
      gapClosePx: currentFillGapClosePx,
      referenceMode: currentFillReferenceMode,
      ...(clipShape ? {
        clipShape: JSON.parse(JSON.stringify(clipShape)) as SelectionShape,
        clipInverted: selectionState?.mode === "region" ? !!selectionState.inverted : false,
      } : {}),
    };
    layer2.fills.push(fill);
    commitHistory([layer2]);
    return;
  }

  drawing = true;
  drawingPointerId = e.pointerId;
  capturePointer(e);
  const c = activeContainer();
  liveStrokeLayer = layer;
  liveStrokeLayerIndex = c.getActiveLayerIndex();
  liveStrokeStrokeIndex = layer.strokes.length;
  liveStrokeSubPanelId = activeSubPanelId;
  // Perspective snap: lock this stroke to a guide line through its start.
  // Hold Alt to draw free.
  const snapGuide = activePerspectiveGuide();
  perspectiveSnapLock = snapGuide && snapGuide.enabled && snapGuide.snapEnabled && !e.altKey
    ? { origin: pos, proj: null, guide: snapGuide }
    : null;
  const firstPressure = pressureForNewStroke(e);
  liveSmoothingSession = createStrokeSmoothingSession(
    { point: pos, pressure: firstPressure },
    project.drawingSettings.smoothing
  );
  liveStroke = {
    brush: currentBrush, color: currentColor, size: currentSize,
    brushSettings: { ...currentBrushSettings },
    points: [applyPerspectiveSnap(pos)], pressures: [firstPressure],
  };
});

canvas.addEventListener("pointermove", (e) => {
  const hoverPos = canvasPos(e);
  lastCanvasPointerPos = hoverPos;
  if (e.buttons === 0) updateCanvasCursor(hoverPos);

  if (panDrag) {
    if (e.pointerId !== panDrag.pointerId) return;
    viewport = {
      ...viewport,
      tx: panDrag.tx + e.clientX - panDrag.x,
      ty: panDrag.ty + e.clientY - panDrag.y,
    };
    applyViewport();
    e.preventDefault();
    return;
  }
  if (pendingRegionTransform) {
    if (e.pointerId !== pendingRegionTransform.pointerId) return;
    const pos = hoverPos;
    if (Math.hypot(pos.x - pendingRegionTransform.startPos.x, pos.y - pendingRegionTransform.startPos.y) < 0.5) {
      return;
    }
    const pending = pendingRegionTransform;
    pendingRegionTransform = null;
    if (beginObjectSelectionTransform(pending.handle, pending.startPos)) {
      applyActiveSelectionTransform(pos, e.shiftKey, e.altKey);
    }
    return;
  }
  if (perspectiveDrag) {
    if (e.pointerId !== perspectiveDrag.pointerId) return;
    const guide = activePerspectiveGuide();
    if (guide) {
      const pos = hoverPos;
      if (perspectiveDrag.target === "radius") {
        const c = guide.vps[0];
        if (c) guide.radius = Math.max(FISHEYE_MIN_RADIUS, Math.hypot(pos.x - c.x, pos.y - c.y));
      } else if (perspectiveDrag.target === "horizon") {
        const dy = pos.y - guide.horizonY;
        guide.horizonY = pos.y;
        // Horizon-bound VPs ride along (the third VP in 3p stays put).
        const riders = guide.kind === "3p" ? guide.vps.slice(0, 2) : guide.vps;
        for (const vp of riders) vp.y += dy;
      } else if (typeof perspectiveDrag.target === "string") {
        // pole0..pole3 — spin and resize the fisheye lens together.
        const c = guide.vps[0];
        if (c) {
          const k = +perspectiveDrag.target.slice(4);
          const d = Math.hypot(pos.x - c.x, pos.y - c.y);
          guide.radius = Math.max(FISHEYE_MIN_RADIUS, d);
          if (d > 1e-3) {
            guide.rotation = Math.atan2(pos.y - c.y, pos.x - c.x) - (k * Math.PI) / 2;
          }
        }
      } else {
        const vp = guide.vps[perspectiveDrag.target];
        if (vp) {
          vp.x = pos.x;
          vp.y = pos.y;
          if (guide.kind === "1p") guide.horizonY = pos.y;
        }
      }
    }
    e.preventDefault();
    return;
  }
  if (selectDrag) {
    const pos = canvasPos(e);
    if (selectDrag.kind === "text") {
      selectDrag.ref.text.x = pos.x - selectDrag.offset.x;
      selectDrag.ref.text.y = pos.y - selectDrag.offset.y;
      bumpLayerVersion(selectDrag.ref.layer);
    } else if (selectDrag.kind === "move" || selectDrag.kind === "tail") {
      const drag = selectDrag;
      const sp = (activePanel().subPanels ?? []).find(s => s.id === drag.subPanelId);
      if (sp) {
        if (drag.kind === "move") {
          sp.bounds.x = pos.x - drag.offset.x;
          sp.bounds.y = pos.y - drag.offset.y;
        } else {
          sp.tail = { x: pos.x, y: pos.y };
        }
      }
    }
    return;
  }
  if (selectionState) {
    const pos = hoverPos;
    if (selectionState.mode === "region" && selectionState.phase === "creating") {
      const path = [...(selectionState.lassoPath ?? [])];
      if (selectionState.tool === "lasso") {
        path.push(pos);
        selectionState = { ...selectionState, lassoPath: path, shape: { kind: "polygon", points: path } };
      } else {
        const start = path[0] ?? pos;
        const shape = selectionState.tool === "ellipse"
          ? ellipseFromDrag(start, pos, e.shiftKey)
          : rectFromDrag(start, pos);
        selectionState = { ...selectionState, lassoPath: [start, pos], shape };
      }
      return;
    }
    if (selectionState.phase === "moving" && selectionState.lastPos) {
      const dx = pos.x - selectionState.lastPos.x;
      const dy = pos.y - selectionState.lastPos.y;
      if (selectionState.mode === "region") {
        if (dx === 0 && dy === 0) return;
        const shape = selectionState.shape;
        const items = cutAtShape(shape, !!selectionState.inverted);
        if (items.length > 0) {
          moveMarqueeItems(items, dx, dy);
          bumpMarqueeItemLayers(items);
          selectionState = {
            mode: "object",
            phase: "moving",
            shape: translateShape(shape, dx, dy),
            bounds: boundsFromItems(items, measureText),
            items,
            lastPos: pos,
          };
          buildEditContext();
        } else {
          selectionState = {
            ...selectionState,
            shape: translateShape(shape, dx, dy),
            lastPos: pos,
          };
        }
      } else {
        moveMarqueeItems(selectionState.items, dx, dy);
        bumpMarqueeItemLayers(selectionState.items);
        selectionState = {
          ...selectionState,
          bounds: { ...selectionState.bounds, x: selectionState.bounds.x + dx, y: selectionState.bounds.y + dy },
          shape: translateShape(selectionState.shape, dx, dy),
          lastPos: pos,
        };
      }
      return;
    }
    if (applyActiveSelectionTransform(pos, e.shiftKey, e.altKey)) {
      return;
    }
  }
  if (currentBrush === SCALE_KEY && scaleToolDrag && e.buttons !== 0) {
    const pos = canvasPos(e);
    const { handle, pivot, startBounds, snapshots, items } = scaleToolDrag;
    if (handle === "rotate") {
      const angleRad = Math.atan2(pos.y - pivot.y, pos.x - pivot.x) - scaleToolDrag.startAngle;
      for (const snap of snapshots) {
        restoreFromSnapshot(snap);
        applyTransformToSnapshot(snap, pivot, 1, 1, angleRad, true);
      }
    } else {
      const t = computeTransformFromHandle(handle, startBounds, pivot, pos, e.shiftKey, e.altKey);
      for (const snap of snapshots) {
        restoreFromSnapshot(snap);
        applyTransformToSnapshot(snap, pivot, t.scaleX, t.scaleY, 0, false);
      }
    }
    bumpMarqueeItemLayers(items);
    scaleToolDrag = { ...scaleToolDrag, bounds: boundsFromItems(items, measureText) };
    if (selectionState?.mode === "object") {
      selectionState = { ...selectionState, bounds: boundsFromItems(selectionState.items, measureText) };
    }
    return;
  }
  if (layerMoveDrag) {
    const pos = canvasPos(e);
    const dx = pos.x - layerMoveDrag.lastPos.x;
    const dy = pos.y - layerMoveDrag.lastPos.y;
    const layer = layerMoveDrag.layer;
    if (layer && (dx !== 0 || dy !== 0)) {
      if (layerMoveDrag.keyframe) {
        const anim = ensureLayerAnimation(layer);
        anim.enabled = true;
        anim[layerMoveDrag.keyframe].x += dx;
        anim[layerMoveDrag.keyframe].y += dy;
      } else {
        layerMoveDrag.totalDx += dx;
        layerMoveDrag.totalDy += dy;
      }
      layerMoveDrag.lastPos = pos;
      layerMoveDrag.moved = true;
    }
    return;
  }
  if (subPanelDrag) {
    subPanelDrag.end = canvasPos(e);
    return;
  }
  if (!drawing || !liveStroke) return;
  if (drawingPointerId !== null && e.pointerId !== drawingPointerId) return;
  const samples = e.getCoalescedEvents?.() ?? [];
  for (const sample of samples.length ? samples : [e]) appendLiveStrokeSample(sample);
  e.preventDefault();
});


canvas.addEventListener("auxclick", (e) => {
  if (e.button === 1) e.preventDefault();
});

canvas.addEventListener("pointerleave", () => {
  lastCanvasPointerPos = null;
  canvas.style.cursor = "";
});

window.addEventListener("pointerup", (e) => {
  // Commit any in-progress brush stroke first. Pointer-specific drags (selection
  // moving, scale, pan) must not steal the lift and orphan an uncommitted stroke.
  if (drawing && (drawingPointerId === null || e.pointerId === drawingPointerId)) {
    finishLiveStrokeSmoothing();
    if (liveStroke) commitLiveStroke();
    drawing = false;
    drawingPointerId = null;
    liveStrokeHasRealPressure = false;
    clearLiveStrokeState();
  }
  if (panDrag) {
    if (e.pointerId === panDrag.pointerId) {
      panDrag = null;
      stageArea.classList.remove("panning");
    }
    return;
  }
  if (perspectiveDrag) {
    perspectiveDrag = null;
    // Guides aren't layer content — no layer bumps needed.
    commitHistory([]);
    return;
  }
  if (selectDrag) {
    selectDrag = null;
    commitHistory();
    buildInspector();
    return;
  }
  if (pendingRegionTransform) {
    if (e.pointerId === pendingRegionTransform.pointerId) {
      pendingRegionTransform = null;
      updateCanvasCursor(lastCanvasPointerPos ?? undefined);
    }
    return;
  }
  if (selectionState) {
    if (selectionState.mode === "region" && selectionState.phase === "creating") {
      let shape = selectionState.shape;
      if (selectionState.tool === "lasso" && selectionState.lassoPath) {
        shape = { kind: "polygon", points: simplifyLassoPath(selectionState.lassoPath) };
      }
      if (!shapeMeetsMinSize(shape)) {
        clearSelection();
        buildEditContext();
        return;
      }
      selectionState = { mode: "region", phase: "idle", shape, tool: selectionState.tool };
      buildEditContext();
      setStatus("Selection active · drag or use handles to cut · paint inside · Esc to clear");
      return;
    }
    if (selectionState.phase === "moving") {
      if (selectionState.mode === "object") {
        selectionState = {
          mode: "object",
          phase: "idle",
          shape: selectionState.shape,
          bounds: selectionState.bounds,
          items: selectionState.items,
        };
        commitHistory();
      } else {
        selectionState = {
          mode: "region",
          phase: "idle",
          shape: selectionState.shape,
          tool: selectionState.tool,
        };
      }
      buildEditContext();
      updateCanvasCursor(lastCanvasPointerPos ?? undefined);
      return;
    }
    if (selectionState.mode === "object" && selectionState.phase === "transforming") {
      transformSnapshots = null;
      selectionState = {
        mode: "object",
        phase: "idle",
        shape: selectionState.shape,
        bounds: boundsFromItems(selectionState.items, measureText),
        items: selectionState.items,
      };
      commitHistory();
      buildEditContext();
      updateCanvasCursor(lastCanvasPointerPos ?? undefined);
      return;
    }
  }
  if (currentBrush === SCALE_KEY && scaleToolDrag) {
    scaleToolDrag = null;
    commitHistory();
    updateCanvasCursor(lastCanvasPointerPos ?? undefined);
    return;
  }
  if (layerMoveDrag) {
    const drag = layerMoveDrag;
    const moved = drag.moved;
    const wasKeyframe = !!drag.keyframe;
    if (moved && !wasKeyframe) {
      moveLayerContents(drag.layer, drag.totalDx, drag.totalDy);
      for (const dependent of drag.dependents) {
        moveLayerContents(dependent, drag.totalDx, drag.totalDy);
      }
    }
    layerMoveDrag = null;
    if (moved) {
      commitHistory();
      if (wasKeyframe) keyframeArm = null;
      buildTimeline();
      buildLayers();
      buildInspector();
      buildBrushBar();
    }
    return;
  }
  if (subPanelDrag) {
    const { start, end } = subPanelDrag;
    subPanelDrag = null;
    const bx = Math.min(start.x, end.x);
    const by = Math.min(start.y, end.y);
    const bw = Math.abs(end.x - start.x);
    const bh = Math.abs(end.y - start.y);
    if (bw > 20 && bh > 20) createSubPanel({ x: bx, y: by, w: bw, h: bh });
    return;
  }
  if (drawing && drawingPointerId !== null && e.pointerId !== drawingPointerId) return;
  if (drawing && liveStroke) {
    finishLiveStrokeSmoothing();
    commitLiveStroke();
  }
  drawing = false;
  drawingPointerId = null;
  liveStrokeHasRealPressure = false;
  clearLiveStrokeState();
});

window.addEventListener("pointercancel", (e) => {
  if (pendingRegionTransform && e.pointerId === pendingRegionTransform.pointerId) {
    pendingRegionTransform = null;
    return;
  }
  if (perspectiveDrag && e.pointerId === perspectiveDrag.pointerId) {
    perspectiveDrag = null;
    commitHistory([]);
    return;
  }
  if (scaleToolDrag) {
    for (const snap of scaleToolDrag.snapshots) restoreFromSnapshot(snap);
    bumpMarqueeItemLayers(scaleToolDrag.items);
    scaleToolDrag = null;
    return;
  }
  if (!drawing) return;
  if (drawingPointerId !== null && e.pointerId !== drawingPointerId) return;
  finishLiveStrokeSmoothing();
  if (liveStroke) commitLiveStroke();
  drawing = false;
  drawingPointerId = null;
  liveStrokeHasRealPressure = false;
  clearLiveStrokeState();
});

function hasLiveEditorInteraction(): boolean {
  return drawing ||
    !!liveStroke ||
    !!selectDrag ||
    !!layerMoveDrag ||
    !!subPanelDrag ||
    !!perspectiveDrag ||
    !!scaleToolDrag ||
    selectionState?.phase === "creating" ||
    selectionState?.phase === "moving" ||
    selectionState?.phase === "transforming";
}

// Double-click: enter a sub-panel, or exit if outside any.
canvas.addEventListener("dblclick", (e) => {
  if (playing) return;
  const pos = canvasPos(e);
  const panel = activePanel();
  const sps = panel.subPanels ?? [];
  for (let i = sps.length - 1; i >= 0; i--) {
    if (isInsideBounds(pos.x, pos.y, sps[i].bounds)) {
      activeSubPanelId = sps[i].id;
      selectedSubPanelId = sps[i].id;
      clearSelection();
      buildBreadcrumb();
      buildLayers();
      buildInspector();
      buildEditContext();
      return;
    }
  }
  if (activeSubPanelId) {
    activeSubPanelId = null;
    clearSelection();
    buildBreadcrumb();
    buildLayers();
    buildInspector();
    buildEditContext();
  }
});

// Single click on a sub-panel = select for inspector (only when at panel root).
canvas.addEventListener("click", (e) => {
  if (playing) return;
  if (activeSubPanelId) return;
  if (TOOL_KEYS.has(currentBrush)) return;
  const pos = canvasPos(e);
  const sps = activePanel().subPanels ?? [];
  for (let i = sps.length - 1; i >= 0; i--) {
    if (isInsideBounds(pos.x, pos.y, sps[i].bounds)) {
      selectedSubPanelId = sps[i].id;
      buildInspector();
      return;
    }
  }
  if (selectedSubPanelId) { selectedSubPanelId = null; buildInspector(); }
});

// ---- viewport controls ----------------------------------------------------

stageArea.addEventListener("wheel", (e) => {
  if (!e.metaKey && !e.ctrlKey) return;
  e.preventDefault();
  const nextScale = viewport.scale * Math.exp(-e.deltaY * 0.0015);
  viewport = zoomAboutPoint(canvas, stageArea, nextScale, e.clientX, e.clientY);
  applyViewport();
}, { passive: false });

function zoomStep(multiplier: number) {
  const rect = stageArea.getBoundingClientRect();
  viewport = zoomAboutPoint(
    canvas,
    stageArea,
    viewport.scale * multiplier,
    rect.left + rect.width / 2,
    rect.top + rect.height / 2
  );
  applyViewport();
}

($("zoom-out") as HTMLButtonElement).onclick = () => zoomStep(0.8);
($("zoom-in") as HTMLButtonElement).onclick = () => zoomStep(1.25);
($("zoom-label") as HTMLButtonElement).onclick = () => resetViewport();
($("zoom-fit") as HTMLButtonElement).onclick = () => fitViewport();

for (const id of ["zoom-out", "zoom-label", "zoom-in", "zoom-fit"]) {
  const btn = $(id) as HTMLButtonElement;
  let pointerActivated = false;
  btn.addEventListener("pointerdown", () => { pointerActivated = true; });
  btn.addEventListener("click", () => {
    if (!pointerActivated) return;
    pointerActivated = false;
    btn.blur();
  });
  btn.addEventListener("blur", () => { pointerActivated = false; });
}

// ---- text input overlay ---------------------------------------------------

function openTextInputAt(pos: { x: number; y: number }) {
  const r = canvas.getBoundingClientRect();
  const sx = r.left + ((pos.x + overscanX) / canvas.width) * r.width;
  const sy = r.top + ((pos.y + overscanY) / canvas.height) * r.height;
  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "type · Enter ok · Esc cancel";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.style.cssText = `
    position: fixed; left: ${sx}px; top: ${sy}px; z-index: 70;
    font-family: "${currentFont}", sans-serif;
    font-size: ${Math.max(12, currentFontSize * (r.width / canvas.width))}px;
    color: ${currentColor};
    background: rgba(26,21,18,0.94);
    border: 2px solid var(--accent);
    border-radius: 6px; padding: 4px 8px;
    outline: none; min-width: 140px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.5);
  `;
  document.body.appendChild(input);

  let committed = false;
  const cleanup = () => { if (input.parentNode) input.remove(); };
  const commit = () => {
    if (committed) return;
    committed = true;
    const content = input.value.trim();
    cleanup();
    if (content) addTextElement(pos, content);
  };

  // Defer focus past the originating click so the just-completed pointerup
  // doesn't blur us out before the user can type. Without this, Electron in
  // particular tends to refocus the canvas after the click, blur-committing
  // the empty input.
  setTimeout(() => input.focus(), 0);

  input.addEventListener("keydown", (ev) => {
    ev.stopPropagation();
    if (ev.key === "Enter") commit();
    else if (ev.key === "Escape") { committed = true; cleanup(); }
  });
  // Only commit on blur if the user actually typed something. An empty-input
  // blur is treated as a silent cancel — covers the "click again to dismiss"
  // case without losing what you were about to type.
  input.addEventListener("blur", () => {
    if (input.value.trim().length > 0) commit();
    else { committed = true; cleanup(); }
  });
}

function addTextElement(pos: { x: number; y: number }, content: string) {
  const tl = ensureTextLayer();
  const t: TextElement = {
    id: crypto.randomUUID(),
    x: pos.x,
    y: pos.y - currentFontSize * 0.8,
    content,
    fontFamily: currentFont,
    fontSize: currentFontSize,
    color: currentColor,
    wiggleAmplitude: currentTextWiggle,
  };
  tl.texts!.push(t);
  commitHistory();
  buildLayers();
}

// ---- sub-panel creation ---------------------------------------------------

function createSubPanel(bounds: { x: number; y: number; w: number; h: number }) {
  // Use the current draw brush for the border; fall back to "round".
  const brush = TOOL_KEYS.has(currentBrush) ? "round" : currentBrush;
  const sp = newSubPanel(bounds, {
    brush,
    color: currentColor,
    thickness: Math.max(2, currentSize),
    wiggleAmplitude: 2,
  });
  const p = activePanel();
  if (!p.subPanels) p.subPanels = [];
  p.subPanels.push(sp);
  selectedSubPanelId = sp.id;
  // Auto-enter the freshly-created sub-panel so the next stroke / fill / text
  // lands inside it. Click the "Panel N" breadcrumb to go back out.
  activeSubPanelId = sp.id;
  commitHistory();
  buildBreadcrumb();
  buildLayers();
  buildInspector();
}

/**
 * Auto-enter the topmost sub-panel containing `pos`. Called from pointerdown
 * for draw/bucket/text tools so the user's first stroke inside a sub-panel
 * routes there without needing the double-click-to-enter step.
 */
function maybeEnterSubPanelAt(pos: { x: number; y: number }): boolean {
  if (activeSubPanelId) return false;
  const sps = activePanel().subPanels ?? [];
  for (let i = sps.length - 1; i >= 0; i--) {
    if (isInsideBounds(pos.x, pos.y, sps[i].bounds)) {
      activeSubPanelId = sps[i].id;
      selectedSubPanelId = sps[i].id;
      buildBreadcrumb();
      buildLayers();
      buildInspector();
      return true;
    }
  }
  return false;
}

function currentBaseFrameCacheKey(panel: Panel): string {
  return baseFrameCacheKey({
    panelId: panel.id,
    contentVersion: renderContentVersion,
    tick: wiggleTick,
    width: project.width,
    height: project.height,
    overscanX,
    overscanY,
    jitterEnabled,
    keyframeArm,
  });
}

function ensureBaseFrameCache() {
  if (!baseFrameCache) {
    const off = document.createElement("canvas");
    baseFrameCache = { key: "", canvas: off, ctx: off.getContext("2d")! };
  }
  if (baseFrameCache.canvas.width !== canvas.width) {
    baseFrameCache.canvas.width = canvas.width;
    baseFrameCache.key = "";
  }
  if (baseFrameCache.canvas.height !== canvas.height) {
    baseFrameCache.canvas.height = canvas.height;
    baseFrameCache.key = "";
  }
  return baseFrameCache;
}

function drawCachedBaseFrame(panel: Panel) {
  const cache = ensureBaseFrameCache();
  const key = currentBaseFrameCacheKey(panel);
  if (cache.key !== key) {
    renderPanel(cache.ctx, panel, wiggleTick, project.width, project.height, {
      allPanels: project.panels,
      timelapseProgress: panel.kind === "timelapse" ? 1 : undefined,
      skipAnim: keyframeArm ? false : true,
      skipJitter: !jitterEnabled,
      layerPreviewOffset: layerMovePreviewOffset(),
      localMs: keyframeArm === "to" ? panel.durationMs : 0,
      wiggleFps: project.wiggleFps,
      overscan: { x: overscanX, y: overscanY },
      renderCache: displayRenderCache,
      contentVersion: renderContentVersion,
      deferFillMasks: true,
    });
    cache.key = key;
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
  ctx.drawImage(cache.canvas, 0, 0);
}

function paintEditorPanelBackground(panel: Panel) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = panel.bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function drawEditorActiveContent(panel: Panel, label: string) {
  profileRender(label, () => renderPanel(ctx, panel, wiggleTick, project.width, project.height, {
    allPanels: project.panels,
    timelapseProgress: panel.kind === "timelapse" ? 1 : undefined,
    skipAnim: keyframeArm ? false : true,
    skipBg: true,
    skipJitter: !jitterEnabled,
    layerPreviewOffset: layerMovePreviewOffset(),
    localMs: keyframeArm === "to" ? panel.durationMs : 0,
    wiggleFps: project.wiggleFps,
    overscan: { x: overscanX, y: overscanY },
    renderCache: displayRenderCache,
    contentVersion: renderContentVersion,
    deferFillMasks: true,
  }));
}

function drawOnionFramesBehindActive(panel: Panel) {
  const passes = editorPreviewPasses({
    onionEnabled: onionEnabled && panel.kind !== "timelapse",
    prevAvailable: activePanelIndex,
    nextAvailable: Math.max(0, project.panels.length - activePanelIndex - 1),
    prevCount: onionPrevCount,
    nextCount: onionNextCount,
    opacity: onionOpacity,
  });
  for (const pass of passes) {
    if (pass.kind === "active") continue;
    const onionPanel = project.panels[activePanelIndex + pass.offset];
    if (!onionPanel) continue;
    drawTintedOnionFrame(pass.offset, onionPanel, pass.tint, pass.alpha, `idle-${pass.kind}-${Math.abs(pass.offset)}`);
  }
}

function drawEditorPanelWithOnion(panel: Panel, activeLabel: string) {
  paintEditorPanelBackground(panel);
  drawOnionFramesBehindActive(panel);
  drawEditorActiveContent(panel, activeLabel);
}

function liveStrokePreviewSegments(): Stroke[] {
  if (!liveStroke) return [];
  const clipShape = activeRegionShape(selectionState);
  if (!clipShape) return [liveStroke];
  const inverted = selectionState?.mode === "region" ? !!selectionState.inverted : false;
  const { inside, outside } = splitStrokeAtShape(liveStroke, clipShape);
  const segments = inverted ? outside : inside;
  return segments.filter((seg) => seg.points.length >= 1);
}

function drawLiveErasePreviewFrame() {
  if (!liveStroke || !liveStrokeLayer) return;
  const panel = activePanel();
  const segments = liveStrokePreviewSegments();
  const insertAt = liveStrokeLayer.strokes.length;
  liveStrokeLayer.strokes.push(...segments);
  try {
    if (onionEnabled && panel.kind !== "timelapse") {
      drawEditorPanelWithOnion(panel, "live-erase-active");
    } else {
      renderPanel(ctx, panel, wiggleTick, project.width, project.height, {
        allPanels: project.panels,
        timelapseProgress: panel.kind === "timelapse" ? 1 : undefined,
        skipAnim: keyframeArm ? false : true,
        skipJitter: !jitterEnabled,
        layerPreviewOffset: layerMovePreviewOffset(),
        localMs: keyframeArm === "to" ? panel.durationMs : 0,
        wiggleFps: project.wiggleFps,
        overscan: { x: overscanX, y: overscanY },
        contentVersion: renderContentVersion,
        deferFillMasks: true,
        skipFillMaskCache: true,
      });
    }
  } finally {
    liveStrokeLayer.strokes.splice(insertAt, segments.length);
  }
}

// Onion-skin frames re-render only when panel content / tick / dims change —
// same key inputs as the base frame cache. Between misses, each idle frame is
// just one drawImage at onionOpacity instead of a full renderPanel.
const onionFrameCache = new Map<number, { key: string; canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D }>();
let tintedOnionCanvas: HTMLCanvasElement | null = null;
let tintedOnionCtx: CanvasRenderingContext2D | null = null;

function cachedOnionFrame(slot: number, panel: Panel, label: string): HTMLCanvasElement {
  let cache = onionFrameCache.get(slot);
  if (!cache) {
    const off = document.createElement("canvas");
    cache = { key: "", canvas: off, ctx: off.getContext("2d")! };
    onionFrameCache.set(slot, cache);
  }
  if (cache.canvas.width !== canvas.width) {
    cache.canvas.width = canvas.width;
    cache.key = "";
  }
  if (cache.canvas.height !== canvas.height) {
    cache.canvas.height = canvas.height;
    cache.key = "";
  }
  const key = currentBaseFrameCacheKey(panel);
  if (cache.key !== key) {
    const c = cache;
    profileRender(label, () => {
      // skipBg renders leave the target uncleared — clear stale content first.
      c.ctx.clearRect(0, 0, c.canvas.width, c.canvas.height);
      renderPanel(c.ctx, panel, wiggleTick, project.width, project.height, {
        skipBg: true, skipFills: true, skipAnim: true,
        allPanels: project.panels,
        timelapseProgress: panel.kind === "timelapse" ? 1 : undefined,
        skipJitter: !jitterEnabled,
        overscan: { x: overscanX, y: overscanY },
        renderCache: displayRenderCache,
        contentVersion: renderContentVersion,
      });
    });
    cache.key = key;
  }
  return cache.canvas;
}

function drawTintedOnionFrame(slot: number, panel: Panel, tint: string, alpha: number, label: string) {
  const source = cachedOnionFrame(slot, panel, label);
  if (!tintedOnionCanvas) {
    tintedOnionCanvas = document.createElement("canvas");
    tintedOnionCtx = tintedOnionCanvas.getContext("2d")!;
  }
  if (tintedOnionCanvas.width !== canvas.width) tintedOnionCanvas.width = canvas.width;
  if (tintedOnionCanvas.height !== canvas.height) tintedOnionCanvas.height = canvas.height;
  const tctx = tintedOnionCtx!;
  tctx.setTransform(1, 0, 0, 1, 0, 0);
  tctx.globalCompositeOperation = "source-over";
  tctx.globalAlpha = 1;
  tctx.clearRect(0, 0, tintedOnionCanvas.width, tintedOnionCanvas.height);
  tctx.drawImage(source, 0, 0);
  tctx.globalCompositeOperation = "source-in";
  tctx.fillStyle = tint;
  tctx.fillRect(0, 0, tintedOnionCanvas.width, tintedOnionCanvas.height);
  tctx.globalCompositeOperation = "source-over";

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.drawImage(tintedOnionCanvas, 0, 0);
  ctx.restore();
}

function drawLiveStrokeOverlay() {
  if (!liveStroke) return;
  const panel = activePanel();
  const sp = liveStrokeSubPanelId
    ? (panel.subPanels ?? []).find(s => s.id === liveStrokeSubPanelId)
    : undefined;

  ctx.save();
  ctx.beginPath();
  ctx.rect(overscanX, overscanY, project.width, project.height);
  ctx.clip();
  if (overscanX > 0 || overscanY > 0) ctx.translate(overscanX, overscanY);

  let bg = panel.bg;
  let subPanelShapePoints: Vec2[] | null = null;
  if (sp) {
    subPanelShapePoints = shapePoints(sp.shape, sp.bounds, sp.tail);
    ctx.save();
    ctx.clip(pointsToPath(subPanelShapePoints));
    bg = sp.bg ?? "#000000";
  }

  const clip = activeRegionShape(selectionState);
  if (clip) {
    ctx.save();
    ctx.beginPath();
    traceShapePath(ctx, clip);
    ctx.clip();
  }
  renderStroke(ctx, liveStroke, wiggleTick, {
    layerIndex: liveStrokeLayerIndex,
    strokeIndex: liveStrokeStrokeIndex,
    bg,
    skipJitter: !jitterEnabled,
  });
  if (clip) ctx.restore();
  if (sp) ctx.restore();
  if (sp && subPanelShapePoints) {
    strokeBorder(
      ctx,
      subPanelShapePoints,
      sp.border.brush,
      sp.border.color,
      sp.border.thickness,
      wiggleTick,
      jitterEnabled ? sp.border.wiggleAmplitude : 0,
      hashId(sp.id),
      sp.bg ?? "#000000"
    );
  }
  ctx.restore();
}

function drawStabilizerLeashOverlay(targetCtx: CanvasRenderingContext2D) {
  if (!drawing || !liveSmoothingSession || liveSmoothingSession.settings.mode !== "stabilizer") return;
  if (playing || panDrag || spacePanDown) return;
  const raw = liveSmoothingSession.lastRaw.point;
  const output = applyPerspectiveSnap(liveSmoothingSession.lastOutput.point);
  if (Math.hypot(raw.x - output.x, raw.y - output.y) < 1) return;

  targetCtx.save();
  targetCtx.beginPath();
  targetCtx.rect(0, 0, project.width, project.height);
  targetCtx.clip();
  targetCtx.strokeStyle = "rgba(255,205,117,0.7)";
  targetCtx.lineWidth = Math.max(1, 1.5 / viewport.scale);
  targetCtx.setLineDash([6 / viewport.scale, 5 / viewport.scale]);
  targetCtx.beginPath();
  targetCtx.moveTo(output.x, output.y);
  targetCtx.lineTo(raw.x, raw.y);
  targetCtx.stroke();
  targetCtx.setLineDash([]);
  targetCtx.fillStyle = "rgba(255,205,117,0.95)";
  targetCtx.beginPath();
  targetCtx.arc(raw.x, raw.y, Math.max(2, 4 / viewport.scale), 0, Math.PI * 2);
  targetCtx.fill();
  targetCtx.restore();
}

function drawEraserCursorOverlay(targetCtx: CanvasRenderingContext2D) {
  const points = drawing && liveStroke && isEraseBrushKey(liveStroke.brush)
    ? liveStroke.points
    : !drawing && lastCanvasPointerPos && isEraseBrushKey(currentBrush)
    ? [lastCanvasPointerPos]
    : null;
  if (!points || points.length === 0) return;

  targetCtx.save();
  targetCtx.beginPath();
  targetCtx.rect(0, 0, project.width, project.height);
  targetCtx.clip();

  const clip = activeRegionShape(selectionState);
  if (clip) {
    targetCtx.beginPath();
    traceShapePath(targetCtx, clip);
    targetCtx.clip();
  }

  drawEraserTracePreview(targetCtx, {
    brushSize: liveStroke?.size ?? currentSize,
    points,
  });
  targetCtx.restore();
}

function drawMaskOverlay(targetCtx: CanvasRenderingContext2D) {
  const layer = activeLayer();
  const mask = layer?.mask;
  if (!layer || !mask || maskOverlayLayerId !== layer.id) return;
  targetCtx.save();
  targetCtx.beginPath();
  traceShapePath(targetCtx, mask.shape);
  targetCtx.fillStyle = mask.mode === "reveal"
    ? "rgba(115, 239, 247, 0.18)"
    : "rgba(255, 110, 110, 0.18)";
  targetCtx.fill();
  targetCtx.beginPath();
  traceShapePath(targetCtx, mask.shape);
  targetCtx.strokeStyle = mask.enabled ? "rgba(115, 239, 247, 0.9)" : "rgba(148, 176, 194, 0.65)";
  targetCtx.lineWidth = 3;
  targetCtx.setLineDash([10, 6]);
  targetCtx.stroke();
  targetCtx.restore();
}

// Perspective guide overlay — editor-only (drawn after renderPanel, never part
// of exports or thumbnails). Coordinates are frame space; the caller has
// already translated by the overscan offset.
function drawPerspectiveGuideLines(ctx: CanvasRenderingContext2D, guide: PerspectiveGuide) {
  const w = project.width, h = project.height;
  ctx.strokeStyle = "#6ec3ff";
  ctx.lineWidth = 1.5;

  // Converging lines, clipped to the frame so off-canvas VPs stay tidy.
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  ctx.clip();
  if (guide.kind === "grid") {
    const step = 96;
    ctx.beginPath();
    for (let x = step; x < w; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
    for (let y = step; y < h; y += step) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
    ctx.stroke();
  } else if (guide.kind === "fisheye") {
    const c = guide.vps[0];
    if (c) {
      const R = fisheyeRadius(guide);
      // Draw the whole lens in its rotated frame so the curvilinear grid
      // tilts with the rim poles.
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate(fisheyeRotation(guide));
      // Lens rim
      ctx.beginPath();
      ctx.arc(0, 0, R, 0, Math.PI * 2);
      ctx.stroke();
      // Curvilinear grid: meridian/parallel circle arcs through the poles,
      // clipped to the lens disc, plus the straight diameters.
      ctx.save();
      ctx.beginPath();
      ctx.arc(0, 0, R, 0, Math.PI * 2);
      ctx.clip();
      ctx.beginPath();
      ctx.moveTo(-R, 0); ctx.lineTo(R, 0);
      ctx.moveTo(0, -R); ctx.lineTo(0, R);
      for (const s of [-0.8, -0.55, -0.28, 0.28, 0.55, 0.8]) {
        const k = (R * (s * s - 1)) / (2 * s);
        const r = Math.hypot(k, R);
        // moveTo the arc's angle-0 start point so no connecting chord is drawn.
        ctx.moveTo(k + r, 0);
        ctx.arc(k, 0, r, 0, Math.PI * 2);   // meridian (through top/bottom poles)
        ctx.moveTo(r, k);
        ctx.arc(0, k, r, 0, Math.PI * 2);   // parallel (through left/right poles)
      }
      ctx.stroke();
      ctx.restore();
      ctx.restore();
    }
  } else {
    const PER_EDGE = 7;
    for (const vp of guide.vps) {
      ctx.beginPath();
      for (let i = 0; i <= PER_EDGE; i++) {
        const t = i / PER_EDGE;
        const edgePts = [
          { x: t * w, y: 0 }, { x: t * w, y: h },
          { x: 0, y: t * h }, { x: w, y: t * h },
        ];
        for (const p of edgePts) {
          ctx.moveTo(vp.x, vp.y);
          ctx.lineTo(p.x, p.y);
        }
      }
      ctx.stroke();
    }
  }
  ctx.restore();

  // Horizon line (full width, on top of the fan). Fisheye uses its own
  // diameters instead.
  if (guide.kind !== "fisheye") {
    ctx.strokeStyle = "#ffcd75";
    ctx.beginPath();
    ctx.moveTo(-overscanX, guide.horizonY);
    ctx.lineTo(w + overscanX, guide.horizonY);
    ctx.stroke();
  }
}

function drawPerspectiveOverlay(ctx: CanvasRenderingContext2D) {
  if (activePanel().kind === "timelapse") return;
  const guide = activePerspectiveGuide();
  const toolActive = currentBrush === PERSPECTIVE_KEY;

  // While the tool is active, ghost the rulers bound to other layers so the
  // user can see where they are without them snapping anything.
  if (toolActive) {
    for (const other of activePanel().guides ?? []) {
      if (other === guide || !other.enabled) continue;
      ctx.save();
      ctx.globalAlpha = Math.min(0.12, other.opacity);
      drawPerspectiveGuideLines(ctx, other);
      ctx.restore();
    }
  }

  if (!guide || !guide.enabled) return;

  ctx.save();
  ctx.globalAlpha = guide.opacity;
  drawPerspectiveGuideLines(ctx, guide);

  // Handles — bright while the tool is active.
  ctx.globalAlpha = toolActive ? 0.95 : Math.min(1, guide.opacity * 1.6);
  const handles = [...guide.vps];
  if (guide.kind === "fisheye" && guide.vps[0]) {
    // Four rim poles: drag to spin and resize the lens.
    for (let k = 0; k < 4; k++) handles.push(fisheyePolePos(guide, k));
  }
  for (const vp of handles) {
    ctx.fillStyle = "#ffcd75";
    ctx.beginPath();
    ctx.arc(vp.x, vp.y, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#0e0e16";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(vp.x, vp.y, 9, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawSelectionOverlay(ctx: CanvasRenderingContext2D) {
  if (!selectionState) return;
  let shape: SelectionShape;
  let b: Rect;
  if (selectionState.mode === "region" && selectionState.phase === "creating") {
    shape = shapeFromCreating(selectionState as SelectionState & { mode: "region"; phase: "creating" });
    b = shapeBounds(shape);
  } else if (selectionState.mode === "object") {
    b = selectionState.bounds;
    shape = { kind: "rect", x: b.x, y: b.y, w: b.w, h: b.h };
  } else {
    shape = selectionState.shape;
    b = shapeBounds(shape);
  }

  ctx.save();
  ctx.strokeStyle = "rgba(255,205,117,0.95)";
  ctx.setLineDash([8, 8]);
  ctx.lineDashOffset = -antsOffset;
  ctx.lineWidth = 2;
  ctx.beginPath();
  traceShapePath(ctx, shape);
  ctx.stroke();
  ctx.setLineDash([]);

  if (currentBrush === MARQUEE_KEY && selectionState.phase !== "creating" &&
      (selectionState.phase === "idle" || selectionState.phase === "transforming")) {
    const hs = transformHandleVisualHalfSize(viewport.scale);
    const corners = [
      { x: b.x, y: b.y }, { x: b.x + b.w, y: b.y },
      { x: b.x + b.w, y: b.y + b.h }, { x: b.x, y: b.y + b.h },
      { x: b.x + b.w / 2, y: b.y }, { x: b.x + b.w, y: b.y + b.h / 2 },
      { x: b.x + b.w / 2, y: b.y + b.h }, { x: b.x, y: b.y + b.h / 2 },
    ];
    ctx.fillStyle = "#ffcd75";
    for (const p of corners) ctx.fillRect(p.x - hs, p.y - hs, hs * 2, hs * 2);
    const rot = transformRotateHandleCenter(b, viewport.scale);
    ctx.beginPath();
    ctx.arc(rot.x, rot.y, hs, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#0e0e16";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(b.x + b.w / 2, b.y);
    ctx.lineTo(rot.x, rot.y);
    ctx.stroke();
  }

  if (selectionState.phase !== "creating") {
    ctx.fillStyle = "#ffcd75";
    ctx.font = "24px ui-monospace, monospace";
    let label: string;
    if (selectionState.mode === "object") {
      label = `${selectionState.items.length} extracted · Del to remove · Esc to clear`;
    } else if (currentBrush === MARQUEE_KEY) {
      label = "Region · drag/handle to cut · Esc to clear";
    } else {
      label = "Painting inside selection · Esc to clear";
    }
    ctx.fillText(label, b.x + 8, Math.max(36, b.y - 10));
  }
  ctx.restore();
}

function drawScaleToolOverlay(ctx: CanvasRenderingContext2D) {
  if (currentBrush !== SCALE_KEY) return;
  const target = scaleToolDrag
    ? { bounds: scaleToolDrag.bounds }
    : scaleToolItems();
  if (!target) return;
  const b = target.bounds;
  ctx.save();
  ctx.strokeStyle = "rgba(255,205,117,0.95)";
  ctx.setLineDash([8, 8]);
  ctx.lineDashOffset = -antsOffset;
  ctx.lineWidth = 2;
  ctx.strokeRect(b.x, b.y, b.w, b.h);
  ctx.setLineDash([]);
  const hs = transformHandleVisualHalfSize(viewport.scale);
  const handles = [
    { x: b.x, y: b.y }, { x: b.x + b.w, y: b.y },
    { x: b.x + b.w, y: b.y + b.h }, { x: b.x, y: b.y + b.h },
    { x: b.x + b.w / 2, y: b.y }, { x: b.x + b.w, y: b.y + b.h / 2 },
    { x: b.x + b.w / 2, y: b.y + b.h }, { x: b.x, y: b.y + b.h / 2 },
  ];
  ctx.fillStyle = "#ffcd75";
  for (const p of handles) ctx.fillRect(p.x - hs, p.y - hs, hs * 2, hs * 2);
  const rot = transformRotateHandleCenter(b, viewport.scale);
  ctx.beginPath();
  ctx.arc(rot.x, rot.y, hs, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#0e0e16";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(b.x + b.w / 2, b.y);
  ctx.lineTo(rot.x, rot.y);
  ctx.stroke();
  ctx.fillStyle = "#ffcd75";
  ctx.font = "24px ui-monospace, monospace";
  ctx.fillText("Scale · drag handles · Shift = constrain · Alt = from center", b.x + 8, Math.max(36, b.y - 10));
  ctx.restore();
}

// ---- three clocks ---------------------------------------------------------

let wiggleTick = 0;
let lastWiggle = 0;
let lastPlaybackRenderPanelIndex = -1;
let lastPlaybackRenderSeqTick = -1;
let lastSyncedThumbIndex = -1;

function loop(now: number) {
  if (perfEnabled) perfState.frames++;
  let tickChanged = false;
  if (now - lastWiggle >= 1000 / project.wiggleFps) {
    wiggleTick++;
    lastWiggle = now;
    tickChanged = true;
    if (perfEnabled) perfState.wiggleTicks++;
  }

  if (playing) {
    const elapsed = playheadStartMs + (now - playStart);
    const total = Math.max(1, projectPlaybackDuration());
    if (!loopPlayback && elapsed >= total) {
      void stopPlayback(total);
    } else {
      const e = loopPlayback ? elapsed % total : Math.min(elapsed, total - 1);
      if (loopPlayback && e < lastPlaybackMs) {
        void startAudioPreview(e);
      }
      playheadMs = e;
      lastPlaybackMs = e;
      const visualMs = Math.min(e, Math.max(0, projectVisualDuration() - 1));
      const seqPos = sequenceAtTime(project, visualMs);
      lastSequencePosition = seqPos;
      const { index, localMs } = seqPos;
      activePanelIndex = index;
      const panel = project.panels[index];
      const seqTick = Math.floor((localMs / 1000) * project.wiggleFps);
      if (shouldRenderPlaybackFrame({
        panelIndex: index,
        seqTick,
        lastPanelIndex: lastPlaybackRenderPanelIndex,
        lastSeqTick: lastPlaybackRenderSeqTick,
        continuous: panelHasPlaybackContinuity(panel),
      })) {
        profileRender("playback-main", () => renderPanel(ctx, panel, seqTick, project.width, project.height, {
          allPanels: project.panels,
          timelapseProgress: panel.kind === "timelapse"
            ? timelapseProgressQuantized(localMs, panel.durationMs, project.wiggleFps) : undefined,
          skipJitter: !jitterEnabled,
          localMs,
          wiggleFps: project.wiggleFps,
          overscan: { x: overscanX, y: overscanY },
          overscanDim: 1,
          renderCache: displayRenderCache,
          contentVersion: renderContentVersion,
        }));
        lastPlaybackRenderPanelIndex = index;
        lastPlaybackRenderSeqTick = seqTick;
      }
      syncActiveThumb();
      updatePlayheadChrome();
    }
  }
  const liveInteraction = hasLiveEditorInteraction();
  if (!playing && shouldRenderIdleFrame({ tickChanged, interacting: liveInteraction })) {
    const panel = activePanel();
    if (drawing && liveStroke) {
      if (isEraseBrushKey(liveStroke.brush)) {
        profileRender("live-erase", () => drawLiveErasePreviewFrame());
      } else {
        if (onionEnabled && panel.kind !== "timelapse") {
          drawEditorPanelWithOnion(panel, "live-base-active");
        } else {
          profileRender("live-base", () => drawCachedBaseFrame(panel));
        }
        profileRender("live-stroke", () => drawLiveStrokeOverlay());
      }
    } else {
      if (onionEnabled && panel.kind !== "timelapse") {
        drawEditorPanelWithOnion(panel, "idle-main-active");
      } else {
        profileRender("idle-main", () => renderPanel(ctx, panel, wiggleTick, project.width, project.height, {
          allPanels: project.panels,
          timelapseProgress: panel.kind === "timelapse" ? 1 : undefined,
          skipAnim: keyframeArm ? false : true,
          skipJitter: !jitterEnabled,
          layerPreviewOffset: layerMovePreviewOffset(),
          localMs: keyframeArm === "to" ? panel.durationMs : 0,
          wiggleFps: project.wiggleFps,
          overscan: { x: overscanX, y: overscanY },
          renderCache: displayRenderCache,
          contentVersion: renderContentVersion,
          deferFillMasks: true,
        }));
      }
    }

    // All overlays below use frame coords — translate to canvas pixel space.
    if (overscanX > 0 || overscanY > 0) {
      ctx.save();
      ctx.translate(overscanX, overscanY);
    }

    // Sub-panel drag preview
    if (subPanelDrag) {
      const { start, end } = subPanelDrag;
      ctx.save();
      ctx.strokeStyle = "rgba(255,125,87,0.9)";
      ctx.setLineDash([10, 6]);
      ctx.lineWidth = 3;
      ctx.strokeRect(
        Math.min(start.x, end.x),
        Math.min(start.y, end.y),
        Math.abs(end.x - start.x),
        Math.abs(end.y - start.y)
      );
      ctx.restore();
    }
    antsOffset = (antsOffset + 0.6) % 16;
    drawPerspectiveOverlay(ctx);
    drawMaskOverlay(ctx);
    drawSelectionOverlay(ctx);
    drawScaleToolOverlay(ctx);
    drawStabilizerLeashOverlay(ctx);
    drawEraserCursorOverlay(ctx);

    // Selected-text outline
    if (selectedText) {
      const m = measureText(selectedText.text);
      ctx.save();
      ctx.strokeStyle = "rgba(255,205,117,0.9)";
      ctx.setLineDash([6, 4]);
      ctx.lineWidth = 2;
      ctx.strokeRect(selectedText.text.x - 4, selectedText.text.y - 4, m.width + 8, m.height + 8);
      ctx.restore();
    }

    // Selection outline + tail handle for selected sub-panel
    if (selectedSubPanelId) {
      const sp = (activePanel().subPanels ?? []).find(s => s.id === selectedSubPanelId);
      if (sp) {
        ctx.save();
        ctx.strokeStyle = "rgba(255,205,117,0.9)";
        ctx.setLineDash([8, 4]);
        ctx.lineWidth = 2;
        ctx.strokeRect(sp.bounds.x, sp.bounds.y, sp.bounds.w, sp.bounds.h);
        ctx.setLineDash([]);
        if ((sp.shape === "balloon" || sp.shape === "thought") && sp.tail) {
          ctx.beginPath();
          ctx.moveTo(sp.bounds.x + sp.bounds.w / 2, sp.bounds.y + sp.bounds.h / 2);
          ctx.lineTo(sp.tail.x, sp.tail.y);
          ctx.strokeStyle = "rgba(255,205,117,0.6)";
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(sp.tail.x, sp.tail.y, 26, 0, Math.PI * 2);
          ctx.fillStyle = "#ffcd75";
          ctx.fill();
          ctx.strokeStyle = "#0e0e16";
          ctx.lineWidth = 4;
          ctx.stroke();
        }
        ctx.restore();
      }
    }

    // Keyframe overlay: A/B handles + motion path for animated layers.
    drawKeyframeOverlay(ctx);

    if (overscanX > 0 || overscanY > 0) ctx.restore();
  }

  // Timeline thumbnails are static previews; refresh only when content changed.
  if (dirtyThumbnailPanelIds.size > 0) refreshThumbnails();

  trimFramePool();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// ---- UI: brushes / palette / layers / timeline / inspector / breadcrumb ---

function buildBrushBar() {
  canvas.classList.toggle("select-cursor", currentBrush === SELECT_KEY || currentBrush === MARQUEE_KEY || currentBrush === MOVE_LAYER_KEY || currentBrush === SCALE_KEY);
  const drawTools = $("tools-draw");
  const editTools = $("tools-edit");
  const insertTools = $("tools-insert");
  const brushBar = $("brushes");
  closeBrushPicker?.();
  closeBrushPicker = null;
  drawTools.innerHTML = "";
  editTools.innerHTML = "";
  insertTools.innerHTML = "";
  brushBar.innerHTML = "";
  const switchTo = (k: string) => {
    currentBrush = k;
    if (!TOOL_KEYS.has(k)) lastBrushByTool[brushToolForKey(k)] = k;
    selectDrag = null;
    pendingRegionTransform = null;
    if (scaleToolDrag) {
      for (const snap of scaleToolDrag.snapshots) restoreFromSnapshot(snap);
      bumpMarqueeItemLayers(scaleToolDrag.items);
      scaleToolDrag = null;
    }
    buildBrushBar();
    buildEditContext();
    updateCanvasCursor(lastCanvasPointerPos ?? undefined);
    if (selectionState?.mode === "region" && selectionState.phase === "idle") {
      setStatus("Painting inside selection · Esc to clear");
    }
  };
  const addTool = (host: HTMLElement, key: string, label: string, icon: IconNode) => {
    const btn = document.createElement("button");
    btn.className = "chip tool" + (currentBrush === key ? " active" : "");
    btn.title = label;
    btn.setAttribute("aria-label", label);
    btn.appendChild(svgIcon(icon, 16));
    btn.onclick = () => switchTo(key);
    host.appendChild(btn);
  };
  const addBrushTool = (tool: BrushToolKey, label: string, icon: IconNode) => {
    const active = !TOOL_KEYS.has(currentBrush) && brushToolForKey(currentBrush) === tool;
    const btn = document.createElement("button");
    btn.className = "chip tool" + (active ? " active" : "");
    btn.title = label;
    btn.setAttribute("aria-label", label);
    btn.appendChild(svgIcon(icon, 16));
    btn.onclick = () => {
      const fallback = defaultBrushForTool(tool).key;
      switchTo(lastBrushByTool[tool] ?? fallback);
    };
    drawTools.appendChild(btn);
  };

  const brushToolIcons: Record<BrushToolKey, IconNode> = {
    classic: StudioIcons.BrushClassic,
    texture: StudioIcons.BrushTexture,
    scatter: StudioIcons.BrushScatter,
    eraser: StudioIcons.Eraser,
  };
  for (const tool of BRUSH_TOOLS) {
    addBrushTool(tool.key, tool.label, brushToolIcons[tool.key]);
  }
  addTool(drawTools, BUCKET_KEY, "Bucket", StudioIcons.Bucket);
  addTool(editTools, SELECT_KEY, "Select", StudioIcons.Pointer);
  addTool(editTools, MARQUEE_KEY, "Marquee", StudioIcons.Selection);
  addTool(editTools, MOVE_LAYER_KEY, "Move active layer", StudioIcons.Move);
  addTool(editTools, SCALE_KEY, "Scale", StudioIcons.Scale);
  addTool(insertTools, TEXT_KEY, "Text", StudioIcons.Text);
  addTool(insertTools, SUBPANEL_KEY, "Sub-Panel", StudioIcons.SubPanel);
  addTool(insertTools, PERSPECTIVE_KEY, "Perspective Ruler", StudioIcons.Perspective);

  const activeTool = TOOL_KEYS.has(currentBrush) ? "classic" : brushToolForKey(currentBrush);
  const activeToolLabel = BRUSH_TOOLS.find((tool) => tool.key === activeTool)?.label ?? "Classic";
  const activeBrushes = brushesForTool(activeTool);
  const activeBrush = activeBrushes.find((b) => b.key === currentBrush)
    ?? defaultBrushForTool(activeTool);
  const appendBrushPreview = (
    host: HTMLElement,
    brush: typeof BRUSHES[number],
    className: string,
    width: number,
    height: number
  ) => {
    const preview = document.createElement("canvas");
    preview.className = className;
    preview.width = width;
    preview.height = height;
    preview.setAttribute("aria-hidden", "true");
    const previewCtx = preview.getContext("2d");
    if (previewCtx) drawBrushPreview(previewCtx, brush, {
      width,
      height,
      color: currentColor,
      bg: "#171720",
      size: currentSize,
    });
    host.appendChild(preview);
  };

  const picker = document.createElement("div");
  picker.className = "brush-picker";
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "brush-picker-trigger";
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");
  trigger.setAttribute("aria-label", `${activeToolLabel} brush: ${activeBrush.label}`);
  appendBrushPreview(trigger, activeBrush, "brush-preview", 48, 28);
  const activeLabel = document.createElement("span");
  activeLabel.className = "brush-picker-label";
  activeLabel.textContent = activeBrush.label;
  trigger.appendChild(activeLabel);

  const menu = document.createElement("div");
  menu.className = "brush-menu";
  menu.setAttribute("role", "listbox");
  menu.hidden = true;

  let open = false;
  let onDocumentPointerDown: ((event: PointerEvent) => void) | null = null;
  const closePicker = () => {
    if (!open) return;
    open = false;
    picker.classList.remove("open");
    menu.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    if (onDocumentPointerDown) {
      document.removeEventListener("pointerdown", onDocumentPointerDown);
      onDocumentPointerDown = null;
    }
    if (closeBrushPicker === closePicker) closeBrushPicker = null;
  };
  const openPicker = () => {
    if (open) return;
    open = true;
    picker.classList.add("open");
    menu.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    closeBrushPicker = closePicker;
    onDocumentPointerDown = (event) => {
      const target = event.target;
      if (target instanceof Node && !picker.contains(target)) closePicker();
    };
    window.setTimeout(() => {
      if (onDocumentPointerDown) document.addEventListener("pointerdown", onDocumentPointerDown);
    }, 0);
  };
  const focusActiveOption = () => {
    const active = menu.querySelector<HTMLButtonElement>(".brush-option.active");
    const first = menu.querySelector<HTMLButtonElement>(".brush-option");
    (active ?? first)?.focus();
  };

  trigger.onclick = () => {
    if (open) closePicker();
    else openPicker();
  };
  trigger.onkeydown = (e) => {
    if (e.key !== "ArrowDown" && e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    openPicker();
    focusActiveOption();
  };
  menu.onkeydown = (e) => {
    const options = [...menu.querySelectorAll<HTMLButtonElement>(".brush-option")];
    const index = options.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "Escape") {
      e.preventDefault();
      closePicker();
      trigger.focus();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      options[Math.min(options.length - 1, index + 1)]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      options[Math.max(0, index - 1)]?.focus();
    }
  };
  picker.addEventListener("focusout", (e) => {
    const next = e.relatedTarget;
    if (next instanceof Node && picker.contains(next)) return;
    closePicker();
  });

  for (const b of activeBrushes) {
    const option = document.createElement("button");
    option.type = "button";
    option.className = "brush-option" + (b.key === activeBrush.key ? " active" : "");
    option.setAttribute("role", "option");
    option.setAttribute("aria-selected", String(b.key === activeBrush.key));
    appendBrushPreview(option, b, "brush-option-preview", 42, 22);
    const optionLabel = document.createElement("span");
    optionLabel.textContent = b.label;
    option.appendChild(optionLabel);
    option.onclick = () => {
      closePicker();
      switchTo(b.key);
    };
    menu.appendChild(option);
  }
  picker.appendChild(trigger);
  picker.appendChild(menu);
  brushBar.appendChild(picker);
  updateToolContext();
  buildEditContext();
}

function buildBrushPresetControls() {
  const host = $("brush-presets");
  if (!host) return;
  host.innerHTML = "";

  const select = document.createElement("select");
  select.className = "chip";
  select.style.width = "100%";
  const empty = document.createElement("option");
  empty.value = "";
  empty.textContent = project.brushPresets.length ? "Choose preset" : "No presets yet";
  select.appendChild(empty);
  for (const preset of project.brushPresets) {
    const option = document.createElement("option");
    option.value = preset.id;
    option.textContent = preset.name;
    option.selected = preset.id === activeBrushPresetId;
    select.appendChild(option);
  }
  select.onchange = () => {
    if (!select.value) {
      activeBrushPresetId = null;
      buildBrushPresetControls();
      return;
    }
    applyBrushPresetById(select.value);
  };
  host.appendChild(select);

  const actions = document.createElement("div");
  actions.className = "layer-actions";
  actions.style.marginTop = "6px";
  actions.style.flexWrap = "wrap";
  const save = document.createElement("button");
  save.className = "chip";
  save.textContent = "Save";
  save.onclick = saveCurrentBrushPreset;
  actions.appendChild(save);

  const update = document.createElement("button");
  update.className = "chip";
  update.textContent = "Update";
  update.disabled = !activeBrushPreset();
  update.onclick = updateActiveBrushPreset;
  actions.appendChild(update);

  const rename = document.createElement("button");
  rename.className = "chip";
  rename.textContent = "Rename";
  rename.disabled = !activeBrushPreset();
  rename.onclick = renameActiveBrushPreset;
  actions.appendChild(rename);

  const del = document.createElement("button");
  del.className = "chip";
  del.textContent = "Delete";
  del.disabled = !activeBrushPreset();
  del.onclick = deleteActiveBrushPreset;
  actions.appendChild(del);
  host.appendChild(actions);
}

function updateToolContext() {
  const currentRegistryBrush = TOOL_KEYS.has(currentBrush)
    ? null
    : BRUSHES.find((b) => b.key === currentBrush) ?? null;
  const isEraser = currentRegistryBrush?.erase === true;
  const isBrushLike = !!currentRegistryBrush && !isEraser;
  const hasSelection = !!selectionState;
  const contexts = [
    ["draw-context", isBrushLike || isEraser],
    ["text-context", currentBrush === TEXT_KEY || !!selectedText],
    ["bucket-context", currentBrush === BUCKET_KEY],
    ["edit-context", currentBrush === SELECT_KEY || currentBrush === MARQUEE_KEY || currentBrush === MOVE_LAYER_KEY || currentBrush === SCALE_KEY || hasSelection],
    ["subpanel-context", currentBrush === SUBPANEL_KEY || !!selectedSubPanelId],
    ["perspective-context", currentBrush === PERSPECTIVE_KEY],
  ] as const;
  for (const [id, active] of contexts) {
    $(id).classList.toggle("active", active);
  }
  if (currentBrush === PERSPECTIVE_KEY) buildPerspectiveInspector();
}

function buildPerspectiveInspector() {
  const host = $("perspective-inspector");
  if (!host) return;
  host.innerHTML = "";
  const panel = activePanel();
  const guide = activePerspectiveGuide();

  const hint = document.createElement("div");
  hint.className = "hint";
  hint.textContent = !guide
    ? "Click the canvas to place a perspective ruler on the current layer."
    : guide.kind === "fisheye"
    ? "Drag the center to move the lens; drag the four rim handles to spin and resize it. Hold Alt while drawing to skip snapping."
    : "Drag the round handles to move vanishing points; drag the yellow line for the horizon. Hold Alt while drawing to skip snapping.";
  host.appendChild(hint);
  if (!guide) return;

  // Kind chips
  const kinds: { kind: PerspectiveGuideKind; label: string }[] = [
    { kind: "grid", label: "Grid" },
    { kind: "1p", label: "1-Point" },
    { kind: "2p", label: "2-Point" },
    { kind: "3p", label: "3-Point" },
    { kind: "fisheye", label: "Fisheye" },
  ];
  const row = document.createElement("div");
  row.style.display = "flex";
  row.style.flexWrap = "wrap";
  row.style.gap = "6px";
  for (const k of kinds) {
    const btn = document.createElement("button");
    btn.className = "chip" + (guide.kind === k.kind ? " active" : "");
    btn.textContent = k.label;
    btn.onclick = () => {
      const fresh = newPerspectiveGuide(k.kind, project.width, project.height);
      guide.kind = k.kind;
      guide.vps = fresh.vps;
      guide.radius = fresh.radius;
      guide.rotation = fresh.rotation;
      if (k.kind !== "fisheye") {
        // Keep the user's horizon; horizon-bound VPs ride it.
        const riders = k.kind === "3p" ? guide.vps.slice(0, 2) : guide.vps;
        for (const vp of riders) vp.y = guide.horizonY;
      }
      commitHistory([]);
      buildPerspectiveInspector();
    };
    row.appendChild(btn);
  }
  host.appendChild(row);

  // Layer binding: a ruler bound to a layer only snaps strokes drawn on that
  // layer, so other layers stay free of it.
  const layer = activeLayer();
  if (layer) {
    const bindLabel = document.createElement("div");
    bindLabel.className = "hint";
    bindLabel.style.margin = "10px 0 4px";
    bindLabel.textContent = "Snaps strokes on";
    host.appendChild(bindLabel);
    const bindRow = document.createElement("div");
    bindRow.style.display = "flex";
    bindRow.style.flexWrap = "wrap";
    bindRow.style.gap = "6px";
    const mkBindChip = (label: string, active: boolean, onClick: () => void) => {
      const btn = document.createElement("button");
      btn.className = "chip" + (active ? " active" : "");
      btn.textContent = label;
      btn.onclick = onClick;
      bindRow.appendChild(btn);
    };
    mkBindChip(`Only “${layer.name}”`, guide.layerId === layer.id, () => {
      guide.layerId = layer.id;
      commitHistory([]);
      buildPerspectiveInspector();
    });
    mkBindChip("All layers", !guide.layerId, () => {
      guide.layerId = null;
      commitHistory([]);
      buildPerspectiveInspector();
    });
    host.appendChild(bindRow);
  }

  if (guide.kind === "fisheye") {
    const straighten = document.createElement("button");
    straighten.className = "chip";
    straighten.style.marginTop = "8px";
    straighten.textContent = "Straighten lens";
    straighten.onclick = () => {
      guide.rotation = 0;
      commitHistory([]);
    };
    host.appendChild(straighten);
  }

  const mkToggle = (label: string, value: boolean, onChange: (v: boolean) => void) => {
    const lab = document.createElement("label");
    lab.style.display = "flex";
    lab.style.alignItems = "center";
    lab.style.gap = "6px";
    lab.style.margin = "8px 0 0";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = value;
    cb.onchange = () => onChange(cb.checked);
    lab.appendChild(cb);
    lab.appendChild(document.createTextNode(label));
    host.appendChild(lab);
  };
  mkToggle("Show guide lines", guide.enabled, (v) => { guide.enabled = v; commitHistory([]); });
  mkToggle("Snap strokes to guide", guide.snapEnabled, (v) => { guide.snapEnabled = v; commitHistory([]); });

  const opacityLab = document.createElement("label");
  opacityLab.style.display = "block";
  opacityLab.style.margin = "8px 0 0";
  opacityLab.textContent = "Opacity";
  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = "0.1";
  slider.max = "1";
  slider.step = "0.05";
  slider.value = String(guide.opacity);
  slider.oninput = () => { guide.opacity = +slider.value; };
  slider.onchange = () => commitHistory([]);
  opacityLab.appendChild(slider);
  host.appendChild(opacityLab);

  const del = document.createElement("button");
  del.className = "chip";
  del.style.marginTop = "10px";
  del.textContent = "Delete ruler";
  del.onclick = () => {
    // Only this ruler — rulers bound to other layers survive.
    panel.guides = (panel.guides ?? []).filter((g) => g !== guide);
    commitHistory([]);
    buildPerspectiveInspector();
  };
  host.appendChild(del);
}

function buildEditContext() {
  const host = $("edit-context-inspector");
  if (!host) return;
  host.innerHTML = "";
  updateToolContext();

  const mkBtn = (label: string, onClick: () => void, title?: string) => {
    const btn = document.createElement("button");
    btn.className = "chip";
    btn.textContent = label;
    if (title) btn.title = title;
    btn.onclick = onClick;
    host.appendChild(btn);
  };

  if (currentBrush === MARQUEE_KEY || selectionState) {
    const toolRow = document.createElement("div");
    toolRow.className = "row";
    toolRow.style.marginBottom = "8px";
    for (const kind of ["rect", "ellipse", "lasso"] as MarqueeToolKind[]) {
      const btn = document.createElement("button");
      btn.className = "chip" + (marqueeToolKind === kind ? " active" : "");
      btn.textContent = kind === "rect" ? "Rect" : kind === "ellipse" ? "Ellipse" : "Lasso";
      btn.onclick = () => { marqueeToolKind = kind; buildEditContext(); };
      toolRow.appendChild(btn);
    }
    host.appendChild(toolRow);
  }

  if (currentBrush === SCALE_KEY && !selectionState) {
    const hint = document.createElement("div");
    hint.style.cssText = "font-size:11px;color:var(--dim);line-height:1.45;";
    hint.textContent = "Scale: drag handles around the active layer to resize or rotate its content.";
    host.appendChild(hint);
    if (selectionClipboard) {
      mkBtn("Paste", () => pasteSelection(), "Paste clipboard to active layer (Ctrl+V)");
    }
    return;
  }

  if (!selectionState) {
    if (currentBrush === MARQUEE_KEY) {
      const hint = document.createElement("div");
      hint.style.cssText = "font-size:11px;color:var(--dim);line-height:1.45;";
      hint.textContent = "Marquee: drag a region to clip brush/bucket. Drag inside to move items.";
      host.appendChild(hint);
    }
    if (selectionClipboard) {
      mkBtn("Paste", () => pasteSelection(), "Paste clipboard to active layer (Ctrl+V)");
    }
    return;
  }

  const info = document.createElement("div");
  info.style.cssText = "font-size:11px;color:var(--dim);line-height:1.45;margin-bottom:8px;";
  if (selectionState.mode === "region") {
    info.textContent = `Region selection (${selectionState.tool}). Paint inside; drag or handle-transform to cut.`;
  } else {
    info.textContent = `${selectionState.items.length} item(s) extracted. Drag to move; handles to scale/rotate.`;
  }
  host.appendChild(info);

  if (selectionState.mode === "region" && selectionState.phase === "idle") {
    mkBtn("Extract", () => extractSelection(), "Enter");
    mkBtn(selectionState.inverted ? "Uninvert" : "Invert", () => invertActiveSelection());
    mkBtn("Grow", () => growActiveSelection(8));
    mkBtn("Shrink", () => growActiveSelection(-8));
    mkBtn("Cut", () => cutSelection());
    mkBtn("Reveal Mask", () => setLayerMaskFromSelection("reveal"), "Mask active layer to show this selection");
    mkBtn("Hide Mask", () => setLayerMaskFromSelection("hide"), "Mask active layer to hide this selection");
  }
  if (selectionState.mode === "object" && isObjectSelectionIdle(selectionState)) {
    mkBtn("Copy", () => copySelection(), "Copy selection to clipboard (Ctrl+C)");
    mkBtn("Cut", () => cutSelection());
    mkBtn("Duplicate", () => duplicateSelection());
    mkBtn("Delete", () => deleteSelection());
  }
  const layerMask = activeLayer()?.mask;
  if (layerMask) {
    mkBtn(layerMask.enabled ? "Disable Mask" : "Enable Mask", () => setLayerMaskEnabled(!layerMask.enabled));
    mkBtn("Invert Mask", () => invertLayerMask());
    mkBtn("Delete Mask", () => deleteLayerMask());
  }
  if (selectionClipboard) {
    mkBtn("Paste", () => pasteSelection(), "Paste clipboard to active layer (Ctrl+V)");
  }
  mkBtn("Clear", () => { clearSelection(); buildEditContext(); setStatus("Selection cleared"); });
}

function buildPalette() {
  const bar = $("palette");
  bar.innerHTML = "";
  for (const c of currentPalette.colors) {
    const sw = document.createElement("button");
    sw.className = "swatch" + (c === currentColor ? " active" : "");
    sw.style.background = c;
    sw.onclick = () => { currentColor = c; buildPalette(); buildBrushBar(); rebuildInspector(); };
    bar.appendChild(sw);
  }
  // "+" — add a custom color to the current palette (in-memory; persists for
  // the session until the palette is swapped, per the user's "temporary" ask).
  const add = document.createElement("input");
  add.type = "color";
  add.className = "swatch swatch-add";
  add.value = currentColor;
  add.title = "Add a color to this palette (session-only)";
  add.onchange = () => {
    if (!currentPalette.colors.includes(add.value)) {
      currentPalette.colors.push(add.value);
    }
    currentColor = add.value;
    buildPalette();
    buildBrushBar();
    rebuildInspector();
  };
  bar.appendChild(add);
}

/** Re-render the inspector (cheap; lets palette-bound color rows pick up new
 *  swatches added via the "+" chip). */
function rebuildInspector() { buildInspector(); }

// Thumbnail tracking — populated by buildTimeline, refreshed each wiggle tick.
const thumbCanvases = new Map<string, HTMLCanvasElement>();

function renderThumb(c: HTMLCanvasElement, p: Panel) {
  const tctx = c.getContext("2d")!;
  tctx.setTransform(1, 0, 0, 1, 0, 0);
  tctx.clearRect(0, 0, c.width, c.height);
  tctx.scale(c.width / project.width, c.height / project.height);
  profileRender("thumbnail", () => renderPanel(tctx, p, wiggleTick, project.width, project.height, {
    allPanels: project.panels,
    timelapseProgress: p.kind === "timelapse" ? 1 : undefined,
    skipAnim: true,
    skipJitter: !jitterEnabled,
    renderCache: displayRenderCache,
    contentVersion: renderContentVersion,
    deferFillMasks: true,
  }));
  tctx.setTransform(1, 0, 0, 1, 0, 0);
}

function refreshThumbnails() {
  const panelById = new Map(project.panels.map(p => [p.id, p]));
  for (const [id, c] of thumbCanvases) {
    const p = panelById.get(id);
    if (!p) continue;
    if (shouldRefreshThumbnail(id, dirtyThumbnailPanelIds)) {
      renderThumb(c, p);
    }
  }
  dirtyThumbnailPanelIds.clear();
}

function selectedPanelRange(): [number, number] | null {
  if (rangeAnchorIndex == null || rangeEndIndex == null) return null;
  const lo = Math.min(rangeAnchorIndex, rangeEndIndex);
  const hi = Math.max(rangeAnchorIndex, rangeEndIndex);
  if (hi <= lo) return null;
  return [lo, hi];
}

function isPanelInSelectedRange(index: number): boolean {
  const range = selectedPanelRange();
  if (!range) return false;
  return index >= range[0] && index <= range[1];
}

function adjustActiveIndexAfterMove(activeId: string | undefined) {
  if (!activeId) return;
  const idx = project.panels.findIndex((p) => p.id === activeId);
  if (idx >= 0) activePanelIndex = idx;
}

function handlePanelDrop(targetIndex: number, isBefore: boolean, raw: string) {
  let to = isBefore ? targetIndex : targetIndex + 1;
  const activeId = project.panels[activePanelIndex]?.id;

  if (raw.startsWith("group:")) {
    const groupId = raw.slice(6);
    const group = groupsForProject(project).find((g) => g.id === groupId);
    if (!group) return;
    const fromIndices = group.panelIds
      .map((id) => project.panels.findIndex((p) => p.id === id))
      .filter((i) => i >= 0)
      .sort((a, b) => a - b);
    if (fromIndices.length === 0) return;

    const targetGroup = groupAtPanelIndex(project, targetIndex);
    if (targetGroup && targetGroup.id !== groupId) {
      const tIndices = targetGroup.panelIds
        .map((id) => project.panels.findIndex((p) => p.id === id))
        .sort((a, b) => a - b);
      to = isBefore ? tIndices[0] : tIndices[tIndices.length - 1] + 1;
    }

    let insertAt = to;
    for (const idx of fromIndices) {
      if (idx < to) insertAt--;
    }
    moveGroup(project, groupId, insertAt);
    adjustActiveIndexAfterMove(activeId);
    commitHistory();
    buildTimeline();
    buildLayers();
    return;
  }

  if (!raw.startsWith("panel:")) return;
  const from = +raw.slice(6);
  if (Number.isNaN(from)) return;

  const movingId = project.panels[from]?.id;
  const fromGroup = movingId ? findGroupForPanel(project, movingId) : undefined;
  if (fromGroup) {
    const gIndices = fromGroup.panelIds
      .map((id) => project.panels.findIndex((p) => p.id === id))
      .filter((i) => i >= 0)
      .sort((a, b) => a - b);
    let insertAt = to;
    for (const idx of gIndices) {
      if (idx < to) insertAt--;
    }
    movePanelBlock(project, gIndices, insertAt);
    adjustActiveIndexAfterMove(activeId);
    commitHistory();
    buildTimeline();
    buildLayers();
    return;
  }

  if (from < to) to--;
  if (to === from) return;
  const [m] = project.panels.splice(from, 1);
  project.panels.splice(to, 0, m);
  if (activePanelIndex === from) activePanelIndex = to;
  else if (from < activePanelIndex && to >= activePanelIndex) activePanelIndex--;
  else if (from > activePanelIndex && to <= activePanelIndex) activePanelIndex++;

  const targetGroup = groupAtPanelIndex(project, to);
  if (targetGroup && movingId) addPanelToGroup(project, targetGroup.id, movingId);
  else syncGroupPanelIds(project);

  commitHistory();
  buildTimeline();
  buildLayers();
}

function buildTransportBar(): HTMLElement {
  const bar = document.createElement("div");
  bar.className = "timeline-transport";

  const playBtn = document.createElement("button");
  playBtn.id = "play";
  playBtn.textContent = playing ? "Stop" : "Play";
  playBtn.onclick = () => {
    if (playing) void stopPlayback(playheadMs);
    else void startPlayback(playheadMs);
  };
  bar.appendChild(playBtn);

  const loopBtn = document.createElement("button");
  loopBtn.id = "loop-toggle";
  loopBtn.textContent = loopPlayback ? "Loop: On" : "Loop: Off";
  loopBtn.className = loopPlayback ? "active" : "";
  loopBtn.onclick = () => {
    loopPlayback = !loopPlayback;
    loopBtn.textContent = loopPlayback ? "Loop: On" : "Loop: Off";
    loopBtn.classList.toggle("active", loopPlayback);
  };
  bar.appendChild(loopBtn);

  const jitterBtn = document.createElement("button");
  jitterBtn.id = "jitter-toggle";
  jitterBtn.textContent = jitterEnabled ? "Stroke wiggle: On" : "Stroke wiggle: Off";
  jitterBtn.title = "Toggle render-time stroke wiggle on/off (does not change saved points)";
  jitterBtn.className = jitterEnabled ? "active" : "";
  jitterBtn.onclick = () => {
    jitterEnabled = !jitterEnabled;
    jitterBtn.textContent = jitterEnabled ? "Stroke wiggle: On" : "Stroke wiggle: Off";
    jitterBtn.classList.toggle("active", jitterEnabled);
    invalidateBaseFrameCache();
    refreshThumbnails();
  };
  bar.appendChild(jitterBtn);

  const groupBtn = document.createElement("button");
  groupBtn.id = "group-selected";
  groupBtn.textContent = "Group";
  groupBtn.title = "Group selected frames (Shift-click to select range)";
  const range = selectedPanelRange();
  groupBtn.disabled = !range;
  groupBtn.onclick = () => {
    const sel = selectedPanelRange();
    if (!sel) return;
    createFrameGroup(project, sel[0], sel[1], 2);
    rangeAnchorIndex = sel[0];
    rangeEndIndex = sel[1];
    commitHistory();
    buildTimeline();
  };
  bar.appendChild(groupBtn);

  const counter = document.createElement("span");
  counter.className = "frame-counter";
  counter.id = "frame-counter";
  counter.textContent = `${activePanelIndex + 1} / ${project.panels.length}`;
  bar.appendChild(counter);

  return bar;
}

function buildOnionSkinBar(): HTMLElement {
  const bar = document.createElement("div");
  bar.className = "onion-skin-bar";

  const toggleLabel = document.createElement("label");
  const toggleCb = document.createElement("input");
  toggleCb.type = "checkbox";
  toggleCb.id = "onion-toggle";
  toggleCb.checked = onionEnabled;
  toggleCb.onchange = () => { onionEnabled = toggleCb.checked; };
  toggleLabel.append(toggleCb, " Onion Skin");
  bar.appendChild(toggleLabel);

  const prevLabel = document.createElement("label");
  const prevSelect = document.createElement("select");
  prevSelect.id = "onion-prev-count";
  for (const count of [0, 1, 2, 3]) {
    const opt = document.createElement("option");
    opt.value = String(count);
    opt.textContent = `Prev ${count}`;
    prevSelect.appendChild(opt);
  }
  prevSelect.value = String(onionPrevCount);
  prevSelect.onchange = () => { onionPrevCount = +prevSelect.value; };
  prevLabel.append(prevSelect);
  bar.appendChild(prevLabel);

  const nextLabel = document.createElement("label");
  const nextSelect = document.createElement("select");
  nextSelect.id = "onion-next-count";
  for (const count of [0, 1, 2, 3]) {
    const opt = document.createElement("option");
    opt.value = String(count);
    opt.textContent = `Next ${count}`;
    nextSelect.appendChild(opt);
  }
  nextSelect.value = String(onionNextCount);
  nextSelect.onchange = () => { onionNextCount = +nextSelect.value; };
  nextLabel.append(nextSelect);
  bar.appendChild(nextLabel);

  const opSlider = document.createElement("input");
  opSlider.type = "range";
  opSlider.id = "onion-opacity";
  opSlider.min = "0.05";
  opSlider.max = "0.6";
  opSlider.step = "0.05";
  opSlider.value = String(onionOpacity);
  opSlider.oninput = () => { onionOpacity = +opSlider.value; };
  bar.appendChild(opSlider);

  return bar;
}

function buildPanelCell(filmstrip: HTMLElement, i: number, p: Panel) {
  const cell = document.createElement("div");
  cell.className = "panel-cell"
    + (i === activePanelIndex ? " active" : "")
    + (isPanelInSelectedRange(i) ? " range-selected" : "");
  cell.dataset.index = String(i);
  cell.draggable = true;

  const group = groupAtPanelIndex(project, i);
  if (group) cell.dataset.groupId = group.id;

  const thumb = document.createElement("canvas");
  thumb.width = 60; thumb.height = 107;
  cell.appendChild(thumb);
  thumbCanvases.set(p.id, thumb);
  renderThumb(thumb, p);

  if (p.kind === "timelapse") {
    const tag = document.createElement("div");
    tag.textContent = "↻ timelapse";
    tag.style.cssText = "font-size:9px;color:#ffcd75;text-align:center;";
    cell.appendChild(tag);
  }
  if (p.enter && p.enter.kind !== "none") {
    const tag = document.createElement("div");
    tag.textContent = `▶ ${p.enter.kind}`;
    tag.style.cssText = "font-size:9px;color:#a7f070;text-align:center;";
    cell.appendChild(tag);
  }

  const exposure = document.createElement("div");
  exposure.className = "exposure-control";
  exposure.style.cssText = "display:flex;gap:2px;justify-content:center;align-items:center;flex-wrap:wrap;";

  const frameInput = document.createElement("input");
  frameInput.type = "number";
  frameInput.value = String(durationMsToExposureTicks(p.durationMs, project.wiggleFps));
  frameInput.min = "1";
  frameInput.step = "1";
  frameInput.className = "frame-dur";
  frameInput.title = "Duration in frames";
  frameInput.setAttribute("aria-label", "Duration in frames");
  frameInput.onchange = () => { setPanelExposure(i, Math.max(1, +frameInput.value || 1)); };
  exposure.appendChild(frameInput);

  const frameUnit = document.createElement("span");
  frameUnit.textContent = "fr";
  frameUnit.title = "Frames";
  frameUnit.style.cssText = "font-size:9px;color:#a7b7d8;";
  exposure.appendChild(frameUnit);

  for (const ticks of [1, 2, 4, 8]) {
    const btn = document.createElement("button");
    btn.textContent = String(ticks);
    btn.title = `Set duration to ${ticks} frame${ticks === 1 ? "" : "s"}`;
    btn.className = "cellbtn";
    btn.onclick = (e) => { e.stopPropagation(); setPanelExposure(i, ticks); };
    exposure.appendChild(btn);
  }
  cell.appendChild(exposure);

  const msDetails = document.createElement("details");
  msDetails.className = "duration-ms-details";
  msDetails.style.cssText = "font-size:9px;color:#a7b7d8;text-align:center;";
  const msSummary = document.createElement("summary");
  msSummary.title = "Custom milliseconds";
  msSummary.appendChild(svgIcon(StudioIcons.Timer, 12));
  msSummary.append(" ms");
  msDetails.appendChild(msSummary);
  const dur = document.createElement("input");
  dur.type = "number"; dur.value = String(p.durationMs); dur.min = "100"; dur.step = "100";
  dur.className = "dur ms-dur";
  dur.title = "Custom duration in milliseconds";
  dur.setAttribute("aria-label", "Custom duration in milliseconds");
  dur.onchange = () => { setPanelDurationMs(i, Math.max(100, +dur.value || 100)); };
  msDetails.appendChild(dur);
  cell.appendChild(msDetails);

  const tools = document.createElement("div");
  tools.className = "panel-cell-actions";
  tools.style.cssText = "display:flex;gap:2px;justify-content:center;";

  const blankBeforeBtn = iconButton(StudioIcons.FrameInsertBefore, "Insert blank panel before", (e) => {
    e.stopPropagation(); activePanelIndex = i; insertBlankPanelAt(i);
  });
  tools.appendChild(blankBeforeBtn);

  const blankAfterBtn = iconButton(StudioIcons.FrameInsertAfter, "Insert blank panel after", (e) => {
    e.stopPropagation(); activePanelIndex = i; insertBlankPanelAt(i + 1);
  });
  tools.appendChild(blankAfterBtn);

  const tl_btn = iconButton(StudioIcons.Timelapse, "Insert timelapse before", (e) => {
    e.stopPropagation(); insertTimelapseBefore(i);
  });
  tools.appendChild(tl_btn);

  const dup_btn = iconButton(StudioIcons.CopyCheck, "Duplicate panel", (e) => {
    e.stopPropagation(); duplicatePanel(i);
  });
  tools.appendChild(dup_btn);

  const copyBtn = iconButton(StudioIcons.Copy, "Copy panel contents", (e) => {
    e.stopPropagation(); activePanelIndex = i; copyActivePanelContents();
  });
  tools.appendChild(copyBtn);

  const pasteBtn = iconButton(StudioIcons.ClipboardPaste, "Paste panel contents", (e) => {
    e.stopPropagation(); activePanelIndex = i; pasteIntoActivePanel();
  });
  pasteBtn.disabled = !panelContentClipboard || p.kind === "timelapse";
  tools.appendChild(pasteBtn);

  const del_btn = iconButton(StudioIcons.Trash, "Delete panel", (e) => {
    e.stopPropagation(); deletePanel(i);
  });
  tools.appendChild(del_btn);

  cell.appendChild(tools);

  cell.addEventListener("dragstart", (e) => {
    if (group) {
      e.dataTransfer!.setData("text/plain", `group:${group.id}`);
    } else {
      e.dataTransfer!.setData("text/plain", `panel:${i}`);
    }
    e.dataTransfer!.effectAllowed = "move";
    cell.classList.add("dragging");
  });
  cell.addEventListener("dragend", () => {
    cell.classList.remove("dragging");
    document.querySelectorAll(".panel-cell").forEach((c) =>
      c.classList.remove("drop-before", "drop-after"));
  });
  cell.addEventListener("dragover", (e) => {
    if (!e.dataTransfer?.types.includes("text/plain")) return;
    e.preventDefault();
    const rect = cell.getBoundingClientRect();
    const isBefore = e.clientX < rect.left + rect.width / 2;
    document.querySelectorAll(".panel-cell").forEach((c) =>
      c.classList.remove("drop-before", "drop-after"));
    cell.classList.add(isBefore ? "drop-before" : "drop-after");
  });
  cell.addEventListener("drop", (e) => {
    e.preventDefault();
    cell.classList.remove("drop-before", "drop-after");
    const raw = e.dataTransfer!.getData("text/plain");
    const rect = cell.getBoundingClientRect();
    const isBefore = e.clientX < rect.left + rect.width / 2;
    handlePanelDrop(i, isBefore, raw);
  });

  cell.onclick = (e) => {
    const t = e.target as HTMLElement;
    if (t.tagName === "INPUT" || t.tagName === "BUTTON") return;
    if (e.shiftKey) {
      rangeEndIndex = i;
    } else {
      activePanelIndex = i;
      rangeAnchorIndex = i;
      rangeEndIndex = i;
    }
    activeSubPanelId = null;
    selectedSubPanelId = null;
    selectedText = null;
    clearSelection();
    buildTimeline();
    buildLayers();
    buildBreadcrumb();
    buildInspector();
    buildEditContext();
  };

  filmstrip.appendChild(cell);
}

function buildGroupBracket(group: FrameGroup): HTMLElement {
  const bracket = document.createElement("div");
  bracket.className = "frame-group-bracket";
  bracket.dataset.groupId = group.id;
  bracket.draggable = true;

  const header = document.createElement("div");
  header.className = "frame-group-header";

  const repeatLabel = document.createElement("span");
  repeatLabel.className = "frame-group-repeat-label";
  repeatLabel.textContent = "×";
  header.appendChild(repeatLabel);

  const repeatInput = document.createElement("input");
  repeatInput.type = "number";
  repeatInput.className = "frame-group-repeat";
  repeatInput.min = "1";
  repeatInput.step = "1";
  repeatInput.value = String(group.repeat);
  repeatInput.title = "Loop count";
  repeatInput.onchange = () => {
    setGroupRepeat(project, group.id, +repeatInput.value);
    commitHistory();
    buildTimeline();
  };
  header.appendChild(repeatInput);

  const ungroupBtn = document.createElement("button");
  ungroupBtn.className = "frame-group-ungroup cellbtn";
  ungroupBtn.textContent = "Ungroup";
  ungroupBtn.title = "Remove loop group";
  ungroupBtn.onclick = (e) => {
    e.stopPropagation();
    ungroup(project, group.id);
    commitHistory();
    buildTimeline();
  };
  header.appendChild(ungroupBtn);

  bracket.appendChild(header);

  const cells = document.createElement("div");
  cells.className = "frame-group-cells";
  bracket.appendChild(cells);

  bracket.addEventListener("dragstart", (e) => {
    if ((e.target as HTMLElement).closest(".panel-cell")) return;
    e.dataTransfer!.setData("text/plain", `group:${group.id}`);
    e.dataTransfer!.effectAllowed = "move";
    bracket.classList.add("dragging");
  });
  bracket.addEventListener("dragend", () => {
    bracket.classList.remove("dragging");
    document.querySelectorAll(".panel-cell").forEach((c) =>
      c.classList.remove("drop-before", "drop-after"));
  });

  return bracket;
}

function buildTimeline() {
  lastSyncedThumbIndex = -1;
  const tl = $("timeline");
  const previousFilmstrip = tl.querySelector(".timeline-filmstrip") as HTMLElement | null;
  const previousFilmstripScrollLeft = previousFilmstrip?.scrollLeft ?? 0;
  tl.innerHTML = "";
  tl.classList.toggle("track-mode", timelineMode === "tracks" && workspaceMode === "draw");
  tl.classList.toggle("edit-mode", workspaceMode === "edit");
  thumbCanvases.clear();
  if (workspaceMode === "edit") { buildEditTimeline(tl); return; }
  if (timelineMode === "tracks") { buildTrackView(tl); return; }

  // Draw mode — transport + filmstrip + onion skin, no tab row
  tl.appendChild(buildTransportBar());

  // Filmstrip scroll area
  const filmstrip = document.createElement("div");
  filmstrip.className = "timeline-filmstrip";
  const groups = groupsForProject(project);
  const groupStarts = new Map<number, FrameGroup>();
  for (const g of groups) {
    const startIdx = project.panels.findIndex((p) => p.id === g.panelIds[0]);
    if (startIdx >= 0) groupStarts.set(startIdx, g);
  }

  let panelIdx = 0;
  while (panelIdx < project.panels.length) {
    const group = groupStarts.get(panelIdx);
    if (group) {
      const bracket = buildGroupBracket(group);
      const cellsHost = bracket.querySelector(".frame-group-cells") as HTMLElement;
      for (const panelId of group.panelIds) {
        const idx = project.panels.findIndex((p) => p.id === panelId);
        if (idx < 0) continue;
        buildPanelCell(cellsHost, idx, project.panels[idx]);
      }
      filmstrip.appendChild(bracket);
      panelIdx += group.panelIds.length;
    } else {
      buildPanelCell(filmstrip, panelIdx, project.panels[panelIdx]);
      panelIdx++;
    }
  }

  const add = document.createElement("button");
  add.className = "add-panel"; add.textContent = "+";
  add.onclick = () => {
    const p = newPanel();
    p.bg = project.panels[activePanelIndex]?.bg ?? "#1a1a2e";
    p.paletteId = currentPalette.id;
    project.panels.push(p);
    activePanelIndex = project.panels.length - 1;
    activeSubPanelId = null;
    selectedSubPanelId = null;
    selectedText = null;
    commitHistory();
    buildTimeline();
    buildLayers();
    buildBreadcrumb();
    buildInspector();
  };
  filmstrip.appendChild(add);
  tl.appendChild(filmstrip);

  const activeCell = filmstrip.querySelector<HTMLElement>(".panel-cell.active");
  if (activeCell) {
    filmstrip.scrollLeft = timelineScrollAfterRebuild({
      previousScrollLeft: previousFilmstripScrollLeft,
      viewportWidth: filmstrip.clientWidth,
      contentWidth: filmstrip.scrollWidth,
      activeLeft: activeCell.offsetLeft,
      activeRight: activeCell.offsetLeft + activeCell.offsetWidth,
    });
  }

  // Onion skin bar — only in cells mode
  tl.appendChild(buildOnionSkinBar());
}

function setWorkspaceMode(mode: WorkspaceMode) {
  workspaceMode = mode;
  if (mode === "draw") {
    timelineMode = "cells";
    selectedAudioClipId = null;
  } else {
    timelineMode = "tracks";
  }
  document.body.classList.toggle("mode-draw", mode === "draw");
  document.body.classList.toggle("mode-edit", mode === "edit");
  for (const key of ["draw", "edit"] as const) {
    const active = mode === key;
    $("mode-" + key).classList.toggle("active", active);
    $("rail-" + key).classList.toggle("active", active);
    const tab = $(`mode-${key}`) as HTMLButtonElement;
    tab.setAttribute("aria-selected", active ? "true" : "false");
    tab.tabIndex = active ? 0 : -1;
  }
  buildTimeline();
  buildInspector();
}

function buildEditTimeline(tl: HTMLElement) {
  tl.appendChild(buildTransportBar());

  const container = document.createElement("div");
  container.className = "edit-timeline";

  // Time ruler
  container.appendChild(buildAudioRuler());

  // Playhead
  container.appendChild(buildPlayheadElement(container));

  // Video track
  container.appendChild(buildVideoTrack());

  // Audio toolbar
  buildEditAudioToolbar(container);

  // Audio tracks
  buildEditAudioTracks(container);

  tl.appendChild(container);

  // Audio clip inspector
  const inspector = document.createElement("div");
  inspector.className = "audio-inspector";
  buildAudioClipInspector(inspector);
  tl.appendChild(inspector);
}

function buildVideoTrack(): HTMLElement {
  const row = document.createElement("div");
  row.className = "audio-track-row";
  const head = document.createElement("div");
  head.className = "audio-track-head";
  const label = document.createElement("span");
  label.style.cssText = "font-size:11px;color:var(--ink);grid-column:1/-1;";
  label.textContent = "Video";
  head.appendChild(label);
  row.appendChild(head);

  const strip = document.createElement("div");
  strip.className = "audio-track-strip";
  const totalMs = Math.max(1000, projectPlaybackDuration());
  const groups = groupsForProject(project);
  const groupStarts = new Map<number, FrameGroup>();
  for (const g of groups) {
    const startIdx = project.panels.findIndex((p) => p.id === g.panelIds[0]);
    if (startIdx >= 0) groupStarts.set(startIdx, g);
  }

  let offsetMs = 0;
  let panelIdx = 0;
  while (panelIdx < project.panels.length) {
    const group = groupStarts.get(panelIdx);
    if (group) {
      const passMs = group.panelIds.reduce((sum, id) => {
        const p = project.panels.find((pp) => pp.id === id);
        return sum + (p?.durationMs ?? 0);
      }, 0);
      const groupMs = passMs * group.repeat;

      const groupBlock = document.createElement("div");
      groupBlock.className = "video-group-block";
      groupBlock.style.left = `${(offsetMs / totalMs) * 100}%`;
      groupBlock.style.width = `${Math.max(0.5, (groupMs / totalMs) * 100)}%`;
      groupBlock.title = `Group ×${group.repeat}`;

      const groupLabel = document.createElement("span");
      groupLabel.className = "video-group-label";
      groupLabel.textContent = `×${group.repeat}`;
      groupBlock.appendChild(groupLabel);

      for (let iter = 0; iter < group.repeat; iter++) {
        const iterStrip = document.createElement("div");
        iterStrip.className = "video-group-iteration"
          + (iter > 0 ? " video-group-iteration-ghost" : "");

        let iterOffset = 0;
        for (const panelId of group.panelIds) {
          const i = project.panels.findIndex((p) => p.id === panelId);
          if (i < 0) continue;
          const p = project.panels[i];
          const block = document.createElement("div");
          block.className = "video-panel-block"
            + (i === activePanelIndex ? " active" : "")
            + (iter > 0 ? " ghost" : "");
          block.style.left = `${(iterOffset / passMs) * 100}%`;
          block.style.width = `${Math.max(0.5, (p.durationMs / passMs) * 100)}%`;
          block.title = `Panel ${i + 1} · ${p.durationMs}ms · loop ${iter + 1}/${group.repeat}`;

          const thumb = document.createElement("canvas");
          thumb.width = 60; thumb.height = 34;
          block.appendChild(thumb);
          thumbCanvases.set(p.id + (iter > 0 ? `-iter${iter}` : ""), thumb);
          renderThumb(thumb, p);

          const lbl = document.createElement("span");
          lbl.textContent = iter === 0 ? `P${i + 1}` : `↻${iter + 1}`;
          block.appendChild(lbl);

          if (iter === 0) {
            const resizeHandle = document.createElement("div");
            resizeHandle.className = "video-panel-resize";
            block.appendChild(resizeHandle);
            resizeHandle.addEventListener("pointerdown", (e) => {
              e.preventDefault();
              e.stopPropagation();
              const rect = strip.getBoundingClientRect();
              if (!rect.width) return;
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
              const startX = e.clientX;
              const originalDuration = p.durationMs;
              const msPerPx = totalMs / rect.width;
              const move = (mv: PointerEvent) => {
                p.durationMs = Math.max(100, originalDuration + (mv.clientX - startX) * msPerPx);
                buildTimeline();
              };
              const up = () => {
                window.removeEventListener("pointermove", move);
                window.removeEventListener("pointerup", up);
                window.removeEventListener("pointercancel", up);
                p.durationMs = Math.max(100, Math.round(p.durationMs));
                commitHistory();
                buildTimeline();
              };
              window.addEventListener("pointermove", move);
              window.addEventListener("pointerup", up);
              window.addEventListener("pointercancel", up);
            });
          }

          block.onclick = (e) => {
            if ((e.target as HTMLElement).classList.contains("video-panel-resize")) return;
            activePanelIndex = i;
            buildTimeline();
            buildLayers();
            buildBreadcrumb();
            buildInspector();
          };

          iterStrip.appendChild(block);
          iterOffset += p.durationMs;
        }
        groupBlock.appendChild(iterStrip);
      }

      strip.appendChild(groupBlock);
      offsetMs += groupMs;
      panelIdx += group.panelIds.length;
    } else {
      const p = project.panels[panelIdx];
      const i = panelIdx;
      const block = document.createElement("div");
      block.className = "video-panel-block" + (i === activePanelIndex ? " active" : "");
      block.style.left = `${(offsetMs / totalMs) * 100}%`;
      block.style.width = `${Math.max(0.5, (p.durationMs / totalMs) * 100)}%`;
      block.title = `Panel ${i + 1} · ${p.durationMs}ms`;

      const thumb = document.createElement("canvas");
      thumb.width = 60; thumb.height = 34;
      block.appendChild(thumb);
      thumbCanvases.set(p.id, thumb);
      renderThumb(thumb, p);

      const lbl = document.createElement("span");
      lbl.textContent = `P${i + 1}`;
      block.appendChild(lbl);

      const resizeHandle = document.createElement("div");
      resizeHandle.className = "video-panel-resize";
      block.appendChild(resizeHandle);

      resizeHandle.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const rect = strip.getBoundingClientRect();
        if (!rect.width) return;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        const startX = e.clientX;
        const originalDuration = p.durationMs;
        const msPerPx = totalMs / rect.width;
        const move = (mv: PointerEvent) => {
          p.durationMs = Math.max(100, originalDuration + (mv.clientX - startX) * msPerPx);
          block.style.width = `${Math.max(0.5, (p.durationMs / totalMs) * 100)}%`;
          block.title = `Panel ${i + 1} · ${Math.round(p.durationMs)}ms`;
        };
        const up = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
          window.removeEventListener("pointercancel", up);
          p.durationMs = Math.max(100, Math.round(p.durationMs));
          commitHistory();
          buildTimeline();
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
        window.addEventListener("pointercancel", up);
      });

      block.onclick = (e) => {
        if ((e.target as HTMLElement).classList.contains("video-panel-resize")) return;
        activePanelIndex = i;
        buildTimeline();
        buildLayers();
        buildBreadcrumb();
        buildInspector();
      };
      strip.appendChild(block);
      offsetMs += p.durationMs;
      panelIdx++;
    }
  }
  row.appendChild(strip);
  return row;
}

function buildEditAudioToolbar(host: HTMLElement) {
  const toolbar = document.createElement("div");
  toolbar.className = "audio-toolbar";
  const input = document.createElement("select");
  input.id = "audio-input-source";
  input.className = "chip";
  input.title = "Microphone input";
  toolbar.appendChild(input);
  void populateAudioInputs(input);

  const record = document.createElement("button");
  record.className = "act";
  record.textContent = mediaRecorder?.state === "recording" ? "Stop Rec" : "Record Voiceover";
  record.onclick = () => mediaRecorder?.state === "recording" ? stopRecording() : void startRecording();
  toolbar.appendChild(record);

  const importBtn = document.createElement("button");
  importBtn.className = "ghost";
  importBtn.textContent = "Import Audio";
  importBtn.onclick = () => void importAudioFiles();
  toolbar.appendChild(importBtn);

  const audio = audioProject();
  const addTrack = document.createElement("button");
  addTrack.className = "ghost";
  addTrack.textContent = "Add Track";
  addTrack.onclick = () => {
    audio.tracks.push(newAudioTrack(`Track ${audio.tracks.length + 1}`));
    commitHistory();
    refreshEditAudio();
  };
  toolbar.appendChild(addTrack);

  const split = document.createElement("button");
  split.className = "ghost";
  split.textContent = "Split";
  split.disabled = !selectedAudioClip();
  split.onclick = splitSelectedAudioClip;
  toolbar.appendChild(split);

  const status = document.createElement("span");
  status.id = "audio-status";
  status.textContent = audioBridge() ? "" : "Desktop audio bridge unavailable";
  toolbar.appendChild(status);
  host.appendChild(toolbar);
}

function buildEditAudioTracks(host: HTMLElement) {
  const audio = audioProject();
  const timeline = document.createElement("div");
  timeline.className = "audio-timeline";
  for (const track of audio.tracks) {
    timeline.appendChild(buildAudioTrackRow(track));
  }
  host.appendChild(timeline);
}

function refreshEditAudio() {
  if (workspaceMode !== "edit") return;
  const tl = $("timeline");
  const container = tl.querySelector(".edit-timeline");
  if (!container) { buildTimeline(); return; }
  // Preserve scroll position
  const scrollTop = container.scrollTop;
  const scrollLeft = container.scrollLeft;
  // Remove old audio toolbar, audio timeline, and inspector
  container.querySelectorAll(".audio-toolbar, .audio-timeline").forEach(el => el.remove());
  tl.querySelectorAll(".audio-inspector").forEach(el => el.remove());
  // Rebuild audio sections
  buildEditAudioToolbar(container as HTMLElement);
  buildEditAudioTracks(container as HTMLElement);
  const inspector = document.createElement("div");
  inspector.className = "audio-inspector";
  buildAudioClipInspector(inspector);
  tl.appendChild(inspector);
  // Restore scroll position
  container.scrollTop = scrollTop;
  container.scrollLeft = scrollLeft;
  updatePlayheadChrome();
}

// ----------------------------------------------------------------------------
// Track view — zoom into the active panel and see / edit when each element's
// enter+exit animations play out. Drag a bar horizontally to change startTick.
// ----------------------------------------------------------------------------

type AnimSlot = "enter" | "exit" | "layer";
type AnimReader = () => AnimationSpec | undefined;
type AnimWriter = (a: AnimationSpec) => void;

function buildTrackView(tl: HTMLElement) {
  const panel = activePanel();
  const wiggleFps = project.wiggleFps;
  const totalTicks = Math.max(1, Math.round((panel.durationMs / 1000) * wiggleFps));

  // Tab header
  const tabRow = document.createElement("div");
  tabRow.className = "timeline-tabs";
  const panelsTab = document.createElement("button");
  panelsTab.textContent = "Panels";
  panelsTab.className = "timeline-tab";
  panelsTab.onclick = () => { timelineMode = "cells"; buildTimeline(); };
  const tracksTab = document.createElement("button");
  tracksTab.textContent = "Tracks";
  tracksTab.className = "timeline-tab active";
  tabRow.append(panelsTab, tracksTab);
  tl.appendChild(tabRow);

  // Transport bar
  tl.appendChild(buildTransportBar());

  const header = document.createElement("div");
  header.className = "track-header";
  const lab = document.createElement("span");
  lab.textContent = `Panel ${activePanelIndex + 1} — ${panel.durationMs}ms · ${totalTicks} ticks @ ${wiggleFps}fps`;
  header.appendChild(lab);
  tl.appendChild(header);

  // Tick ruler
  const ruler = document.createElement("div");
  ruler.className = "track-ruler";
  for (let t = 0; t <= totalTicks; t++) {
    const m = document.createElement("div");
    m.className = "tick";
    m.style.left = `${(t / totalTicks) * 100}%`;
    if (t % 2 === 0) {
      const lab = document.createElement("span");
      lab.textContent = String(t);
      m.appendChild(lab);
    }
    ruler.appendChild(m);
  }
  tl.appendChild(ruler);

  // Helper to add a row
  const addRow = (
    name: string,
    enter: AnimReader, setEnter: AnimWriter,
    exit: AnimReader, setExit: AnimWriter
  ) => {
    const row = document.createElement("div");
    row.className = "track-row";
    const nm = document.createElement("span");
    nm.textContent = name;
    nm.className = "track-name";
    row.appendChild(nm);
    const track = document.createElement("div");
    track.className = "track-strip";
    for (let t = 1; t < totalTicks; t++) {
      const grid = document.createElement("div");
      grid.className = "tick-grid";
      grid.style.left = `${(t / totalTicks) * 100}%`;
      track.appendChild(grid);
    }
    const eSpec = enter();
    if (eSpec && eSpec.kind !== "none") {
      const startTick = eSpec.startTick ?? 0;
      track.appendChild(makeAnimBar("enter", eSpec, startTick, totalTicks, (timing) => {
        setEnter({ ...eSpec, startTick: timing.startTick, durationTicks: timing.durationTicks });
      }));
    }
    const xSpec = exit();
    if (xSpec && xSpec.kind !== "none") {
      const startTick = xSpec.startTick ?? Math.max(0, totalTicks - xSpec.durationTicks);
      track.appendChild(makeAnimBar("exit", xSpec, startTick, totalTicks, (timing) => {
        setExit({ ...xSpec, startTick: timing.startTick, durationTicks: timing.durationTicks });
      }));
    }
    row.appendChild(track);
    tl.appendChild(row);
  };

  addRow(
    `Panel`,
    () => panel.enter, (a) => { panel.enter = a; commitHistory(); },
    () => panel.exit,  (a) => { panel.exit  = a; commitHistory(); },
  );

  (panel.subPanels ?? []).forEach((sp, i) => {
    addRow(
      `Sub ${i + 1} (${sp.shape})`,
      () => sp.enter, (a) => { sp.enter = a; commitHistory(); },
      () => sp.exit,  (a) => { sp.exit  = a; commitHistory(); },
    );
  });

  panel.layers.forEach((l) => {
    if (l.animation?.enabled) {
      const row = document.createElement("div");
      row.className = "track-row";
      const nm = document.createElement("span");
      nm.textContent = `Layer: ${l.name}`;
      nm.className = "track-name";
      row.appendChild(nm);
      const track = document.createElement("div");
      track.className = "track-strip";
      for (let t = 1; t < totalTicks; t++) {
        const grid = document.createElement("div");
        grid.className = "tick-grid";
        grid.style.left = `${(t / totalTicks) * 100}%`;
        track.appendChild(grid);
      }
      track.appendChild(makeAnimBar("layer", l.animation, l.animation.startTick, totalTicks, (timing) => {
        if (!l.animation) return;
        l.animation = {
          ...l.animation,
          startTick: timing.startTick,
          durationTicks: timing.durationTicks,
        };
        commitHistory();
      }));
      row.appendChild(track);
      tl.appendChild(row);
    }
    (l.texts ?? []).forEach((t) => {
      addRow(
        `"${t.content.length > 12 ? t.content.slice(0, 12) + "…" : t.content}"`,
        () => t.enter, (a) => { t.enter = a; commitHistory(); },
        () => t.exit,  (a) => { t.exit  = a; commitHistory(); },
      );
    });
  });

  // Empty-state hint
  const hasAny = (panel.enter && panel.enter.kind !== "none") ||
                 (panel.exit && panel.exit.kind !== "none") ||
                 (panel.subPanels ?? []).some(sp => (sp.enter?.kind ?? "none") !== "none" || (sp.exit?.kind ?? "none") !== "none") ||
                 panel.layers.some(l => !!l.animation?.enabled) ||
                 panel.layers.some(l => (l.texts ?? []).some(t => (t.enter?.kind ?? "none") !== "none" || (t.exit?.kind ?? "none") !== "none"));
  if (!hasAny) {
    const hint = document.createElement("div");
    hint.className = "track-hint";
    hint.textContent = "No animations on this panel yet. Use the Inspector to add Enter / Exit anims, then drag the bars here to retime.";
    tl.appendChild(hint);
  }
}

function makeAnimBar(
  slot: AnimSlot,
  spec: AnimationSpec | LayerAnimation,
  startTick: number,
  totalTicks: number,
  commit: (timing: { startTick: number; durationTicks: number }) => void
): HTMLElement {
  const bar = document.createElement("div");
  const labelKind = "kind" in spec ? spec.kind : spec.easing;
  bar.className = `anim-bar anim-bar-${slot} anim-${labelKind}`;
  const widthPct = (spec.durationTicks / totalTicks) * 100;
  bar.style.left = `${(startTick / totalTicks) * 100}%`;
  bar.style.width = `${Math.max(2, widthPct)}%`;
  const label = document.createElement("span");
  label.textContent = `${slot}: ${labelKind}`;
  const leftHandle = document.createElement("span");
  leftHandle.className = "anim-bar-handle anim-bar-handle-left";
  leftHandle.title = "Drag to change animation start";
  const rightHandle = document.createElement("span");
  rightHandle.className = "anim-bar-handle anim-bar-handle-right";
  rightHandle.title = "Drag to change animation end";
  bar.appendChild(leftHandle);
  bar.appendChild(label);
  bar.appendChild(rightHandle);

  // Drag the middle to retime; drag either tail to resize start/end.
  bar.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const track = bar.parentElement as HTMLElement;
    const trackRect = track.getBoundingClientRect();
    if (!trackRect.width) return;
    const startX = e.clientX;
    const target = e.target as HTMLElement;
    const mode = target.classList.contains("anim-bar-handle-left")
      ? "resize-left"
      : target.classList.contains("anim-bar-handle-right")
        ? "resize-right"
        : "move";
    const initialStart = startTick;
    const initialDuration = spec.durationTicks;
    const initialEnd = startTick + spec.durationTicks;
    bar.classList.add("dragging");
    let latestStart = startTick;
    let latestDuration = spec.durationTicks;
    const move = (mv: PointerEvent) => {
      const dx = mv.clientX - startX;
      const dxTicks = Math.round((dx / trackRect.width) * totalTicks);
      if (mode === "resize-left") {
        latestStart = Math.max(0, Math.min(initialEnd - 1, initialStart + dxTicks));
        latestDuration = initialEnd - latestStart;
      } else if (mode === "resize-right") {
        const latestEnd = Math.max(initialStart + 1, Math.min(totalTicks, initialEnd + dxTicks));
        latestStart = initialStart;
        latestDuration = latestEnd - latestStart;
      } else {
        latestStart = Math.max(0, Math.min(totalTicks - initialDuration, initialStart + dxTicks));
        latestDuration = initialDuration;
      }
      bar.style.left = `${(latestStart / totalTicks) * 100}%`;
      bar.style.width = `${Math.max(2, (latestDuration / totalTicks) * 100)}%`;
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      bar.classList.remove("dragging");
      commit({ startTick: latestStart, durationTicks: latestDuration });
      buildTimeline();
      buildInspector();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  });
  return bar;
}

// ---- Audio Desk -----------------------------------------------------------


async function populateAudioInputs(sel: HTMLSelectElement) {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const inputs = devices.filter((d) => d.kind === "audioinput");
    sel.innerHTML = "";
    for (const d of inputs) {
      const o = document.createElement("option");
      o.value = d.deviceId;
      o.textContent = d.label || `Microphone ${sel.length + 1}`;
      if (d.deviceId === selectedInputDeviceId) o.selected = true;
      sel.appendChild(o);
    }
    sel.onchange = () => { selectedInputDeviceId = sel.value; };
  } catch {
    sel.innerHTML = '<option value="">Mic permission needed</option>';
  }
}

function buildAudioRuler() {
  const ruler = document.createElement("div");
  ruler.className = "audio-ruler";
  const total = Math.max(1000, projectPlaybackDuration());
  const ticks = Math.max(2, Math.ceil(total / 1000));
  for (let i = 0; i <= ticks; i++) {
    const tick = document.createElement("div");
    tick.className = "audio-ruler-tick";
    tick.style.left = `${(i / ticks) * 100}%`;
    tick.textContent = `${i}s`;
    ruler.appendChild(tick);
  }
  ruler.style.cursor = "pointer";
  ruler.onclick = (e) => {
    const rect = ruler.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setPlayhead(audioPctToTime(pct));
  };
  return ruler;
}

function buildAudioTrackRow(track: AudioTrack) {
  const row = document.createElement("div");
  row.className = "audio-track-row";
  const head = document.createElement("div");
  head.className = "audio-track-head";
  const mute = document.createElement("input");
  mute.type = "checkbox";
  mute.checked = track.muted;
  mute.title = "Muted";
  mute.onchange = () => { track.muted = mute.checked; commitHistory(); refreshEditAudio(); };
  head.appendChild(mute);
  const name = document.createElement("input");
  name.type = "text";
  name.value = track.name;
  name.onchange = () => { track.name = name.value; commitHistory(); };
  head.appendChild(name);
  row.appendChild(head);

  const strip = document.createElement("div");
  strip.className = "audio-track-strip";
  for (const clip of track.clips) {
    const asset = findAsset(project.audio, clip.assetId);
    if (!asset) continue;
    strip.appendChild(buildAudioClipBlock(clip, asset));
  }
  row.appendChild(strip);
  return row;
}

function buildAudioClipBlock(clip: AudioClip, asset: AudioAsset) {
  const block = document.createElement("div");
  block.className = "audio-clip" + (clip.id === selectedAudioClipId ? " selected" : "");
  block.style.left = `${audioTimeToPct(clip.startMs)}%`;
  block.style.width = `${Math.max(1, audioTimeToPct(clip.durationMs))}%`;
  block.title = asset.path;
  block.dataset.clipId = clip.id;

  const canvas = document.createElement("canvas");
  canvas.width = 220;
  canvas.height = 34;
  const wctx = canvas.getContext("2d")!;
  wctx.clearRect(0, 0, canvas.width, canvas.height);
  drawWaveform(wctx, asset.waveformPeaks, 0, 0, canvas.width, canvas.height);
  block.appendChild(canvas);

  const label = document.createElement("span");
  label.textContent = asset.name;
  block.appendChild(label);

  const left = document.createElement("span");
  left.className = "audio-trim audio-trim-left";
  block.appendChild(left);
  const right = document.createElement("span");
  right.className = "audio-trim audio-trim-right";
  block.appendChild(right);

  block.onclick = (e) => {
    e.stopPropagation();
    selectedAudioClipId = clip.id;
    refreshEditAudio();
  };
  block.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    selectedAudioClipId = clip.id;
    const strip = block.parentElement as HTMLElement;
    const rect = strip.getBoundingClientRect();
    const startX = e.clientX;
    const mode = (e.target as HTMLElement).classList.contains("audio-trim-left")
      ? "trim-left"
      : (e.target as HTMLElement).classList.contains("audio-trim-right")
        ? "trim-right"
        : "move";
    const originalStart = clip.startMs;
    const originalEnd = clip.startMs + clip.durationMs;
    const move = (mv: PointerEvent) => {
      const deltaMs = audioPctToTime((mv.clientX - startX) / rect.width);
      let next = clip;
      if (mode === "trim-left") next = trimClipStart(clip, asset, originalStart + deltaMs);
      else if (mode === "trim-right") next = trimClipEnd(clip, asset, originalEnd + deltaMs);
      else next = moveClip(clip, originalStart + deltaMs);
      Object.assign(clip, next);
      block.style.left = `${audioTimeToPct(clip.startMs)}%`;
      block.style.width = `${Math.max(1, audioTimeToPct(clip.durationMs))}%`;
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      commitHistory();
      refreshEditAudio();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  });
  return block;
}

function buildAudioClipInspector(host: HTMLElement) {
  const selected = selectedAudioClip();
  if (!selected) {
    const empty = document.createElement("div");
    empty.textContent = "No clip selected.";
    empty.style.cssText = "font-size:11px;color:var(--dim);";
    host.appendChild(empty);
    return;
  }
  const { clip, asset } = selected;
  host.innerHTML = "";
  const title = document.createElement("div");
  title.className = "audio-inspector-title";
  title.textContent = asset.name;
  host.appendChild(title);
  audioNumber(host, "Start", clip.startMs, 10, (v) => { clip.startMs = Math.max(0, v); });
  audioNumber(host, "Duration", clip.durationMs, 10, (v) => { Object.assign(clip, trimClipEnd(clip, asset, clip.startMs + v)); });
  audioNumber(host, "Volume", clip.volume, 0.05, (v) => { clip.volume = Math.max(0, Math.min(2, v)); });
  audioNumber(host, "Fade In", clip.fadeInMs, 10, (v) => { clip.fadeInMs = Math.max(0, Math.min(v, clip.durationMs / 2)); });
  audioNumber(host, "Fade Out", clip.fadeOutMs, 10, (v) => { clip.fadeOutMs = Math.max(0, Math.min(v, clip.durationMs / 2)); });
  const path = document.createElement("div");
  path.className = "audio-path";
  path.textContent = asset.path;
  host.appendChild(path);
}

function audioNumber(host: HTMLElement, label: string, value: number, step: number, write: (v: number) => void) {
  const wrap = document.createElement("label");
  wrap.textContent = label;
  const input = document.createElement("input");
  input.type = "number";
  input.value = String(Math.round(value * 100) / 100);
  input.step = String(step);
  input.onchange = () => {
    write(+input.value || 0);
    commitHistory();
    refreshEditAudio();
  };
  wrap.appendChild(input);
  host.appendChild(wrap);
}

async function importAudioFiles() {
  const bridge = audioBridge();
  if (!bridge) { setAudioStatus("Desktop audio bridge unavailable"); return; }
  const files = await bridge.pickFiles();
  if (files.length === 0) return;
  const audio = audioProject();
  const target = audio.tracks[1] ?? audio.tracks[0] ?? newAudioTrack("SFX");
  if (!audio.tracks.includes(target)) audio.tracks.push(target);
  for (const file of files) {
    try {
      const bytes = await bridge.readFile(file.path);
      const durationMs = await audioDurationMs(bytes);
      const peaks = await waveformPeaks(bytes);
      const asset = newAudioAsset("import", file.name, file.path, durationMs, peaks);
      audio.assets.push(asset);
      target.clips.push(newAudioClip(asset, playheadMs));
    } catch (err) {
      setAudioStatus(`import failed: ${(err as Error).message}`);
    }
  }
  commitHistory();
  refreshEditAudio();
  buildInspector();
}

async function startRecording() {
  const constraints: MediaStreamConstraints = {
    audio: selectedInputDeviceId ? { deviceId: { exact: selectedInputDeviceId } } : true,
  };
  try {
    recordingStream = await navigator.mediaDevices.getUserMedia(constraints);
    recordingChunks = [];
    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : "audio/webm";
    mediaRecorder = new MediaRecorder(recordingStream, { mimeType });
    mediaRecorder.ondataavailable = (e) => { if (e.data.size) recordingChunks.push(e.data); };
    mediaRecorder.onstop = () => void finishRecording();
    recordingStartMs = playheadMs;
    recordingStartedAt = performance.now();
    mediaRecorder.start();
    await startPlayback(playheadMs);
    refreshEditAudio();
  } catch (err) {
    setAudioStatus(`record failed: ${(err as Error).message}`);
  }
}

function stopRecording() {
  if (mediaRecorder?.state === "recording") mediaRecorder.stop();
}

async function finishRecording() {
  const bridge = audioBridge();
  recordingStream?.getTracks().forEach((t) => t.stop());
  recordingStream = null;
  const chunks = recordingChunks;
  recordingChunks = [];
  if (!bridge || chunks.length === 0) { refreshEditAudio(); return; }
  const blob = new Blob(chunks, { type: mediaRecorder?.mimeType || "audio/webm" });
  mediaRecorder = null;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const saved = await bridge.saveRecording({
    name: `voice-${new Date().toISOString().slice(0, 19)}`,
    extension: "webm",
    bytes,
  });
  let durationMs = Math.max(1, Math.round(performance.now() - recordingStartedAt));
  let peaks: number[] | undefined;
  try {
    const savedBytes = await bridge.readFile(saved.path);
    durationMs = await audioDurationMs(savedBytes);
    peaks = await waveformPeaks(savedBytes);
  } catch {
    peaks = undefined;
  }
  const audio = audioProject();
  const voice = audio.tracks[0] ?? newAudioTrack("Voice");
  if (!audio.tracks.includes(voice)) audio.tracks.unshift(voice);
  const asset = newAudioAsset("recording", saved.name, saved.path, durationMs, peaks);
  audio.assets.push(asset);
  const clip = newAudioClip(asset, recordingStartMs);
  voice.clips.push(clip);
  selectedAudioClipId = clip.id;
  commitHistory();
  setAudioStatus(`recorded ${saved.name}`);
  refreshEditAudio();
  buildInspector();
}

function splitSelectedAudioClip() {
  const selected = selectedAudioClip();
  if (!selected) return;
  const parts = splitClip(selected.clip, selected.asset, playheadMs);
  if (!parts) return;
  const index = selected.track.clips.findIndex((clip) => clip.id === selected.clip.id);
  selected.track.clips.splice(index, 1, ...parts);
  selectedAudioClipId = parts[1].id;
  commitHistory();
  refreshEditAudio();
  buildInspector();
}


function setAudioStatus(msg: string) {
  const el = document.getElementById("audio-status");
  if (el) el.textContent = msg;
  setStatus(msg);
}

function audioTimeToPct(ms: number) {
  return (ms / Math.max(1000, projectPlaybackDuration())) * 100;
}

function audioPctToTime(pct: number) {
  return Math.max(0, Math.round(pct * Math.max(1000, projectPlaybackDuration())));
}

function formatMs(ms: number) {
  const total = Math.max(0, Math.round(ms / 1000));
  const min = Math.floor(total / 60);
  const sec = String(total % 60).padStart(2, "0");
  return `${min}:${sec}`;
}

const TRACK_HEAD_WIDTH = 126;

function buildPlayheadElement(container: HTMLElement): HTMLElement {
  const line = document.createElement("div");
  line.className = "playhead-line";
  line.style.left = `calc(${audioTimeToPct(playheadMs)}% + ${TRACK_HEAD_WIDTH}px)`;
  const handle = document.createElement("div");
  handle.className = "playhead-handle";
  line.appendChild(handle);

  handle.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    handle.style.cursor = "grabbing";
    const move = (mv: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      const x = mv.clientX - rect.left - TRACK_HEAD_WIDTH + container.scrollLeft;
      const w = container.scrollWidth - TRACK_HEAD_WIDTH;
      const pct = Math.max(0, Math.min(1, x / w));
      setPlayhead(audioPctToTime(pct));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      handle.style.cursor = "";
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  });
  return line;
}

function syncActiveThumb() {
  if (lastSyncedThumbIndex === activePanelIndex) return;
  lastSyncedThumbIndex = activePanelIndex;
  document.querySelectorAll<HTMLElement>(".panel-cell").forEach((c) => {
    c.classList.toggle("active", +c.dataset.index! === activePanelIndex);
  });
}

function buildBreadcrumb() {
  const host = $("breadcrumb");
  host.innerHTML = "";
  const mkCrumb = (label: string, onClick?: () => void) => {
    const s = document.createElement("button");
    s.textContent = label;
    s.className = "crumb";
    if (!onClick) s.disabled = true;
    if (onClick) s.onclick = onClick;
    host.appendChild(s);
  };
  mkCrumb(`Panel ${activePanelIndex + 1}`, activeSubPanelId ? () => {
    activeSubPanelId = null;
    selectedSubPanelId = null;
    selectedText = null;
    clearSelection();
    buildBreadcrumb();
    buildLayers();
    buildInspector();
    buildEditContext();
  } : undefined);
  if (activeSubPanelId) {
    const sp = (activePanel().subPanels ?? []).find(s => s.id === activeSubPanelId);
    const label = sp ? `▸ Sub-Panel (${sp.shape})` : "▸ Sub-Panel";
    host.appendChild(document.createTextNode(" "));
    mkCrumb(label);
  }
}

function buildLayers() {
  const host = $("layers");
  host.innerHTML = "";
  const panel = activePanel();
  if (panel.kind === "timelapse" && !activeSubPanelId) {
    host.innerHTML = '<div style="font-size:11px;color:var(--dim);">Timelapse panels have no layers — edit the source panel.</div>';
    return;
  }
  const cont = activeContainer();
  // Display newest-on-top: visually iterate from highest actual index down.
  // `li` is the actual index in cont.layers (preserved everywhere so history,
  // drag-drop, and rendering keep using the unreversed array).
  const layerCount = cont.layers.length;
  for (let displayPos = 0; displayPos < layerCount; displayPos++) {
    const li = layerCount - 1 - displayPos;
    const layer = cont.layers[li];
    const isActive = li === cont.getActiveLayerIndex();
    const row = document.createElement("div");
    row.className = "layer-row" + (isActive ? " active" : "");

    const handle = document.createElement("span");
    handle.textContent = "⋮⋮"; handle.className = "drag-handle"; handle.title = "Drag to reorder";
    handle.draggable = true;
    handle.addEventListener("dragstart", (e) => {
      e.dataTransfer!.setData("text/plain", `layer:${li}`);
      e.dataTransfer!.effectAllowed = "move";
      row.classList.add("dragging");
    });
    handle.addEventListener("dragend", () => {
      row.classList.remove("dragging");
      document.querySelectorAll(".layer-row").forEach((r) =>
        r.classList.remove("drop-above", "drop-below"));
    });
    row.appendChild(handle);

    const vis = document.createElement("input");
    vis.type = "checkbox"; vis.checked = layer.visible;
    vis.onchange = () => { layer.visible = vis.checked; commitHistory(); };
    row.appendChild(vis);

    // Name: show as label, double-click to rename
    const nameEl = document.createElement("span");
    nameEl.className = "layer-label";
    nameEl.textContent = layer.name;
    nameEl.title = "Double-click to rename";
    nameEl.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      const nm = document.createElement("input");
      nm.type = "text"; nm.value = layer.name; nm.className = "layer-name";
      nm.onchange = () => { layer.name = nm.value; commitHistory(); buildLayers(); };
      nm.onblur = () => buildLayers();
      nm.onkeydown = (ke) => { if (ke.key === "Enter") nm.blur(); if (ke.key === "Escape") { nm.value = layer.name; nm.blur(); } };
      nameEl.replaceWith(nm);
      nm.focus();
      nm.select();
    });
    row.appendChild(nameEl);
    const badge = layerMaskBadge(layer);
    if (badge) {
      const tag = document.createElement("span");
      tag.className = "layer-tag";
      tag.textContent = maskOverlayLayerId === layer.id ? "MASK*" : badge;
      tag.title = layer.mask?.enabled === false ? "Mask disabled" : "Layer mask";
      row.appendChild(tag);
    }

    // Compact actions — just delete for the top row
    const del = iconButton(StudioIcons.Trash, "Delete layer", (e) => {
      e.stopPropagation();
      if (cont.layers.length <= 1) return;
      cont.layers.splice(li, 1);
      cont.setActiveLayerIndex(Math.max(0, Math.min(cont.getActiveLayerIndex(), cont.layers.length - 1)));
      prunePerspectiveGuides(panel);
      commitHistory();
      buildLayers();
      buildInspector();
    });
    if (cont.layers.length <= 1) del.disabled = true;
    row.appendChild(del);

    // Expanded row — only shown for the active layer
    if (isActive) {
      const expanded = document.createElement("div");
      expanded.className = "layer-expanded";

      const opLabel = document.createElement("span");
      opLabel.textContent = `${Math.round(layer.opacity * 100)}%`;
      opLabel.className = "layer-op-label";
      const op = document.createElement("input");
      op.type = "range"; op.min = "0"; op.max = "1"; op.step = "0.05";
      op.value = String(layer.opacity); op.className = "layer-op";
      op.oninput = () => { layer.opacity = +op.value; opLabel.textContent = `${Math.round(layer.opacity * 100)}%`; };
      op.onchange = () => { commitHistory(); };
      expanded.appendChild(op);
      expanded.appendChild(opLabel);

      const activateRow = () => {
        cont.setActiveLayerIndex(li);
        selectedText = null;
        selectedSubPanelId = null;
      };
      const actions = document.createElement("div");
      actions.className = "layer-actions";
      const clip = iconButton(layer.clipToBelow ? StudioIcons.Clip : StudioIcons.Layers, layer.clipToBelow ? "Unclip" : "Clip to below", (e) => {
        e.stopPropagation(); activateRow();
        layer.clipToBelow = !layer.clipToBelow;
        commitHistory(); buildLayers(); buildInspector();
      });
      clip.classList.toggle("active", !!layer.clipToBelow);
      actions.appendChild(clip);
      actions.appendChild(iconButton(StudioIcons.CopyCheck, "Duplicate layer", (e) => {
        e.stopPropagation(); activateRow(); duplicateActiveLayer();
      }));
      actions.appendChild(iconButton(StudioIcons.Eraser, "Clear layer", (e) => {
        e.stopPropagation(); activateRow(); clearActiveLayer();
      }));
      const merge = iconButton(StudioIcons.Layers, "Merge down", (e) => {
        e.stopPropagation(); activateRow(); mergeActiveLayerDown();
      });
      merge.disabled = !canMergeLayerDown(cont.layers, li);
      actions.appendChild(merge);
      actions.appendChild(iconButton(StudioIcons.Copy, "Copy layer", (e) => {
        e.stopPropagation(); activateRow(); copyActiveLayer();
      }));
      const paste = iconButton(StudioIcons.ClipboardPaste, "Paste above", (e) => {
        e.stopPropagation(); activateRow(); pasteLayerAboveActive();
      });
      paste.disabled = !layerClipboard;
      actions.appendChild(paste);
      expanded.appendChild(actions);
      row.appendChild(expanded);
    }

    row.addEventListener("dragover", (e) => {
      if (!e.dataTransfer?.types.includes("text/plain")) return;
      e.preventDefault();
      const rect = row.getBoundingClientRect();
      const isAbove = e.clientY < rect.top + rect.height / 2;
      document.querySelectorAll(".layer-row").forEach((r) =>
        r.classList.remove("drop-above", "drop-below"));
      row.classList.add(isAbove ? "drop-above" : "drop-below");
    });
    row.addEventListener("drop", (e) => {
      e.preventDefault();
      row.classList.remove("drop-above", "drop-below");
      const raw = e.dataTransfer!.getData("text/plain");
      if (!raw.startsWith("layer:")) return;
      const from = +raw.slice(6);
      if (Number.isNaN(from)) return;
      const rect = row.getBoundingClientRect();
      const isAbove = e.clientY < rect.top + rect.height / 2;
      // Reversed display: dropping VISUALLY above row `li` means landing
      // LATER in the actual array (newer-on-top); below means landing earlier.
      let to = isAbove ? li + 1 : li;
      if (from < to) to--;
      if (to === from) return;
      const [m] = cont.layers.splice(from, 1);
      cont.layers.splice(to, 0, m);
      const cur = cont.getActiveLayerIndex();
      if (cur === from) cont.setActiveLayerIndex(to);
      else if (from < cur && to >= cur) cont.setActiveLayerIndex(cur - 1);
      else if (from > cur && to <= cur) cont.setActiveLayerIndex(cur + 1);
      commitHistory();
      buildLayers();
    });

    row.onclick = (e) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "BUTTON" || t.classList.contains("drag-handle")) return;
      cont.setActiveLayerIndex(li);
      buildLayers();
    };
    if (layer.kind === "text") {
      const tag = document.createElement("span");
      tag.textContent = "T";
      tag.title = "Text layer";
      tag.className = "layer-tag";
      row.appendChild(tag);
    }
    host.appendChild(row);
  }

  const add = document.createElement("button");
  add.textContent = "+ Add layer"; add.className = "ghost";
  add.style.marginTop = "6px";
  add.onclick = () => {
    cont.layers.push(newLayer(`Layer ${cont.layers.length + 1}`));
    cont.setActiveLayerIndex(cont.layers.length - 1);
    commitHistory();
    buildLayers();
  };
  host.appendChild(add);

  // Rulers are layer-bound: switching layers can swap which ruler applies,
  // so keep the perspective inspector in sync.
  if (currentBrush === PERSPECTIVE_KEY) buildPerspectiveInspector();
}

// ---- inspector ------------------------------------------------------------

function buildProjectSettings() {
  const host = $("project-settings");
  host.innerHTML = "";

  const row = (label: string, child: HTMLElement) => {
    const wrap = document.createElement("div");
    wrap.style.cssText = "display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center;margin-top:6px;";
    const lab = document.createElement("span");
    lab.textContent = label;
    lab.style.cssText = "font-size:11px;color:var(--dim);";
    wrap.append(lab, child);
    host.appendChild(wrap);
  };

  const fps = document.createElement("input");
  fps.type = "number";
  fps.min = "1";
  fps.max = "60";
  fps.step = "1";
  fps.value = String(project.wiggleFps);
  fps.title = "How many wiggle ticks per second across the project";
  fps.style.cssText = "width:64px;background:var(--bg);color:var(--ink);border:1px solid var(--line);border-radius:var(--radius-sm);padding:4px 6px;font-size:12px;font-family:var(--font-mono);";
  fps.onchange = () => {
    project.wiggleFps = Math.max(1, Math.min(60, +fps.value || 8));
    fps.value = String(project.wiggleFps);
    commitHistory();
    buildTimeline();
    buildInspector();
  };
  row("Stroke wiggle rate", fps);

  const fpsUnit = document.createElement("div");
  fpsUnit.style.cssText = "font-size:10px;color:var(--text-muted);margin-top:4px;line-height:1.4;";
  fpsUnit.textContent = "Ticks per second for hand-drawn wiggle (default 8). Panel durations are measured in these ticks.";
  host.appendChild(fpsUnit);
}

function buildInspector() {
  updateToolContext();
  const host = $("inspector");
  const subPanelHost = $("subpanel-inspector");
  host.innerHTML = "";
  subPanelHost.innerHTML = "";

  const summaryEl = document.getElementById("inspector-heading");

  if (workspaceMode === "edit") {
    if (summaryEl) summaryEl.textContent = "Edit";
    appendEditInspector(host);
    return;
  }

  // Heading shows current target.
  const heading = document.createElement("div");
  heading.style.cssText = "font-size:11px;color:var(--dim);margin-bottom:6px;";
  if (selectedText) {
    const preview = selectedText.text.content.length > 18
      ? selectedText.text.content.slice(0, 18) + "…"
      : selectedText.text.content;
    heading.textContent = `Selected: Text "${preview}"`;
    if (summaryEl) summaryEl.textContent = "Text Properties";
  } else if (selectedSubPanelId) {
    heading.textContent = "Selected: Sub-Panel";
    if (summaryEl) summaryEl.textContent = "Sub-Panel Properties";
  } else {
    const layer = activeLayer();
    if (layer) {
      heading.textContent = `Active: ${layer.name} · Panel ${activePanelIndex + 1}`;
      if (summaryEl) summaryEl.textContent = "Layer Properties";
    } else {
      heading.textContent = `Active: Panel ${activePanelIndex + 1}`;
      if (summaryEl) summaryEl.textContent = "Panel Properties";
    }
  }
  host.appendChild(heading);

  if (selectedText) {
    appendTextInspector(host, selectedText);
    return;
  }

  if (selectedSubPanelId) {
    const sp = (activePanel().subPanels ?? []).find(s => s.id === selectedSubPanelId);
    if (!sp) { selectedSubPanelId = null; return; }
    appendSubPanelInspector(subPanelHost, sp);
  }

  appendPanelAnimInspector(host, activePanel());
  buildLayerAnimation();
}

function buildLayerAnimation() {
  const host = document.getElementById("layer-animation");
  if (!host) return;
  host.innerHTML = "";
  const layer = activeLayer();
  if (layer) appendLayerInspector(host, layer);
}

function appendEditInspector(host: HTMLElement) {
  const heading = document.createElement("div");
  heading.style.cssText = "font-size:11px;color:var(--dim);margin-bottom:6px;";
  heading.textContent = "Edit";
  host.appendChild(heading);
  buildAudioClipInspector(host);
  const section = document.createElement("div");
  section.className = "inspector-section";
  const title = document.createElement("div");
  title.className = "inspector-section-title";
  title.textContent = "Timeline";
  section.appendChild(title);
  const info = document.createElement("div");
  info.style.cssText = "font-size:11px;color:var(--dim);line-height:1.45;";
  info.textContent = `${project.panels.length} panels · ${audioProject().tracks.length} audio tracks · ${formatMs(projectPlaybackDuration())}`;
  section.appendChild(info);
  host.appendChild(section);
}

function appendTextInspector(host: HTMLElement, ref: TextRef) {
  const t = ref.text;
  const row = (label: string, child: HTMLElement) => {
    const wrap = document.createElement("div");
    wrap.style.cssText = "display:grid;grid-template-columns:80px 1fr;gap:4px;align-items:center;margin-top:4px;";
    const lab = document.createElement("span"); lab.textContent = label;
    lab.style.cssText = "font-size:11px;color:var(--dim);";
    wrap.appendChild(lab); wrap.appendChild(child);
    host.appendChild(wrap);
  };

  // Content
  const content = document.createElement("input");
  content.type = "text"; content.value = t.content;
  content.style.cssText = "width:100%;background:#0e0e16;color:var(--ink);border:1px solid var(--line);border-radius:3px;padding:4px;font-size:12px;font-family:inherit;";
  content.oninput = () => { t.content = content.value; };
  content.onchange = () => commitHistory();
  row("Content", content);

  // Font
  const font = document.createElement("select");
  for (const f of FONT_OPTIONS) {
    const o = document.createElement("option");
    o.value = f.family; o.textContent = f.label;
    if (f.family === t.fontFamily) o.selected = true;
    font.appendChild(o);
  }
  font.onchange = () => { t.fontFamily = font.value; commitHistory(); };
  row("Font", font);

  // Size
  const size = document.createElement("input");
  size.type = "range"; size.min = "12"; size.max = "200"; size.step = "2"; size.value = String(t.fontSize);
  size.oninput = () => { t.fontSize = +size.value; };
  size.onchange = () => commitHistory();
  row("Size", size);

  // Color (palette-aware row)
  appendColorRow(host, "Color", () => t.color, (c) => { t.color = c; });

  // Wiggle
  const wiggle = document.createElement("input");
  wiggle.type = "range"; wiggle.min = "0"; wiggle.max = "6"; wiggle.step = "0.5"; wiggle.value = String(t.wiggleAmplitude);
  wiggle.oninput = () => { t.wiggleAmplitude = +wiggle.value; };
  wiggle.onchange = () => commitHistory();
  row("Wiggle", wiggle);

  // Position (X / Y)
  const posWrap = document.createElement("div");
  posWrap.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:3px;";
  const mkPos = (axis: "x" | "y", lab: string) => {
    const w = document.createElement("label");
    w.style.cssText = "font-size:10px;color:var(--dim);"; w.textContent = lab;
    const inp = document.createElement("input");
    inp.type = "number"; inp.value = String(Math.round(t[axis]));
    inp.style.cssText = "width:100%;background:#0e0e16;color:var(--ink);border:1px solid var(--line);border-radius:3px;padding:2px;font-size:11px;";
    inp.onchange = () => { t[axis] = +inp.value; commitHistory(); };
    w.appendChild(inp); posWrap.appendChild(w);
  };
  mkPos("x", "X"); mkPos("y", "Y");
  row("Position", posWrap);

  // Enter / Exit animations
  appendAnimPicker(host, "Enter", () => t.enter, (a) => { t.enter = a; commitHistory(); });
  appendAnimPicker(host, "Exit",  () => t.exit,  (a) => { t.exit  = a; commitHistory(); });

  // Delete
  const delWrap = document.createElement("div"); delWrap.style.cssText = "margin-top:8px;";
  const del = document.createElement("button");
  del.textContent = "Delete text"; del.className = "ghost";
  del.onclick = () => {
    const idx = ref.layer.texts?.indexOf(ref.text) ?? -1;
    if (idx >= 0) {
      ref.layer.texts!.splice(idx, 1);
      selectedText = null;
      commitHistory();
      buildLayers();
      buildInspector();
    }
  };
  delWrap.appendChild(del);
  host.appendChild(delWrap);
}

function appendSubPanelInspector(host: HTMLElement, sp: SubPanel) {
  const row = (label: string, child: HTMLElement) => {
    const wrap = document.createElement("div");
    wrap.style.cssText = "display:grid;grid-template-columns:80px 1fr;gap:4px;align-items:center;margin-top:4px;";
    const lab = document.createElement("span"); lab.textContent = label;
    lab.style.cssText = "font-size:11px;color:var(--dim);";
    wrap.appendChild(lab); wrap.appendChild(child);
    host.appendChild(wrap);
  };

  // Shape
  const shape = document.createElement("select");
  for (const s of SHAPES) {
    const o = document.createElement("option"); o.value = s; o.textContent = s;
    if (s === sp.shape) o.selected = true;
    shape.appendChild(o);
  }
  shape.onchange = () => {
    sp.shape = shape.value as SubPanelShape;
    if ((sp.shape === "balloon" || sp.shape === "thought") && !sp.tail) {
      sp.tail = { x: sp.bounds.x + sp.bounds.w / 2, y: sp.bounds.y + sp.bounds.h + 80 };
    }
    // Speech balloons & thought bubbles are filled white by default.
    if ((sp.shape === "balloon" || sp.shape === "thought") && sp.bg == null) {
      sp.bg = "#ffffff";
    }
    commitHistory();
    buildInspector();
  };
  row("Shape", shape);

  // Border brush
  const bb = document.createElement("select");
  for (const b of BRUSHES) {
    const o = document.createElement("option"); o.value = b.key; o.textContent = b.label;
    if (b.key === sp.border.brush) o.selected = true;
    bb.appendChild(o);
  }
  bb.onchange = () => { sp.border.brush = bb.value; commitHistory(); };
  row("Border", bb);

  // Border color — native picker + palette strip
  appendColorRow(host, "Color", () => sp.border.color, (c) => { sp.border.color = c; });

  // Thickness
  const bt = document.createElement("input"); bt.type = "range"; bt.min = "1"; bt.max = "12"; bt.step = "0.5"; bt.value = String(sp.border.thickness);
  bt.oninput = () => { sp.border.thickness = +bt.value; };
  bt.onchange = () => commitHistory();
  row("Thickness", bt);

  // Wiggle
  const bw = document.createElement("input"); bw.type = "range"; bw.min = "0"; bw.max = "10"; bw.step = "0.5"; bw.value = String(sp.border.wiggleAmplitude);
  bw.oninput = () => { sp.border.wiggleAmplitude = +bw.value; };
  bw.onchange = () => commitHistory();
  row("Wiggle", bw);

  // Fill — checkbox to toggle transparency, then a full color row when on
  const fillRow = document.createElement("div");
  fillRow.className = "color-row";
  const fillLab = document.createElement("span");
  fillLab.textContent = "Fill";
  fillLab.className = "color-row-label";
  fillRow.appendChild(fillLab);
  const fillRight = document.createElement("div");
  fillRight.className = "color-row-right";
  const fillToggle = document.createElement("label");
  fillToggle.style.cssText = "display:flex;gap:4px;align-items:center;font-size:11px;color:var(--dim);";
  const fillChk = document.createElement("input");
  fillChk.type = "checkbox";
  fillChk.checked = !!sp.bg;
  fillChk.onchange = () => {
    sp.bg = fillChk.checked ? (sp.bg ?? "#ffffff") : null;
    commitHistory();
    rebuildInspector();
  };
  fillToggle.appendChild(fillChk);
  fillToggle.appendChild(document.createTextNode(sp.bg ? "filled" : "transparent"));
  fillRight.appendChild(fillToggle);
  fillRow.appendChild(fillRight);
  host.appendChild(fillRow);
  if (sp.bg != null) {
    appendColorRow(host, "Fill color", () => sp.bg ?? "#ffffff", (c) => { sp.bg = c; });
  }

  // Bounds (x, y, w, h)
  const bounds = document.createElement("div");
  bounds.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:3px;";
  const mk = (key: "x" | "y" | "w" | "h", lab: string) => {
    const wrap = document.createElement("label");
    wrap.style.cssText = "font-size:10px;color:var(--dim);";
    wrap.textContent = lab;
    const inp = document.createElement("input");
    inp.type = "number"; inp.value = String(Math.round(sp.bounds[key]));
    inp.style.cssText = "width:100%;background:#0e0e16;color:var(--ink);border:1px solid var(--line);border-radius:3px;padding:2px;font-size:11px;";
    inp.onchange = () => { sp.bounds[key] = +inp.value; commitHistory(); };
    wrap.appendChild(inp);
    bounds.appendChild(wrap);
  };
  mk("x", "X"); mk("y", "Y"); mk("w", "W"); mk("h", "H");
  row("Bounds", bounds);

  // Tail (only relevant for balloon/thought)
  if (sp.shape === "balloon" || sp.shape === "thought") {
    const tailWrap = document.createElement("div");
    tailWrap.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:3px;";
    const mkT = (axis: "x" | "y", lab: string) => {
      const w = document.createElement("label");
      w.style.cssText = "font-size:10px;color:var(--dim);"; w.textContent = lab;
      const inp = document.createElement("input");
      inp.type = "number";
      inp.value = String(Math.round((sp.tail ?? { x: 0, y: 0 })[axis]));
      inp.style.cssText = "width:100%;background:#0e0e16;color:var(--ink);border:1px solid var(--line);border-radius:3px;padding:2px;font-size:11px;";
      inp.onchange = () => {
        if (!sp.tail) sp.tail = { x: 0, y: 0 };
        sp.tail[axis] = +inp.value;
        commitHistory();
      };
      w.appendChild(inp); tailWrap.appendChild(w);
    };
    mkT("x", "TX"); mkT("y", "TY");
    row("Tail", tailWrap);
  }

  // Enter/Exit animations
  appendAnimPicker(host, "Enter", () => sp.enter, (a) => { sp.enter = a; commitHistory(); });
  appendAnimPicker(host, "Exit",  () => sp.exit,  (a) => { sp.exit  = a; commitHistory(); });

  // Delete
  const delWrap = document.createElement("div"); delWrap.style.cssText = "margin-top:8px;";
  const del = document.createElement("button");
  del.textContent = "Delete sub-panel"; del.className = "ghost";
  del.onclick = () => {
    const p = activePanel();
    p.subPanels = (p.subPanels ?? []).filter(s => s.id !== sp.id);
    if (activeSubPanelId === sp.id) activeSubPanelId = null;
    selectedSubPanelId = null;
    selectedText = null;
    commitHistory();
    buildBreadcrumb(); buildLayers(); buildInspector();
  };
  delWrap.appendChild(del);
  host.appendChild(delWrap);
}

function appendPanelAnimInspector(host: HTMLElement, p: Panel) {
  appendColorRow(host, "Background", () => p.bg, (c) => { p.bg = c; });
  appendAnimPicker(host, "Panel Enter", () => p.enter, (a) => { p.enter = a; commitHistory(); buildTimeline(); });
  appendAnimPicker(host, "Panel Exit",  () => p.exit,  (a) => { p.exit  = a; commitHistory(); buildTimeline(); });
}

function appendLayerInspector(host: HTMLElement, layer: Layer) {
  const section = document.createElement("div");
  section.className = "inspector-section";
  const title = document.createElement("div");
  title.className = "inspector-section-title";
  title.appendChild(svgIcon(StudioIcons.BrushScatter, 14));
  title.appendChild(document.createTextNode(" Layer Animation"));
  title.appendChild(svgIcon(StudioIcons.BrushTexture, 14));
  section.appendChild(title);

  const row = (label: string, child: HTMLElement) => {
    const wrap = document.createElement("div");
    wrap.style.cssText = "display:grid;grid-template-columns:80px 1fr;gap:4px;align-items:center;margin-top:4px;";
    const lab = document.createElement("span");
    lab.textContent = label;
    lab.style.cssText = "font-size:11px;color:var(--dim);";
    wrap.appendChild(lab);
    wrap.appendChild(child);
    section.appendChild(wrap);
  };

  const clip = document.createElement("input");
  clip.type = "checkbox";
  clip.checked = !!layer.clipToBelow;
  clip.onchange = () => {
    layer.clipToBelow = clip.checked;
    commitHistory();
    buildLayers();
  };

  const blend = document.createElement("select");
  for (const mode of LAYER_BLEND_MODES) {
    const o = document.createElement("option");
    o.value = mode;
    o.textContent = mode;
    if ((layer.blendMode ?? "normal") === mode) o.selected = true;
    blend.appendChild(o);
  }
  blend.onchange = () => {
    layer.blendMode = blend.value as LayerBlendMode;
    commitHistory([layer]);
    buildLayers();
    buildInspector();
  };

  if (layer.animation?.enabled) {
    const activeToggle = document.createElement("input");
    activeToggle.type = "checkbox";
    activeToggle.checked = true;
    activeToggle.onchange = () => {
      layer.animation!.enabled = false;
      commitHistory();
      buildTimeline();
      buildLayers();
      buildInspector();
    };
    row("Active", activeToggle);
    row("Blend", blend);
    row("Clip", clip);
    const anim = layer.animation;
    const tickWrap = document.createElement("div");
    tickWrap.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:4px;";
    const tickInput = (key: "startTick" | "durationTicks", label: string) => {
      const lab = document.createElement("label");
      lab.style.cssText = "font-size:10px;color:var(--dim);";
      lab.textContent = label;
      const inp = document.createElement("input");
      inp.type = "number";
      inp.min = key === "durationTicks" ? "1" : "0";
      inp.step = "1";
      inp.value = String(anim[key]);
      inp.onchange = () => {
        anim[key] = key === "durationTicks"
          ? Math.max(1, +inp.value || 1)
          : Math.max(0, +inp.value || 0);
        commitHistory();
        buildTimeline();
      };
      lab.appendChild(inp);
      tickWrap.appendChild(lab);
    };
    tickInput("startTick", "Start");
    tickInput("durationTicks", "Ticks");
    row("Timing", tickWrap);

    const easing = document.createElement("select");
    for (const kind of EASINGS) {
      const o = document.createElement("option");
      o.value = kind;
      o.textContent = kind;
      if (kind === anim.easing) o.selected = true;
      easing.appendChild(o);
    }
    easing.onchange = () => { anim.easing = easing.value as EasingKind; commitHistory(); };
    row("Easing", easing);

    const loop = document.createElement("select");
    for (const kind of LAYER_LOOPS) {
      const o = document.createElement("option");
      o.value = kind;
      o.textContent = kind;
      if (kind === (anim.loop ?? "none")) o.selected = true;
      loop.appendChild(o);
    }
    loop.onchange = () => { anim.loop = loop.value as LayerLoopKind; commitHistory(); };
    row("Loop", loop);

    const keyButtons = document.createElement("div");
    keyButtons.className = "keyframe-buttons";
    const fromBtn = document.createElement("button");
    fromBtn.type = "button";
    fromBtn.className = "cellbtn" + (keyframeArm === "from" ? " active" : "");
    fromBtn.textContent = "Set start (A)";
    fromBtn.title = "Position the start keyframe A on the canvas";
    fromBtn.onclick = () => armLayerKeyframe("from");
    const toBtn = document.createElement("button");
    toBtn.type = "button";
    toBtn.className = "cellbtn" + (keyframeArm === "to" ? " active" : "");
    toBtn.textContent = "Set end (B)";
    toBtn.title = "Position the end keyframe B on the canvas";
    toBtn.onclick = () => armLayerKeyframe("to");
    keyButtons.appendChild(fromBtn);
    keyButtons.appendChild(toBtn);
    row("Keyframes", keyButtons);

    appendLayerTransformGrid(section, "From", anim.from, () => {
      commitHistory();
      buildTimeline();
    });
    appendLayerTransformGrid(section, "To", anim.to, () => {
      commitHistory();
      buildTimeline();
    });
  } else {
    const enableWrap = document.createElement("div");
    enableWrap.style.cssText = "display:flex;align-items:center;gap:6px;margin:4px 0;";
    const enableChk = document.createElement("input");
    enableChk.type = "checkbox"; enableChk.checked = false;
    enableChk.id = "layer-anim-enable";
    const enableLabel = document.createElement("label");
    enableLabel.htmlFor = "layer-anim-enable";
    enableLabel.textContent = "Animate";
    enableLabel.style.cssText = "font-size:11px;color:var(--text-secondary);cursor:pointer;";
    enableChk.onchange = () => {
      const anim = ensureLayerAnimation(layer);
      anim.enabled = true;
      keyframeArm = "from";
      currentBrush = MOVE_LAYER_KEY;
      if (!animHintShown) {
        animHintShown = true;
        setStatus("Drag A and B on the canvas, then press Play");
      }
      buildBrushBar();
      buildTimeline();
      buildLayers();
      buildInspector();
    };
    enableWrap.appendChild(enableChk);
    enableWrap.appendChild(enableLabel);
    section.appendChild(enableWrap);
    row("Blend", blend);
    row("Clip", clip);
  }

  if (layer.mask) {
    const maskControls = document.createElement("div");
    maskControls.style.cssText = "display:flex;align-items:center;gap:4px;flex-wrap:wrap;";

    const enabled = document.createElement("input");
    enabled.type = "checkbox";
    enabled.checked = layer.mask.enabled;
    enabled.title = "Enable mask";
    enabled.onchange = () => setLayerMaskEnabled(enabled.checked);
    maskControls.appendChild(enabled);

    const overlay = document.createElement("input");
    overlay.type = "checkbox";
    overlay.checked = maskOverlayLayerId === layer.id;
    overlay.title = "Show mask overlay";
    overlay.onchange = () => setActiveMaskOverlay(overlay.checked);
    maskControls.appendChild(overlay);

    const invert = document.createElement("button");
    invert.className = "chip";
    invert.textContent = "Invert";
    invert.onclick = () => invertLayerMask();
    maskControls.appendChild(invert);

    const del = document.createElement("button");
    del.className = "chip";
    del.textContent = "Delete";
    del.onclick = () => deleteLayerMask();
    maskControls.appendChild(del);
    row("Mask", maskControls);
  }

  const buttons = document.createElement("div");
  buttons.className = "inspector-buttons";
  buttons.appendChild(iconButton(StudioIcons.CopyCheck, "Copy animation", (e) => {
    e.preventDefault();
    copyActiveLayerAnimation();
  }, "cellbtn iconbtn inspector-iconbtn"));
  const pasteAnim = iconButton(StudioIcons.ClipboardCheck, "Paste animation", (e) => {
    e.preventDefault();
    pasteAnimationToActiveLayer();
  }, "cellbtn iconbtn inspector-iconbtn");
  pasteAnim.disabled = !animationClipboard;
  buttons.appendChild(pasteAnim);
  section.appendChild(buttons);

  host.appendChild(section);
}

function appendLayerTransformGrid(
  host: HTMLElement,
  label: string,
  transform: LayerAnimTransform,
  commit: () => void
) {
  const wrap = document.createElement("div");
  wrap.style.cssText = "margin-top:6px;";
  const title = document.createElement("div");
  title.style.cssText = "font-size:11px;color:var(--dim);margin-bottom:3px;";
  title.textContent = label;
  wrap.appendChild(title);
  const grid = document.createElement("div");
  grid.className = "layer-transform-grid";
  for (const [key, short, step] of [
    ["x", "X", "1"],
    ["y", "Y", "1"],
    ["opacity", "Op", "0.05"],
    ["scale", "Sc", "0.05"],
    ["rotation", "Rot", "1"],
  ] as const) {
    const item = document.createElement("label");
    item.textContent = short;
    const inp = document.createElement("input");
    inp.type = "number";
    inp.step = step;
    inp.value = String(transform[key]);
    inp.onchange = () => {
      transform[key] = key === "opacity"
        ? Math.max(0, Math.min(1, +inp.value || 0))
        : key === "scale"
          ? Math.max(0.05, +inp.value || 1)
          : +inp.value || 0;
      commit();
    };
    item.appendChild(inp);
    grid.appendChild(item);
  }
  wrap.appendChild(grid);
  host.appendChild(wrap);
}

/**
 * Color row: label | native color picker + a strip of the current palette's
 * swatches. Clicking a swatch commits immediately; the native picker
 * previews via `oninput` and commits on `change`.
 */
function appendColorRow(
  host: HTMLElement,
  label: string,
  get: () => string,
  set: (c: string) => void
) {
  const wrap = document.createElement("div");
  wrap.className = "color-row";
  const lab = document.createElement("span");
  lab.textContent = label;
  lab.className = "color-row-label";
  wrap.appendChild(lab);

  const right = document.createElement("div");
  right.className = "color-row-right";

  const inp = document.createElement("input");
  inp.type = "color";
  inp.value = get();
  inp.oninput = () => set(inp.value);
  inp.onchange = () => { set(inp.value); commitHistory(); };
  right.appendChild(inp);

  const swatches = document.createElement("div");
  swatches.className = "color-row-swatches";
  for (const c of currentPalette.colors) {
    const b = document.createElement("button");
    b.className = "mini-swatch" + (c.toLowerCase() === get().toLowerCase() ? " active" : "");
    b.style.background = c;
    b.title = c;
    b.onclick = (e) => {
      e.preventDefault();
      set(c);
      commitHistory();
      inp.value = c;
      rebuildInspector();
    };
    swatches.appendChild(b);
  }
  right.appendChild(swatches);

  wrap.appendChild(right);
  host.appendChild(wrap);
}

function appendAnimPicker(
  host: HTMLElement,
  label: string,
  read: () => AnimationSpec | undefined,
  write: (a: AnimationSpec | undefined) => void
) {
  const wrap = document.createElement("div");
  wrap.style.cssText = "display:grid;grid-template-columns:80px 1fr 1fr;gap:4px;align-items:center;margin-top:4px;";
  const lab = document.createElement("span"); lab.textContent = label;
  lab.style.cssText = "font-size:11px;color:var(--dim);";
  wrap.appendChild(lab);

  const cur = read();
  const sel = document.createElement("select");
  for (const k of ANIM_KINDS) {
    const o = document.createElement("option"); o.value = k; o.textContent = k;
    if ((cur?.kind ?? "none") === k) o.selected = true;
    sel.appendChild(o);
  }
  const ticks = document.createElement("input");
  ticks.type = "number"; ticks.min = "1"; ticks.max = "32"; ticks.step = "1";
  ticks.value = String(cur?.durationTicks ?? 4);
  ticks.title = "ticks (8 ticks = 1s @ 8fps)";
  ticks.style.cssText = "width:100%;background:#0e0e16;color:var(--ink);border:1px solid var(--line);border-radius:3px;padding:2px;font-size:11px;";
  sel.onchange = () => {
    const kind = sel.value as AnimationKind;
    if (kind === "none") write(undefined);
    else write({ kind, durationTicks: +ticks.value || 4 });
  };
  ticks.onchange = () => {
    const kind = sel.value as AnimationKind;
    if (kind === "none") return;
    write({ kind, durationTicks: Math.max(1, +ticks.value || 4) });
  };
  wrap.appendChild(sel); wrap.appendChild(ticks);
  host.appendChild(wrap);
}

// ---- panel ops ------------------------------------------------------------

function rebuildAfterPanelTimingChange() {
  commitHistory();
  buildTimeline();
  buildInspector();
}

function setPanelExposure(i: number, ticks: number) {
  const panel = project.panels[i];
  if (!panel) return;
  setPanelExposureTicks(panel, ticks, project.wiggleFps);
  rebuildAfterPanelTimingChange();
  setStatus(`Panel ${i + 1}: ${durationMsToExposureTicks(panel.durationMs, project.wiggleFps)} frames`);
}

function setPanelDurationMs(i: number, durationMs: number) {
  const panel = project.panels[i];
  if (!panel) return;
  panel.durationMs = Math.max(100, Math.round(durationMs));
  rebuildAfterPanelTimingChange();
  setStatus(`Panel ${i + 1}: ${panel.durationMs}ms`);
}

function adjustPanelExposure(i: number, deltaTicks: number) {
  const panel = project.panels[i];
  if (!panel) return;
  adjustPanelExposureTicks(panel, deltaTicks, project.wiggleFps);
  rebuildAfterPanelTimingChange();
  setStatus(`Panel ${i + 1}: ${durationMsToExposureTicks(panel.durationMs, project.wiggleFps)} frames`);
}

function insertBlankPanelAt(index: number) {
  const source = project.panels[activePanelIndex] ?? project.panels[0];
  if (!source) return;
  const blank = createBlankPanelFrom(source, () => crypto.randomUUID());
  const insertAt = Math.max(0, Math.min(index, project.panels.length));
  project.panels.splice(insertAt, 0, blank);
  activePanelIndex = insertAt;
  activeSubPanelId = null;
  selectedSubPanelId = null;
  selectedText = null;
  dirtyThumbnailPanelIds.add(blank.id);
  commitHistory();
  buildTimeline();
  buildLayers();
  buildBreadcrumb();
  buildInspector();
}

function copyActivePanelContents() {
  panelContentClipboard = copyPanelContents(activePanel());
  buildTimeline();
  setStatus(`copied panel ${activePanelIndex + 1} contents`);
}

function pasteIntoActivePanel() {
  if (!panelContentClipboard) return;
  const panel = activePanel();
  if (panel.kind === "timelapse") return;
  pastePanelContents(panel, panelContentClipboard, () => crypto.randomUUID());
  activeSubPanelId = null;
  selectedSubPanelId = null;
  selectedText = null;
  dirtyThumbnailPanelIds.add(panel.id);
  commitHistory();
  buildTimeline();
  buildLayers();
  buildBreadcrumb();
  buildInspector();
  setStatus(`pasted into panel ${activePanelIndex + 1}`);
}

function insertTimelapseBefore(i: number) {
  const src = project.panels[i];
  if (src.kind === "timelapse") return;
  const totalLen = computeTotalLength(src);
  const duration = Math.max(300, Math.round((totalLen / 5000) * 1000));
  const tl: Panel = {
    id: crypto.randomUUID(),
    durationMs: duration,
    bg: src.bg,
    paletteId: src.paletteId,
    layers: [],
    kind: "timelapse",
    timelapse: { sourceId: src.id },
    subPanels: [],
  };
  project.panels.splice(i, 0, tl);
  if (activePanelIndex >= i) activePanelIndex++;
  dirtyThumbnailPanelIds.add(tl.id);
  commitHistory();
  buildTimeline();
  buildLayers();
}

function duplicatePanel(i: number) {
  const src = project.panels[i];
  const copy = clonePanelForDuplicate(src, () => crypto.randomUUID());
  project.panels.splice(i + 1, 0, copy);
  onPanelDuplicated(project, src.id, copy.id);
  activePanelIndex = i + 1;
  dirtyThumbnailPanelIds.add(copy.id);
  commitHistory();
  buildTimeline();
  buildLayers();
  buildInspector();
}

function deletePanel(i: number) {
  if (project.panels.length <= 1) return;
  const removedId = project.panels[i].id;
  project.panels.splice(i, 1);
  onPanelDeleted(project, removedId);
  activePanelIndex = Math.max(0, Math.min(activePanelIndex, project.panels.length - 1));
  activeSubPanelId = null;
  selectedSubPanelId = null;
  selectedText = null;
  commitHistory();
  buildTimeline();
  buildLayers();
  buildBreadcrumb();
  buildInspector();
}

// ---- controls -------------------------------------------------------------

async function startAudioPreview(fromMs: number) {
  const duration = Math.max(0, projectPlaybackDuration() - fromMs);
  await audioPreview.play(project.audio, fromMs, duration);
}

async function startPlayback(fromMs = playheadMs) {
  playing = true;
  lastPlaybackRenderPanelIndex = -1;
  lastPlaybackRenderSeqTick = -1;
  playheadStartMs = Math.max(0, Math.min(fromMs, Math.max(0, projectPlaybackDuration() - 1)));
  playheadMs = playheadStartMs;
  lastPlaybackMs = playheadStartMs;
  playStart = performance.now();
  const playEl = document.getElementById("play") as HTMLButtonElement | null;
  if (playEl) playEl.textContent = "Stop";
  await startAudioPreview(playheadStartMs);
  updatePlayheadChrome();
}

async function stopPlayback(atMs = playheadMs) {
  playing = false;
  lastPlaybackRenderPanelIndex = -1;
  lastPlaybackRenderSeqTick = -1;
  playheadMs = Math.max(0, atMs);
  const playEl = document.getElementById("play") as HTMLButtonElement | null;
  if (playEl) playEl.textContent = "Play";
  await audioPreview.stop();
  if (mediaRecorder?.state === "recording") mediaRecorder.stop();
  updatePlayheadChrome();
}

function setPlayhead(ms: number) {
  playheadMs = Math.max(0, Math.min(Math.round(ms), Math.max(0, projectPlaybackDuration() - 1)));
  playheadStartMs = playheadMs;
  playStart = performance.now();
  updatePlayheadChrome();
  if (playing) void startAudioPreview(playheadMs);
}

function updatePlayheadChrome() {
  const el = document.getElementById("audio-playhead-label");
  if (el) el.textContent = formatMs(playheadMs);
  const fc = document.getElementById("frame-counter");
  if (fc) {
    if (workspaceMode === "edit") {
      fc.textContent = formatMs(playheadMs);
    } else if (playing && lastSequencePosition) {
      fc.textContent = formatSequenceCounter(project, lastSequencePosition, true);
    } else {
      fc.textContent = `${activePanelIndex + 1} / ${project.panels.length}`;
    }
  }
  const line = document.querySelector(".playhead-line") as HTMLElement | null;
  if (line) line.style.left = `calc(${audioTimeToPct(playheadMs)}% + ${TRACK_HEAD_WIDTH}px)`;
}

// Play, loop, and jitter handlers are now in buildTransportBar().
($("size") as HTMLInputElement).oninput = (e) => {
  currentSize = +(e.target as HTMLInputElement).value;
  buildBrushBar();
};
($("pen-pressure") as HTMLInputElement).onchange = (e) => {
  pressureEnabled = (e.target as HTMLInputElement).checked;
};
($("brush-spacing") as HTMLInputElement).oninput = (e) => {
  currentBrushSettings = normalizeBrushSettings({
    ...currentBrushSettings,
    spacingScale: +(e.target as HTMLInputElement).value,
  });
  updateBrushSettingsControls();
};
($("brush-flow") as HTMLInputElement).oninput = (e) => {
  currentBrushSettings = normalizeBrushSettings({
    ...currentBrushSettings,
    flow: +(e.target as HTMLInputElement).value,
  });
  updateBrushSettingsControls();
};
($("brush-pressure-size") as HTMLInputElement).onchange = (e) => {
  currentBrushSettings = normalizeBrushSettings({
    ...currentBrushSettings,
    pressureSize: (e.target as HTMLInputElement).checked,
  });
  updateBrushSettingsControls();
};
($("brush-pressure-flow") as HTMLInputElement).onchange = (e) => {
  currentBrushSettings = normalizeBrushSettings({
    ...currentBrushSettings,
    pressureFlow: (e.target as HTMLInputElement).checked,
  });
  updateBrushSettingsControls();
};
($("stroke-smoothing-mode") as HTMLSelectElement).onchange = (e) => {
  setStrokeSmoothingSettings({ mode: (e.target as HTMLSelectElement).value as Project["drawingSettings"]["smoothing"]["mode"] });
};
($("stroke-smoothing-distance") as HTMLInputElement).oninput = (e) => {
  setStrokeSmoothingSettings({ distance: +(e.target as HTMLInputElement).value });
};
($("stroke-smoothing-delay") as HTMLInputElement).oninput = (e) => {
  setStrokeSmoothingSettings({ delayDistance: +(e.target as HTMLInputElement).value });
};
($("stroke-smoothing-finish") as HTMLInputElement).onchange = (e) => {
  setStrokeSmoothingSettings({ finishStabilizedStroke: (e.target as HTMLInputElement).checked });
};
($("stroke-smoothing-pressure") as HTMLInputElement).onchange = (e) => {
  setStrokeSmoothingSettings({ smoothPressure: (e.target as HTMLInputElement).checked });
};

// ---- text controls --------------------------------------------------------

function buildFontPicker() {
  const sel = $("font-picker") as HTMLSelectElement;
  sel.innerHTML = "";
  for (const f of FONT_OPTIONS) {
    const o = document.createElement("option");
    o.value = f.family; o.textContent = f.label;
    o.style.fontFamily = `"${f.family}", sans-serif`;
    if (f.family === currentFont) o.selected = true;
    sel.appendChild(o);
  }
  sel.onchange = () => { currentFont = sel.value; };
}

($("font-size") as HTMLInputElement).oninput = (e) => {
  currentFontSize = +(e.target as HTMLInputElement).value;
  $("font-size-val").textContent = String(currentFontSize);
};
($("text-wiggle") as HTMLInputElement).oninput = (e) => {
  currentTextWiggle = +(e.target as HTMLInputElement).value;
};

// ---- bucket controls -------------------------------------------------------

($("fill-tolerance") as HTMLInputElement).oninput = (e) => {
  currentFillTolerance = +(e.target as HTMLInputElement).value;
  $("fill-tolerance-val").textContent = String(currentFillTolerance);
};
($("fill-gap-close") as HTMLSelectElement).onchange = (e) => {
  currentFillGapClosePx = +(e.target as HTMLSelectElement).value;
};
($("fill-reference") as HTMLSelectElement).onchange = (e) => {
  currentFillReferenceMode = (e.target as HTMLSelectElement).value as Fill["referenceMode"];
};

// ---- palette UX -----------------------------------------------------------

function setLospecError(msg: string) { $("lospec-error").textContent = msg; }

function rebuildPalettePicker() {
  const sel = $("palette-picker") as HTMLSelectElement;
  sel.innerHTML = "";
  const group = (label: string, items: { id: string; name: string }[]) => {
    if (!items.length) return;
    const og = document.createElement("optgroup");
    og.label = label;
    for (const it of items) {
      const o = document.createElement("option");
      o.value = it.id; o.textContent = it.name;
      if (it.id === currentPalette.id) o.selected = true;
      og.appendChild(o);
    }
    sel.appendChild(og);
  };
  group("Built-in", BUILTIN_PALETTES.map((p) => ({ id: p.id, name: p.name })));
  group("Recent (Lospec)", recentSlugs.map((s) => ({ id: s, name: s })));
}

async function applyPaletteById(id: string) {
  setLospecError("");
  const builtin = BUILTIN_PALETTES.find((p) => p.id === id);
  if (builtin) {
    currentPalette = builtin;
  } else {
    try {
      currentPalette = await loadLospecPalette(id);
      if (!recentSlugs.includes(id)) {
        recentSlugs.unshift(id);
        if (recentSlugs.length > 8) recentSlugs.pop();
      }
    } catch (err) {
      setLospecError((err as Error).message);
      return;
    }
  }
  activePanel().paletteId = currentPalette.id;
  commitHistory();
  currentColor = currentPalette.colors[0];
  buildPalette();
  rebuildPalettePicker();
}

($("lospec") as HTMLButtonElement).onclick = async () => {
  const slug = ($("lospec-slug") as HTMLInputElement).value.trim();
  if (!slug) return;
  await applyPaletteById(slug);
};
($("palette-picker") as HTMLSelectElement).onchange = (e) => {
  applyPaletteById((e.target as HTMLSelectElement).value);
};

// Onion skin handlers are now in buildOnionSkinBar().

// ---- export ---------------------------------------------------------------

function showToast(message: string, kind: "error" | "info" = "error") {
  const stack = $("toast-stack");
  const toast = document.createElement("div");
  toast.className = "toast" + (kind === "info" ? " toast-info" : "");
  const text = document.createElement("span");
  text.textContent = message;
  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.className = "toast-dismiss";
  dismiss.setAttribute("aria-label", "Dismiss");
  dismiss.textContent = "×";
  dismiss.onclick = () => toast.remove();
  toast.append(text, dismiss);
  stack.appendChild(toast);
}

function showError(message: string) {
  showToast(message, "error");
}

function openExportOverlay() {
  const overlay = $("export-overlay");
  overlay.hidden = false;
  overlay.classList.add("open");
}

function closeExportOverlay() {
  const overlay = $("export-overlay");
  overlay.classList.remove("open");
  overlay.hidden = true;
  $("export-audio-choice").hidden = true;
  $("export-progress-panel").hidden = true;
}

function updateExportProgress(status: string, progress: number) {
  $("export-status").textContent = status;
  ($("export-progress-fill") as HTMLElement).style.width = `${Math.round(Math.max(0, Math.min(1, progress)) * 100)}%`;
}

function askAudioTailChoice(): Promise<boolean | null> {
  return new Promise((resolve) => {
    $("export-title").textContent = "Audio runs past your panels";
    $("export-audio-choice").hidden = false;
    $("export-progress-panel").hidden = true;
    openExportOverlay();

    let settled = false;
    const finish = (value: boolean | null) => {
      if (settled) return;
      settled = true;
      $("export-audio-include").onclick = null;
      $("export-audio-skip").onclick = null;
      resolve(value);
    };

    ($("export-audio-include") as HTMLButtonElement).onclick = () => finish(true);
    ($("export-audio-skip") as HTMLButtonElement).onclick = () => finish(false);

    const onOverlayClick = (e: MouseEvent) => {
      if (e.target === $("export-overlay")) finish(null);
    };
    $("export-overlay").addEventListener("click", onOverlayClick, { once: true });
  });
}

async function runExport(format: "webm" | "mp4") {
  closeExportMenu();
  const wasPlaying = playing;
  await stopPlayback(playheadMs);

  let includeAudioTail = false;
  if (format === "mp4") {
    const hasTail = totalAudioDuration(project.audio) > projectVisualDuration();
    if (hasTail) {
      const choice = await askAudioTailChoice();
      if (choice === null) {
        closeExportOverlay();
        return;
      }
      includeAudioTail = choice;
    }
  }

  exportCancelled = false;
  $("export-title").textContent = format === "webm" ? "Exporting WebM…" : "Exporting MP4…";
  $("export-audio-choice").hidden = true;
  $("export-progress-panel").hidden = false;
  updateExportProgress(format === "mp4" ? "Loading encoder…" : "Starting…", 0);
  openExportOverlay();

  const shouldCancel = () => exportCancelled;
  const onProgressEvent = (progress: Parameters<typeof exportProgressStatus>[0]) => {
    updateExportProgress(exportProgressStatus(progress), progress.progress);
  };

  try {
    if (format === "webm") {
      const blob = await exportWebM(project, undefined, {
        contentVersion: renderContentVersion,
        onProgressEvent,
        shouldCancel,
      });
      downloadBlob(blob, "wiggle.webm");
      setStatus("WebM done");
    } else {
      const blob = await exportMP4(project, 30, undefined, {
        includeAudioTail,
        contentVersion: renderContentVersion,
        onProgressEvent,
        shouldCancel,
      });
      downloadBlob(blob, "wiggle.mp4");
      setStatus("MP4 done");
    }
  } catch (err) {
    if (isAbortError(err) || exportCancelled) {
      setStatus("Export cancelled");
    } else {
      showError(`${format === "webm" ? "WebM" : "MP4"} failed: ${(err as Error).message}`);
    }
  } finally {
    closeExportOverlay();
    exportCancelled = false;
    if (wasPlaying) void startPlayback(playheadMs);
  }
}

($("export-webm") as HTMLButtonElement).onclick = () => { void runExport("webm"); };
($("export-mp4") as HTMLButtonElement).onclick = () => { void runExport("mp4"); };
($("export-cancel") as HTMLButtonElement).onclick = () => { exportCancelled = true; };

function openAboutDialog() {
  $("about-overlay").hidden = false;
  $("about-overlay").classList.add("open");
}

function closeAboutDialog() {
  $("about-overlay").classList.remove("open");
  $("about-overlay").hidden = true;
}

function projectCanvasIsEmpty(): boolean {
  for (const panel of project.panels) {
    for (const layer of panel.layers) {
      if (layer.strokes.length || layer.fills.length || (layer.texts?.length ?? 0)) return false;
    }
  }
  return true;
}

function updateCanvasHint() {
  const hint = $("canvas-hint");
  const dismissed = localStorage.getItem(CANVAS_HINT_KEY) === "1";
  hint.hidden = dismissed || !projectCanvasIsEmpty();
}

function dismissCanvasHint() {
  localStorage.setItem(CANVAS_HINT_KEY, "1");
  $("canvas-hint").hidden = true;
}

function showFirstLaunchStatus() {
  const el = $("status");
  if (localStorage.getItem(CMDK_HINT_KEY) !== "1") {
    localStorage.setItem(CMDK_HINT_KEY, "1");
    el.innerHTML = 'Ready · <span class="status-hint">Press <kbd>⌘K</kbd> for commands</span>';
    el.style.opacity = "1";
    clearTimeout(_statusTimer);
    return;
  }
  setStatus("ready");
}

($("canvas-hint-dismiss") as HTMLButtonElement).onclick = dismissCanvasHint;
($("about-close") as HTMLButtonElement).onclick = closeAboutDialog;
$("about-overlay").addEventListener("click", (e) => {
  if (e.target === $("about-overlay")) closeAboutDialog();
});
($("help-about") as HTMLButtonElement).onclick = () => {
  closeHelpMenu();
  openAboutDialog();
};
($("help-commands") as HTMLButtonElement).onclick = () => {
  closeHelpMenu();
  openCommandPalette();
};
($("help-menu-button") as HTMLButtonElement).onclick = (e) => {
  e.stopPropagation();
  closeFileMenu();
  closeExportMenu();
  $("help-menu").classList.toggle("open");
  $("help-menu-button").classList.toggle("open");
};

let _statusTimer = 0;
function setStatus(s: string, durationMs = 3500) {
  const el = $("status");
  el.textContent = s;
  el.style.opacity = "1";
  clearTimeout(_statusTimer);
  if (durationMs > 0) {
    _statusTimer = window.setTimeout(() => {
      el.style.transition = "opacity .4s ease";
      el.style.opacity = "0";
    }, durationMs);
  }
}

type Command = {
  id: string;
  label: string;
  group: string;
  shortcut?: string;
  enabled?: () => boolean;
  run: () => void | Promise<void>;
};

function commandList(): Command[] {
  return [
    { id: "file-save", label: "Save", group: "File", shortcut: "⌘S", run: () => void saveProject() },
    { id: "file-save-as", label: "Save As", group: "File", shortcut: "⇧⌘S", run: () => void saveProjectAs() },
    { id: "file-open", label: "Open", group: "File", run: openProject },
    { id: "view-draw", label: "Switch to Draw", group: "View", run: () => setWorkspaceMode("draw") },
    { id: "view-edit", label: "Switch to Edit", group: "View", run: () => setWorkspaceMode("edit") },
    { id: "view-fit", label: "Fit Canvas", group: "View", run: fitViewport },
    { id: "view-actual", label: "Actual Size", group: "View", run: resetViewport },
    { id: "view-onion", label: "Toggle Onion Skin", group: "Draw", run: () => {
      onionEnabled = !onionEnabled;
      const ot = document.getElementById("onion-toggle") as HTMLInputElement | null;
      if (ot) ot.checked = onionEnabled;
    } },
    { id: "panel-add", label: "Add Panel", group: "Edit", run: () => {
      const p = newPanel();
      p.bg = project.panels[activePanelIndex]?.bg ?? "#1a1a2e";
      p.paletteId = currentPalette.id;
      project.panels.push(p);
      activePanelIndex = project.panels.length - 1;
      commitHistory();
      buildTimeline();
      buildLayers();
      buildBreadcrumb();
      buildInspector();
    } },
    { id: "panel-duplicate", label: "Duplicate Forward", group: "Edit", run: () => duplicatePanel(activePanelIndex) },
    { id: "panel-insert-blank-before", label: "Insert Blank Before", group: "Edit",
      enabled: () => project.panels.length > 0,
      run: () => insertBlankPanelAt(activePanelIndex),
    },
    { id: "panel-insert-blank-after", label: "Insert Blank After", group: "Edit",
      enabled: () => project.panels.length > 0,
      run: () => insertBlankPanelAt(activePanelIndex + 1),
    },
    { id: "panel-copy-contents", label: "Copy Panel Contents", group: "Edit",
      enabled: () => project.panels.length > 0,
      run: () => copyActivePanelContents(),
    },
    { id: "panel-paste-contents", label: "Paste Into Current Panel", group: "Edit",
      enabled: () => !!panelContentClipboard && activePanel().kind !== "timelapse",
      run: () => pasteIntoActivePanel(),
    },
    { id: "panel-exposure-minus", label: "Panel Duration -1 Frame", group: "Edit",
      enabled: () => project.panels.length > 0,
      run: () => adjustPanelExposure(activePanelIndex, -1),
    },
    { id: "panel-exposure-plus", label: "Panel Duration +1 Frame", group: "Edit",
      enabled: () => project.panels.length > 0,
      run: () => adjustPanelExposure(activePanelIndex, 1),
    },
    ...[1, 2, 4, 8].map((ticks): Command => ({
      id: `panel-exposure-${ticks}`,
      label: `Panel Duration ${ticks} Frame${ticks === 1 ? "" : "s"}`,
      group: "Edit",
      enabled: () => project.panels.length > 0,
      run: () => setPanelExposure(activePanelIndex, ticks),
    })),
    { id: "layer-duplicate", label: "Duplicate Layer", group: "Layer",
      enabled: () => !!activeLayer(),
      run: () => duplicateActiveLayer(),
    },
    { id: "layer-clear", label: "Clear Layer", group: "Layer",
      enabled: () => !!activeLayer(),
      run: () => clearActiveLayer(),
    },
    { id: "layer-merge-down", label: "Merge Down", group: "Layer",
      enabled: () => canMergeLayerDown(activeContainer().layers, activeContainer().getActiveLayerIndex()),
      run: () => mergeActiveLayerDown(),
    },
    { id: "edit-record", label: "Record Voiceover", group: "Edit", run: () => {
      setWorkspaceMode("edit");
      mediaRecorder?.state === "recording" ? stopRecording() : void startRecording();
    } },
    { id: "edit-import-audio", label: "Import Audio", group: "Edit", run: () => {
      setWorkspaceMode("edit");
      void importAudioFiles();
    } },
    { id: "edit-split", label: "Split Clip", group: "Edit", enabled: () => !!selectedAudioClip(), run: splitSelectedAudioClip },
    { id: "edit-loop", label: "Toggle Loop", group: "Edit", run: () => {
      loopPlayback = !loopPlayback;
      const lt = document.getElementById("loop-toggle") as HTMLButtonElement | null;
      if (lt) {
        lt.textContent = loopPlayback ? "Loop: On" : "Loop: Off";
        lt.classList.toggle("active", loopPlayback);
      }
    } },
    { id: "export-webm-command", label: "Quick WebM", group: "Export", run: () => ($("export-webm") as HTMLButtonElement).click() },
    { id: "export-mp4-command", label: "Final MP4", group: "Export", run: () => ($("export-mp4") as HTMLButtonElement).click() },
    { id: "help-commands", label: "Command Palette", group: "Help", shortcut: "⌘K", run: openCommandPalette },
    { id: "help-about", label: "About WiggleStudio", group: "Help", run: openAboutDialog },
    { id: "marquee-rect", label: "Marquee: Rectangle", group: "Edit", run: () => {
      marqueeToolKind = "rect";
      currentBrush = MARQUEE_KEY;
      buildBrushBar();
    } },
    { id: "marquee-ellipse", label: "Marquee: Ellipse", group: "Edit", run: () => {
      marqueeToolKind = "ellipse";
      currentBrush = MARQUEE_KEY;
      buildBrushBar();
    } },
    { id: "marquee-lasso", label: "Marquee: Lasso", group: "Edit", run: () => {
      marqueeToolKind = "lasso";
      currentBrush = MARQUEE_KEY;
      buildBrushBar();
    } },
    { id: "selection-extract", label: "Extract Selection", group: "Edit",
      enabled: () => selectionState?.mode === "region" && selectionState.phase === "idle",
      run: () => extractSelection(),
    },
    { id: "selection-invert", label: "Invert Selection", group: "Edit",
      enabled: () => selectionState?.mode === "region" && selectionState.phase !== "creating",
      run: () => invertActiveSelection(),
    },
    { id: "selection-grow", label: "Grow Selection", group: "Edit",
      enabled: () => selectionState?.mode === "region" && selectionState.phase === "idle",
      run: () => growActiveSelection(8),
    },
    { id: "selection-shrink", label: "Shrink Selection", group: "Edit",
      enabled: () => selectionState?.mode === "region" && selectionState.phase === "idle",
      run: () => growActiveSelection(-8),
    },
    { id: "selection-cut", label: "Cut Selection", group: "Edit",
      enabled: () => !!selectionState,
      run: () => cutSelection(),
    },
    { id: "selection-duplicate", label: "Duplicate Selection", group: "Edit",
      enabled: () => selectionState?.mode === "object" && isObjectSelectionIdle(selectionState),
      run: () => duplicateSelection(),
    },
    { id: "selection-clear", label: "Clear Selection", group: "Edit",
      enabled: () => !!selectionState,
      run: () => { clearSelection(); buildEditContext(); setStatus("Selection cleared"); },
    },
  ];
}

function openCommandPalette() {
  $("command-overlay").classList.add("open");
  const input = $("command-input") as HTMLInputElement;
  input.value = "";
  buildCommandList("");
  input.focus();
}

function closeCommandPalette() {
  $("command-overlay").classList.remove("open");
}

function buildCommandList(query: string) {
  const host = $("command-list");
  host.innerHTML = "";
  const q = query.trim().toLowerCase();
  const commands = commandList().filter((c) =>
    !q || `${c.group} ${c.label}`.toLowerCase().includes(q)
  );
  for (const cmd of commands) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "command-item";
    btn.disabled = cmd.enabled ? !cmd.enabled() : false;
    const label = document.createElement("span");
    label.textContent = cmd.label;
    const meta = document.createElement("small");
    meta.textContent = cmd.shortcut ? `${cmd.group} · ${cmd.shortcut}` : cmd.group;
    btn.append(label, meta);
    btn.onclick = () => {
      if (btn.disabled) return;
      closeCommandPalette();
      void cmd.run();
    };
    host.appendChild(btn);
  }
  if (!commands.length) {
    const empty = document.createElement("div");
    empty.style.cssText = "padding:12px;color:var(--dim);font-size:12px;";
    empty.textContent = "No commands found.";
    host.appendChild(empty);
  }
}

// ---- file menu / persistence ---------------------------------------------

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

function currentDirty(): boolean {
  return _isDirty;
}

function updateFileChrome() {
  $("file-name").textContent = persistenceState.currentFileName ?? "Untitled";
  $("dirty-dot").classList.toggle("dirty", currentDirty());
}

function resetProjectSession(next: Project, fileStatus: string) {
  applySanitizedGroups(next);
  project = next;
  history.init(project);
  markClean();
  resizeCanvasForProject();
  activePanelIndex = 0;
  rangeAnchorIndex = 0;
  rangeEndIndex = 0;
  lastSequencePosition = null;
  activeSubPanelId = null;
  selectedSubPanelId = null;
  selectedText = null;
  clearSelection();
  activeBrushPresetId = null;
  selectedAudioClipId = null;
  playheadMs = 0;
  playheadStartMs = 0;
  void audioPreview.stop();
  if (mediaRecorder?.state === "recording") mediaRecorder.stop();
  drawing = false;
  clearLiveStrokeState();
  renderContentVersion++;
  // All Layer objects were replaced — drop dead raw-layer entries for memory.
  clearRenderCache(displayRenderCache);
  invalidateBaseFrameCache();
  buildTimeline();
  buildBrushPresetControls();
  updateSmoothingControls();
  buildLayers();
  buildBreadcrumb();
  buildInspector();
  buildProjectSettings();
  refreshEditAudio();
  fitViewport();
  updateExportMenuLabels();
  updateCanvasHint();
  updateFileChrome();
  setStatus(fileStatus);
}

async function saveProject() {
  try {
    const result = await persistSaveProject(project);
    markClean();
    clearRecoverySnapshot();
    updateFileChrome();
    buildFileMenu();
    setStatus(result.mode === "download" ? "project downloaded" : `saved ${result.fileName}`);
  } catch (err) {
    if (!isAbortError(err)) setStatus("save failed: " + (err as Error).message);
  }
}

async function saveProjectAs() {
  try {
    const result = await saveAsProject(project, persistenceState.currentFileName ?? "wigglestudio-project.wiggle.json");
    markClean();
    clearRecoverySnapshot();
    updateFileChrome();
    buildFileMenu();
    setStatus(result.mode === "download" ? "project downloaded" : `saved ${result.fileName}`);
  } catch (err) {
    if (!isAbortError(err)) setStatus("save failed: " + (err as Error).message);
  }
}

async function openProject() {
  if (!canUseFileSystemAccess()) {
    loadProjectFile.click();
    return;
  }
  try {
    const result = await openProjectFromPicker();
    if (!result) return;
    resetProjectSession(result.project, `opened ${result.fileName}`);
    buildFileMenu();
  } catch (err) {
    if (!isAbortError(err)) setStatus("open failed: " + (err as Error).message);
  }
}

function newProject(presetKey?: string) {
  const preset = presetKey ? canvasPresetByKey(presetKey) : defaultCanvasPreset();
  const { width, height } = preset ?? defaultCanvasPreset();
  const next = createProject(width, height);
  resetCurrentFile(next);
  clearRecoverySnapshot();
  resetProjectSession(next, `new project (${formatCanvasDimensions(width, height)})`);
  buildFileMenu();
}

function openPresetPicker() {
  closeFileMenu();
  closeExportMenu();
  const list = $("preset-picker-list");
  list.innerHTML = "";
  for (const preset of CANVAS_PRESETS) {
    const btn = document.createElement("button");
    btn.className = "command-item";
    btn.type = "button";
    const label = document.createElement("span");
    label.textContent = preset.label;
    const meta = document.createElement("small");
    meta.textContent = `${formatCanvasDimensions(preset.width, preset.height)} · ${preset.description}`;
    btn.appendChild(label);
    btn.appendChild(meta);
    btn.onclick = () => {
      closePresetPicker();
      newProject(preset.key);
    };
    list.appendChild(btn);
  }
  $("preset-picker-overlay").classList.add("open");
}

function closePresetPicker() {
  $("preset-picker-overlay").classList.remove("open");
}

async function revertProject() {
  if (!persistenceState.currentFileHandle) {
    setStatus("no file to revert");
    return;
  }
  try {
    const file = await persistenceState.currentFileHandle.getFile();
    const next = migrateProject(JSON.parse(await file.text()));
    persistenceState.lastSavedHash = projectHash(next);
    resetProjectSession(next, `reverted ${persistenceState.currentFileName ?? file.name}`);
  } catch (err) {
    setStatus("revert failed: " + (err as Error).message);
  }
}

function menuButton(label: string, shortcut: string, action: () => void | Promise<void>, disabled = false) {
  const btn = document.createElement("button");
  btn.className = "menu-item";
  btn.disabled = disabled;
  const text = document.createElement("span");
  text.textContent = label;
  const small = document.createElement("small");
  small.textContent = shortcut;
  btn.appendChild(text);
  btn.appendChild(small);
  btn.onclick = () => {
    closeFileMenu();
    void action();
  };
  return btn;
}

function divider() {
  const el = document.createElement("div");
  el.className = "menu-divider";
  return el;
}

function closeFileMenu() {
  $("file-menu").classList.remove("open");
  $("file-menu-button").classList.remove("open");
}

function closeExportMenu() {
  $("export-menu").classList.remove("open");
  $("export-menu-button").classList.remove("open");
}

function closeHelpMenu() {
  $("help-menu").classList.remove("open");
  $("help-menu-button").classList.remove("open");
}

function buildFileMenu() {
  const menu = $("file-menu");
  menu.innerHTML = "";
  menu.appendChild(menuButton("New Project…", "", openPresetPicker));
  menu.appendChild(menuButton("Open…", "⌘O", openProject));
  menu.appendChild(menuButton("Save", "⌘S", saveProject));
  menu.appendChild(menuButton("Save As…", "⇧⌘S", saveProjectAs));
  menu.appendChild(divider());

  const recentLabel = document.createElement("div");
  recentLabel.className = "recent-label";
  recentLabel.textContent = "Recent";
  menu.appendChild(recentLabel);
  const recents = readRecents();
  if (recents.length === 0) {
    menu.appendChild(menuButton("No recent files", "", () => {}, true));
  } else {
    for (const recent of recents) {
      menu.appendChild(menuButton(recent.name, "Open file…", openProject));
    }
  }
  menu.appendChild(divider());
  menu.appendChild(menuButton("Revert", "", revertProject, !persistenceState.currentFileHandle));
}

($("file-menu-button") as HTMLButtonElement).onclick = (e) => {
  e.stopPropagation();
  closeExportMenu();
  closeHelpMenu();
  buildFileMenu();
  $("file-menu").classList.toggle("open");
  $("file-menu-button").classList.toggle("open");
};
($("export-menu-button") as HTMLButtonElement).onclick = (e) => {
  e.stopPropagation();
  closeFileMenu();
  closeHelpMenu();
  $("export-menu").classList.toggle("open");
  $("export-menu-button").classList.toggle("open");
};
document.addEventListener("click", (e) => {
  if (!(e.target as HTMLElement).closest(".menu-wrap")) {
    closeFileMenu();
    closeExportMenu();
    closeHelpMenu();
  }
});

for (const [id, mode] of [
  ["mode-draw", "draw"],
  ["mode-edit", "edit"],
  ["rail-draw", "draw"],
  ["rail-edit", "edit"],
] as const) {
  ($(id) as HTMLButtonElement).onclick = () => setWorkspaceMode(mode);
}

($("command-input") as HTMLInputElement).oninput = (e) => {
  buildCommandList((e.target as HTMLInputElement).value);
};
($("command-input") as HTMLInputElement).onkeydown = (e) => {
  if (e.key === "Escape") {
    e.preventDefault();
    closeCommandPalette();
  }
  if (e.key === "Enter") {
    e.preventDefault();
    const first = $("command-list").querySelector<HTMLButtonElement>(".command-item:not(:disabled)");
    first?.click();
  }
};
$("command-overlay").addEventListener("click", (e) => {
  if (e.target === $("command-overlay")) closeCommandPalette();
});
$("preset-picker-overlay").addEventListener("click", (e) => {
  if (e.target === $("preset-picker-overlay")) closePresetPicker();
});

loadProjectFile.onchange = async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  try {
    const next = await readFallbackFile(file);
    resetProjectSession(next, `opened ${file.name}`);
    buildFileMenu();
  } catch (err) {
    setStatus("load failed: " + (err as Error).message);
  }
  (e.target as HTMLInputElement).value = "";
};

async function autosaveTick() {
  if (!_isDirty) { updateFileChrome(); return; }
  if (_autosaveInFlight) return;
  // If no file handle and nothing changed since the last recovery write, skip
  // the expensive projectHash()/JSON.stringify until the next real edit.
  if (!persistenceState.currentFileHandle && _recoveryClean) { updateFileChrome(); return; }
  // Deferred clean-check: undo/redo only calls markDirty() (O(1)); the hash
  // comparison runs here at most once every 5 seconds instead of every keystroke.
  const currentHash = projectHash(project);
  if (currentHash === persistenceState.lastSavedHash) { markClean(); updateFileChrome(); return; }
  _autosaveInFlight = true;
  try {
    if (persistenceState.currentFileHandle) {
      try {
        await writeHandle(persistenceState.currentFileHandle, project);
        persistenceState.lastSavedHash = currentHash;
        markClean();
        clearRecoverySnapshot();
        setStatus(`auto-saved ${new Date().toLocaleTimeString()}`);
      } catch (err) {
        setStatus("auto-save failed: " + (err as Error).message);
      }
    } else {
      writeRecoverySnapshot(project);
      _recoveryClean = true;
    }
  } finally {
    _autosaveInFlight = false;
  }
  updateFileChrome();
}

function showRecoveryPrompt() {
  const snapshot = readRecoverySnapshot();
  if (!snapshot || persistenceState.currentFileHandle) return;
  const host = $("status");
  const prompt = document.createElement("div");
  prompt.className = "recovery-prompt";
  const time = new Date(snapshot.savedAt).toLocaleString();
  const msg = document.createElement("span");
  msg.textContent = `Unsaved work from ${time}`;
  const recover = document.createElement("button");
  recover.className = "ghost";
  recover.textContent = "Recover";
  recover.onclick = () => {
    try {
      const next = recoverProject(snapshot);
      resetCurrentFile(next);
      resetProjectSession(next, "recovered unsaved work");
      clearRecoverySnapshot();
      updateFileChrome();
    } catch (err) {
      setStatus("recovery failed: " + (err as Error).message);
    }
  };
  const discard = document.createElement("button");
  discard.className = "ghost";
  discard.textContent = "Discard";
  discard.onclick = () => {
    clearRecoverySnapshot();
    setStatus("recovery discarded");
  };
  prompt.appendChild(msg);
  prompt.appendChild(recover);
  prompt.appendChild(discard);
  host.replaceChildren(prompt);
}

setInterval(() => { void autosaveTick(); }, 5000);

// ---- undo / redo ----------------------------------------------------------

window.addEventListener("keydown", (e) => {
  const target = e.target as HTMLElement | null;
  const tag = target?.tagName;
  const inEditable = tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable;

  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    openCommandPalette();
    return;
  }

  if (!inEditable && (e.key === " " || e.key === "Spacebar" || e.code === "Space")) {
    e.preventDefault();
    spacePanDown = true;
    stageArea.classList.add("space-pan");
    return;
  }

  if ((e.metaKey || e.ctrlKey) && !inEditable) {
    const key = e.key.toLowerCase();
    if (key === "s") {
      e.preventDefault();
      void (e.shiftKey ? saveProjectAs() : saveProject());
      return;
    }
    if (key === "o") {
      e.preventDefault();
      void openProject();
      return;
    }
    if (key === "0") {
      e.preventDefault();
      fitViewport();
      return;
    }
    if (key === "=" || key === "+") {
      e.preventDefault();
      zoomStep(1.25);
      return;
    }
    if (key === "-" || key === "_") {
      e.preventDefault();
      zoomStep(0.8);
      return;
    }
    if (key === "c") {
      if (selectionState?.mode === "object") { e.preventDefault(); copySelection(); return; }
    }
    if (key === "v") {
      if (selectionClipboard) { e.preventDefault(); pasteSelection(); return; }
    }
  }

  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
    if (inEditable) return;
    e.preventDefault();
    const isRedo = e.shiftKey;
    const snap = isRedo ? history.redo() : history.undo();
    if (!snap) { setStatus(isRedo ? "Nothing to redo" : "Nothing to undo"); return; }
    project = snap;
    markDirty();
    // Any panel could have changed after undo/redo — mark all thumbnails stale.
    for (const id of thumbCanvases.keys()) dirtyThumbnailPanelIds.add(id);
    renderContentVersion++;
    // Undo/redo rebuilds every Layer object — drop dead raw-layer entries.
    clearRenderCache(displayRenderCache);
    resizeCanvasForProject();
    activePanelIndex = Math.min(activePanelIndex, project.panels.length - 1);
    activeSubPanelId = null;
    selectedSubPanelId = null;
    selectedText = null;
    clearSelection();
    scaleToolDrag = null; // snapshots reference replaced Layer objects
    setStatus(isRedo ? "Redo" : "Undo");
    updateSmoothingControls();
    buildTimeline();
    buildLayers();
    buildBreadcrumb();
    buildInspector();
    buildEditContext();
    return;
  }

  if (e.key === "Enter" && !inEditable && selectionState?.mode === "region" &&
      selectionState.phase === "idle") {
    e.preventDefault();
    extractSelection();
    return;
  }

  // Delete / Backspace removes extracted object selection.
  if ((e.key === "Delete" || e.key === "Backspace") &&
      isObjectSelectionIdle(selectionState) && !inEditable) {
    e.preventDefault();
    deleteSelection();
    return;
  }
  // Escape clears any in-progress or active selection.
  if (e.key === "Escape" && !inEditable) {
    if ($("about-overlay").classList.contains("open")) {
      closeAboutDialog();
      return;
    }
    if ($("export-overlay").classList.contains("open")) {
      if (!$("export-audio-choice").hidden) closeExportOverlay();
      else exportCancelled = true;
      return;
    }
    if ($("preset-picker-overlay").classList.contains("open")) {
      closePresetPicker();
      return;
    }
    if ($("command-overlay").classList.contains("open")) {
      closeCommandPalette();
      return;
    }
    closeFileMenu();
    closeExportMenu();
    if (selectionState) {
      // Commit before clearing so any auto-extracted cut has an undo entry.
      if (selectionState.phase === "moving" && selectionState.mode === "object") commitHistory();
      else if (selectionState.phase === "transforming") { transformSnapshots = null; commitHistory(); }
      clearSelection();
      buildEditContext();
      setStatus("Selection cleared");
    }
    if (keyframeArm) { keyframeArm = null; buildBrushBar(); buildInspector(); setStatus("Keyframe placement cancelled"); }
    if (selectedText) { selectedText = null; buildInspector(); }
    if (selectedSubPanelId) { selectedSubPanelId = null; buildInspector(); }
    return;
  }
});

window.addEventListener("keyup", (e) => {
  if (e.key !== " " && e.key !== "Spacebar" && e.code !== "Space") return;
  spacePanDown = false;
  panDrag = null;
  stageArea.classList.remove("space-pan", "panning");
});

// initial paint
buildBrushBar();
buildPalette();
buildTimeline();
buildLayers();
rebuildPalettePicker();
buildBreadcrumb();
buildInspector();
buildProjectSettings();
buildFontPicker();
$("font-size-val").textContent = String(currentFontSize);
updateBrushSettingsControls();
updateSmoothingControls();
buildBrushPresetControls();
buildFileMenu();
updateExportMenuLabels();
fitViewport();
updateFileChrome();
setWorkspaceMode("draw");
showFirstLaunchStatus();
updateCanvasHint();
showRecoveryPrompt();
void loadPerfProjectFromParam();
// File chrome updates are event-driven via markDirty()/markClean() — the old
// 500ms poll is gone.
