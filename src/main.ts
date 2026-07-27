// ============================================================================
// main.ts — app shell. Wires together drawing input, the three independent
// clocks (display / wiggle / sequence), the panel timeline, layers, tools
// (brush / bucket / text / sub-panel), inspectors, animations, undo/redo,
// save/load, and export.
// ============================================================================

import {
  Project, Stroke, Panel, Layer, Fill, SubPanel, TextElement, Vec2, SelectionShape,
  AnimationSpec, AnimationKind, SubPanelShape, LayerAnimation, FadeSpec,
  EasingKind, LayerLoopKind, LayerAnimTransform, FrameGroup, BrushPreset,
  PerspectiveGuide, PerspectiveGuideKind, LayerBlendMode, BrushSettings, ToneStyle,
  LayerNoiseDisplace, ReferenceImage,
  newProject as createProject, newPanel, newLayer, newSubPanel, newLayerGroup, newPerspectiveGuide, newReferenceImage, migrateProject,
  isBlankQuickStartProject,
} from "./core/types";
import {
  defaultNoiseDisplace,
  layerSupportsNoiseDisplace,
  applyNoiseDisplaceToPanelLayers,
  DEFAULT_NOISE_DISPLACE,
} from "./core/noiseDisplace";
import {
  activeRegionContains, activeRegionShape, applyTransformToSnapshot, boundsFromItems, computeTransformFromHandle,
  ellipseFromDrag, growSelectionShape, hitTestTransformHandle, isObjectSelectionIdle, ItemSnapshot,
  marqueeAntsOffset, MarqueeRef, MarqueeToolKind, moveMarqueeItems, pointInRegionSelection, Rect, rectCenter, rectFromDrag,
  rasterizeShapeMask, restoreFromSnapshot, SelectionState, segmentShapeIntersections, shapeBounds, shapeMeetsMinSize,
  simplifyLassoPath, snapshotItems, splitStrokeAtShape, traceShapePath, translateShape,
  TransformHandleId, transformCursorForHandle, transformHandleVisualHalfSize, transformRotateHandleCenter,
} from "./core/selection";
import {
  clearRenderCache, clearTimelapseCache, createRenderCache, renderCacheStats, renderPanel, renderStroke,
  resetRenderCacheStats, computeTotalLength, trimFramePool, setAsyncRenderInvalidate, stampStrokeToCanvas,
} from "./core/render";
import { renderSequenceFrame } from "./core/sequenceRender";
import {
  advanceDiscreteClock, baseFrameCacheKey, editorPreviewPasses, panelHasPlaybackContinuity, shouldRefreshThumbnail,
  shouldRenderIdleFrame, shouldRenderPlaybackFrame,
} from "./core/renderSchedule";
import { drawTikTokOverlay } from "./core/tiktokOverlay";
import { StudioIcons, type StudioIcon } from "./icons/studio";
import { BRUSHES, brushByKey } from "./brushes/registry";
import { BUILTIN_PALETTES, loadLospecPalette, Palette } from "./core/palette";
import {
  mountColorTriangle,
  type ColorTriangleHandle,
} from "./core/colorTriangle";
import { exportWebM, exportMP4, exportGIF, exportStillImage, downloadBlob } from "./core/export";
import { exportErrorMessage, exportProgressStatus } from "./core/exportProgress";
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
  sequenceStartMsForPanel, sequenceTransitionAtTime, setGroupRepeat,
  syncGroupPanelIds, ungroup,
  type SequencePosition,
} from "./core/sequence";
import { AudioPreview } from "./core/audioPreview";
import { audioBridge } from "./core/electronAudio";
import { menuBridge } from "./core/electronMenu";
import { audioDurationMs, drawWaveform, waveformPeaks } from "./core/waveform";
import {
  FONT_OPTIONS, DEFAULT_FONT, FontOption, fontFamilyCss,
  queryInstalledFontOptions, supportsInstalledFontAccess,
} from "./core/fonts";
import {
  hashId, isInsideSubPanel, pointsToPath, strokeBorder,
  subPanelOutline, applyCustomOutline, cutSubPanelGeometry, setSubPanelBounds,
  translateSubPanel, lineCrossesSubPanel,
} from "./core/subpanel";
import { easeProgress } from "./core/anim";
import { timelineScrollAfterRebuild } from "./core/timelineScroll";
import {
  PEN_STARTUP_FALLBACK_PRESSURE,
  backfillLeadingPressures,
  readPointerPressure,
  simplifyStroke,
} from "./core/input";
import { bumpLayerVersion, layerVersion } from "./core/layerVersion";
import { applyToneGradient } from "./core/tone";
import { canMergeLayerDown, clearLayerContents, duplicateLayer, mergeLayerDown, pasteLayerAbove } from "./core/layerOps";
import {
  countSubPanels,
  containerHasUnlockedLayer,
  ensurePanelStack,
  findSubPanelPath,
  moveStackItem,
  replaceLayersWithGroup,
  sanitizeSubPanelPath,
  stackInsertLayer,
  stackInsertSubPanel,
  stackRemoveLayer,
  stackRemoveSubPanel,
  subPanelAtPath,
  subPanelLabel,
  walkSubPanels,
  type StackContainer,
} from "./core/panelStack";
import {
  deleteMask as deleteMaskState,
  invertMask as invertMaskState,
  layerMaskBadge,
  setMaskEnabled as setMaskEnabledState,
  setMaskOverlayLayer,
} from "./core/maskControls";
import {
  overscanPx, screenToCanvas,
} from "./core/viewport";
import {
  Camera, WorldRect, boundingRect, chromeOpacity, DEFAULT_CHROME_FADE,
  fitCamera, migrateLegacyPosition, organizeGrid, screenToWorld, zoomAbout,
} from "./core/boardCamera";
import {
  canUseFileSystemAccess, clearRecoverySnapshot, openProjectFromPicker,
  persistenceState, projectHashFromString, readFallbackFile,
  readRecoverySnapshot, recoverProject, resetCurrentFile, saveAsProject,
  saveProject as persistSaveProject, serializeProject, writeHandleString,
  writeRecoverySnapshotString,
} from "./core/persistence";
import { AutosaveSerializationCache } from "./core/autosave";
import {
  ProjectBoardMeta, ProjectLibraryRecord,
  defaultProjectBoardMeta, deleteProjectLibraryRecord, getProjectLibraryRecord,
  listProjectLibraryRecords, projectLibraryAvailable,
  putProjectLibraryRecord, readProjectBoardMeta, writeProjectBoardMeta,
} from "./core/projectLibrary";
import {
  CANVAS_PRESETS, canvasPresetByKey, defaultCanvasPreset, formatCanvasDimensions,
} from "./core/canvasPresets";
import * as history from "./core/history";
import {
  commitRasterPreparation, getRasterCanvas, installRasterCanvas, markRasterEdited,
  nextRasterStrokeIndex, onRasterReady, prepareRasterCanvases, pruneRasterStore,
  rasterPixelVersion, syncRasterToLayer,
} from "./core/rasterStore";
import {
  cloneRasterCanvas, createRasterSelectionFromPixels, extractRasterSelection,
  flattenRasterSelection, rasterContentBounds, RasterStrokeSession,
  renderRasterSelection,
} from "./core/rasterEditing";
import {
  containRasterImage, isSupportedRasterImageFile, rasterLayerName, referenceImageName,
} from "./core/rasterImport";
import { drawBrushPreview } from "./brushes/preview";
import { eraserPreviewRadius, isErasePreviewBrush } from "./core/eraserPreview";
import { floodFillImageData, hexToRgb } from "./core/fill";
import {
  BRUSH_TOOLS, BrushToolKey, brushesForTool, brushToolForKey, defaultBrushForTool,
  isBrushKeyAvailable, resolveBrushForLayer,
} from "./brushes/groups";
import { DEFAULT_BRUSH_SETTINGS, normalizeBrushSettings, effectiveBrushSettings } from "./core/brushSettings";
import {
  appendStrokeSmoothingSample, createStrokeSmoothingSession,
  finishStrokeSmoothingSession, normalizeStrokeSmoothingSettings,
  type StrokeSmoothingSample, type StrokeSmoothingSession,
} from "./core/strokeSmoothing";
import {
  applyBrushPreset, brushPresetFromState, deleteBrushPreset, upsertBrushPreset,
} from "./core/brushPresets";
import {
  adjustPanelExposureTicks,
  durationMsToAbsoluteTicks,
  durationMsToExposureTicks,
  durationMsToSeconds,
  formatHoldDuration,
  formatSecondsValue,
  formatTimelineTime,
  setPanelDurationSeconds,
  setPanelExposureTicks,
  type TimelineTimeUnit,
} from "./core/frameTiming";
import {
  clonePanelForDuplicate, copyPanelContents, createBlankPanelFrom, pastePanelContents,
  regenerateSubPanelIds,
  type PanelContentsClipboard,
} from "./core/panelOps";
import {
  MAX_PANEL_ANNOTATION_CHARS,
  MAX_LAYERS_PER_PANEL,
  MAX_REFERENCE_DIMENSION,
  MAX_REFERENCE_IMAGES,
  MAX_SUBPANEL_DEPTH,
  MAX_SUBPANELS_PER_PANEL,
} from "./core/projectValidation";
import { APP_NAME, APP_VERSION } from "./core/appMeta";

if (location.protocol === "file:") document.body.classList.add("file-mode");

const BUCKET_KEY = "__bucket__";
const GRADIENT_KEY = "__gradient__";
const TEXT_KEY = "__text__";
const SUBPANEL_KEY = "__subpanel__";
const BALLOON_KEY = "__balloon__";
const CUT_SUBPANEL_KEY = "__cut_subpanel__";
const SELECT_KEY = "__select__";
const MARQUEE_KEY = "__marquee__";
const MOVE_LAYER_KEY = "__move_layer__";
const PERSPECTIVE_KEY = "__perspective__";
const SCALE_KEY = "__scale__";
const TOOL_KEYS = new Set([
  BUCKET_KEY, GRADIENT_KEY, TEXT_KEY, SUBPANEL_KEY, BALLOON_KEY, CUT_SUBPANEL_KEY,
  SELECT_KEY, MARQUEE_KEY, MOVE_LAYER_KEY, PERSPECTIVE_KEY, SCALE_KEY,
]);

/** MRU quick-access strip in the draw inspector (brushes + pseudo-tools). */
const RECENT_TOOLS_MAX = 5;
const RECENT_TOOLS_KEY = "wigostudio.recentTools";
const DEFAULT_RECENT_TOOLS = ["pencil", "ink", "eraser"];

type TextRef = { layer: Layer; text: TextElement };

let project: Project = createProject();
const autosaveSerialization = new AutosaveSerializationCache<Project>(serializeProject);
autosaveSerialization.reset(project);
let activePanelIndex = 0;
let rangeAnchorIndex: number | null = null;
let rangeEndIndex: number | null = null;
let lastSequencePosition: SequencePosition | null = null;
let activeSubPanelPath: string[] = [];           // [] = panel root; path of nested frame ids
let selectedSubPanelId: string | null = null;     // for inspector
let selectedText: TextRef | null = null;
const selectedLayerIds = new Set<string>();
let selectedLayerAnchorId: string | null = null;
let selectedLayerContainerKey = "";
const collapsedLayerGroupIds = new Set<string>();
/** Selected board reference image (editor-only overlay; never exported). */
let selectedReferenceImageId: string | null = null;
let selectionState: SelectionState | null = null;
let marqueeToolKind: MarqueeToolKind = "rect";
let transformSnapshots: ItemSnapshot[] | null = null;
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
/** Virtual transparent palette swatch. The last real color stays selected
 *  underneath so color inputs remain valid and switching back is instant. */
let transparentPaintSelected = false;
let currentSize = 2;
let currentBrushSettings: BrushSettings = { ...DEFAULT_BRUSH_SETTINGS };
let activeBrushPresetId: string | null = null;
let closeBrushPicker: (() => void) | null = null;
let closeFontPicker: (() => void) | null = null;

function isKnownRecentToolKey(key: string): boolean {
  return TOOL_KEYS.has(key) || BRUSHES.some((b) => b.key === key);
}

function readRecentToolKeys(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_TOOLS_KEY) ?? "null");
    if (!Array.isArray(raw)) return [...DEFAULT_RECENT_TOOLS];
    const keys = raw
      .filter((k): k is string => typeof k === "string" && isKnownRecentToolKey(k));
    const unique = [...new Set(keys)].slice(0, RECENT_TOOLS_MAX);
    return unique.length ? unique : [...DEFAULT_RECENT_TOOLS];
  } catch {
    return [...DEFAULT_RECENT_TOOLS];
  }
}

function writeRecentToolKeys(keys: string[]) {
  try {
    localStorage.setItem(RECENT_TOOLS_KEY, JSON.stringify(keys.slice(0, RECENT_TOOLS_MAX)));
  } catch {
    /* private mode / quota — session-only is fine */
  }
}

/** Most-recent-first list of brush/tool keys for the quick-access strip. */
let recentToolKeys = readRecentToolKeys();

function rememberRecentTool(key: string) {
  if (!isKnownRecentToolKey(key)) return;
  recentToolKeys = [key, ...recentToolKeys.filter((k) => k !== key)].slice(0, RECENT_TOOLS_MAX);
  writeRecentToolKeys(recentToolKeys);
}

/** Float a picker menu above scrollable panels (portaled to body + fixed). */
function clearFloatingMenuPosition(menu: HTMLElement) {
  menu.classList.remove("is-floating");
  menu.style.left = "";
  menu.style.top = "";
  menu.style.width = "";
  menu.style.right = "";
  menu.style.maxHeight = "";
}

function positionFloatingMenu(menu: HTMLElement, anchor: HTMLElement) {
  const margin = 8;
  const rect = anchor.getBoundingClientRect();
  menu.classList.add("is-floating");
  menu.style.width = `${Math.max(160, rect.width)}px`;
  menu.style.left = `${Math.max(margin, Math.min(rect.left, window.innerWidth - rect.width - margin))}px`;
  menu.style.top = `${rect.bottom + 4}px`;
  menu.style.right = "auto";
  menu.style.maxHeight = "300px";

  const next = menu.getBoundingClientRect();
  let top = rect.bottom + 4;
  if (next.bottom > window.innerHeight - margin) {
    top = Math.max(margin, rect.top - next.height - 4);
    menu.style.top = `${top}px`;
  }
  const maxBottom = window.innerHeight - margin;
  const shown = menu.getBoundingClientRect();
  if (shown.bottom > maxBottom) {
    menu.style.maxHeight = `${Math.max(120, maxBottom - shown.top)}px`;
  }
  if (shown.right > window.innerWidth - margin) {
    menu.style.left = `${Math.max(margin, window.innerWidth - shown.width - margin)}px`;
  }
}

function mountFloatingMenu(menu: HTMLElement, anchor: HTMLElement, home: HTMLElement) {
  if (menu.parentElement !== document.body) document.body.appendChild(menu);
  positionFloatingMenu(menu, anchor);
  const onReposition = () => {
    if (menu.hidden) return;
    positionFloatingMenu(menu, anchor);
  };
  const onScrollOrResize = () => onReposition();
  window.addEventListener("resize", onScrollOrResize);
  document.addEventListener("scroll", onScrollOrResize, true);
  return () => {
    window.removeEventListener("resize", onScrollOrResize);
    document.removeEventListener("scroll", onScrollOrResize, true);
    clearFloatingMenuPosition(menu);
    if (menu.parentElement === document.body) home.appendChild(menu);
  };
}
const lastBrushByTool: Partial<Record<BrushToolKey, string>> = {};
/** Raster-only brush parked while the user is on a non-raster layer, restored
 *  when they return to a raster layer (if still available). */
let deferredRasterBrush: string | null = null;
/** Whether the Tone tool chip is engaged, and which layer to restore when
 *  the user switches to any other tool/brush. The Tone tool is a layer
 *  shortcut, not a brush — currentBrush is left untouched while it's active. */
let toneToolActive = false;
let toneToolPrevLayerIndex: number | null = null;
let currentPalette: Palette = BUILTIN_PALETTES[0];
let currentFont = DEFAULT_FONT.family;
let availableFontOptions: FontOption[] = [...FONT_OPTIONS];
let installedFontsLoaded = false;
let installedFontsUnavailable = false;
let installedFontsLoading: Promise<number> | null = null;
let currentFontSize = 64;
let currentTextWiggle = 1.5;
let currentFillTolerance = 0;
let currentFillGapClosePx = 0;
let currentFillReferenceMode: Fill["referenceMode"] = "activeLayer";
let currentGradientKind: "linear" | "radial" = "linear";
let currentGradientEndColor = "#ffffff";
let pressureEnabled = true;
let jitterEnabled = true;
let layerClipboard: Layer | null = null;
let animationClipboard: LayerAnimation | null = null;
type SelectionClipboard =
  | { kind: "vector"; strokes: Stroke[]; fills: Fill[]; texts: TextElement[] }
  | { kind: "raster"; pixels: HTMLCanvasElement; x: number; y: number };
let selectionClipboard: SelectionClipboard | null = null;
let lastEditClipboardKind: "selection" | "layer" | "reference" | null = null;
type ReferenceClipboard = { name: string; data: string; width: number; height: number };
let referenceClipboard: ReferenceClipboard | null = null;
let maskOverlayLayerId: string | null = null;

// Dirty flag: set by commitHistory(), cleared on save. Replaces the expensive
// projectHash() call that was running every 500ms via updateFileChrome().
let _isDirty = false;
let _autosaveInFlight = false;
const dirtyThumbnailPanelIds = new Set<string>();

function markDirty() {
  autosaveSerialization.markChanged();
  _isDirty = true;
  updateFileChrome();
  requestLoopFrame();
}
function markClean() { _isDirty = false; updateFileChrome(); }
let keyframeArm: "from" | "to" | null = null;
let animHintShown = false;

const CANVAS_HINT_KEY = "wigostudio-canvas-hint-dismissed";
const CMDK_HINT_KEY = "wigostudio-cmdk-hint-shown";
const LEGACY_CANVAS_HINT_KEY = "wigglestudio-canvas-hint-dismissed";
const LEGACY_CMDK_HINT_KEY = "wigglestudio-cmdk-hint-shown";
let exportCancelled = false;

/**
 * Read pen pressure from a PointerEvent. Mouse input stays full-size, while pen
 * input keeps real positive pressure and only patches missing/zero startup
 * contact samples.
 *
 * After mouse-wheel / keyboard interrupts, Chromium often demotes the stylus to
 * mouse events (flat 0.5 pressure) or keeps reporting pressure=0. Reusing the
 * last real pen pressure as a synthetic filler keeps the stroke feeling live
 * until the driver catches up; leading samples are rewritten once a real
 * reading arrives.
 */
function notePenPointerActivity(e: PointerEvent) {
  if (e.pointerType === "pen") lastPenActivityMs = performance.now();
}

function markStylusPressureInterrupt() {
  if (performance.now() - lastPenActivityMs < STYLUS_RECOVERY_ARM_MS) {
    stylusPressureRecoveryUntil = performance.now() + STYLUS_RECOVERY_HOLD_MS;
  }
}

function stylusPressureRecoveryActive(): boolean {
  return performance.now() < stylusPressureRecoveryUntil;
}

function clearStylusPressureRecovery() {
  stylusPressureRecoveryUntil = 0;
}

function pressureForNewStroke(e: PointerEvent): number {
  notePenPointerActivity(e);
  const sample = readPointerPressure(e, pressureEnabled, {
    recovery: stylusPressureRecoveryActive(),
    fallbackPressure: lastRealPenPressure,
  });
  if (sample.real) {
    if (e.pointerType === "pen") {
      lastRealPenPressure = sample.pressure;
      clearStylusPressureRecovery();
    }
    liveStrokeHasRealPressure = true;
    liveStrokeSyntheticPressureCount = 0;
    return sample.pressure;
  }
  liveStrokeHasRealPressure = false;
  liveStrokeSyntheticPressureCount = 1;
  return sample.pressure;
}

function pressureForLiveStroke(e: PointerEvent): number {
  notePenPointerActivity(e);
  const sample = readPointerPressure(e, pressureEnabled, {
    recovery: stylusPressureRecoveryActive(),
    fallbackPressure: lastRealPenPressure,
  });
  if (sample.real) {
    if (!liveStrokeHasRealPressure && liveStroke?.pressures) {
      backfillLeadingPressures(
        liveStroke.pressures,
        liveStrokeSyntheticPressureCount,
        sample.pressure
      );
    }
    if (e.pointerType === "pen") {
      lastRealPenPressure = sample.pressure;
      clearStylusPressureRecovery();
    }
    liveStrokeHasRealPressure = true;
    liveStrokeSyntheticPressureCount = 0;
    return sample.pressure;
  }
  if (!liveStrokeHasRealPressure) liveStrokeSyntheticPressureCount++;
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

/** Last non-off smoothing mode — restored when the Smoothing toggle turns back on. */
let lastActiveSmoothingMode: "weighted" | "stabilizer" = "weighted";

function updateSmoothingControls() {
  project.drawingSettings.smoothing = normalizeStrokeSmoothingSettings(project.drawingSettings.smoothing);
  const smoothing = project.drawingSettings.smoothing;
  if (smoothing.mode === "weighted" || smoothing.mode === "stabilizer") {
    lastActiveSmoothingMode = smoothing.mode;
  }
  const enabled = smoothing.mode !== "off";
  const enableToggle = $("stroke-smoothing-enabled") as HTMLInputElement;
  const options = $("stroke-smoothing-options");
  const mode = $("stroke-smoothing-mode") as HTMLSelectElement;
  const distance = $("stroke-smoothing-distance") as HTMLInputElement;
  const distanceVal = $("stroke-smoothing-distance-val");
  const delay = $("stroke-smoothing-delay") as HTMLInputElement;
  const delayVal = $("stroke-smoothing-delay-val");
  const finish = $("stroke-smoothing-finish") as HTMLInputElement;
  const pressure = $("stroke-smoothing-pressure") as HTMLInputElement;
  const delayRow = $("stroke-smoothing-delay-row") as HTMLElement;
  const toggleLabel = enableToggle.closest(".brush-subtoggle");

  enableToggle.checked = enabled;
  toggleLabel?.classList.toggle("is-on", enabled);
  options.hidden = !enabled;
  mode.value = enabled ? smoothing.mode : lastActiveSmoothingMode;
  distance.value = String(smoothing.distance);
  distanceVal.textContent = `${Math.round(smoothing.distance)}px`;
  delay.value = String(smoothing.delayDistance);
  delayVal.textContent = `${Math.round(smoothing.delayDistance)}px`;
  finish.checked = smoothing.finishStabilizedStroke;
  pressure.checked = smoothing.smoothPressure;
  const stabilizer = smoothing.mode === "stabilizer";
  delayRow.hidden = !enabled || !stabilizer;
  delay.hidden = !enabled || !stabilizer;
  delay.disabled = !enabled || !stabilizer;
  finish.disabled = !enabled || !stabilizer;
}

/** Mutates + marks dirty, but does NOT commit history — callers on a
 *  continuously-firing input (a slider's `oninput`) must commit separately
 *  on release (`onchange`), or every drag tick floods the undo stack. */
function setStrokeSmoothingSettings(update: Partial<Project["drawingSettings"]["smoothing"]>) {
  project.drawingSettings.smoothing = normalizeStrokeSmoothingSettings({
    ...project.drawingSettings.smoothing,
    ...update,
  });
  markDirty();
  updateSmoothingControls();
}

function formatBrushSize(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function updateBrushSizeControl() {
  const size = $("size") as HTMLInputElement | null;
  if (size) size.value = String(currentSize);
  const sizeVal = document.getElementById("size-val");
  if (sizeVal) sizeVal.textContent = formatBrushSize(currentSize);
}

function activeBrushPreset(): BrushPreset | null {
  return project.brushPresets.find((p) => p.id === activeBrushPresetId) ?? null;
}

function applyBrushPresetById(id: string) {
  const preset = project.brushPresets.find((p) => p.id === id);
  if (!preset) return;
  const applied = applyBrushPreset(preset);
  const resolved = resolveBrushForLayer(applied.brush, activeLayer()?.kind ?? null);
  currentBrush = resolved.brush.key;
  currentSize = applied.size;
  currentBrushSettings = { ...applied.settings };
  activeBrushPresetId = preset.id;
  rememberRecentTool(currentBrush);
  updateBrushSizeControl();
  updateBrushSettingsControls();
  buildBrushBar();
  buildBrushPresetControls();
  if (resolved.changed && resolved.reason) setStatus(resolved.reason);
  else setStatus(`preset ${preset.name}`);
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
let tiktokOverlayEnabled = false;
let editorPreviewInvalidated = false;
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
const PANEL_SHAPES: SubPanelShape[] = ["rect", "rounded"];
const BALLOON_SHAPES: SubPanelShape[] = ["balloon", "thought", "burst"];
/** Default shape for newly drag-created manga panel frames (Sub-Panel tool). */
let pendingSubPanelShape: SubPanelShape = "rect";
/** Default shape for newly drag-created speech balloons (Balloon tool). */
let pendingBalloonShape: SubPanelShape = "balloon";

function isBalloonShape(shape: SubPanelShape): boolean {
  return shape === "balloon" || shape === "thought" || shape === "burst";
}
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

function mountAppMetadata() {
  document.title = APP_NAME;
  $("about-title").textContent = APP_NAME;
  $("about-version").textContent = `Local-first · Version ${APP_VERSION} · GPL-3.0-only`;
  const aboutMenuLabel = $("help-about").querySelector("span");
  if (aboutMenuLabel) aboutMenuLabel.textContent = `About ${APP_NAME}`;
}

mountAppMetadata();
const canvas = $("stage") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const stageArea = $("stage-area") as HTMLElement;
const loadProjectFile = $("load-project-file") as HTMLInputElement;
// The board world lives inside the stage area: the live canvas and every
// preview card share this one camera-transformed container. The stage area
// itself is the board "surface" (the screen-space viewport into the world).
const boardWorld = $("board-world") as HTMLElement;
const activeProjectFrame = $("active-project-frame") as HTMLElement;

let overscanX = 0;
let overscanY = 0;
let renderContentVersion = 0;
let baseFrameCache: { key: string; canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null = null;
const displayRenderCache = createRenderCache(64);
const perfEnabled = new URLSearchParams(location.search).has("perf");
const perfProjectUrl = new URLSearchParams(location.search).get("project");
const historyCheckEnabled = new URLSearchParams(location.search).has("historycheck");
let projectBoardRecords: ProjectLibraryRecord[] = [];
let projectBoardMeta: ProjectBoardMeta = defaultProjectBoardMeta();
let activeLibraryProjectId: string | null = null;
let projectLibraryReady = false;
// Whether preview cards for the *other* projects are shown on the board. The
// active project is always live (the drawing canvas); this toggle only hides
// the neighbours for a focused, solo-project look.
let boardCardsVisible = true;
let boardMoveToolActive = false;
const projectFileHandles = new Map<string, FileSystemFileHandle>();
let projectBoardMetaSaveTimer: ReturnType<typeof setTimeout> | null = null;

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
  $("export-panel-png-dims").textContent = `${dims} · .png`;
  $("export-panel-png-transparent-dims").textContent = `${dims} · .png`;
  $("export-panel-jpeg-dims").textContent = `${dims} · .jpg`;
  $("export-panel-gif-dims").textContent = `${dims} · .gif`;
  $("export-gif-dims").textContent = `${dims} · .gif`;
  $("export-webm-dims").textContent = `${dims} · .webm`;
  $("export-mp4-dims").textContent = `${dims} · .mp4`;
  $("export-panel-mp4-dims").textContent = `${dims} · .mp4`;
}

function resizeCanvasForProject() {
  const { x: ox, y: oy } = overscanPx(project.width, project.height);
  const nextWidth = project.width + 2 * ox;
  const nextHeight = project.height + 2 * oy;
  const dimensionsChanged = canvas.width !== nextWidth || canvas.height !== nextHeight;
  overscanX = ox;
  overscanY = oy;
  if (dimensionsChanged) {
    canvas.width = nextWidth;
    canvas.height = nextHeight;
  }
  syncCanvasAspect();
  if (dimensionsChanged) {
    invalidateBaseFrameCache();
    // Defer: resizeCanvasForProject() runs at module load before timelineTab exists.
    queueMicrotask(() => syncTimelineDock());
  }
  positionActiveCanvas();
  return dimensionsChanged;
}

resizeCanvasForProject();

function svgIcon(icon: StudioIcon, size = 15): SVGSVGElement {
  const svg = icon({ size, color: "currentColor", weight: "Outline" });
  svg.setAttribute("aria-hidden", "true");
  svg.style.display = "block";
  svg.style.flex = "0 0 auto";
  return svg;
}

function iconButton(
  icon: StudioIcon,
  title: string,
  onClick: (e: MouseEvent) => void,
  className = "cellbtn iconbtn"
): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = className;
  btn.title = title;
  btn.setAttribute("aria-label", title);
  btn.appendChild(svgIcon(icon));
  btn.onclick = onClick;
  return btn;
}

history.init(project, { activePanelIndex });
pruneRasterStoreForProject(project);
onRasterReady(() => {
  renderContentVersion++;
  invalidateBaseFrameCache();
  dirtyThumbnailPanelIds.add(activePanel().id);
  requestLoopFrame();
});
resetCurrentFile(project);

// `viewport` is the shared board camera, in world (project-pixel) coordinates.
// It is applied to #board-world, so the same pan/zoom drives both the live
// canvas and every preview card. It is persisted as projectBoardMeta.camera.
let viewport: Camera = { scale: 1, tx: 0, ty: 0 };
let spacePanDown = false;
let panDrag: { pointerId: number; x: number; y: number; tx: number; ty: number } | null = null;

/** The board surface's screen rect (the window into world space). */
function surfaceRect(): DOMRect {
  return stageArea.getBoundingClientRect();
}

/** The active project's frame rectangle in world coordinates. */
function activeWorldRect(): WorldRect {
  const record = activeLibraryProjectId
    ? projectBoardRecords.find((r) => r.id === activeLibraryProjectId)
    : null;
  return {
    x: record?.x ?? 0,
    y: record?.y ?? 0,
    width: project.width,
    height: project.height,
  };
}

/** Places the live drawing canvas at the active project's world slot. The
 *  canvas element extends past the frame by the overscan margin on every side,
 *  so its top-left sits at (frame - overscan). */
function positionActiveCanvas() {
  const rect = activeWorldRect();
  activeProjectFrame.style.left = `${rect.x}px`;
  activeProjectFrame.style.top = `${rect.y}px`;
  activeProjectFrame.style.width = `${rect.width}px`;
  activeProjectFrame.style.height = `${rect.height}px`;
  canvas.style.left = `${-overscanX}px`;
  canvas.style.top = `${-overscanY}px`;
  canvas.style.width = `${canvas.width}px`;
  canvas.style.height = `${canvas.height}px`;
}

function applyViewport() {
  boardWorld.style.transform =
    `translate(${viewport.tx}px, ${viewport.ty}px) scale(${viewport.scale})`;
  const inverseScale = 1 / Math.max(viewport.scale, 0.001);
  boardWorld.style.setProperty("--board-pickup-lift", `${Math.min(120, 14 * inverseScale)}px`);
  boardWorld.style.setProperty("--board-shadow-drop", `${Math.min(150, 18 * inverseScale)}px`);
  boardWorld.style.setProperty("--board-shadow-blur", `${Math.min(180, 22 * inverseScale)}px`);
  boardWorld.style.setProperty("--board-inv-scale", String(inverseScale));
  $("zoom-label").textContent = `${Math.round(viewport.scale * 100)}%`;
  updateChromeFade();
  projectBoardMeta.camera = { ...viewport };
  saveProjectBoardMetaSoon();
  requestLoopFrame();
}

/** Fit the active project's frame into the board surface (with margin). */
function fitViewport() {
  const rect = surfaceRect();
  if (rect.width <= 0 || rect.height <= 0) return;
  viewport = fitCamera({ width: rect.width, height: rect.height }, activeWorldRect(), 40);
  applyViewport();
}

/** Frame the active project at exactly 1:1 (100%), centred in the surface. */
function resetViewport() {
  const rect = surfaceRect();
  if (rect.width <= 0 || rect.height <= 0) return;
  const frame = activeWorldRect();
  viewport = {
    scale: 1,
    tx: (rect.width - frame.width) / 2 - frame.x,
    ty: (rect.height - frame.height) / 2 - frame.y,
  };
  applyViewport();
}

/** Fit every project (active canvas + preview cards) into the board surface.
 *  With more than one project we pull back a little further so the view clearly
 *  reads as the board (chrome faded) rather than a near-focused single frame. */
function fitAllProjects() {
  const rect = surfaceRect();
  if (rect.width <= 0 || rect.height <= 0) return;
  const rects = boardWorldRects();
  const bounds = boundingRect(rects) ?? activeWorldRect();
  const surface = { width: rect.width, height: rect.height };
  viewport = fitCamera(surface, bounds, 72);
  if (projectBoardRecords.length > 1) {
    viewport = zoomAbout(viewport, viewport.scale * 0.78, surface.width / 2, surface.height / 2);
  }
  applyViewport();
}

// Keep the board camera stable across window resizes — just re-apply it (and
// recompute the chrome fade for the new surface size). Snapping back to "fit"
// on every resize would fight the user's board position.
window.addEventListener("resize", () => applyViewport());
// rAF is naturally paused while the tab is hidden; force one frame on return
// so the canvas isn't stuck showing whatever was last painted before hiding.
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) requestLoopFrame();
});

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

function activeStackContainer(): StackContainer {
  const p = activePanel();
  if (activeSubPanelPath.length === 0) return p;
  const sp = subPanelAtPath(p, activeSubPanelPath);
  return sp ?? p;
}

/** Geometric sub-panels participate in canvas hit-testing. Layer groups are
 *  stack-only containers and are opened from the Layers panel instead. */
function frameSubPanels(container: StackContainer): SubPanel[] {
  return (container.subPanels ?? []).filter((sp) => !sp.group);
}

function findSubPanelById(panel: Panel, id: string): SubPanel | null {
  let found: SubPanel | null = null;
  walkSubPanels(panel, (sp) => {
    if (!found && sp.id === id) found = sp;
  });
  return found;
}

function parentContainerOf(panel: Panel, subPanelId: string): StackContainer | null {
  const path = findSubPanelPath(panel, subPanelId);
  if (!path || path.length === 0) return null;
  if (path.length === 1) return panel;
  return subPanelAtPath(panel, path.slice(0, -1));
}

function removeSubPanelById(panel: Panel, subPanelId: string): boolean {
  const parent = parentContainerOf(panel, subPanelId);
  if (!parent) return false;
  stackRemoveSubPanel(parent, subPanelId);
  parent.subPanels = (parent.subPanels ?? []).filter((s) => s.id !== subPanelId);
  return true;
}

function groupSelectedLayers(): void {
  const cont = activeContainer();
  const active = cont.layers[cont.getActiveLayerIndex()];
  const containerKey = activeSubPanelPath.join("/");
  const selected = cont.layers.filter((layer) =>
    selectedLayerContainerKey === containerKey && selectedLayerIds.has(layer.id)
  );
  const layers = selected.length ? selected : active ? [active] : [];
  if (!layers.length) return;
  if (countSubPanels(activePanel()) >= MAX_SUBPANELS_PER_PANEL) {
    setStatus(`Layer group limit reached (${MAX_SUBPANELS_PER_PANEL} nested containers)`);
    return;
  }
  if (activeSubPanelPath.length >= MAX_SUBPANEL_DEPTH) {
    setStatus(`Layer group nesting depth limit reached (${MAX_SUBPANEL_DEPTH})`);
    return;
  }
  const container = cont.container;
  const groupCount = (container.subPanels ?? []).filter((sp) => sp.group).length;
  const group = newLayerGroup(`Group ${groupCount + 1}`, project.width, project.height, layers);
  if (!replaceLayersWithGroup(container, group)) return;
  selectedLayerIds.clear();
  selectedLayerAnchorId = null;
  selectedLayerContainerKey = "";
  collapsedLayerGroupIds.delete(group.id);
  selectedSubPanelId = group.id;
  selectedText = null;
  commitHistory();
  buildLayers();
  buildInspector();
}

function moveLayerIntoGroup(container: StackContainer, layerId: string, group: SubPanel): boolean {
  if (!group.group) return false;
  if (group.layers.length >= MAX_LAYERS_PER_PANEL) {
    setStatus(`Layer limit reached (${MAX_LAYERS_PER_PANEL})`);
    return false;
  }
  const layerIndex = container.layers.findIndex((layer) => layer.id === layerId);
  if (layerIndex < 0) return false;
  const [layer] = container.layers.splice(layerIndex, 1);
  stackRemoveLayer(container, layer.id);
  group.layers.push(layer);
  stackInsertLayer(group, layer.id);
  group.activeLayerIndex = group.layers.length - 1;
  container.activeLayerIndex = Math.max(0, Math.min(
    container.activeLayerIndex ?? 0,
    container.layers.length - 1,
  ));
  return true;
}

function ungroupLayerGroup(group: SubPanel): boolean {
  if (!group.group) return false;
  const parent = parentContainerOf(activePanel(), group.id);
  if (!parent) return false;
  const parentStack = ensurePanelStack(parent);
  const groupIndex = parentStack.findIndex((item) => item.kind === "subpanel" && item.id === group.id);
  if (groupIndex < 0) return false;
  if (parent.layers.length + group.layers.length > MAX_LAYERS_PER_PANEL) {
    setStatus(`Cannot ungroup: parent would exceed ${MAX_LAYERS_PER_PANEL} layers`);
    return false;
  }

  const groupStack = ensurePanelStack(group);
  parent.layers.push(...group.layers);
  (parent.subPanels ??= []).push(...(group.subPanels ?? []));
  parent.subPanels = parent.subPanels.filter((sp) => sp.id !== group.id);
  parentStack.splice(groupIndex, 1, ...groupStack);
  parent.stack = parentStack;
  const firstLayer = groupStack.find((item) => item.kind === "layer");
  if (firstLayer) {
    const index = parent.layers.findIndex((layer) => layer.id === firstLayer.id);
    if (index >= 0) parent.activeLayerIndex = index;
  }
  selectedSubPanelId = null;
  return true;
}

function exitToSubPanelPath(path: string[]) {
  activeSubPanelPath = path;
  selectedSubPanelId = null;
  selectedText = null;
  clearSelection();
}

function enterChildSubPanel(id: string) {
  activeSubPanelPath = [...activeSubPanelPath, id];
  selectedSubPanelId = id;
}

function popActiveSubPanel() {
  if (activeSubPanelPath.length === 0) return;
  activeSubPanelPath = activeSubPanelPath.slice(0, -1);
  selectedSubPanelId = null;
}

function activeContainer(): {
  layers: Layer[];
  getActiveLayerIndex(): number;
  setActiveLayerIndex(i: number): void;
  isSubPanel: boolean;
  subPanel?: SubPanel;
  container: StackContainer;
} {
  const p = activePanel();
  if (activeSubPanelPath.length > 0) {
    const sp = subPanelAtPath(p, activeSubPanelPath);
    if (sp) {
      return {
        layers: sp.layers,
        getActiveLayerIndex: () => sp.activeLayerIndex ?? 0,
        setActiveLayerIndex: (i) => { sp.activeLayerIndex = i; },
        isSubPanel: true,
        subPanel: sp,
        container: sp,
      };
    }
    activeSubPanelPath = sanitizeSubPanelPath(p, activeSubPanelPath);
  }
  return {
    layers: p.layers,
    getActiveLayerIndex: () => p.activeLayerIndex ?? 0,
    setActiveLayerIndex: (i) => { p.activeLayerIndex = i; },
    isSubPanel: false,
    container: p,
  };
}

/** Keep the active container's stack aligned after layer insert/remove. */
function noteRootLayerInserted(layerId: string, afterLayerId?: string | null) {
  stackInsertLayer(activeStackContainer(), layerId, afterLayerId);
}

function noteRootLayerRemoved(layerId: string) {
  stackRemoveLayer(activeStackContainer(), layerId);
}

function activeLayer(): Layer | null {
  const c = activeContainer();
  return c.layers[c.getActiveLayerIndex()] ?? null;
}

function selectedLayerGroup(): SubPanel | null {
  if (!selectedSubPanelId) return null;
  const subPanel = findSubPanelById(activePanel(), selectedSubPanelId);
  return subPanel?.group ? subPanel : null;
}

function activeAnimationTarget(): Layer | SubPanel | null {
  return selectedLayerGroup() ?? activeLayer();
}

function activeContainerIsLocked(): boolean {
  let container: StackContainer = activePanel();
  for (const id of activeSubPanelPath) {
    const child = (container.subPanels ?? []).find((subPanel) => subPanel.id === id);
    if (!child) return false;
    if (child.group && child.locked) return true;
    container = child;
  }
  return false;
}

function activeLayerIsEditable(showMessage = false): boolean {
  const layer = activeLayer();
  const editable = !!layer && !layer.locked && !activeContainerIsLocked();
  if (!editable && showMessage) setStatus("Layer is locked · unlock it in Layers to edit");
  return editable;
}

function projectLayerIds(source: Project): Set<string> {
  const ids = new Set<string>();
  for (const panel of source.panels) {
    for (const layer of panel.layers) ids.add(layer.id);
    walkSubPanels(panel, (subPanel) => {
      for (const layer of subPanel.layers) ids.add(layer.id);
    });
  }
  return ids;
}

function pruneRasterStoreForProject(source: Project): void {
  pruneRasterStore(projectLayerIds(source));
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
/** Find which panels a set of changed layers live on, so `history.push` can
 *  reuse the serialized string of every other panel. Always includes the
 *  active panel — guides, bg, sub-panel bounds and texts all live there and
 *  aren't necessarily reflected in `changedLayers`. */
function changedPanelIdsFor(changedLayers: Layer[]): Set<string> {
  const ids = new Set<string>();
  ids.add(activePanel().id);
  if (changedLayers.length === 0) return ids;
  const changedSet = new Set(changedLayers);
  for (const panel of project.panels) {
    if (panel.layers.some(l => changedSet.has(l))) {
      ids.add(panel.id);
      continue;
    }
    if (panel.subPanels?.some(sp => sp.layers.some(l => changedSet.has(l)))) ids.add(panel.id);
  }
  return ids;
}

/** JSON-value deep equality (key order independent) — only used behind
 *  `?historycheck` to verify the structural-sharing history entry
 *  reconstructs to the same project that was just pushed. */
function historyCheckDeepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => historyCheckDeepEqual(v, b[i]));
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const keysA = Object.keys(ao);
  const keysB = Object.keys(bo);
  return keysA.length === keysB.length && keysA.every(k => historyCheckDeepEqual(ao[k], bo[k]));
}

function commitHistory(changedLayers?: Layer[]) {
  if (changedLayers) {
    for (const l of changedLayers) bumpLayerVersion(l);
  } else {
    bumpAllProjectLayers();
  }
  const changedPanelIds = changedLayers ? changedPanelIdsFor(changedLayers) : undefined;
  history.push(project, { activePanelIndex }, changedPanelIds);
  if (historyCheckEnabled) {
    const expected = JSON.parse(JSON.stringify(project));
    const actual = history.debugCurrentReconstruction();
    if (!historyCheckDeepEqual(expected, actual)) {
      console.error("historycheck: history entry mismatch after commitHistory", {
        changedLayerCount: changedLayers?.length,
        stack: new Error().stack,
      });
    }
  }
  markDirty();
  dirtyThumbnailPanelIds.add(activePanel().id);
  renderContentVersion++;
  invalidateBaseFrameCache();
  updateCanvasHint();
  updateUndoRedoButtons();
}

function updateUndoRedoButtons() {
  const undoBtn = document.getElementById("undo-btn") as HTMLButtonElement | null;
  const redoBtn = document.getElementById("redo-btn") as HTMLButtonElement | null;
  if (undoBtn) undoBtn.disabled = !history.canUndo();
  if (redoBtn) redoBtn.disabled = !history.canRedo();
}

function mountChromeIcons() {
  const undoBtn = document.getElementById("undo-btn");
  const redoBtn = document.getElementById("redo-btn");
  if (undoBtn && !undoBtn.querySelector("svg")) undoBtn.appendChild(svgIcon(StudioIcons.Undo, 16));
  if (redoBtn && !redoBtn.querySelector("svg")) redoBtn.appendChild(svgIcon(StudioIcons.Redo, 16));
}

mountChromeIcons();
updateUndoRedoButtons();

/** Cleanly terminate any live pointer interaction before an undo/redo swaps
 *  `project` out from under it — the interaction's in-flight state (live
 *  stroke, drag snapshots) points at Layer/Panel objects from the project
 *  being discarded. Undoing mid-interaction means the user wants out, so we
 *  drop the in-flight edit rather than committing it.
 *
 *  Also release pointer capture and suppress further paint until that pointer
 *  lifts. Leaving capture held (or drawing=false while the tip is still down)
 *  is what made stylus pressure feel "dead" until the user scribbled/re-seated
 *  the pen after Cmd/Ctrl+Z. */
function releaseCanvasPointerCapture(pointerId: number | null) {
  if (pointerId == null) return;
  try {
    if (canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
  } catch { /* already released / unsupported */ }
}

function cancelLiveInteractionsForUndo() {
  markStylusPressureInterrupt();
  if (drawing) {
    if (liveRasterStroke) rollbackLiveRasterStroke();
    if (drawingPointerId != null) suppressStrokeUntilPointerUp = drawingPointerId;
    releaseCanvasPointerCapture(drawingPointerId);
    drawing = false;
    drawingPointerId = null;
    liveStrokeHasRealPressure = false;
    liveStrokeSyntheticPressureCount = 0;
    clearLiveStrokeState();
  }
  if (selectionState?.mode === "object" && transformSnapshots) {
    for (const snapshot of transformSnapshots) restoreFromSnapshot(snapshot);
    bumpMarqueeItemLayers(selectionState.items);
    transformSnapshots = null;
  }
  layerMoveDrag = null;
  perspectiveDrag = null;
  selectDrag = null;
  subPanelDrag = null;
  cutSubPanelDrag = null;
  mangaRadialDrag = null;
  gradientDrag = null;
  transformSnapshots = null;
  keyframeArm = null;
  scaleToolDrag = null; // snapshots reference replaced Layer objects
}

function panelTimelineSignature(panel: Panel): string {
  return JSON.stringify({
    kind: panel.kind,
    durationMs: panel.durationMs,
    annotation: panel.annotation,
    enter: panel.enter,
    exit: panel.exit,
  });
}

function timelineNeedsRebuildAfterHistory(
  previous: Project,
  next: Project,
  change: history.HistoryChange,
): boolean {
  if (timelineTab === "sequence" || timelineTab === "anim") return true;
  if (change.panelOrderChanged || previous.wiggleFps !== next.wiggleFps) return true;
  if (JSON.stringify(previous.groups ?? []) !== JSON.stringify(next.groups ?? [])) return true;
  const previousById = new Map(previous.panels.map(panel => [panel.id, panel]));
  for (const id of change.changedPanelIds) {
    const oldPanel = previousById.get(id);
    const newPanel = next.panels.find(panel => panel.id === id);
    if (oldPanel && newPanel && panelTimelineSignature(oldPanel) !== panelTimelineSignature(newPanel)) return true;
  }
  return false;
}

let undoRedoQueue = Promise.resolve();

function performUndoRedo(isRedo: boolean) {
  const run = undoRedoQueue.then(() => performUndoRedoNow(isRedo));
  undoRedoQueue = run.catch(() => undefined);
  return undoRedoQueue;
}

async function performUndoRedoNow(isRedo: boolean) {
  cancelLiveInteractionsForUndo();
  const prepared = isRedo ? history.prepareRedo(project) : history.prepareUndo(project);
  if (!prepared) { setStatus(isRedo ? "Nothing to redo" : "Nothing to undo"); return; }

  let rasterPreparation;
  try {
    rasterPreparation = await prepareRasterCanvases(
      prepared.result.project,
      prepared.result.change.changedPanelIds,
    );
  } catch (error) {
    console.error(`${isRedo ? "Redo" : "Undo"} raster preparation failed`, error);
    setStatus(`${isRedo ? "Redo" : "Undo"} failed: raster layer could not be restored`);
    return;
  }

  const snap = history.commitPrepared(prepared);
  if (!snap) {
    setStatus("Undo state changed before it could be applied");
    return;
  }
  const previousProject = project;
  const previousActivePanel = previousProject.panels[activePanelIndex];
  const previousActiveSubPanelPath = activeSubPanelPath.slice();
  project = snap.project;
  commitRasterPreparation(rasterPreparation);
  pruneRasterStoreForProject(project);
  markDirty();
  for (const id of snap.change.changedPanelIds) {
    if (project.panels.some(panel => panel.id === id)) dirtyThumbnailPanelIds.add(id);
  }
  renderContentVersion++;
  // The raw-layer cache is intentionally preserved. Restored layers with
  // identical render signatures can reuse their previous stamped pixels.
  resizeCanvasForProject();
  activePanelIndex = Math.max(0, Math.min(snap.ctx.activePanelIndex, project.panels.length - 1));
  activeSubPanelPath = sanitizeSubPanelPath(activePanel(), previousActiveSubPanelPath);
  selectedSubPanelId = null;
  selectedText = null;
  clearSelection();
  setStatus(isRedo ? "Redo" : "Undo");
  updateSmoothingControls();
  if (timelineNeedsRebuildAfterHistory(previousProject, project, snap.change)) {
    buildTimeline();
  } else {
    lastSyncedThumbIndex = -1;
    syncActiveThumb();
  }
  const activePanelWasReused = previousActivePanel === project.panels[activePanelIndex]
    && previousActiveSubPanelPath.length === 0;
  if (!activePanelWasReused) buildLayers();
  buildBreadcrumb();
  buildInspector();
  buildEditContext();
  updateUndoRedoButtons();
  buildReferenceImages();
  requestLoopFrame();
}

/** Bump versions of every layer a marquee selection touches (live drags mutate
 *  stroke points in place, so the render memo must see each intermediate state). */
function bumpMarqueeItemLayers(items: MarqueeRef[]) {
  for (const ref of items) {
    if (ref.kind === "stroke" || ref.kind === "fill" || ref.kind === "text") {
      bumpLayerVersion(ref.layer);
    } else if (ref.kind === "raster") {
      const rasterCanvas = getRasterCanvas(ref.layer);
      if (!rasterCanvas) continue;
      renderRasterSelection(ref.selection, rasterCanvas);
      markRasterEdited(ref.layer);
      invalidateBaseFrameCache();
    }
  }
}

function rasterMarqueeItems(items: MarqueeRef[]) {
  return items.filter((item): item is Extract<MarqueeRef, { kind: "raster" }> =>
    item.kind === "raster"
  );
}

function syncRasterMarqueeItems(items: MarqueeRef[]) {
  for (const ref of rasterMarqueeItems(items)) syncRasterToLayer(ref.layer);
}

const rasterContentBoundsCache = new Map<string, {
  version: number;
  bounds: Rect | null;
}>();

function cachedRasterContentBounds(layer: Layer, canvas: HTMLCanvasElement): Rect | null {
  const version = rasterPixelVersion(layer);
  const cached = rasterContentBoundsCache.get(layer.id);
  if (cached?.version === version) return cached.bounds ? { ...cached.bounds } : null;
  const bounds = rasterContentBounds(canvas);
  rasterContentBoundsCache.set(layer.id, { version, bounds });
  return bounds ? { ...bounds } : null;
}

function scaleToolItems(): { items: MarqueeRef[]; bounds: Rect } | null {
  if (selectionState?.mode === "object" && isObjectSelectionIdle(selectionState)) {
    return { items: selectionState.items, bounds: selectionState.bounds };
  }
  const layer = activeLayer();
  if (!layer || !layer.visible) return null;
  if (layer.kind === "raster") {
    const rasterCanvas = getRasterCanvas(layer);
    const bounds = rasterCanvas ? cachedRasterContentBounds(layer, rasterCanvas) : null;
    return bounds ? { items: [], bounds } : null;
  }
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
  const rasterRef = rasterMarqueeItems(selectionState.items)[0];
  if (rasterRef) {
    const bounds = boundsFromItems([rasterRef], measureText);
    selectionClipboard = {
      kind: "raster",
      pixels: flattenRasterSelection(rasterRef.selection),
      x: bounds.x,
      y: bounds.y,
    };
    lastEditClipboardKind = "selection";
    buildEditContext();
    setStatus("Selected pixels copied");
    return;
  }
  const strokes: Stroke[] = [];
  const fills: Fill[] = [];
  const texts: TextElement[] = [];
  for (const ref of selectionState.items) {
    if (ref.kind === "stroke") strokes.push(JSON.parse(JSON.stringify(ref.stroke)));
    else if (ref.kind === "fill") fills.push(JSON.parse(JSON.stringify(ref.fill)));
    else if (ref.kind === "text") texts.push(JSON.parse(JSON.stringify(ref.text)));
  }
  selectionClipboard = { kind: "vector", strokes, fills, texts };
  lastEditClipboardKind = "selection";
  const count = strokes.length + fills.length + texts.length;
  buildEditContext();
  setStatus(`${count} item(s) copied · navigate to a frame and paste`);
}

function pasteSelection() {
  if (!selectionClipboard) return;
  if (activePanel().kind === "timelapse") { setStatus("Cannot paste onto a timelapse panel"); return; }
  let layer = activeLayer();
  if (!layer) return;

  if (selectionClipboard.kind === "raster") {
    if (layer.kind !== "raster") {
      const container = activeContainer();
      const raster = newLayer("Pasted pixels", "raster", {
        width: project.width,
        height: project.height,
      });
      const index = container.getActiveLayerIndex() + 1;
      const afterId = container.layers[container.getActiveLayerIndex()]?.id ?? null;
      container.layers.splice(index, 0, raster);
      noteRootLayerInserted(raster.id, afterId);
      container.setActiveLayerIndex(index);
      const blank = document.createElement("canvas");
      blank.width = project.width;
      blank.height = project.height;
      installRasterCanvas(raster, blank);
      layer = raster;
      buildLayers();
    }
    const rasterCanvas = getRasterCanvas(layer);
    if (!rasterCanvas) {
      showToast("Raster layer still loading", "info");
      return;
    }
    const pixels = selectionClipboard.pixels;
    const x = Math.max(0, Math.min(
      rasterCanvas.width - pixels.width,
      selectionClipboard.x + 24
    ));
    const y = Math.max(0, Math.min(
      rasterCanvas.height - pixels.height,
      selectionClipboard.y + 24
    ));
    const payload = createRasterSelectionFromPixels(layer, rasterCanvas, pixels, x, y);
    renderRasterSelection(payload, rasterCanvas);
    markRasterEdited(layer);
    syncRasterToLayer(layer);
    selectionState = {
      mode: "object",
      phase: "idle",
      shape: { kind: "rect", x, y, w: pixels.width, h: pixels.height },
      bounds: { x, y, w: pixels.width, h: pixels.height },
      items: [{ kind: "raster", layer, selection: payload }],
    };
    commitHistory([layer]);
    lastEditClipboardKind = "selection";
    buildEditContext();
    setStatus("Pasted pixels · drag or transform to position");
    return;
  }

  if (layer.kind === "raster") {
    showToast("Vector objects need a draw layer; paste selected pixels into raster layers", "info");
    return;
  }
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
  commitHistory([layer]);
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

function copyRasterRegionSelection(): boolean {
  if (selectionState?.mode !== "region" || selectionState.phase !== "idle") return false;
  const layer = activeLayer();
  if (layer?.kind !== "raster") return false;
  const rasterCanvas = getRasterCanvas(layer);
  if (!rasterCanvas) {
    showToast("Raster layer still loading", "info");
    return false;
  }
  const payload = extractRasterSelection(
    layer,
    rasterCanvas,
    selectionState.shape,
    !!selectionState.inverted
  );
  if (!payload) {
    setStatus("Nothing to copy in selection");
    return false;
  }
  const bounds = boundsFromItems([{ kind: "raster", layer, selection: payload }], measureText);
  selectionClipboard = {
    kind: "raster",
    pixels: flattenRasterSelection(payload),
    x: bounds.x,
    y: bounds.y,
  };
  lastEditClipboardKind = "selection";
  buildEditContext();
  setStatus("Selected pixels copied");
  return true;
}

function clipRasterContextToRegion(
  rasterCtx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: Extract<SelectionState, { mode: "region" }>
) {
  rasterCtx.beginPath();
  if (state.inverted) rasterCtx.rect(0, 0, width, height);
  traceShapePath(rasterCtx, state.shape);
  rasterCtx.clip(state.inverted ? "evenodd" : "nonzero");
}

function deleteRasterRegionSelection(): boolean {
  if (selectionState?.mode !== "region" || selectionState.phase !== "idle") return false;
  const layer = activeLayer();
  if (layer?.kind !== "raster") return false;
  const rasterCanvas = getRasterCanvas(layer);
  if (!rasterCanvas) {
    showToast("Raster layer still loading", "info");
    return false;
  }
  const rasterCtx = rasterCanvas.getContext("2d")!;
  rasterCtx.save();
  clipRasterContextToRegion(
    rasterCtx,
    rasterCanvas.width,
    rasterCanvas.height,
    selectionState
  );
  rasterCtx.clearRect(0, 0, rasterCanvas.width, rasterCanvas.height);
  rasterCtx.restore();
  markRasterEdited(layer);
  syncRasterToLayer(layer);
  commitHistory([layer]);
  setStatus("Selected pixels deleted");
  return true;
}

function cutSelection() {
  if (!selectionState) return;
  if (selectionState.mode === "region" && selectionState.phase === "idle") {
    if (activeLayer()?.kind === "raster") {
      if (copyRasterRegionSelection()) deleteRasterRegionSelection();
      return;
    }
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
  const rasterRef = rasterMarqueeItems(selectionState.items)[0];
  if (rasterRef) {
    const rasterCanvas = getRasterCanvas(rasterRef.layer);
    if (!rasterCanvas) {
      showToast("Raster layer still loading", "info");
      return;
    }
    const pixels = flattenRasterSelection(rasterRef.selection);
    // The current selected pixels become part of the base; the duplicate is
    // the new floating selection, matching raster-editor duplicate semantics.
    const bounds = boundsFromItems([rasterRef], measureText);
    const payload = createRasterSelectionFromPixels(
      rasterRef.layer,
      rasterCanvas,
      pixels,
      bounds.x + 24,
      bounds.y + 24
    );
    renderRasterSelection(payload, rasterCanvas);
    markRasterEdited(rasterRef.layer);
    syncRasterToLayer(rasterRef.layer);
    selectionState = {
      mode: "object",
      phase: "idle",
      shape: {
        kind: "rect",
        x: payload.frame.x,
        y: payload.frame.y,
        w: payload.frame.w,
        h: payload.frame.h,
      },
      bounds: { ...payload.frame },
      items: [{ kind: "raster", layer: rasterRef.layer, selection: payload }],
    };
    commitHistory([rasterRef.layer]);
    buildEditContext();
    setStatus("Selected pixels duplicated");
    return;
  }
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
      stackInsertSubPanel(activePanel(), copy.id);
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
  const touchedLayers = [...new Set(
    newItems.filter(i => i.kind !== "subpanel").map(i => (i as { layer: Layer }).layer)
  )];
  commitHistory(touchedLayers);
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

// When a deferred fill-mask recompute lands, repaint from fresh caches. This
// fires from an async task, possibly after the rAF loop has gone idle — it
// must wake the loop itself, not just mark state dirty for a loop that may
// no longer be running.
setAsyncRenderInvalidate(() => {
  invalidateBaseFrameCache();
  dirtyThumbnailPanelIds.add(activePanel().id);
  requestLoopFrame();
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
  liveRasterStroke = null;
}

function beginLiveRasterStroke(
  layer: Layer,
  stroke: Stroke,
  firstPoint: Vec2,
  firstPressure: number
): boolean {
  const rasterCanvas = getRasterCanvas(layer);
  if (!rasterCanvas) {
    showToast("Raster layer still loading", "info");
    return false;
  }
  const rasterCtx = rasterCanvas.getContext("2d")!;
  const before = cloneRasterCanvas(rasterCanvas);
  rasterCtx.save();
  const region = selectionState?.mode === "region" && selectionState.phase !== "creating"
    ? selectionState
    : null;
  if (region) {
    clipRasterContextToRegion(rasterCtx, rasterCanvas.width, rasterCanvas.height, region);
  }
  const painter = new RasterStrokeSession(
    rasterCtx,
    brushByKey(stroke.brush),
    stroke,
    liveStrokeLayerIndex,
    nextRasterStrokeIndex(layer),
    activePanel().bg,
    firstPoint,
    firstPressure
  );
  liveRasterStroke = {
    layer,
    canvas: rasterCanvas,
    before,
    ctx: rasterCtx,
    painter,
    contextSaved: true,
  };
  markRasterEdited(layer);
  invalidateBaseFrameCache();
  return true;
}

function closeLiveRasterStrokeContext() {
  if (!liveRasterStroke?.contextSaved) return;
  liveRasterStroke.ctx.restore();
  liveRasterStroke.contextSaved = false;
}

function rollbackLiveRasterStroke() {
  if (!liveRasterStroke) return;
  closeLiveRasterStrokeContext();
  const { canvas, before, layer } = liveRasterStroke;
  const rasterCtx = canvas.getContext("2d")!;
  rasterCtx.clearRect(0, 0, canvas.width, canvas.height);
  rasterCtx.drawImage(before, 0, 0);
  markRasterEdited(layer);
  invalidateBaseFrameCache();
}

function commitLiveStroke() {
  if (!liveStroke || !liveStrokeLayer) return;
  if (liveStrokeLayer.kind === "raster") {
    if (!liveRasterStroke) return;
    closeLiveRasterStrokeContext();
    if (liveRasterStroke.painter.touched) {
      markRasterEdited(liveStrokeLayer);
      syncRasterToLayer(liveStrokeLayer);
      commitHistory([liveStrokeLayer]);
    }
    return;
  }
  simplifyStroke(liveStroke);
  const clipShape = activeRegionShape(selectionState);
  const segments: Stroke[] = [];
  if (clipShape) {
    const inverted = selectionState?.mode === "region" ? !!selectionState.inverted : false;
    const { inside, outside } = splitStrokeAtShape(liveStroke, clipShape);
    segments.push(...(inverted ? outside : inside).filter((seg) => seg.points.length >= 1));
  } else {
    segments.push(liveStroke);
  }

  for (const segment of segments) liveStrokeLayer.strokes.push(segment);
  commitHistory([liveStrokeLayer]);
}

function isRadialBrushActive(): boolean {
  return !TOOL_KEYS.has(currentBrush) && brushByKey(currentBrush).radial === true;
}

function commitMangaRadialStroke(center: Vec2, edge: Vec2) {
  const radius = Math.hypot(edge.x - center.x, edge.y - center.y);
  if (radius < MANGA_RADIAL_MIN_RADIUS) return;

  const panel = activePanel();
  if (panel.kind === "timelapse") return;
  let layer = activeLayer();
  if (!layer || !layer.visible) return;
  if (!activeLayerIsEditable(true)) return;
  const paintableTone = layer.kind === "tone" && layer.tone?.coverage === "painted";
  const gradientTone = currentBrush === GRADIENT_KEY && layer.kind === "tone";
  if (layer.kind !== "draw" && layer.kind !== "raster" && layer.kind !== undefined && !paintableTone && !gradientTone) {
    const c = activeContainer();
    const idx = c.layers.findIndex(l => (l.kind ?? "draw") === "draw" && l.visible && !l.locked);
    if (idx < 0) return;
    c.setActiveLayerIndex(idx);
    buildLayers();
    layer = activeLayer();
    if (!layer || !layer.visible) return;
  }

  const regionClip = activeRegionShape(selectionState);
  if (regionClip && !activeRegionContains(selectionState, center)) {
    setStatus("Click inside the selection");
    return;
  }

  const stroke: Stroke = {
    brush: currentBrush,
    color: currentColor,
    size: currentSize,
    erase: transparentPaintSelected || brushByKey(currentBrush).erase === true,
    brushSettings: { ...currentBrushSettings },
    points: [{ x: center.x, y: center.y }, { x: edge.x, y: edge.y }],
    pressures: [1, 1],
  };

  const c = activeContainer();
  const layerIndex = c.getActiveLayerIndex();
  if (layer.kind === "raster") {
    const rasterCanvas = getRasterCanvas(layer);
    if (!rasterCanvas) { showToast("Layer still loading", "info"); return; }
    const rasterCtx = rasterCanvas.getContext("2d")!;
    rasterCtx.save();
    const region = selectionState?.mode === "region" && selectionState.phase !== "creating"
      ? selectionState
      : null;
    if (region) {
      clipRasterContextToRegion(rasterCtx, rasterCanvas.width, rasterCanvas.height, region);
    }
    stampStrokeToCanvas(rasterCtx, stroke, layerIndex, nextRasterStrokeIndex(layer), panel.bg);
    rasterCtx.restore();
    markRasterEdited(layer);
    syncRasterToLayer(layer);
  } else {
    layer.strokes.push(stroke);
  }
  commitHistory([layer]);
}

function gradientAmount(kind: "linear" | "radial", start: Vec2, end: Vec2, x: number, y: number): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSq = Math.max(1, dx * dx + dy * dy);
  const t = kind === "radial"
    ? Math.hypot(x - start.x, y - start.y) / Math.sqrt(lengthSq)
    : ((x - start.x) * dx + (y - start.y) * dy) / lengthSq;
  return Math.max(0, Math.min(1, t));
}

function commitGradient(start: Vec2, end: Vec2) {
  if (Math.hypot(end.x - start.x, end.y - start.y) < 2) return;
  const layer = activeLayer();
  if (!layer?.visible) return;
  if (!activeLayerIsEditable(true)) return;

  if (layer.kind === "tone" && layer.tone) {
    const hasPaintedMask = layer.strokes.some((stroke) => !stroke.erase && stroke.points.length > 0);
    applyToneGradient(layer.tone, currentGradientKind, start, end, hasPaintedMask);
    commitHistory([layer]);
    buildLayers();
    buildLayerToneEffects();
    setStatus(hasPaintedMask
      ? "Tone gradient applied inside the painted mask"
      : "Tone gradient applied across the layer");
    return;
  }

  const regionClip = activeRegionShape(selectionState);
  if (layer.kind === "raster") {
    const rasterCanvas = getRasterCanvas(layer);
    if (!rasterCanvas) { showToast("Layer still loading", "info"); return; }
    const rasterCtx = rasterCanvas.getContext("2d")!;
    const image = rasterCtx.getImageData(0, 0, rasterCanvas.width, rasterCanvas.height);
    const before = new Uint8ClampedArray(image.data);
    const sx = Math.max(0, Math.min(rasterCanvas.width - 1, Math.floor(start.x)));
    const sy = Math.max(0, Math.min(rasterCanvas.height - 1, Math.floor(start.y)));
    const si = (sy * rasterCanvas.width + sx) * 4;
    const sentinel = `#${(255 - before[si]).toString(16).padStart(2, "0")}${(255 - before[si + 1]).toString(16).padStart(2, "0")}${(255 - before[si + 2]).toString(16).padStart(2, "0")}`;
    if (!floodFillImageData(image, start.x, start.y, sentinel, rasterCanvas.width, rasterCanvas.height, currentFillTolerance)) return;
    const from = hexToRgb(currentColor);
    const to = hexToRgb(currentGradientEndColor);
    const selectionMask = regionClip ? rasterizeShapeMask(regionClip, rasterCanvas.width, rasterCanvas.height) : null;
    const inverted = selectionState?.mode === "region" && !!selectionState.inverted;
    for (let i = 0; i < image.data.length; i += 4) {
      const changed = image.data[i] !== before[i] || image.data[i + 1] !== before[i + 1] || image.data[i + 2] !== before[i + 2];
      const pixel = i / 4;
      const selected = !selectionMask || (inverted ? selectionMask[pixel] === 0 : selectionMask[pixel] !== 0);
      if (!changed || !selected) {
        image.data[i] = before[i]; image.data[i + 1] = before[i + 1];
        image.data[i + 2] = before[i + 2]; image.data[i + 3] = before[i + 3];
        continue;
      }
      const x = pixel % rasterCanvas.width;
      const y = Math.floor(pixel / rasterCanvas.width);
      const t = gradientAmount(currentGradientKind, start, end, x, y);
      image.data[i] = Math.round(from[0] + (to[0] - from[0]) * t);
      image.data[i + 1] = Math.round(from[1] + (to[1] - from[1]) * t);
      image.data[i + 2] = Math.round(from[2] + (to[2] - from[2]) * t);
      image.data[i + 3] = 255;
    }
    rasterCtx.putImageData(image, 0, 0);
    markRasterEdited(layer);
    syncRasterToLayer(layer);
    commitHistory([layer]);
    return;
  }

  if (layer.kind !== "draw" && layer.kind !== undefined) {
    showToast("Choose a draw, raster, or manga tone layer", "info");
    return;
  }
  layer.fills.push({
    point: { ...start }, color: currentColor, seed: Date.now() & 0x7fffffff,
    afterStrokeIndex: layer.strokes.length - 1, tolerance: currentFillTolerance,
    gapClosePx: currentFillGapClosePx, referenceMode: currentFillReferenceMode,
    gradient: { kind: currentGradientKind, start: { ...start }, end: { ...end }, endColor: currentGradientEndColor },
    ...(regionClip ? { clipShape: JSON.parse(JSON.stringify(regionClip)) as SelectionShape, clipInverted: selectionState?.mode === "region" ? !!selectionState.inverted : false } : {}),
  });
  commitHistory([layer]);
}

/** Returns the index of the container's first paintable tone layer, creating
 *  one (and committing history) if none exists yet. Shared by the "+ Manga
 *  tone" button and the Tone tool chip. */
function ensurePaintedToneLayer(cont: ReturnType<typeof activeContainer>): number {
  const idx = cont.layers.findIndex((l) => l.kind === "tone" && l.tone?.coverage === "painted");
  if (idx >= 0) return idx;
  cont.layers.push(newLayer("Manga tone", "tone"));
  const created = cont.layers[cont.layers.length - 1];
  noteRootLayerInserted(created.id);
  cont.setActiveLayerIndex(cont.layers.length - 1);
  commitHistory();
  return cont.layers.length - 1;
}

function ensureTextLayer(): Layer {
  const c = activeContainer();
  let tl = c.layers.find(l => l.kind === "text");
  if (!tl) {
    tl = newLayer("Text", "text");
    c.layers.push(tl);
    noteRootLayerInserted(tl.id);
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
/** Count of leading samples that used a synthetic filler this stroke. */
let liveStrokeSyntheticPressureCount = 0;
/** Last positive pen pressure — reused when the tablet briefly reports 0 / demotes
 *  the stylus to mouse after wheel or keyboard interrupts. */
let lastRealPenPressure = PEN_STARTUP_FALLBACK_PRESSURE;
/** Most recent pen pointer activity (including hover). Arms recovery after interrupts. */
let lastPenActivityMs = 0;
/** Until this timestamp, mouse/default-pressure samples are treated as synthetic pen. */
let stylusPressureRecoveryUntil = 0;
const STYLUS_RECOVERY_ARM_MS = 8000;
const STYLUS_RECOVERY_HOLD_MS = 4000;
/** After undo cancels a live pen stroke, ignore further paint until that
 *  pointer lifts — otherwise mid-air residual moves feel like a dead brush. */
let suppressStrokeUntilPointerUp: number | null = null;
let liveSmoothingSession: StrokeSmoothingSession | null = null;
let liveRasterStroke: {
  layer: Layer;
  canvas: HTMLCanvasElement;
  before: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  painter: RasterStrokeSession;
  contextSaved: boolean;
} | null = null;
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
let cutSubPanelDrag: { start: { x: number; y: number }; end: { x: number; y: number } } | null = null;
const MANGA_RADIAL_MIN_RADIUS = 2;
let mangaRadialDrag: {
  center: Vec2;
  edge: Vec2;
  pointerId: number;
} | null = null;
let gradientDrag: {
  start: Vec2;
  end: Vec2;
  pointerId: number;
} | null = null;
type SelectDrag =
  | { kind: "move"; subPanelId: string; offset: { x: number; y: number } }
  | { kind: "tail"; subPanelId: string; offset: { x: number; y: number } }
  | {
      kind: "text";
      ref: TextRef;
      offset: { x: number; y: number };
      /** Canvas coords at pointerdown — used to tell a click from a drag. */
      origin: { x: number; y: number };
      /** True when this text was already selected before this press. */
      alreadySelected: boolean;
    };
let selectDrag: SelectDrag | null = null;
/** Inline text editor currently mounted on document.body, if any. */
let activeTextInput: HTMLTextAreaElement | null = null;

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
  walkSubPanels(panel, (sp) => {
    for (const l of sp.layers) ids.add(l.id);
  });
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
// Setting `.font` re-parses a CSS font shorthand and `measureText` shapes the
// string — neither is free, and this runs in hot loops (boundsFromItems,
// hit-testing, selection overlays, per-text in cutAtShape) where the same few
// strings are measured over and over during a drag. Text content changes far
// less often than bounds are queried, so memoize on the inputs that decide the
// result. Bounded so a long editing session can't grow it without limit.
const _measureCache = new Map<string, { width: number; height: number }>();
const MEASURE_CACHE_MAX = 2000;
/** Fonts load asynchronously; metrics measured against a fallback face become
 *  wrong once the real face arrives, so the cache must be dropped then. */
function invalidateMeasureCache(): void {
  _measureCache.clear();
}
function measureText(t: TextElement): { width: number; height: number } {
  const family = fontFamilyCss(t.fontFamily);
  const key = `${t.fontSize}|${family}|${t.content}`;
  const hit = _measureCache.get(key);
  if (hit) return hit;
  _measureCtx.font = `${t.fontSize}px ${family}`;
  const lines = t.content.split("\n");
  let width = 0;
  for (const line of lines) width = Math.max(width, _measureCtx.measureText(line || " ").width);
  const result = { width, height: Math.max(1, lines.length) * t.fontSize * 1.2 };
  if (_measureCache.size >= MEASURE_CACHE_MAX) _measureCache.clear();
  _measureCache.set(key, result);
  return result;
}
// A face that finishes loading changes the metrics of anything measured against
// its fallback, so drop memoized bounds whenever the font set settles.
if (typeof document !== "undefined" && document.fonts) {
  document.fonts.addEventListener("loadingdone", invalidateMeasureCache);
  void document.fonts.ready.then(invalidateMeasureCache).catch(() => {});
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
  canvas.style.cursor = "";
}

function marqueeTransformBounds(state: SelectionState): Rect | null {
  if (state.mode !== "object") return null;
  return state.bounds;
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
  // The eraser ring overlay is driven by pointermove; drop it whenever the
  // eraser isn't the effective tool so it can't linger over other tools.
  if (!isEraseBrushKey(currentBrush)) hideEraserCursorOverlay();
  if (playing || panDrag || spacePanDown) return;
  if (isEraseBrushKey(currentBrush)) {
    canvas.style.cursor = "none";
    return;
  }
  if (currentBrush === MARQUEE_KEY && selectionState) {
    const at = pos ?? lastCanvasPointerPos;
    const manipulableIdleObject = selectionState.mode === "object" && selectionState.phase === "idle";
    const manipulableRasterRegion = isManipulableRasterRegion(selectionState);
    if (at && (manipulableIdleObject || manipulableRasterRegion)) {
      const bounds = manipulableRasterRegion
        ? shapeBounds(selectionState.shape)
        : marqueeTransformBounds(selectionState);
      if (bounds) {
        const handle = hitTestTransformHandle(at, bounds, viewport.scale);
        if (handle) {
          canvas.style.cursor = transformCursorForHandle(handle);
          return;
        }
        if (manipulableRasterRegion
          ? activeRegionContains(selectionState, at)
          : selectionMoveCursorHit(at, selectionState)) {
          canvas.style.cursor = "move";
          return;
        }
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

function isEraseBrushKey(key: string, eraseWithColor = transparentPaintSelected): boolean {
  if (TOOL_KEYS.has(key)) return false;
  return eraseWithColor || isErasePreviewBrush(brushByKey(key));
}

function cutAtShape(shape: SelectionShape, inverted = false): MarqueeRef[] {
  const items: MarqueeRef[] = [];
  const cont = activeContainer();
  const inSelection = (p: Vec2) => pointInRegionSelection(p, shape, inverted);

  for (const sp of frameSubPanels(activeStackContainer())) {
    const cx = sp.bounds.x + sp.bounds.w / 2;
    const cy = sp.bounds.y + sp.bounds.h / 2;
    if (inSelection({ x: cx, y: cy })) {
      items.push({ kind: "subpanel", subPanel: sp });
    }
  }

  for (const layer of cont.layers) {
    if (!layer.visible || layer.locked) continue;
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

function rasterSelectionAtShape(
  layer: Layer,
  shape: SelectionShape,
  inverted: boolean
): Extract<MarqueeRef, { kind: "raster" }> | null {
  const rasterCanvas = getRasterCanvas(layer);
  if (!rasterCanvas) {
    showToast("Raster layer still loading", "info");
    return null;
  }
  const payload = extractRasterSelection(layer, rasterCanvas, shape, inverted);
  if (!payload) return null;
  renderRasterSelection(payload, rasterCanvas);
  markRasterEdited(layer);
  invalidateBaseFrameCache();
  return { kind: "raster", layer, selection: payload };
}

function rasterContentSelection(layer: Layer): Extract<MarqueeRef, { kind: "raster" }> | null {
  const rasterCanvas = getRasterCanvas(layer);
  if (!rasterCanvas) {
    showToast("Raster layer still loading", "info");
    return null;
  }
  const bounds = cachedRasterContentBounds(layer, rasterCanvas);
  if (!bounds) return null;
  return rasterSelectionAtShape(layer, { kind: "rect", ...bounds }, false);
}

/** True when the active selection is an idle region on a raster layer — the
 *  case the marquee lets you drag/scale/rotate directly (handles are drawn and
 *  a plain drag inside lifts the pixels). Non-raster layers keep region
 *  selections as paint clips. */
function isManipulableRasterRegion(state: SelectionState | null): boolean {
  return !!state && state.mode === "region" && state.phase === "idle" &&
    activeLayer()?.kind === "raster";
}

/** Lifts an idle region selection into an object selection (extracting raster
 *  pixels or vector items) but does NOT commit history — the caller commits
 *  once the ensuing move/transform gesture ends, so a select→drag→release is a
 *  single undo step. Returns the extracted items, or null when the selection is
 *  not a promotable idle region or contains nothing. */
function promoteRegionSelection(): MarqueeRef[] | null {
  if (!selectionState || selectionState.mode !== "region" || selectionState.phase !== "idle") {
    return null;
  }
  const shape = selectionState.shape;
  const inverted = !!selectionState.inverted;
  const layer = activeLayer();
  const rasterRef = layer?.kind === "raster"
    ? rasterSelectionAtShape(layer, shape, inverted)
    : null;
  const items = rasterRef ? [rasterRef] : layer?.kind === "raster" ? [] : cutAtShape(shape, inverted);
  if (items.length === 0) return null;
  selectionState = {
    mode: "object",
    phase: "idle",
    shape,
    bounds: boundsFromItems(items, measureText),
    items,
  };
  return items;
}

function extractSelection() {
  if (!activeLayerIsEditable(true)) return;
  if (!selectionState || selectionState.mode !== "region" || selectionState.phase !== "idle") return;
  const items = promoteRegionSelection();
  if (!items) {
    clearSelection();
    setStatus("Nothing to extract in selection");
    return;
  }
  const rasterRef = rasterMarqueeItems(items)[0];
  if (rasterRef) {
    syncRasterToLayer(rasterRef.layer);
    commitHistory([rasterRef.layer]);
  } else {
    commitHistory();
  }
  buildEditContext();
  setStatus(rasterRef
    ? "Pixels extracted · drag to move · handles scale/rotate · Del removes"
    : `${items.length} extracted · drag to move · Del to remove`);
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
    const layer = activeLayer();
    const rasterRef = layer?.kind === "raster"
      ? rasterSelectionAtShape(layer, selectionState.shape, !!selectionState.inverted)
      : null;
    items = rasterRef ? [rasterRef] : layer?.kind === "raster"
      ? []
      : cutAtShape(selectionState.shape, !!selectionState.inverted);
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
  if (!activeLayerIsEditable(true)) return;
  if (!selectionState || selectionState.mode !== "object" || selectionState.phase !== "idle") return;
  const panel = activePanel();
  bumpMarqueeItemLayers(selectionState.items);
  const touchedLayers = [...new Set(
    selectionState.items.filter(i => i.kind !== "subpanel").map(i => (i as { layer: Layer }).layer)
  )];
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
      removeSubPanelById(panel, ref.subPanel.id);
    } else if (ref.kind === "raster") {
      const rasterCanvas = getRasterCanvas(ref.layer);
      if (rasterCanvas) {
        const rasterCtx = rasterCanvas.getContext("2d")!;
        rasterCtx.clearRect(0, 0, rasterCanvas.width, rasterCanvas.height);
        rasterCtx.drawImage(ref.selection.base, 0, 0);
        markRasterEdited(ref.layer);
        syncRasterToLayer(ref.layer);
      }
    }
  }
  clearSelection();
  commitHistory(touchedLayers);
  buildTimeline();
  buildLayers();
  buildInspector();
  buildEditContext();
}

function moveLayerContents(layer: Layer, dx: number, dy: number): boolean {
  if (layer.kind === "raster") {
    const rasterCanvas = getRasterCanvas(layer);
    if (!rasterCanvas || !layer.raster) return false;
    const scratch = document.createElement("canvas");
    scratch.width = rasterCanvas.width;
    scratch.height = rasterCanvas.height;
    scratch.getContext("2d")!.drawImage(rasterCanvas, 0, 0);
    const rasterCtx = rasterCanvas.getContext("2d")!;
    rasterCtx.clearRect(0, 0, rasterCanvas.width, rasterCanvas.height);
    rasterCtx.drawImage(scratch, dx, dy);
    markRasterEdited(layer);
    syncRasterToLayer(layer);
    return true;
  }
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
  return true;
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

const _centroidMemo = new WeakMap<Layer, { v: number; centroid: Vec2 }>();

function layerCentroid(layer: Layer): Vec2 {
  const v = layerVersion(layer);
  const memo = _centroidMemo.get(layer);
  if (memo && memo.v === v) return memo.centroid;
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
  const centroid = count === 0
    ? { x: project.width / 2, y: project.height / 2 }
    : { x: cx / count, y: cy / count };
  _centroidMemo.set(layer, { v, centroid });
  return centroid;
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

function copyActiveLayer() {
  const layer = activeLayer();
  if (!layer) return;
  layerClipboard = JSON.parse(JSON.stringify(layer)) as Layer;
  lastEditClipboardKind = "layer";
  buildLayers();
  buildInspector();
  setStatus(`copied ${layer.name}`);
}

function pasteLayerAboveActive() {
  if (!layerClipboard) return;
  if (activePanel().kind === "timelapse" && !activeSubPanelPath.length) {
    setStatus("Cannot paste a layer onto a timelapse panel");
    return;
  }
  const cont = activeContainer();
  const index = cont.getActiveLayerIndex();
  const nextIndex = pasteLayerAbove(cont.layers, index, layerClipboard, () => crypto.randomUUID());
  const pasted = cont.layers[nextIndex];
  noteRootLayerInserted(pasted.id, cont.layers[index]?.id ?? null);
  cont.setActiveLayerIndex(nextIndex);
  selectedText = null;
  selectedSubPanelId = null;
  clearSelection();
  commitHistory();
  buildLayers();
  buildInspector();
  setStatus(`pasted ${pasted.name}`);
}

function clipboardRasterFiles(data: DataTransfer | null): File[] {
  if (!data) return [];
  const itemFiles = [...data.items]
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter((file): file is File => !!file && isSupportedRasterImageFile(file));
  if (itemFiles.length > 0) return itemFiles;
  return [...data.files].filter(isSupportedRasterImageFile);
}

function clipboardContainsImage(data: DataTransfer | null): boolean {
  if (!data) return false;
  return [...data.items].some((item) => item.type.toLowerCase().startsWith("image/"))
    || [...data.files].some((file) => file.type.toLowerCase().startsWith("image/"));
}

/** True when a drag payload may contain filesystem files (MIME is unreliable mid-drag). */
function dataTransferHasFiles(data: DataTransfer | null): boolean {
  if (!data) return false;
  return [...data.types].includes("Files");
}

function loadClipboardImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    const finish = () => URL.revokeObjectURL(url);
    image.onload = () => {
      finish();
      resolve(image);
    };
    image.onerror = () => {
      finish();
      reject(new Error("clipboard image could not be decoded"));
    };
    image.src = url;
  });
}

async function pasteRasterImages(files: File[]) {
  setStatus(files.length === 1 ? "Importing image…" : `Importing ${files.length} images…`);
  const decoded = await Promise.all(files.map(async (file) => {
    try {
      const image = await loadClipboardImage(file);
      return { name: rasterLayerName(file), image };
    } catch (error) {
      console.error("Raster image import failed", error);
      return null;
    }
  }));
  const successful = decoded.filter(
    (item): item is NonNullable<typeof item> => item !== null
  );
  if (successful.length === 0) {
    showToast("PNG/JPEG import failed", "error");
    return;
  }
  await addRasterLayersFromImages(successful, files.length);
}

/** Shared path for Finder paste and “copy reference → paste into panel”. */
async function addRasterLayersFromImages(
  items: { name: string; image: HTMLImageElement }[],
  attemptedCount = items.length
) {
  if (activePanel().kind === "timelapse" && !activeSubPanelPath.length) {
    setStatus("Cannot import images onto a timelapse panel");
    return;
  }

  const targetProject = project;
  const targetPanel = activePanel();
  const targetContainer = activeContainer();
  const targetIndex = targetContainer.getActiveLayerIndex();

  const prepared = items.map(({ name, image }) => {
    const placement = containRasterImage(
      image.naturalWidth,
      image.naturalHeight,
      targetProject.width,
      targetProject.height
    );
    const rasterCanvas = document.createElement("canvas");
    rasterCanvas.width = targetProject.width;
    rasterCanvas.height = targetProject.height;
    const rasterCtx = rasterCanvas.getContext("2d");
    if (!rasterCtx) throw new Error("raster canvas is unavailable");
    rasterCtx.drawImage(
      image,
      placement.x,
      placement.y,
      placement.width,
      placement.height
    );
    return { name, rasterCanvas };
  });

  if (project !== targetProject || !targetProject.panels.includes(targetPanel)) {
    setStatus("Image import cancelled because the project changed");
    return;
  }

  const pastedLayers = prepared.map(({ name, rasterCanvas }) => {
    const layer = newLayer(name, "raster", {
      width: targetProject.width,
      height: targetProject.height,
    });
    installRasterCanvas(layer, rasterCanvas);
    return layer;
  });
  targetContainer.layers.splice(targetIndex + 1, 0, ...pastedLayers);
  let afterId = targetContainer.layers[targetIndex]?.id ?? null;
  for (const layer of pastedLayers) {
    noteRootLayerInserted(layer.id, afterId);
    afterId = layer.id;
  }
  targetContainer.setActiveLayerIndex(targetIndex + pastedLayers.length);
  selectedText = null;
  selectedSubPanelId = null;
  selectedReferenceImageId = null;
  clearSelection();
  commitHistory(pastedLayers);
  buildLayers();
  buildInspector();
  buildReferenceImages();

  const failedCount = attemptedCount - pastedLayers.length;
  const pastedLabel = pastedLayers.length === 1
    ? `added ${pastedLayers[0].name} as a raster layer`
    : `added ${pastedLayers.length} images as raster layers`;
  setStatus(failedCount > 0 ? `${pastedLabel} · ${failedCount} failed` : pastedLabel);
}

function loadDataUrlImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("image data URL could not be decoded"));
    image.src = dataUrl;
  });
}

function selectedReferenceImage(): ReferenceImage | null {
  if (!selectedReferenceImageId) return null;
  return (project.referenceImages ?? []).find((r) => r.id === selectedReferenceImageId) ?? null;
}

function copySelectedReferenceImage(): boolean {
  const ref = selectedReferenceImage();
  if (!ref) return false;
  referenceClipboard = {
    name: ref.name,
    data: ref.data,
    width: ref.width,
    height: ref.height,
  };
  lastEditClipboardKind = "reference";
  setStatus(`copied reference “${ref.name}” — paste into the panel to place as a layer`);
  // Best-effort system clipboard so Cmd/Ctrl+V uses the normal image-paste path.
  void (async () => {
    try {
      const response = await fetch(ref.data);
      const blob = await response.blob();
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
    } catch (error) {
      console.warn("System clipboard write for reference image failed", error);
    }
  })();
  return true;
}

async function pasteReferenceClipboardAsRaster() {
  if (!referenceClipboard) return;
  setStatus("Pasting reference into panel…");
  try {
    const image = await loadDataUrlImage(referenceClipboard.data);
    await addRasterLayersFromImages([{ name: referenceClipboard.name, image }]);
  } catch (error) {
    console.error("Reference → panel paste failed", error);
    showToast("Could not paste reference into panel", "error");
  }
}

function ensureReferenceImages(): ReferenceImage[] {
  if (!project.referenceImages) project.referenceImages = [];
  return project.referenceImages;
}

function imageToPngDataUrl(image: HTMLImageElement): { data: string; width: number; height: number } {
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    throw new Error("image has invalid dimensions");
  }
  if (width > MAX_REFERENCE_DIMENSION || height > MAX_REFERENCE_DIMENSION) {
    throw new Error(`image exceeds ${MAX_REFERENCE_DIMENSION}px`);
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("reference canvas is unavailable");
  ctx.drawImage(image, 0, 0);
  return { data: canvas.toDataURL("image/png"), width, height };
}

/** Soft cap so a huge photo doesn't dominate the board at 1:1. */
function referenceImportScale(width: number, height: number): number {
  const maxSide = Math.max(project.width, project.height) * 2;
  const natMax = Math.max(width, height);
  return natMax > maxSide ? maxSide / natMax : 1;
}

function selectReferenceImage(id: string | null) {
  selectedReferenceImageId = id;
  activeProjectFrame.querySelectorAll(".board-ref").forEach((node) => {
    const el = node as HTMLElement;
    el.classList.toggle("selected", el.dataset.refId === id);
  });
}

function deleteSelectedReferenceImage(): boolean {
  if (!selectedReferenceImageId) return false;
  const refs = project.referenceImages;
  if (!refs?.length) return false;
  const idx = refs.findIndex((r) => r.id === selectedReferenceImageId);
  if (idx < 0) return false;
  const removed = refs.splice(idx, 1)[0];
  selectedReferenceImageId = null;
  commitHistory([]);
  buildReferenceImages();
  setStatus(`removed reference “${removed.name}”`);
  return true;
}

/** Drop PNG/JPEG onto the board as project-attached reference overlays.
 *  Positions are frame-relative so they travel with the project card. */
async function dropReferenceImages(files: File[], clientX: number, clientY: number) {
  const refs = ensureReferenceImages();
  const remaining = MAX_REFERENCE_IMAGES - refs.length;
  if (remaining <= 0) {
    showToast(`At most ${MAX_REFERENCE_IMAGES} reference images per project`, "info");
    return;
  }
  const batch = files.slice(0, remaining);
  if (batch.length < files.length) {
    showToast(`Only ${remaining} more reference image${remaining === 1 ? "" : "s"} allowed`, "info");
  }

  const targetProject = project;
  const surface = surfaceRect();
  const world = screenToWorld(viewport, clientX - surface.left, clientY - surface.top);
  const frame = activeWorldRect();
  setStatus(batch.length === 1 ? "Adding reference…" : `Adding ${batch.length} references…`);

  const decoded = await Promise.all(batch.map(async (file) => {
    try {
      const image = await loadClipboardImage(file);
      const png = imageToPngDataUrl(image);
      const scale = referenceImportScale(png.width, png.height);
      return { file, png, scale };
    } catch (error) {
      console.error("Reference image import failed", error);
      return null;
    }
  }));

  if (project !== targetProject) {
    setStatus("Reference import cancelled because the project changed");
    return;
  }

  const successful = decoded.filter(
    (item): item is NonNullable<typeof item> => item !== null
  );
  if (successful.length === 0) {
    showToast("PNG/JPEG reference import failed", "error");
    return;
  }

  // Stack multiple drops around the cursor so they don't fully occlude each other.
  const stagger = 28;
  let lastId: string | null = null;
  for (let i = 0; i < successful.length; i++) {
    const { file, png, scale } = successful[i];
    const displayW = png.width * scale;
    const displayH = png.height * scale;
    const x = world.x - frame.x - displayW / 2 + i * stagger;
    const y = world.y - frame.y - displayH / 2 + i * stagger;
    const ref = newReferenceImage(referenceImageName(file), png.data, png.width, png.height, x, y, scale);
    refs.push(ref);
    lastId = ref.id;
  }

  selectedReferenceImageId = lastId;
  commitHistory([]);
  buildReferenceImages();
  const label = successful.length === 1
    ? `added reference “${successful[0] ? referenceImageName(successful[0].file) : "image"}”`
    : `added ${successful.length} reference images`;
  const failedCount = batch.length - successful.length;
  setStatus(failedCount > 0 ? `${label} · ${failedCount} failed` : label);
}

function referenceWorldRect(ref: ReferenceImage, frame = activeWorldRect()): WorldRect {
  return {
    x: frame.x + ref.x,
    y: frame.y + ref.y,
    width: ref.width * ref.scale,
    height: ref.height * ref.scale,
  };
}

function buildReferenceImages() {
  activeProjectFrame.querySelectorAll(".board-ref").forEach((el) => el.remove());
  const refs = project.referenceImages ?? [];
  if (selectedReferenceImageId && !refs.some((r) => r.id === selectedReferenceImageId)) {
    selectedReferenceImageId = null;
  }
  if (refs.length === 0) return;
  for (const ref of refs) {
    if (!ref.visible) continue;
    const displayW = ref.width * ref.scale;
    const displayH = ref.height * ref.scale;
    const el = document.createElement("div");
    el.className = "board-ref" + (ref.id === selectedReferenceImageId ? " selected" : "");
    el.style.left = `${ref.x}px`;
    el.style.top = `${ref.y}px`;
    el.style.width = `${displayW}px`;
    el.style.height = `${displayH}px`;
    el.style.opacity = String(ref.opacity);
    el.dataset.refId = ref.id;
    el.setAttribute("role", "img");
    el.setAttribute("aria-label", `Reference ${ref.name}`);
    el.title = `${ref.name} (drag · resize corners · ⌘/Ctrl+C then paste into panel)`;

    const img = document.createElement("img");
    img.src = ref.data;
    img.alt = "";
    img.draggable = false;
    el.appendChild(img);

    const label = document.createElement("div");
    label.className = "board-ref-label";
    label.textContent = ref.name;
    el.appendChild(label);

    for (const corner of ["nw", "ne", "se", "sw"] as const) {
      const handle = document.createElement("div");
      handle.className = `board-ref-handle ${corner}`;
      handle.title = "Resize";
      handle.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        selectReferenceImage(ref.id);
        beginReferenceResize(event, el, ref, corner);
      });
      el.appendChild(handle);
    }

    el.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      if ((event.target as HTMLElement).closest(".board-ref-handle")) return;
      event.preventDefault();
      event.stopPropagation();
      selectReferenceImage(ref.id);
      beginReferenceDrag(event, el, ref);
    });

    activeProjectFrame.appendChild(el);
  }
}

function syncReferenceElement(element: HTMLElement, ref: ReferenceImage) {
  element.style.left = `${ref.x}px`;
  element.style.top = `${ref.y}px`;
  element.style.width = `${ref.width * ref.scale}px`;
  element.style.height = `${ref.height * ref.scale}px`;
}

function beginReferenceDrag(event: PointerEvent, element: HTMLElement, ref: ReferenceImage) {
  try { element.setPointerCapture(event.pointerId); } catch { /* unsupported */ }
  element.classList.add("dragging");
  const startX = event.clientX;
  const startY = event.clientY;
  const originX = ref.x;
  const originY = ref.y;
  let moved = false;

  const move = (next: PointerEvent) => {
    if (next.pointerId !== event.pointerId) return;
    const dx = (next.clientX - startX) / viewport.scale;
    const dy = (next.clientY - startY) / viewport.scale;
    if (!moved && Math.hypot(next.clientX - startX, next.clientY - startY) > 3) moved = true;
    ref.x = originX + dx;
    ref.y = originY + dy;
    syncReferenceElement(element, ref);
  };
  const finish = (next: PointerEvent) => {
    if (next.pointerId !== event.pointerId) return;
    element.classList.remove("dragging");
    element.removeEventListener("pointermove", move);
    element.removeEventListener("pointerup", finish);
    element.removeEventListener("pointercancel", finish);
    if (moved) {
      commitHistory([]);
      setStatus(`moved reference “${ref.name}”`);
    }
  };
  element.addEventListener("pointermove", move);
  element.addEventListener("pointerup", finish);
  element.addEventListener("pointercancel", finish);
}

type ReferenceCorner = "nw" | "ne" | "se" | "sw";

function clampReferenceScale(ref: ReferenceImage, scale: number): number {
  const minDisplay = 24;
  const maxDisplay = Math.max(project.width, project.height) * 4;
  const minScale = minDisplay / Math.max(ref.width, ref.height);
  const maxScale = maxDisplay / Math.min(ref.width, ref.height);
  return Math.min(maxScale, Math.max(minScale, scale));
}

function beginReferenceResize(
  event: PointerEvent,
  element: HTMLElement,
  ref: ReferenceImage,
  corner: ReferenceCorner
) {
  try { element.setPointerCapture(event.pointerId); } catch { /* unsupported */ }
  element.classList.add("resizing");
  const startW = ref.width * ref.scale;
  const startH = ref.height * ref.scale;
  const fixed =
    corner === "nw" ? { x: ref.x + startW, y: ref.y + startH }
    : corner === "ne" ? { x: ref.x, y: ref.y + startH }
    : corner === "sw" ? { x: ref.x + startW, y: ref.y }
    : { x: ref.x, y: ref.y };
  let changed = false;

  const move = (next: PointerEvent) => {
    if (next.pointerId !== event.pointerId) return;
    const surface = surfaceRect();
    const world = screenToWorld(viewport, next.clientX - surface.left, next.clientY - surface.top);
    const frame = activeWorldRect();
    const fx = world.x - frame.x;
    const fy = world.y - frame.y;
    const dx = fx - fixed.x;
    const dy = fy - fixed.y;

    // Uniform aspect from the dragged corner: pick the scale that best
    // matches the cursor while keeping width/height ratio.
    const aspect = ref.width / Math.max(1, ref.height);
    let newW = Math.abs(dx);
    let newH = Math.abs(dy);
    if (newW / aspect > newH) newH = newW / aspect;
    else newW = newH * aspect;

    const scale = clampReferenceScale(ref, newW / Math.max(1, ref.width));
    newW = ref.width * scale;
    newH = ref.height * scale;

    if (corner === "se") {
      ref.x = fixed.x;
      ref.y = fixed.y;
    } else if (corner === "nw") {
      ref.x = fixed.x - newW;
      ref.y = fixed.y - newH;
    } else if (corner === "ne") {
      ref.x = fixed.x;
      ref.y = fixed.y - newH;
    } else {
      ref.x = fixed.x - newW;
      ref.y = fixed.y;
    }
    ref.scale = scale;
    changed = true;
    syncReferenceElement(element, ref);
  };
  const finish = (next: PointerEvent) => {
    if (next.pointerId !== event.pointerId) return;
    element.classList.remove("resizing");
    element.removeEventListener("pointermove", move);
    element.removeEventListener("pointerup", finish);
    element.removeEventListener("pointercancel", finish);
    if (changed) {
      commitHistory([]);
      setStatus(`resized reference “${ref.name}”`);
    }
  };
  element.addEventListener("pointermove", move);
  element.addEventListener("pointerup", finish);
  element.addEventListener("pointercancel", finish);
}

function duplicateActiveLayer() {
  const cont = activeContainer();
  const index = cont.getActiveLayerIndex();
  const afterId = cont.layers[index]?.id ?? null;
  const nextIndex = duplicateLayer(cont.layers, index, () => crypto.randomUUID());
  const copy = cont.layers[nextIndex];
  if (copy && copy.id !== afterId) noteRootLayerInserted(copy.id, afterId);
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
  if (!activeLayerIsEditable(true)) return;
  if (layer.kind === "raster") {
    const rasterCanvas = getRasterCanvas(layer);
    if (!rasterCanvas) { showToast("Layer still loading", "info"); return; }
    rasterCanvas.getContext("2d")!.clearRect(0, 0, rasterCanvas.width, rasterCanvas.height);
    markRasterEdited(layer);
    syncRasterToLayer(layer);
  }
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
  const active = cont.layers[index];
  const below = cont.layers[index - 1];
  if (active?.locked || below?.locked || activeContainerIsLocked()) {
    setStatus("Unlock both layers before merging");
    return;
  }
  if (active?.kind === "raster" && below?.kind === "raster") {
    if (!canMergeLayerDown(cont.layers, index)) {
      setStatus("Raster layers cannot merge with their current settings");
      return;
    }
    const activeCanvas = getRasterCanvas(active);
    const belowCanvas = getRasterCanvas(below);
    if (!activeCanvas || !belowCanvas) { showToast("Layer still loading", "info"); return; }
    belowCanvas.getContext("2d")!.drawImage(activeCanvas, 0, 0);
    markRasterEdited(below);
    syncRasterToLayer(below);
    const removedId = active.id;
    cont.layers.splice(index, 1);
    noteRootLayerRemoved(removedId);
    cont.setActiveLayerIndex(index - 1);
    selectedText = null;
    selectedSubPanelId = null;
    clearSelection();
    commitHistory([below]);
    buildLayers();
    buildInspector();
    setStatus("merged raster layer down");
    return;
  }
  const result = mergeLayerDown(cont.layers, index);
  if (!result.merged) {
    setStatus(result.reason === "no-below" ? "No layer below" : "Layer cannot merge down safely");
    return;
  }
  // mergeLayerDown splices the upper layer out; keep the root stack in sync.
  ensurePanelStack(activePanel());
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

function confirmAction(title: string, copy: string, confirmLabel = "Continue"): Promise<boolean> {
  const overlay = $("confirm-overlay");
  const titleEl = $("confirm-title");
  const copyEl = $("confirm-copy");
  const ok = $("confirm-ok") as HTMLButtonElement;
  const cancel = $("confirm-cancel") as HTMLButtonElement;
  titleEl.textContent = title;
  copyEl.textContent = copy;
  ok.textContent = confirmLabel;
  overlay.hidden = false;
  overlay.classList.add("open");
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      ok.onclick = null;
      cancel.onclick = null;
      overlay.onclick = null;
      window.removeEventListener("keydown", onKey);
      overlay.classList.remove("open");
      overlay.hidden = true;
      resolve(value);
    };
    ok.onclick = () => finish(true);
    cancel.onclick = () => finish(false);
    overlay.onclick = (event) => { if (event.target === overlay) finish(false); };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); finish(false); }
    };
    window.addEventListener("keydown", onKey);
    ok.focus();
  });
}

async function rasterizeActiveLayer() {
  const layer = activeLayer();
  if (!layer || layer.kind !== "draw") {
    setStatus("Only draw layers can be rasterized");
    return;
  }
  if (!activeLayerIsEditable(true)) return;
  if (!await confirmAction("Rasterize layer?", `“${layer.name}” will become pixels and vector editing will be lost.`, "Rasterize")) return;

  const baked = document.createElement("canvas");
  baked.width = project.width;
  baked.height = project.height;
  const bakedCtx = baked.getContext("2d")!;
  const sourceLayer: Layer = {
    ...layer,
    opacity: 1,
    blendMode: "normal",
    mask: undefined,
    clipToBelow: false,
  };
  const sourcePanel: Panel = { ...activePanel(), layers: [sourceLayer], subPanels: [] };
  renderPanel(bakedCtx, sourcePanel, 0, project.width, project.height, {
    skipBg: true,
    skipJitter: true,
    skipAnim: true,
    skipFills: false,
  });

  const raster = newLayer(layer.name, "raster", { width: project.width, height: project.height });
  raster.id = layer.id;
  raster.visible = layer.visible;
  raster.opacity = layer.opacity;
  raster.blendMode = layer.blendMode;
  raster.animation = layer.animation;
  installRasterCanvas(raster, baked);
  const cont = activeContainer();
  const index = cont.getActiveLayerIndex();
  cont.layers[index] = raster;
  commitHistory([raster]);
  buildLayers();
  buildInspector();
  setStatus(`rasterized ${raster.name}`);
}

function copyActiveLayerAnimation() {
  const anim = activeAnimationTarget()?.animation;
  if (!anim) return;
  animationClipboard = JSON.parse(JSON.stringify(anim)) as LayerAnimation;
  buildLayers();
  buildInspector();
  setStatus("copied layer animation");
}

function pasteAnimationToActiveLayer() {
  const target = activeAnimationTarget();
  if (!target || !animationClipboard) return;
  const group = selectedLayerGroup();
  if (group?.locked) {
    setStatus("Group is locked · unlock it before editing animation");
    return;
  }
  if (!group && !activeLayerIsEditable(true)) return;
  target.animation = JSON.parse(JSON.stringify(animationClipboard)) as LayerAnimation;
  commitHistory();
  buildTimeline();
  buildLayers();
  buildInspector();
  setStatus(`pasted animation to ${group ? subPanelLabel(group) : (target as Layer).name}`);
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

function ensureLayerAnimation(target: { animation?: LayerAnimation }): LayerAnimation {
  if (!target.animation) target.animation = defaultLayerAnimation();
  return target.animation;
}

function ensureNoiseDisplace(layer: Layer): LayerNoiseDisplace {
  if (!layer.noiseDisplace) layer.noiseDisplace = defaultNoiseDisplace();
  return layer.noiseDisplace;
}

/** Session-only: Apply/Clear also hit tone layers when true. */
let noiseDisplaceIncludeTone = false;

function armLayerKeyframe(which: "from" | "to") {
  const layer = activeLayer();
  if (!layer) return;
  if (!activeLayerIsEditable(true)) return;
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

type TimelineTab = "panels" | "anim" | "sequence";
type TimelineDockOverride = "auto" | "wide" | "tall";

let timelineTab: TimelineTab = "panels";
let timelineDockOverride: TimelineDockOverride = "auto";
/** Editor display/edit unit for timeline holds and rulers. Storage stays durationMs. */
let timelineTimeUnit: TimelineTimeUnit = "frames";
const expandedPanelAnnotations = new Set<string>();

function isSequenceTab(): boolean {
  return timelineTab === "sequence";
}

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
    if (liveRasterStroke) {
      liveRasterStroke.painter.append(pos, sample.pressure);
      markRasterEdited(liveRasterStroke.layer);
      invalidateBaseFrameCache();
    }
  }
}

function finishLiveStrokeSmoothing() {
  if (!liveSmoothingSession) return;
  appendSmoothedStrokeSamples(finishStrokeSmoothingSession(liveSmoothingSession));
}

canvas.addEventListener("pointerdown", (e) => {
  if (playing) return;
  notePenPointerActivity(e);
  e.preventDefault();
  if (selectedReferenceImageId) selectReferenceImage(null);
  requestLoopFrame();
  if (boardMoveToolActive) {
    const record = activeLibraryProjectId
      ? projectBoardRecords.find((item) => item.id === activeLibraryProjectId)
      : null;
    if (record) beginCanvasPlacement(e, activeProjectFrame, record, true);
    return;
  }
  if (shouldStartViewportPan(e)) {
    beginViewportPan(e);
    return;
  }
  const pos = canvasPos(e);

  // Select tool — universal mouse / picker. Priority: tail handle (when a
  // balloon/thought is selected) → text → sub-panel → deselect.
  if (currentBrush === SELECT_KEY) {
    const sps = frameSubPanels(activeStackContainer());
    if (selectedSubPanelId) {
      const sp = findSubPanelById(activePanel(), selectedSubPanelId) ?? sps.find(s => s.id === selectedSubPanelId);
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
      if (textHit.layer.locked || activeContainerIsLocked()) {
        selectedText = textHit;
        setStatus("Text layer is locked");
        buildInspector();
        return;
      }
      const alreadySelected = selectedText?.text === textHit.text;
      selectedText = textHit;
      selectDrag = {
        kind: "text", ref: textHit,
        offset: { x: pos.x - textHit.text.x, y: pos.y - textHit.text.y },
        origin: { x: pos.x, y: pos.y },
        alreadySelected,
      };
      try { canvas.setPointerCapture(e.pointerId); } catch {}
      buildInspector();
      return;
    }
    for (let i = sps.length - 1; i >= 0; i--) {
      if (isInsideSubPanel(pos.x, pos.y, sps[i])) {
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
    if (!activeLayerIsEditable(true)) return;
    if (selectionState?.mode === "object" && selectionState.phase === "idle") {
      const handle = hitTestTransformHandle(pos, selectionState.bounds, viewport.scale);
      if (handle) {
        // Always consume handle hits — never fall through to a new marquee.
        // The rotate knob sits outside the bounds rect, so a missed consume
        // previously cleared the selection and started a fresh drag.
        beginObjectSelectionTransform(handle, pos);
        try { canvas.setPointerCapture(e.pointerId); } catch {}
        return;
      }
      const b = selectionState.bounds;
      if (pos.x >= b.x && pos.x <= b.x + b.w && pos.y >= b.y && pos.y <= b.y + b.h) {
        transformSnapshots = snapshotItems(selectionState.items);
        selectionState = { ...selectionState, phase: "moving", lastPos: pos };
        try { canvas.setPointerCapture(e.pointerId); } catch {}
        return;
      }
      // Click outside bounds and handles — cancel selection before starting a new one.
      clearSelection();
      buildEditContext();
    }
    if (selectionState?.mode === "region" && selectionState.phase === "idle") {
      // On raster layers the marquee manipulates pixels directly: a handle grab
      // scales/rotates, a plain drag inside lifts and moves the selection. Both
      // promote the region to an object selection first. Alt-drag (and every
      // non-raster layer) keeps the classic behavior of moving just the mask.
      if (isManipulableRasterRegion(selectionState) && !e.altKey) {
        const handle = hitTestTransformHandle(pos, shapeBounds(selectionState.shape), viewport.scale);
        if (handle) {
          // Consume the handle hit even when promotion fails so clicking the
          // rotate circle above the box cannot start a brand-new marquee.
          beginObjectSelectionTransform(handle, pos);
          try { canvas.setPointerCapture(e.pointerId); } catch {}
          return;
        } else if (activeRegionContains(selectionState, pos)) {
          // promoteRegionSelection extracts the pixels and swaps selectionState
          // to an object selection; open the move gesture directly from the
          // returned items so this reads as one grab-and-drag.
          const items = promoteRegionSelection();
          if (items) {
            transformSnapshots = snapshotItems(items);
            const bounds = boundsFromItems(items, measureText);
            selectionState = {
              mode: "object",
              phase: "moving",
              shape: { kind: "rect", x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h },
              bounds,
              items,
              lastPos: pos,
            };
            try { canvas.setPointerCapture(e.pointerId); } catch {}
            buildEditContext();
            return;
          }
          // Promotion failed (empty / still decoding) — fall through to a
          // boundary move so the gesture still does something sensible.
        }
      }
      if (activeRegionContains(selectionState, pos)) {
        selectionState = { ...selectionState, phase: "moving", lastPos: pos };
        try { canvas.setPointerCapture(e.pointerId); } catch {}
        buildEditContext();
        return;
      }
    }
    const startShape = marqueeToolKind === "ellipse"
      ? ellipseFromDrag(pos, pos, e.shiftKey, e.altKey)
      : rectFromDrag(pos, pos, e.shiftKey, e.altKey);
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
    if (!activeLayerIsEditable(true)) return;
    let target = scaleToolItems();
    if (!target) return;
    const handle = hitTestTransformHandle(pos, target.bounds, viewport.scale);
    if (!handle) return;
    const rasterLayer = activeLayer()?.kind === "raster" ? activeLayer()! : null;
    if (rasterLayer && target.items.length === 0) {
      const rasterRef = rasterContentSelection(rasterLayer);
      if (!rasterRef) return;
      const bounds = boundsFromItems([rasterRef], measureText);
      selectionState = {
        mode: "object",
        phase: "idle",
        shape: { kind: "rect", ...bounds },
        bounds,
        items: [rasterRef],
      };
      target = { items: [rasterRef], bounds };
      beginObjectSelectionTransform(handle, pos);
      try { canvas.setPointerCapture(e.pointerId); } catch {}
      return;
    }
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
    if (!activeLayerIsEditable(true)) return;
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

  // Sub-panel / balloon tool: drag-create
  if (currentBrush === SUBPANEL_KEY || currentBrush === BALLOON_KEY) {
    subPanelDrag = { start: pos, end: pos };
    capturePointer(e);
    return;
  }

  // Cut Subpanel: drag a straight cut line across a frame
  if (currentBrush === CUT_SUBPANEL_KEY) {
    cutSubPanelDrag = { start: pos, end: pos };
    capturePointer(e);
    return;
  }

  // Text tool: click existing text to re-edit; otherwise place a new one.
  // Route into the sub-panel at the click point if the user is at panel root.
  if (currentBrush === TEXT_KEY) {
    maybeEnterSubPanelAt(pos);
    const textHit = hitTestText(pos);
    if (textHit) {
      selectedSubPanelId = null;
      selectedText = textHit;
      if (textHit.layer.locked || activeContainerIsLocked()) {
        setStatus("Text layer is locked");
        buildInspector();
        return;
      }
      openTextInputAt(pos, textHit);
      buildInspector();
      return;
    }
    if (!activeLayerIsEditable(true)) return;
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
  if (!activeLayerIsEditable(true)) return;
  // Text layers, and tone layers still set to full-bleed coverage, are
  // output-only; send paint tools to a real draw layer so an accidental
  // stroke cannot silently disappear. Painted-coverage tone layers accept
  // strokes directly (they commit through the normal liveStroke path — the
  // tone pattern is revealed by the mask at render time).
  const paintableTone = layer.kind === "tone" && layer.tone?.coverage === "painted";
  const gradientTone = currentBrush === GRADIENT_KEY && layer.kind === "tone";
  if (layer.kind !== "draw" && layer.kind !== "raster" && layer.kind !== undefined && !paintableTone && !gradientTone) {
    const c = activeContainer();
    const idx = c.layers.findIndex(l => (l.kind ?? "draw") === "draw" && l.visible && !l.locked);
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

  if (currentBrush === GRADIENT_KEY) {
    gradientDrag = { start: pos, end: pos, pointerId: e.pointerId };
    capturePointer(e);
    return;
  }

  if (isRadialBrushActive()) {
    mangaRadialDrag = { center: pos, edge: pos, pointerId: e.pointerId };
    capturePointer(e);
    return;
  }

  if (currentBrush === BUCKET_KEY) {
    const layer2 = activeLayer()!;
    if (layer2.kind === "raster") {
      const rasterCanvas = getRasterCanvas(layer2);
      if (!rasterCanvas) { showToast("Layer still loading", "info"); return; }
      const rasterCtx = rasterCanvas.getContext("2d")!;
      const image = rasterCtx.getImageData(0, 0, rasterCanvas.width, rasterCanvas.height);
      const beforeFill = new Uint8ClampedArray(image.data);
      if (floodFillImageData(image, pos.x, pos.y, currentColor, rasterCanvas.width, rasterCanvas.height, currentFillTolerance)) {
        if (regionClip) {
          const mask = rasterizeShapeMask(regionClip, rasterCanvas.width, rasterCanvas.height);
          const inverted = selectionState?.mode === "region" && !!selectionState.inverted;
          for (let pixel = 0; pixel < mask.length; pixel++) {
            const selected = inverted ? mask[pixel] === 0 : mask[pixel] !== 0;
            if (selected) continue;
            const offset = pixel * 4;
            image.data[offset] = beforeFill[offset];
            image.data[offset + 1] = beforeFill[offset + 1];
            image.data[offset + 2] = beforeFill[offset + 2];
            image.data[offset + 3] = beforeFill[offset + 3];
          }
        }
        rasterCtx.putImageData(image, 0, 0);
        markRasterEdited(layer2);
        syncRasterToLayer(layer2);
        commitHistory([layer2]);
      }
      return;
    }
    if (layer2.kind === "tone") {
      showToast(
        "Fills aren't supported on tone layers yet",
        "info"
      );
      return;
    }
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

  // Undo/redo may have cancelled the previous contact without Chromium ever
  // delivering its pointerup. A new pointerdown is itself proof of a fresh
  // contact, even when tablet drivers reuse the same pointer id.
  if (suppressStrokeUntilPointerUp !== null) suppressStrokeUntilPointerUp = null;

  drawing = true;
  drawingPointerId = e.pointerId;
  capturePointer(e);
  const c = activeContainer();
  liveStrokeLayer = layer;
  liveStrokeLayerIndex = c.getActiveLayerIndex();
  liveStrokeStrokeIndex = layer.strokes.length;
  liveStrokeSubPanelId = activeSubPanelPath.length
    ? activeSubPanelPath[activeSubPanelPath.length - 1]!
    : null;
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
    erase: transparentPaintSelected || brushByKey(currentBrush).erase === true,
    brushSettings: { ...currentBrushSettings },
    points: [applyPerspectiveSnap(pos)], pressures: [firstPressure],
  };
  if (layer.kind === "raster" && !beginLiveRasterStroke(
    layer,
    liveStroke,
    liveStroke.points[0],
    firstPressure
  )) {
    drawing = false;
    drawingPointerId = null;
    clearLiveStrokeState();
    return;
  }
});

canvas.addEventListener("pointermove", (e) => {
  notePenPointerActivity(e);
  const hoverPos = canvasPos(e);
  lastCanvasPointerPos = hoverPos;
  updateEraserCursorOverlay(e.clientX, e.clientY);
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
      const sp = findSubPanelById(activePanel(), drag.subPanelId);
      if (sp) {
        if (drag.kind === "move") {
          const nx = pos.x - drag.offset.x;
          const ny = pos.y - drag.offset.y;
          translateSubPanel(sp, nx - sp.bounds.x, ny - sp.bounds.y);
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
          ? ellipseFromDrag(start, pos, e.shiftKey, e.altKey)
          : rectFromDrag(start, pos, e.shiftKey, e.altKey);
        selectionState = { ...selectionState, lassoPath: [start, pos], shape };
      }
      return;
    }
    if (selectionState.phase === "moving" && selectionState.lastPos) {
      const dx = pos.x - selectionState.lastPos.x;
      const dy = pos.y - selectionState.lastPos.y;
      if (selectionState.mode === "region") {
        if (dx === 0 && dy === 0) return;
        selectionState = {
          ...selectionState,
          shape: translateShape(selectionState.shape, dx, dy),
          lastPos: pos,
        };
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
  if (cutSubPanelDrag) {
    cutSubPanelDrag.end = canvasPos(e);
    return;
  }
  if (mangaRadialDrag) {
    if (e.pointerId !== mangaRadialDrag.pointerId) return;
    mangaRadialDrag.edge = canvasPos(e);
    return;
  }
  if (gradientDrag) {
    if (e.pointerId !== gradientDrag.pointerId) return;
    gradientDrag.end = canvasPos(e);
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
  if (suppressStrokeUntilPointerUp === e.pointerId) suppressStrokeUntilPointerUp = null;
  // Commit any in-progress brush stroke first. Pointer-specific drags (selection
  // moving, scale, pan) must not steal the lift and orphan an uncommitted stroke.
  if (drawing && (drawingPointerId === null || e.pointerId === drawingPointerId)) {
    finishLiveStrokeSmoothing();
    if (liveStroke) commitLiveStroke();
    drawing = false;
    drawingPointerId = null;
    liveStrokeHasRealPressure = false;
    liveStrokeSyntheticPressureCount = 0;
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
    const drag = selectDrag;
    selectDrag = null;
    // Second click on already-selected text (no meaningful drag) opens the
    // inline editor — same expectation as the text tool.
    if (drag.kind === "text") {
      const pos = canvasPos(e);
      const moved = Math.hypot(pos.x - drag.origin.x, pos.y - drag.origin.y);
      const clickSlop = 4 / Math.max(0.001, viewport.scale);
      if (moved < clickSlop) {
        // Snap back in case a sub-pixel nudge slipped through.
        drag.ref.text.x = drag.origin.x - drag.offset.x;
        drag.ref.text.y = drag.origin.y - drag.offset.y;
        if (drag.alreadySelected) {
          openTextInputAt({ x: drag.ref.text.x, y: drag.ref.text.y }, drag.ref);
        }
        buildInspector();
        return;
      }
      commitHistory([drag.ref.layer]);
      buildInspector();
      return;
    }
    commitHistory([]);
    buildInspector();
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
      setStatus(activeLayer()?.kind === "raster"
        ? "Selection active · drag to move pixels · handles scale/rotate · ⌥-drag moves boundary · Esc to clear"
        : "Selection active · drag inside to move boundary · paint is clipped · Esc to clear");
      return;
    }
    if (selectionState.phase === "moving") {
      if (selectionState.mode === "object") {
        const touchedLayers = [...new Set(
          selectionState.items.filter(i => i.kind !== "subpanel").map(i => (i as { layer: Layer }).layer)
        )];
        syncRasterMarqueeItems(selectionState.items);
        transformSnapshots = null;
        selectionState = {
          mode: "object",
          phase: "idle",
          shape: selectionState.shape,
          bounds: selectionState.bounds,
          items: selectionState.items,
        };
        commitHistory(touchedLayers);
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
      const touchedLayers = [...new Set(
        selectionState.items.filter(i => i.kind !== "subpanel").map(i => (i as { layer: Layer }).layer)
      )];
      syncRasterMarqueeItems(selectionState.items);
      transformSnapshots = null;
      selectionState = {
        mode: "object",
        phase: "idle",
        shape: selectionState.shape,
        bounds: boundsFromItems(selectionState.items, measureText),
        items: selectionState.items,
      };
      commitHistory(touchedLayers);
      buildEditContext();
      updateCanvasCursor(lastCanvasPointerPos ?? undefined);
      return;
    }
  }
  if (currentBrush === SCALE_KEY && scaleToolDrag) {
    const touchedLayers = [...new Set(
      scaleToolDrag.items.filter(i => i.kind !== "subpanel").map(i => (i as { layer: Layer }).layer)
    )];
    syncRasterMarqueeItems(scaleToolDrag.items);
    scaleToolDrag = null;
    commitHistory(touchedLayers);
    updateCanvasCursor(lastCanvasPointerPos ?? undefined);
    return;
  }
  if (layerMoveDrag) {
    const drag = layerMoveDrag;
    const moved = drag.moved;
    const wasKeyframe = !!drag.keyframe;
    if (moved && !wasKeyframe) {
      const layersToMove = [drag.layer, ...drag.dependents];
      if (layersToMove.some((layer) => layer.kind === "raster" && !getRasterCanvas(layer))) {
        showToast("Layer still loading", "info");
        layerMoveDrag = null;
        return;
      }
      for (const layer of layersToMove) moveLayerContents(layer, drag.totalDx, drag.totalDy);
    }
    layerMoveDrag = null;
    if (moved) {
      commitHistory(wasKeyframe ? [] : [drag.layer, ...drag.dependents]);
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
    if (bw > 20 && bh > 20) {
      const shape = currentBrush === BALLOON_KEY ? pendingBalloonShape : pendingSubPanelShape;
      createSubPanel({ x: bx, y: by, w: bw, h: bh }, shape);
    }
    return;
  }
  if (mangaRadialDrag) {
    if (e.pointerId !== mangaRadialDrag.pointerId) return;
    const { center, edge } = mangaRadialDrag;
    mangaRadialDrag = null;
    commitMangaRadialStroke(center, edge);
    return;
  }
  if (gradientDrag) {
    if (e.pointerId !== gradientDrag.pointerId) return;
    const { start, end } = gradientDrag;
    gradientDrag = null;
    commitGradient(start, end);
    return;
  }
  if (cutSubPanelDrag) {
    const { start, end } = cutSubPanelDrag;
    cutSubPanelDrag = null;
    if (Math.hypot(end.x - start.x, end.y - start.y) > 8) {
      applyCutSubPanel(start, end);
    }
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
  liveStrokeSyntheticPressureCount = 0;
  clearLiveStrokeState();
});

window.addEventListener("pointercancel", (e) => {
  if (suppressStrokeUntilPointerUp === e.pointerId) suppressStrokeUntilPointerUp = null;
  if (perspectiveDrag && e.pointerId === perspectiveDrag.pointerId) {
    perspectiveDrag = null;
    commitHistory([]);
    return;
  }
  if (selectionState?.mode === "object" &&
      selectionState.phase !== "idle" &&
      transformSnapshots) {
    for (const snapshot of transformSnapshots) restoreFromSnapshot(snapshot);
    bumpMarqueeItemLayers(selectionState.items);
    transformSnapshots = null;
    selectionState = {
      mode: "object",
      phase: "idle",
      shape: selectionState.shape,
      bounds: boundsFromItems(selectionState.items, measureText),
      items: selectionState.items,
    };
    buildEditContext();
    return;
  }
  if (scaleToolDrag) {
    for (const snap of scaleToolDrag.snapshots) restoreFromSnapshot(snap);
    bumpMarqueeItemLayers(scaleToolDrag.items);
    scaleToolDrag = null;
    return;
  }
  if (cutSubPanelDrag) {
    cutSubPanelDrag = null;
    return;
  }
  if (subPanelDrag) {
    subPanelDrag = null;
    return;
  }
  if (mangaRadialDrag) {
    mangaRadialDrag = null;
    return;
  }
  if (gradientDrag) {
    gradientDrag = null;
    return;
  }
  if (!drawing) return;
  if (drawingPointerId !== null && e.pointerId !== drawingPointerId) return;
  if (liveRasterStroke) {
    rollbackLiveRasterStroke();
  } else {
    finishLiveStrokeSmoothing();
    if (liveStroke) commitLiveStroke();
  }
  drawing = false;
  drawingPointerId = null;
  liveStrokeHasRealPressure = false;
  liveStrokeSyntheticPressureCount = 0;
  clearLiveStrokeState();
});

function hasLiveEditorInteraction(): boolean {
  return drawing ||
    !!liveStroke ||
    !!selectDrag ||
    !!layerMoveDrag ||
    !!subPanelDrag ||
    !!cutSubPanelDrag ||
    !!mangaRadialDrag ||
    !!gradientDrag ||
    !!perspectiveDrag ||
    !!scaleToolDrag ||
    selectionState?.phase === "creating" ||
    selectionState?.phase === "moving" ||
    selectionState?.phase === "transforming";
}

// Double-click: edit text under the cursor, else enter a sub-panel / exit.
canvas.addEventListener("dblclick", (e) => {
  if (playing) return;
  const pos = canvasPos(e);
  if (currentBrush === SELECT_KEY || currentBrush === TEXT_KEY) {
    // Second click of a double-click already opened the editor on pointerup.
    if (activeTextInput) return;
    const textHit = hitTestText(pos);
    if (textHit) {
      selectedSubPanelId = null;
      selectedText = textHit;
      if (textHit.layer.locked || activeContainerIsLocked()) {
        setStatus("Text layer is locked");
        buildInspector();
        return;
      }
      openTextInputAt({ x: textHit.text.x, y: textHit.text.y }, textHit);
      buildInspector();
      return;
    }
  }
  const sps = frameSubPanels(activeStackContainer());
  for (let i = sps.length - 1; i >= 0; i--) {
    if (isInsideSubPanel(pos.x, pos.y, sps[i])) {
      enterChildSubPanel(sps[i].id);
      clearSelection();
      buildBreadcrumb();
      buildLayers();
      buildInspector();
      buildEditContext();
      return;
    }
  }
  if (activeSubPanelPath.length) {
    popActiveSubPanel();
    clearSelection();
    buildBreadcrumb();
    buildLayers();
    buildInspector();
    buildEditContext();
  }
});

// Single click on a child sub-panel = select for inspector (scoped to current container).
canvas.addEventListener("click", (e) => {
  if (playing) return;
  if (TOOL_KEYS.has(currentBrush)) return;
  const pos = canvasPos(e);
  const sps = frameSubPanels(activeStackContainer());
  for (let i = sps.length - 1; i >= 0; i--) {
    if (isInsideSubPanel(pos.x, pos.y, sps[i])) {
      selectedSubPanelId = sps[i].id;
      buildInspector();
      return;
    }
  }
  if (selectedSubPanelId) { selectedSubPanelId = null; buildInspector(); }
});

// ---- viewport controls ----------------------------------------------------

stageArea.addEventListener("wheel", (e) => {
  e.preventDefault();
  markStylusPressureInterrupt();
  const rect = surfaceRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;
  const nextScale = viewport.scale * Math.exp(-e.deltaY * 0.0015);
  viewport = zoomAbout(viewport, nextScale, sx, sy);
  applyViewport();
  // Resize the eraser ring to the new zoom under the (stationary) pointer.
  updateEraserCursorOverlay(e.clientX, e.clientY);
}, { passive: false });

// Drop the eraser ring when the pointer leaves the canvas so it doesn't hang
// frozen at the edge (pointermove stops firing once the pointer is outside).
canvas.addEventListener("pointerleave", hideEraserCursorOverlay);

function zoomStep(multiplier: number) {
  markStylusPressureInterrupt();
  const rect = surfaceRect();
  viewport = zoomAbout(viewport, viewport.scale * multiplier, rect.width / 2, rect.height / 2);
  applyViewport();
}

($("zoom-out") as HTMLButtonElement).onclick = () => zoomStep(0.8);
($("zoom-in") as HTMLButtonElement).onclick = () => zoomStep(1.25);
($("zoom-label") as HTMLButtonElement).onclick = () => resetViewport();
($("zoom-fit") as HTMLButtonElement).onclick = () => fitViewport();
($("tiktok-overlay-toggle") as HTMLButtonElement).onclick = toggleTikTokOverlay;
syncTikTokOverlayToggle();

for (const id of ["tiktok-overlay-toggle", "zoom-out", "zoom-label", "zoom-in", "zoom-fit"]) {
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

function openTextInputAt(pos: { x: number; y: number }, existing?: TextRef) {
  // One editor at a time — dropping a stale overlay avoids stacked editors if
  // the user clicks again while typing.
  if (activeTextInput) {
    activeTextInput.blur();
    if (activeTextInput) {
      activeTextInput.remove();
      activeTextInput = null;
    }
  }

  const editing = existing?.text;
  const fontFamily = editing?.fontFamily ?? currentFont;
  const fontSize = editing?.fontSize ?? currentFontSize;
  const color = editing?.color ?? currentColor;
  // TextElements store top-left; new placements use the click as a near-baseline
  // anchor (see addTextElement). Position the overlay on the glyph box itself.
  const anchor = editing
    ? { x: editing.x, y: editing.y }
    : { x: pos.x, y: pos.y - fontSize * 0.8 };
  const r = canvas.getBoundingClientRect();
  const sx = r.left + ((anchor.x + overscanX) / canvas.width) * r.width;
  const sy = r.top + ((anchor.y + overscanY) / canvas.height) * r.height;
  const left = Math.max(8, Math.min(sx, window.innerWidth - 196));
  const width = Math.max(180, Math.min(320, window.innerWidth - left - 16));
  const input = document.createElement("textarea");
  input.rows = 1;
  input.placeholder = "Type text…  ⌘/Ctrl+Enter to finish";
  input.autocomplete = "off";
  input.spellcheck = false;
  if (editing) input.value = editing.content;
  // Light paper fill — the old near-black fill made typical ink colors invisible.
  input.style.cssText = `
    position: fixed; left: ${left}px; top: ${Math.min(sy, window.innerHeight - 64)}px; z-index: 70;
    font-family: ${fontFamilyCss(fontFamily)};
    font-size: ${Math.max(12, fontSize * (r.width / canvas.width))}px;
    line-height: 1.2; white-space: pre-wrap; resize: none; overflow: hidden;
    color: ${color};
    caret-color: ${color};
    background: rgba(255, 253, 249, 0.94);
    border: 2px solid var(--accent);
    border-radius: 6px; padding: 4px 8px;
    outline: none; width: ${width}px;
    min-width: 180px; min-height: 1.2em; max-width: 560px;
    box-shadow: 0 4px 20px rgba(40, 32, 24, 0.18);
  `;
  document.body.appendChild(input);
  activeTextInput = input;

  // Hide the canvas copy while editing so glyphs aren't double-drawn under the
  // overlay. Restored on cancel; replaced on commit.
  const previousContent = editing?.content ?? "";
  if (editing) {
    editing.content = "";
    bumpLayerVersion(existing!.layer);
  }

  const resize = () => {
    input.style.height = "auto";
    const availableHeight = window.innerHeight - input.getBoundingClientRect().top - 16;
    input.style.height = `${Math.max(32, Math.min(input.scrollHeight, availableHeight))}px`;
    input.style.overflowY = input.scrollHeight > input.clientHeight ? "auto" : "hidden";
  };
  let committed = false;
  const cleanup = () => {
    if (input.parentNode) input.remove();
    if (activeTextInput === input) activeTextInput = null;
  };
  const commit = () => {
    if (committed) return;
    committed = true;
    const content = input.value;
    cleanup();
    if (editing && existing) {
      if (content.trim()) {
        editing.content = content;
        selectedText = existing;
        commitHistory([existing.layer]);
      } else {
        // Empty commit deletes the element (same as clearing in the inspector).
        const idx = existing.layer.texts?.indexOf(editing) ?? -1;
        if (idx >= 0) existing.layer.texts!.splice(idx, 1);
        if (selectedText?.text === editing) selectedText = null;
        commitHistory([existing.layer]);
        buildLayers();
      }
      buildInspector();
      return;
    }
    if (content.trim()) addTextElement(pos, content);
  };
  const cancel = () => {
    if (committed) return;
    committed = true;
    if (editing) {
      editing.content = previousContent;
      bumpLayerVersion(existing!.layer);
    }
    cleanup();
  };

  // Defer focus past the originating click so the just-completed pointerup
  // doesn't blur us out before the user can type. Without this, Electron in
  // particular tends to refocus the canvas after the click, blur-committing
  // the empty input.
  setTimeout(() => {
    if (committed || !input.parentNode) return;
    input.focus();
    if (editing) {
      const end = input.value.length;
      input.setSelectionRange(end, end);
    }
    resize();
  }, 0);

  input.addEventListener("keydown", (ev) => {
    ev.stopPropagation();
    if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey)) {
      ev.preventDefault();
      commit();
    }
    else if (ev.key === "Escape") { cancel(); }
  });
  input.addEventListener("input", resize);
  // New text: empty blur cancels. Re-edit: blur always commits (empty deletes).
  input.addEventListener("blur", () => {
    if (editing) commit();
    else if (input.value.trim().length > 0) commit();
    else cancel();
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

function applySubPanelShapeDefaults(sp: SubPanel, shape: SubPanelShape) {
  if (shape !== "custom") {
    delete sp.points;
  } else if (!sp.points || sp.points.length < 3) {
    applyCustomOutline(sp, subPanelOutline({ ...sp, shape: sp.shape === "custom" ? "rect" : sp.shape }));
    return;
  }
  sp.shape = shape;
  if ((shape === "balloon" || shape === "thought") && !sp.tail) {
    sp.tail = { x: sp.bounds.x + sp.bounds.w / 2, y: sp.bounds.y + sp.bounds.h + 80 };
  }
  if (isBalloonShape(shape) && sp.bg == null) {
    sp.bg = "#ffffff";
  }
}

function createSubPanel(bounds: { x: number; y: number; w: number; h: number }, shape: SubPanelShape) {
  // Use the current draw brush for the border; fall back to "round".
  const brush = TOOL_KEYS.has(currentBrush) ? "round" : currentBrush;
  const panel = activePanel();
  if (countSubPanels(panel) >= MAX_SUBPANELS_PER_PANEL) {
    setStatus(`Sub-panel limit reached (${MAX_SUBPANELS_PER_PANEL})`);
    return;
  }
  if (activeSubPanelPath.length >= MAX_SUBPANEL_DEPTH) {
    setStatus(`Sub-panel nesting depth limit reached (${MAX_SUBPANEL_DEPTH})`);
    return;
  }
  const sp = newSubPanel(bounds, {
    brush,
    color: currentColor,
    thickness: Math.max(2, currentSize),
    wiggleAmplitude: 2,
  });
  applySubPanelShapeDefaults(sp, shape);
  const container = activeStackContainer();
  if (!container.subPanels) container.subPanels = [];
  container.subPanels.push(sp);
  stackInsertSubPanel(container, sp.id);
  // Auto-enter the freshly-created sub-panel so the next stroke / fill / text
  // lands inside it. Click an ancestor breadcrumb to go back out.
  enterChildSubPanel(sp.id);
  commitHistory();
  buildBreadcrumb();
  buildLayers();
  buildInspector();
}

/**
 * Auto-enter the topmost child sub-panel containing `pos` under the current
 * container. Works at every nesting level.
 */
function maybeEnterSubPanelAt(pos: { x: number; y: number }): boolean {
  if (activeSubPanelPath.length >= MAX_SUBPANEL_DEPTH) return false;
  const sps = frameSubPanels(activeStackContainer());
  for (let i = sps.length - 1; i >= 0; i--) {
    if (isInsideSubPanel(pos.x, pos.y, sps[i]) && containerHasUnlockedLayer(sps[i])) {
      enterChildSubPanel(sps[i].id);
      buildBreadcrumb();
      buildLayers();
      buildInspector();
      return true;
    }
  }
  return false;
}

function findCutTargetSubPanel(a: { x: number; y: number }, b: { x: number; y: number }): SubPanel | null {
  const sps = frameSubPanels(activeStackContainer());
  if (selectedSubPanelId) {
    const selected = sps.find((s) => s.id === selectedSubPanelId);
    if (selected && lineCrossesSubPanel(selected, a, b)) return selected;
  }
  for (let i = sps.length - 1; i >= 0; i--) {
    if (lineCrossesSubPanel(sps[i], a, b)) return sps[i];
  }
  return null;
}

function applyCutSubPanel(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  const panel = activePanel();
  if (panel.kind === "timelapse") {
    setStatus("Cannot cut sub-panels on a timelapse frame");
    return false;
  }
  if (countSubPanels(panel) >= MAX_SUBPANELS_PER_PANEL) {
    setStatus(`Sub-panel limit reached (${MAX_SUBPANELS_PER_PANEL})`);
    return false;
  }
  const target = findCutTargetSubPanel(a, b);
  if (!target) {
    setStatus("Cut must cross a sub-panel once");
    return false;
  }
  const cut = cutSubPanelGeometry(target, a, b);
  if (!cut) {
    setStatus("Cut must cross a sub-panel once");
    return false;
  }
  const container = parentContainerOf(panel, target.id) ?? activeStackContainer();
  applyCustomOutline(target, cut.first);
  const created = regenerateSubPanelIds(target, () => crypto.randomUUID());
  applyCustomOutline(created, cut.second);
  if (!container.subPanels) container.subPanels = [];
  container.subPanels.push(created);
  stackInsertSubPanel(container, created.id);
  selectedSubPanelId = created.id;
  commitHistory();
  buildBreadcrumb();
  buildLayers();
  buildInspector();
  setStatus("Sub-panel cut · delete the piece you don't want");
  return true;
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
  ctx.fillRect(overscanX, overscanY, project.width, project.height);
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
  // Temporarily append the in-progress erase to the layer, then bump its
  // version so the layer signature (which hashes every stroke) recomputes and
  // the raw-layer cache stores THIS layer's with-erase bitmap under a fresh
  // key. Every other layer keeps its version, so it renders from cache instead
  // of restamping — per-frame cost stays O(active layer) rather than O(panel).
  // The post-pop bump restores a truthful signature for the popped-back state
  // so no later render can serve the with-erase bitmap after the drag ends.
  liveStrokeLayer.strokes.push(...segments);
  bumpLayerVersion(liveStrokeLayer);
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
        renderCache: displayRenderCache,
        contentVersion: renderContentVersion,
        deferFillMasks: true,
        skipFillMaskCache: true,
      });
    }
  } finally {
    liveStrokeLayer.strokes.splice(insertAt, segments.length);
    bumpLayerVersion(liveStrokeLayer);
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
    ? findSubPanelById(panel, liveStrokeSubPanelId)
    : undefined;

  ctx.save();
  ctx.beginPath();
  ctx.rect(overscanX, overscanY, project.width, project.height);
  ctx.clip();
  if (overscanX > 0 || overscanY > 0) ctx.translate(overscanX, overscanY);

  let bg = panel.bg;
  let subPanelShapePoints: Vec2[] | null = null;
  if (sp && !sp.group) {
    subPanelShapePoints = subPanelOutline(sp);
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
  if (sp && !sp.group) ctx.restore();
  if (sp && !sp.group && subPanelShapePoints) {
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

// The eraser cursor is a DOM overlay positioned directly from pointer events,
// not painted into the canvas. That keeps it tracking the pointer at input rate
// even while the canvas render loop is idling at the wiggle tick rate (which is
// why a canvas-painted ring lagged on hover).
const eraserCursorEl = document.createElement("div");
eraserCursorEl.className = "eraser-cursor";
eraserCursorEl.setAttribute("aria-hidden", "true");
stageArea.appendChild(eraserCursorEl);

function hideEraserCursorOverlay() {
  eraserCursorEl.style.display = "none";
}

/** Shows and positions the eraser ring at the given screen coordinates, sized
 *  to the erased radius at the current zoom. Hides it when the eraser isn't the
 *  effective tool or the canvas is otherwise busy (playback / panning). */
function updateEraserCursorOverlay(clientX: number, clientY: number) {
  const erasing = drawing && liveStroke &&
    isEraseBrushKey(liveStroke.brush, liveStroke.erase === true);
  const hovering = !drawing && isEraseBrushKey(currentBrush);
  if ((!erasing && !hovering) || playing || panDrag || spacePanDown) {
    hideEraserCursorOverlay();
    return;
  }
  const areaRect = stageArea.getBoundingClientRect();
  // canvas.offsetWidth is the CSS layout size before the zoom transform, so
  // (offsetWidth / canvas.width) converts frame pixels to CSS pixels; the live
  // viewport scale then accounts for zoom.
  const cssPerFramePx = canvas.offsetWidth ? canvas.offsetWidth / canvas.width : 1;
  const brushSize = liveStroke?.size ?? currentSize;
  const diameter = 2 * eraserPreviewRadius(brushSize) * cssPerFramePx * viewport.scale;
  eraserCursorEl.style.display = "block";
  eraserCursorEl.style.width = `${diameter}px`;
  eraserCursorEl.style.height = `${diameter}px`;
  eraserCursorEl.style.left = `${clientX - areaRect.left}px`;
  eraserCursorEl.style.top = `${clientY - areaRect.top}px`;
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
    shape = selectionState.shape;
    b = shapeBounds(shape);
  } else if (selectionState.mode === "object") {
    b = selectionState.bounds;
    shape = { kind: "rect", x: b.x, y: b.y, w: b.w, h: b.h };
  } else {
    shape = selectionState.shape;
    b = shapeBounds(shape);
  }

  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.95)";
  ctx.setLineDash([]);
  ctx.lineWidth = 2;
  ctx.beginPath();
  traceShapePath(ctx, shape);
  ctx.stroke();
  ctx.strokeStyle = "rgba(0,0,0,0.95)";
  ctx.setLineDash([6, 6]);
  ctx.lineDashOffset = -antsOffset;
  ctx.lineWidth = 2;
  ctx.beginPath();
  traceShapePath(ctx, shape);
  ctx.stroke();
  ctx.setLineDash([]);

  const showTransformHandles = currentBrush === MARQUEE_KEY && (
    (selectionState.mode === "object" &&
      (selectionState.phase === "idle" || selectionState.phase === "transforming")) ||
    isManipulableRasterRegion(selectionState)
  );
  if (showTransformHandles) {
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

function drawTikTokOverlayInCanvasSpace() {
  if (!tiktokOverlayEnabled) return;
  ctx.save();
  if (overscanX > 0 || overscanY > 0) ctx.translate(overscanX, overscanY);
  drawTikTokOverlay(ctx, project.width, project.height);
  ctx.restore();
}

// ---- three clocks ---------------------------------------------------------

let wiggleTick = 0;
let lastWiggle = 0;
let lastPlaybackRenderPanelIndex = -1;
let lastPlaybackRenderSeqTick = -1;
let lastSyncedThumbIndex = -1;

/** Synchronous idle paint of the active panel into `#stage`. Used on board
 *  project switches so the live canvas has pixels before its preview card is
 *  removed — the idle rAF loop often won't draw until the next wiggle tick. */
function paintActivePanelNow() {
  const panel = activePanel();
  if (onionEnabled && panel.kind !== "timelapse") {
    drawEditorPanelWithOnion(panel, "session-swap-active");
  } else {
    profileRender("session-swap", () => renderPanel(ctx, panel, wiggleTick, project.width, project.height, {
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
  drawTikTokOverlayInCanvasSpace();
  editorPreviewInvalidated = false;
}

// The rAF loop used to re-arm itself unconditionally forever — a permanent
// ~60Hz JS wakeup even with the app idle in the background. `requestLoopFrame`
// is the single entry point that schedules the next `loop()` call; anything
// that changes what's on screen (a commit, a drag, playback, a viewport
// change, the wiggle clock ticking) must call it. `loop()` itself re-arms
// only while something needs continuous frames (playback, a live drag,
// pending thumbnail work, marching ants on a selection) — see the bottom of
// the function.
let loopArmed = false;
function requestLoopFrame() {
  if (loopArmed) return;
  loopArmed = true;
  requestAnimationFrame(loop);
}

// The wiggle clock used to advance purely by the rAF loop polling elapsed
// time every frame, ~60x/s even between ticks. Instead, a setInterval at the
// project's wiggle rate wakes the loop only when a tick is actually due;
// `loop()`'s own elapsed-time check (below) still derives the tick from
// `now`, so playback/determinism math is untouched — this only changes how
// often the loop is woken, not how it computes time.
let wiggleIntervalId: ReturnType<typeof setInterval> | null = null;
let wiggleIntervalFps = -1;
// When surveying the board (the active project is a distant thumbnail and we're
// not playing or drawing), the live wiggle is barely perceptible, so we wake the
// render loop far less often. The clock catches up from elapsed time below, so
// only the redraw cadence changes, not playback timing or determinism.
const BOARD_OVERVIEW_FPS = 4;
function effectiveWiggleFps(): number {
  if (boardOverview && !playing && !drawing) {
    return Math.min(project.wiggleFps, BOARD_OVERVIEW_FPS);
  }
  return project.wiggleFps;
}
function ensureWiggleInterval() {
  const fps = effectiveWiggleFps();
  if (wiggleIntervalFps === fps) return;
  if (wiggleIntervalId !== null) clearInterval(wiggleIntervalId);
  wiggleIntervalFps = fps;
  wiggleIntervalId = setInterval(() => requestLoopFrame(), 1000 / fps);
}

function loop(now: number) {
  loopArmed = false;
  ensureWiggleInterval();
  if (perfEnabled) perfState.frames++;
  const clock = advanceDiscreteClock(wiggleTick, lastWiggle, now, project.wiggleFps);
  const advancedTicks = clock.tick - wiggleTick;
  wiggleTick = clock.tick;
  lastWiggle = clock.lastMs;
  const tickChanged = clock.changed;
  if (perfEnabled) perfState.wiggleTicks += advancedTicks;

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
      const seqPos = sequenceTransitionAtTime(project, visualMs);
      lastSequencePosition = seqPos;
      const { index, localMs } = seqPos;
      activePanelIndex = index;
      const panel = project.panels[index];
      const seqTick = Math.floor((localMs / 1000) * project.wiggleFps);
      if (editorPreviewInvalidated || shouldRenderPlaybackFrame({
        panelIndex: index,
        seqTick,
        lastPanelIndex: lastPlaybackRenderPanelIndex,
        lastSeqTick: lastPlaybackRenderSeqTick,
        continuous: panelHasPlaybackContinuity(panel) || !!seqPos.transition,
      })) {
        profileRender("playback-main", () => renderSequenceFrame(ctx, project, visualMs, {
          skipJitter: !jitterEnabled,
          overscan: { x: overscanX, y: overscanY },
          overscanDim: 1,
          renderCache: displayRenderCache,
          contentVersion: renderContentVersion,
        }, seqPos));
        drawTikTokOverlayInCanvasSpace();
        editorPreviewInvalidated = false;
        lastPlaybackRenderPanelIndex = index;
        lastPlaybackRenderSeqTick = seqTick;
      }
      syncActiveThumb();
      updatePlayheadChrome();
    }
  }
  const liveInteraction = hasLiveEditorInteraction();
  if (!playing && shouldRenderIdleFrame({
    tickChanged,
    interacting: liveInteraction || !!selectionState || editorPreviewInvalidated,
  })) {
    const panel = activePanel();
    if (drawing && liveStroke) {
      if (liveRasterStroke) {
        if (onionEnabled && panel.kind !== "timelapse") {
          drawEditorPanelWithOnion(panel, "live-raster-active");
        } else {
          paintEditorPanelBackground(panel);
          drawEditorActiveContent(panel, "live-raster");
        }
      } else if (isEraseBrushKey(liveStroke.brush, liveStroke.erase === true)) {
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
    if (cutSubPanelDrag) {
      const { start, end } = cutSubPanelDrag;
      ctx.save();
      ctx.strokeStyle = "rgba(255,125,87,0.95)";
      ctx.setLineDash([6, 4]);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(start.x, start.y, 4, 0, Math.PI * 2);
      ctx.arc(end.x, end.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,125,87,0.95)";
      ctx.fill();
      ctx.restore();
    }
    if (mangaRadialDrag) {
      const { center, edge } = mangaRadialDrag;
      const radius = Math.hypot(edge.x - center.x, edge.y - center.y);
      ctx.save();
      ctx.strokeStyle = "rgba(255,125,87,0.9)";
      ctx.setLineDash([8, 5]);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(center.x, center.y, Math.max(radius, 1), 0, Math.PI * 2);
      ctx.stroke();
      if (radius >= MANGA_RADIAL_MIN_RADIUS) {
        const brush = brushByKey(currentBrush);
        const settings = effectiveBrushSettings(brush.spacing, currentSize, currentBrushSettings);
        const c = activeContainer();
        const layerIndex = c.getActiveLayerIndex();
        const strokeIndex = activeLayer()?.strokes.length ?? 0;
        brush.stamp({
          ctx,
          pos: center,
          delta: { x: edge.x - center.x, y: edge.y - center.y },
          color: currentColor,
          size: settings.stampSize(currentSize, 1),
          tick: 0,
          seed: strokeIndex + layerIndex * 10000,
          bg: activePanel().bg,
          flow: settings.stampFlow(1),
          radialRadius: radius,
        });
      }
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(255,125,87,0.95)";
      ctx.beginPath();
      ctx.arc(center.x, center.y, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    if (gradientDrag) {
      const { start, end } = gradientDrag;
      const radius = Math.hypot(end.x - start.x, end.y - start.y);
      ctx.save();
      ctx.strokeStyle = "rgba(255,125,87,0.95)";
      ctx.fillStyle = "rgba(255,125,87,0.95)";
      ctx.setLineDash([7, 5]);
      ctx.lineWidth = 2;
      ctx.beginPath();
      if (currentGradientKind === "radial") ctx.arc(start.x, start.y, Math.max(1, radius), 0, Math.PI * 2);
      else { ctx.moveTo(start.x, start.y); ctx.lineTo(end.x, end.y); }
      ctx.stroke();
      ctx.setLineDash([]);
      for (const point of [start, end]) {
        ctx.beginPath(); ctx.arc(point.x, point.y, 4, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }
    antsOffset = marqueeAntsOffset(now);
    drawPerspectiveOverlay(ctx);
    drawMaskOverlay(ctx);
    drawSelectionOverlay(ctx);
    drawScaleToolOverlay(ctx);
    drawStabilizerLeashOverlay(ctx);

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
      const sp = selectedSubPanelId
        ? findSubPanelById(activePanel(), selectedSubPanelId)
        : null;
      if (sp && !sp.group) {
        ctx.save();
        ctx.strokeStyle = "rgba(255,205,117,0.9)";
        ctx.setLineDash([8, 4]);
        ctx.lineWidth = 2;
        const outline = subPanelOutline(sp);
        ctx.beginPath();
        ctx.moveTo(outline[0].x, outline[0].y);
        for (let i = 1; i < outline.length; i++) ctx.lineTo(outline[i].x, outline[i].y);
        ctx.closePath();
        ctx.stroke();
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

    // Platform chrome is drawn last so it matches how TikTok covers the post.
    if (tiktokOverlayEnabled) drawTikTokOverlay(ctx, project.width, project.height);

    if (overscanX > 0 || overscanY > 0) ctx.restore();
    editorPreviewInvalidated = false;
  }

  // Timeline thumbnails are static previews; refresh only when content changed.
  if (dirtyThumbnailPanelIds.size > 0) refreshThumbnails();

  trimFramePool();

  // Re-arm only while something needs continuous frames. Wiggle ticking is
  // covered separately by `ensureWiggleInterval`'s setInterval, which calls
  // `requestLoopFrame` when the next tick is due — it doesn't need this loop
  // to keep spinning between ticks.
  const needsContinuousFrames =
    playing ||
    liveInteraction ||
    drawing ||
    dirtyThumbnailPanelIds.size > 0 ||
    !!selectionState; // marching ants animate on every idle repaint
  if (needsContinuousFrames) requestLoopFrame();
}
requestLoopFrame();

// ---- UI: brushes / palette / layers / timeline / inspector / breadcrumb ---

/** Keep currentBrush compatible with the active layer; park/restore raster-only. */
function syncBrushAvailability(announce = true): boolean {
  if (TOOL_KEYS.has(currentBrush)) return false;
  const layerKind = activeLayer()?.kind ?? null;

  if (
    layerKind === "raster" &&
    deferredRasterBrush &&
    isBrushKeyAvailable(deferredRasterBrush, "raster")
  ) {
    if (currentBrush !== deferredRasterBrush) {
      currentBrush = deferredRasterBrush;
      if (announce) setStatus(`Restored ${brushByKey(deferredRasterBrush).label}`);
    }
    deferredRasterBrush = null;
    return true;
  }

  const resolved = resolveBrushForLayer(currentBrush, layerKind);
  if (!resolved.changed) return false;
  const previous = BRUSHES.find((b) => b.key === currentBrush);
  if (previous?.rasterOnly) deferredRasterBrush = currentBrush;
  currentBrush = resolved.brush.key;
  if (announce && resolved.reason) setStatus(resolved.reason);
  return true;
}

/** Krita-inspired brushes are raster-only. Selecting one from a draw/tone layer
 *  should land on a raster layer rather than looking like the brush "failed to load". */
function ensureActiveRasterLayer(announce = true): boolean {
  const cont = activeContainer();
  if (cont.layers[cont.getActiveLayerIndex()]?.kind === "raster") return false;
  const existing = cont.layers.findIndex((layer) => layer.kind === "raster");
  if (existing >= 0) {
    cont.setActiveLayerIndex(existing);
    if (announce) setStatus(`Switched to “${cont.layers[existing].name}” for raster brushes`);
    return true;
  }
  const raster = newLayer("Raster", "raster", { width: project.width, height: project.height });
  cont.layers.push(raster);
  noteRootLayerInserted(raster.id);
  cont.setActiveLayerIndex(cont.layers.length - 1);
  getRasterCanvas(raster);
  commitHistory();
  if (announce) setStatus("Added a raster layer for Krita-style brushes");
  return true;
}

function selectBrushKey(key: string) {
  const brush = BRUSHES.find((entry) => entry.key === key);
  let layerChanged = false;
  if (brush?.rasterOnly) layerChanged = ensureActiveRasterLayer(true);
  currentBrush = key;
  if (!TOOL_KEYS.has(key)) lastBrushByTool[brushToolForKey(key)] = key;
  deferredRasterBrush = null;
  if (layerChanged) {
    buildLayers();
    buildInspector();
  }
}

function buildBrushBar() {
  syncBrushAvailability(true);
  canvas.classList.toggle("select-cursor", currentBrush === SELECT_KEY || currentBrush === MOVE_LAYER_KEY || currentBrush === SCALE_KEY);
  canvas.classList.toggle("marquee-cursor", currentBrush === MARQUEE_KEY);
  canvas.classList.toggle("cut-subpanel-cursor", currentBrush === CUT_SUBPANEL_KEY);
  const drawTools = $("tools-draw");
  const editTools = $("tools-edit");
  const insertTools = $("tools-insert");
  const brushBar = $("brushes");
  const recentHost = document.getElementById("recent-tools");
  closeBrushPicker?.();
  closeBrushPicker = null;
  drawTools.innerHTML = "";
  editTools.innerHTML = "";
  insertTools.innerHTML = "";
  brushBar.innerHTML = "";
  if (recentHost) recentHost.innerHTML = "";
  const exitToneTool = (restorePreviousLayer = true) => {
    if (!toneToolActive) return;
    const cont = activeContainer();
    if (restorePreviousLayer && toneToolPrevLayerIndex !== null && toneToolPrevLayerIndex < cont.layers.length) {
      cont.setActiveLayerIndex(toneToolPrevLayerIndex);
    }
    toneToolActive = false;
    toneToolPrevLayerIndex = null;
  };
  const switchTo = (k: string) => {
    const hadTone = toneToolActive;
    // Gradient is a valid tone-layer operation. Keep the Tone shortcut's
    // active layer selected instead of restoring the prior draw layer.
    exitToneTool(k !== GRADIENT_KEY);
    if (TOOL_KEYS.has(k)) {
      currentBrush = k;
    } else {
      selectBrushKey(k);
    }
    rememberRecentTool(k);
    selectDrag = null;
    if (scaleToolDrag) {
      for (const snap of scaleToolDrag.snapshots) restoreFromSnapshot(snap);
      bumpMarqueeItemLayers(scaleToolDrag.items);
      scaleToolDrag = null;
    }
    if (hadTone) { buildLayers(); buildInspector(); }
    buildBrushBar();
    buildEditContext();
    updateCanvasCursor(lastCanvasPointerPos ?? undefined);
    if (selectionState?.mode === "region" && selectionState.phase === "idle") {
      setStatus("Painting inside selection · Esc to clear");
    }
  };
  const engageToneTool = () => {
    if (toneToolActive) return;
    const cont = activeContainer();
    toneToolPrevLayerIndex = cont.getActiveLayerIndex();
    cont.setActiveLayerIndex(ensurePaintedToneLayer(cont));
    toneToolActive = true;
    buildLayers();
    buildInspector();
    buildBrushBar();
  };
  const addTool = (host: HTMLElement, key: string, label: string, icon: StudioIcon) => {
    const btn = document.createElement("button");
    btn.className = "chip tool" + (currentBrush === key ? " active" : "");
    btn.title = label;
    btn.setAttribute("aria-label", label);
    btn.appendChild(svgIcon(icon, 16));
    btn.onclick = () => switchTo(key);
    host.appendChild(btn);
  };
  const addBrushTool = (tool: BrushToolKey, label: string, icon: StudioIcon) => {
    const layerKind = activeLayer()?.kind ?? null;
    const active = !TOOL_KEYS.has(currentBrush) && brushToolForKey(currentBrush) === tool;
    const btn = document.createElement("button");
    btn.className = "chip tool" + (active ? " active" : "");
    btn.title = label;
    btn.setAttribute("aria-label", label);
    btn.appendChild(svgIcon(icon, 16));
    btn.onclick = () => {
      const fallback = defaultBrushForTool(tool, layerKind).key;
      const remembered = lastBrushByTool[tool];
      const next =
        remembered && isBrushKeyAvailable(remembered, layerKind) ? remembered : fallback;
      switchTo(next);
    };
    drawTools.appendChild(btn);
  };

  const brushToolIcons: Record<BrushToolKey, StudioIcon> = {
    classic: StudioIcons.BrushClassic,
    texture: StudioIcons.BrushTexture,
    scatter: StudioIcons.BrushScatter,
    eraser: StudioIcons.Eraser,
  };
  for (const tool of BRUSH_TOOLS) {
    addBrushTool(tool.key, tool.label, brushToolIcons[tool.key]);
  }
  addTool(drawTools, BUCKET_KEY, "Bucket", StudioIcons.Bucket);
  addTool(drawTools, GRADIENT_KEY, "Gradient", StudioIcons.Gradient);
  {
    const toneBtn = document.createElement("button");
    toneBtn.className = "chip tool" + (toneToolActive ? " active" : "");
    toneBtn.title = "Tone — paint the active manga tone layer with the current brush";
    toneBtn.setAttribute("aria-label", "Tone");
    toneBtn.appendChild(svgIcon(StudioIcons.Tone, 16));
    toneBtn.onclick = () => engageToneTool();
    drawTools.appendChild(toneBtn);
  }
  addTool(editTools, SELECT_KEY, "Select", StudioIcons.Pointer);
  addTool(editTools, MARQUEE_KEY, "Marquee", StudioIcons.Selection);
  addTool(editTools, MOVE_LAYER_KEY, "Move active layer", StudioIcons.Move);
  addTool(editTools, SCALE_KEY, "Scale", StudioIcons.Scale);
  addTool(insertTools, TEXT_KEY, "Text", StudioIcons.Text);
  addTool(insertTools, SUBPANEL_KEY, "Sub-Panel", StudioIcons.SubPanel);
  addTool(insertTools, BALLOON_KEY, "Balloon", StudioIcons.Balloon);
  addTool(insertTools, CUT_SUBPANEL_KEY, "Cut Subpanel", StudioIcons.CutSubPanel);
  addTool(insertTools, PERSPECTIVE_KEY, "Perspective Ruler", StudioIcons.Perspective);

  const activeTool = TOOL_KEYS.has(currentBrush) ? "classic" : brushToolForKey(currentBrush);
  const activeToolLabel = BRUSH_TOOLS.find((tool) => tool.key === activeTool)?.label ?? "Classic";
  const layerKind = activeLayer()?.kind ?? null;
  // List raster-only (Krita) brushes even on draw layers so they don't look
  // "missing" — selecting one switches/creates a raster layer via selectBrushKey.
  const activeBrushes = brushesForTool(activeTool, "raster");
  const usableBrushes = brushesForTool(activeTool, layerKind);
  const activeBrush = usableBrushes.find((b) => b.key === currentBrush)
    ?? activeBrushes.find((b) => b.key === currentBrush)
    ?? defaultBrushForTool(activeTool, layerKind);
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
      bg: "transparent",
      size: currentSize,
      erase: transparentPaintSelected,
    });
    host.appendChild(preview);
  };

  const toolMeta: Record<string, { label: string; icon: StudioIcon }> = {
    [BUCKET_KEY]: { label: "Bucket", icon: StudioIcons.Bucket },
    [GRADIENT_KEY]: { label: "Gradient", icon: StudioIcons.Gradient },
    [TEXT_KEY]: { label: "Text", icon: StudioIcons.Text },
    [SUBPANEL_KEY]: { label: "Sub-Panel", icon: StudioIcons.SubPanel },
    [BALLOON_KEY]: { label: "Balloon", icon: StudioIcons.Balloon },
    [CUT_SUBPANEL_KEY]: { label: "Cut Subpanel", icon: StudioIcons.CutSubPanel },
    [SELECT_KEY]: { label: "Select", icon: StudioIcons.Pointer },
    [MARQUEE_KEY]: { label: "Marquee", icon: StudioIcons.Selection },
    [MOVE_LAYER_KEY]: { label: "Move active layer", icon: StudioIcons.Move },
    [SCALE_KEY]: { label: "Scale", icon: StudioIcons.Scale },
    [PERSPECTIVE_KEY]: { label: "Perspective Ruler", icon: StudioIcons.Perspective },
  };

  if (recentHost) {
    for (const key of recentToolKeys) {
      if (TOOL_KEYS.has(key)) {
        const meta = toolMeta[key];
        if (!meta) continue;
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "recent-tool" + (currentBrush === key ? " active" : "");
        btn.title = meta.label;
        btn.setAttribute("aria-label", meta.label);
        btn.setAttribute("role", "listitem");
        btn.appendChild(svgIcon(meta.icon, 16));
        btn.onclick = () => switchTo(key);
        recentHost.appendChild(btn);
        continue;
      }
      if (!isBrushKeyAvailable(key, layerKind)) {
        const brush = BRUSHES.find((entry) => entry.key === key);
        if (!brush?.rasterOnly) continue;
      }
      const brush = brushByKey(key);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "recent-tool" + (currentBrush === key ? " active" : "");
      btn.title = brush.label;
      btn.setAttribute("aria-label", brush.label);
      btn.setAttribute("role", "listitem");
      appendBrushPreview(btn, brush, "recent-tool-preview", 34, 34);
      btn.onclick = () => switchTo(key);
      recentHost.appendChild(btn);
    }
  }

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
  let unmountFloating: (() => void) | null = null;
  const closePicker = () => {
    if (!open) return;
    open = false;
    picker.classList.remove("open");
    menu.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    unmountFloating?.();
    unmountFloating = null;
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
    unmountFloating = mountFloatingMenu(menu, trigger, picker);
    onDocumentPointerDown = (event) => {
      const target = event.target;
      if (target instanceof Node && (picker.contains(target) || menu.contains(target))) return;
      closePicker();
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
    if (next instanceof Node && (picker.contains(next) || menu.contains(next))) return;
    // Focus may move into the portaled menu on the next tick.
    window.setTimeout(() => {
      if (!open) return;
      const active = document.activeElement;
      if (active instanceof Node && (picker.contains(active) || menu.contains(active))) return;
      closePicker();
    }, 0);
  });

  let lastGroup: string | null = null;
  for (const b of activeBrushes) {
    const groupName = b.group ?? (activeTool === "classic" ? "Classic" : activeToolLabel);
    if (groupName !== lastGroup) {
      lastGroup = groupName;
      const header = document.createElement("div");
      header.className = "brush-menu-group";
      header.textContent = groupName;
      menu.appendChild(header);
    }
    const option = document.createElement("button");
    option.type = "button";
    option.className = "brush-option" + (b.key === activeBrush.key ? " active" : "");
    option.setAttribute("role", "option");
    option.setAttribute("aria-selected", String(b.key === activeBrush.key));
    if (b.rasterOnly && layerKind !== "raster") {
      option.title = `${b.label} · needs a raster layer (click to switch)`;
    }
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
  actions.className = "brush-preset-actions";
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

function drawContextSummaryLabel(): string {
  if (toneToolActive) return "Tone";
  const regBrush = TOOL_KEYS.has(currentBrush) ? null : brushByKey(currentBrush);
  if (!regBrush) return "Brush";
  if (regBrush.erase || transparentPaintSelected) return "Eraser";
  if (regBrush.group === "Manga FX") return "Manga FX";
  const tool = brushToolForKey(currentBrush);
  return BRUSH_TOOLS.find((t) => t.key === tool)?.label ?? "Classic";
}

function updateToolContext() {
  const currentRegistryBrush = TOOL_KEYS.has(currentBrush)
    ? null
    : BRUSHES.find((b) => b.key === currentBrush) ?? null;
  const isEraser = !!currentRegistryBrush &&
    (currentRegistryBrush.erase === true || transparentPaintSelected);
  const isBrushLike = !!currentRegistryBrush && !isEraser;
  const hasSelection = !!selectionState;
  const selectedSubPanel = selectedSubPanelId
    ? findSubPanelById(activePanel(), selectedSubPanelId)
    : null;
  const contexts = [
    ["draw-context", isBrushLike || isEraser],
    ["text-context", currentBrush === TEXT_KEY || !!selectedText],
    ["bucket-context", currentBrush === BUCKET_KEY],
    ["gradient-context", currentBrush === GRADIENT_KEY],
    ["edit-context", currentBrush === SELECT_KEY || currentBrush === MARQUEE_KEY || currentBrush === MOVE_LAYER_KEY || currentBrush === SCALE_KEY || hasSelection],
    ["subpanel-context", currentBrush === SUBPANEL_KEY || currentBrush === CUT_SUBPANEL_KEY || (!!selectedSubPanel && !isBalloonShape(selectedSubPanel.shape))],
    ["balloon-context", currentBrush === BALLOON_KEY || (!!selectedSubPanel && isBalloonShape(selectedSubPanel.shape))],
    ["perspective-context", currentBrush === PERSPECTIVE_KEY],
  ] as const;
  for (const [id, active] of contexts) {
    $(id).classList.toggle("active", active);
  }
  const drawSummary = document.querySelector("#draw-context > summary");
  if (drawSummary) setInspectorModuleSummaryLabel(drawSummary as HTMLElement, drawContextSummaryLabel());
  const showBrushSettings = isBrushLike || isEraser;
  document.querySelectorAll<HTMLElement>(".draw-setting-module").forEach((module) => {
    module.hidden = !showBrushSettings;
  });
  document.querySelectorAll<HTMLElement>(".inspector-module-panel").forEach((group) => {
    const modules = directInspectorModules(group);
    group.hidden = modules.length > 0 && modules.every((module) =>
      module.hidden
      || (module.classList.contains("tool-context") && !module.classList.contains("active")),
    );
  });
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
  row.className = "context-action-row";
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
    bindRow.className = "context-action-row";
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
    lab.className = "control-check";
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
    hint.className = "context-hint";
    hint.textContent = "Scale: drag handles around the active layer to resize or rotate its content.";
    host.appendChild(hint);
    if (selectionClipboard) {
      mkBtn("Paste", () => pasteSelection(), "Paste clipboard to active layer (Ctrl+V)");
    }
    return;
  }

  if (!selectionState) {
    if (currentBrush === MOVE_LAYER_KEY) {
      const hint = document.createElement("div");
      hint.className = "context-hint";
      hint.textContent = keyframeArm
        ? `Drag on the canvas to place the ${keyframeArm === "from" ? "start (A)" : "end (B)"} keyframe.`
        : "Drag to move the active layer. For layer animation, use Set start (A) / Set end (B).";
      host.appendChild(hint);
      if (selectionClipboard) {
        mkBtn("Paste", () => pasteSelection(), "Paste clipboard to active layer (Ctrl+V)");
      }
      return;
    }
    if (currentBrush === MARQUEE_KEY) {
      const hint = document.createElement("div");
      hint.className = "context-hint";
      hint.textContent = activeLayer()?.kind === "raster"
        ? "Drag to select. Shift constrains; Alt draws from center. On raster layers, drag inside to move the selected pixels; handles scale/rotate; ⌥-drag moves just the boundary."
        : "Drag to select. Shift constrains; Alt draws from center. Drag inside to move the boundary.";
      host.appendChild(hint);
    }
    if (selectionClipboard) {
      mkBtn("Paste", () => pasteSelection(), "Paste clipboard to active layer (Ctrl+V)");
    }
    return;
  }

  const info = document.createElement("div");
  info.className = "context-hint";
  info.style.marginBottom = "8px";
  if (selectionState.mode === "region") {
    info.textContent = isManipulableRasterRegion(selectionState)
      ? `Region selection (${selectionState.tool}). Drag inside to move pixels; handles scale/rotate; ⌥-drag moves the boundary.`
      : `Region selection (${selectionState.tool}). Paint is clipped; drag inside to move the boundary.`;
  } else {
    info.textContent = rasterMarqueeItems(selectionState.items).length > 0
      ? "Selected pixels. Drag to move; handles scale/rotate."
      : `${selectionState.items.length} item(s) extracted. Drag to move; handles to scale/rotate.`;
  }
  host.appendChild(info);

  if (selectionState.mode === "region" && selectionState.phase === "idle") {
    mkBtn("Extract", () => extractSelection());
    mkBtn(selectionState.inverted ? "Uninvert" : "Invert", () => invertActiveSelection());
    mkBtn("Grow", () => growActiveSelection(8));
    mkBtn("Shrink", () => growActiveSelection(-8));
    if (activeLayer()?.kind === "raster") {
      mkBtn("Copy", () => copyRasterRegionSelection(), "Copy selected pixels (Ctrl+C)");
      mkBtn("Delete", () => deleteRasterRegionSelection(), "Delete selected pixels");
    }
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
  const transparent = document.createElement("button");
  transparent.type = "button";
  transparent.className = "swatch swatch-transparent" + (transparentPaintSelected ? " active" : "");
  transparent.title = "Erase with the current brush";
  transparent.setAttribute("aria-label", "Transparent — erase with current brush");
  transparent.setAttribute("aria-pressed", String(transparentPaintSelected));
  transparent.onclick = () => {
    transparentPaintSelected = true;
    buildPalette();
    buildBrushBar();
    rebuildInspector();
    updateCanvasCursor();
    setStatus("Transparent paint · erase with the current brush");
  };
  bar.appendChild(transparent);
  for (const c of currentPalette.colors) {
    const sw = document.createElement("button");
    sw.className = "swatch" + (!transparentPaintSelected && c === currentColor ? " active" : "");
    sw.style.background = c;
    sw.title = c;
    sw.setAttribute("aria-label", `Paint color ${c}`);
    sw.onclick = () => {
      currentColor = c;
      transparentPaintSelected = false;
      buildPalette();
      buildBrushBar();
      rebuildInspector();
      updateCanvasCursor();
    };
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
    transparentPaintSelected = false;
    buildPalette();
    buildBrushBar();
    rebuildInspector();
  };
  bar.appendChild(add);
  buildGradientEndPalette();
  syncPaletteTriangle();
}

/** Keep the Gradient tool's second color tied to the current palette. This is
 *  transient tool state; project history changes only when a drag commits. */
function buildGradientEndPalette() {
  const host = document.getElementById("gradient-end-swatches");
  const input = document.getElementById("gradient-end-color") as HTMLInputElement | null;
  if (!host || !input) return;
  input.value = currentGradientEndColor;
  host.replaceChildren();
  for (const color of currentPalette.colors) {
    const swatch = document.createElement("button");
    swatch.type = "button";
    swatch.className = "mini-swatch" +
      (color.toLowerCase() === currentGradientEndColor.toLowerCase() ? " active" : "");
    swatch.style.background = color;
    swatch.title = color;
    swatch.setAttribute("aria-label", `Gradient end color ${color}`);
    swatch.onclick = () => {
      currentGradientEndColor = color;
      input.value = color;
      buildGradientEndPalette();
    };
    host.appendChild(swatch);
  }
}

let paletteTriangle: ColorTriangleHandle | null = null;

function syncPaletteTriangle() {
  const host = document.getElementById("palette-triangle-host");
  if (!host) return;
  if (!paletteTriangle) {
    paletteTriangle = mountColorTriangle(host, {
      color: currentColor,
      onChange: (hex) => {
        // Avoid remounting the picker; only refresh swatch chrome + brush.
        currentColor = hex;
        transparentPaintSelected = false;
        const bar = $("palette");
        for (const el of bar.querySelectorAll<HTMLElement>(".swatch")) {
          if (el.classList.contains("swatch-transparent")) {
            el.classList.remove("active");
            el.setAttribute("aria-pressed", "false");
            continue;
          }
          if (el.classList.contains("swatch-add")) {
            (el as HTMLInputElement).value = hex;
            continue;
          }
          el.classList.toggle("active", el.title.toLowerCase() === hex.toLowerCase());
        }
        buildBrushBar();
        updateCanvasCursor();
      },
    });
    return;
  }
  paletteTriangle.setColor(currentColor);
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

function renderProjectPreview(source: Project, panelIndex: number): string {
  const preview = document.createElement("canvas");
  preview.width = 360;
  preview.height = Math.max(180, Math.round(preview.width * source.height / source.width));
  const previewCtx = preview.getContext("2d")!;
  const panel = source.panels[Math.max(0, Math.min(panelIndex, source.panels.length - 1))];
  previewCtx.scale(preview.width / source.width, preview.height / source.height);
  renderPanel(previewCtx, panel, 0, source.width, source.height, {
    allPanels: source.panels,
    timelapseProgress: panel.kind === "timelapse" ? 1 : undefined,
    skipAnim: true,
    skipJitter: false,
    skipFillMaskCache: true,
  });
  previewCtx.setTransform(1, 0, 0, 1, 0, 0);
  return preview.toDataURL("image/jpeg", 0.82);
}

// Budget thumbnail re-renders per frame so undo/redo on a big project (every
// panel marked dirty at once) doesn't re-render 50 thumbs in a single frame
// and visibly hitch. Leftover dirty ids stay in `dirtyThumbnailPanelIds` and
// get picked up on subsequent frames until the set drains.
const THUMBNAIL_REFRESH_BUDGET_MS = 4;

function refreshThumbnails() {
  const panelById = new Map(project.panels.map(p => [p.id, p]));
  const start = performance.now();

  // Drop dirty ids for thumbs that no longer exist (e.g. a deleted panel) —
  // nothing to refresh, and leaving them behind would keep this set
  // permanently non-empty, blocking the idle render loop from ever sleeping.
  for (const id of dirtyThumbnailPanelIds) {
    if (!thumbCanvases.has(id)) dirtyThumbnailPanelIds.delete(id);
  }

  // Always refresh the active panel's thumb first — it's the one the user
  // is most likely looking at (e.g. right after switching panels on undo).
  const activeId = activePanel().id;
  if (shouldRefreshThumbnail(activeId, dirtyThumbnailPanelIds)) {
    const c = thumbCanvases.get(activeId);
    const p = panelById.get(activeId);
    if (c && p) renderThumb(c, p);
    dirtyThumbnailPanelIds.delete(activeId);
  }

  for (const [id, c] of thumbCanvases) {
    if (!shouldRefreshThumbnail(id, dirtyThumbnailPanelIds)) continue;
    if (performance.now() - start > THUMBNAIL_REFRESH_BUDGET_MS) break;
    const p = panelById.get(id);
    if (!p) { dirtyThumbnailPanelIds.delete(id); continue; }
    renderThumb(c, p);
    dirtyThumbnailPanelIds.delete(id);
  }
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
  playBtn.className = "transport-primary transport-icon";
  playBtn.title = playing ? "Stop" : "Play";
  playBtn.setAttribute("aria-label", playing ? "Stop" : "Play");
  playBtn.appendChild(svgIcon(playing ? StudioIcons.Pause : StudioIcons.Play, 16));
  playBtn.onclick = () => {
    if (playing) void stopPlayback(playheadMs);
    else void startPlayback(sequenceStartMsForPanel(project, activePanelIndex));
  };
  bar.appendChild(playBtn);

  const loopBtn = document.createElement("button");
  loopBtn.id = "loop-toggle";
  loopBtn.title = loopPlayback ? "Loop on" : "Loop off";
  loopBtn.setAttribute("aria-label", loopBtn.title);
  loopBtn.className = "transport-toggle transport-icon" + (loopPlayback ? " active" : "");
  loopBtn.appendChild(svgIcon(StudioIcons.Repeat, 15));
  loopBtn.onclick = () => {
    loopPlayback = !loopPlayback;
    loopBtn.title = loopPlayback ? "Loop on" : "Loop off";
    loopBtn.setAttribute("aria-label", loopBtn.title);
    loopBtn.classList.toggle("active", loopPlayback);
  };
  bar.appendChild(loopBtn);

  const jitterBtn = document.createElement("button");
  jitterBtn.id = "jitter-toggle";
  jitterBtn.title = jitterEnabled ? "Stroke wiggle on" : "Stroke wiggle off";
  jitterBtn.setAttribute("aria-label", jitterBtn.title);
  jitterBtn.className = "transport-toggle transport-icon" + (jitterEnabled ? " active" : "");
  jitterBtn.appendChild(svgIcon(StudioIcons.Sparkle, 15));
  jitterBtn.onclick = () => {
    jitterEnabled = !jitterEnabled;
    jitterBtn.title = jitterEnabled ? "Stroke wiggle on" : "Stroke wiggle off";
    jitterBtn.setAttribute("aria-label", jitterBtn.title);
    jitterBtn.classList.toggle("active", jitterEnabled);
    invalidateBaseFrameCache();
    refreshThumbnails();
  };
  bar.appendChild(jitterBtn);

  const groupBtn = document.createElement("button");
  groupBtn.id = "group-selected";
  groupBtn.className = "transport-command";
  groupBtn.textContent = "Group";
  groupBtn.title = "Group selected frames (Shift-click to select range)";
  const range = selectedPanelRange();
  groupBtn.disabled = !range;
  groupBtn.hidden = !range;
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

  const unitBtn = document.createElement("button");
  unitBtn.type = "button";
  unitBtn.className = "timeline-unit-toggle-btn";
  unitBtn.textContent = timelineTimeUnit === "frames" ? "fr" : "s";
  unitBtn.title = timelineTimeUnit === "frames"
    ? "Duration unit: frames — click for seconds"
    : "Duration unit: seconds — click for frames";
  unitBtn.setAttribute("aria-label", unitBtn.title);
  unitBtn.addEventListener("pointerdown", (e) => { e.stopPropagation(); });
  unitBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleTimelineTimeUnit();
  });
  bar.appendChild(unitBtn);

  return bar;
}

function buildOnionSkinBar(): HTMLElement {
  const bar = document.createElement("details");
  bar.className = "onion-skin-bar";

  const summary = document.createElement("summary");
  summary.className = "onion-skin-summary";
  const title = document.createElement("span");
  title.textContent = "Onion skin";

  const toggleLabel = document.createElement("label");
  toggleLabel.className = "onion-skin-toggle";
  toggleLabel.title = onionEnabled ? "Disable onion skin" : "Enable onion skin";
  const toggleCb = document.createElement("input");
  toggleCb.type = "checkbox";
  toggleCb.id = "onion-toggle";
  toggleCb.setAttribute("role", "switch");
  toggleCb.setAttribute("aria-label", "Onion skin");
  toggleCb.checked = onionEnabled;
  const syncToggleChrome = () => {
    toggleLabel.title = onionEnabled ? "Disable onion skin" : "Enable onion skin";
    toggleLabel.classList.toggle("is-on", onionEnabled);
    bar.classList.toggle("is-enabled", onionEnabled);
    // Enabling reveals Prev/Next/opacity; disabling collapses them again.
    bar.open = onionEnabled;
  };
  toggleCb.onchange = () => {
    onionEnabled = toggleCb.checked;
    syncToggleChrome();
  };
  const track = document.createElement("span");
  track.className = "onion-skin-switch";
  track.setAttribute("aria-hidden", "true");
  toggleLabel.append(toggleCb, track);
  // Keep summary expand/collapse separate from the on/off switch.
  const stopSummaryToggle = (e: Event) => { e.stopPropagation(); };
  toggleLabel.addEventListener("click", stopSummaryToggle);
  toggleCb.addEventListener("click", stopSummaryToggle);
  summary.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest(".onion-skin-toggle")) e.preventDefault();
  });
  syncToggleChrome();
  summary.append(title, toggleLabel);
  bar.appendChild(summary);

  const controls = document.createElement("div");
  controls.className = "onion-skin-controls";

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
  controls.appendChild(prevLabel);

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
  nextLabel.className = "onion-skin-next";
  nextLabel.append(nextSelect);
  controls.appendChild(nextLabel);

  const opSlider = document.createElement("input");
  opSlider.type = "range";
  opSlider.id = "onion-opacity";
  opSlider.min = "0.05";
  opSlider.max = "0.6";
  opSlider.step = "0.05";
  opSlider.value = String(onionOpacity);
  opSlider.oninput = () => { onionOpacity = +opSlider.value; };
  controls.appendChild(opSlider);
  bar.appendChild(controls);

  return bar;
}

/** Shared actions for the active panel — sits above onion skin, not in each cell. */
function buildTimelinePanelActionsBar(): HTMLElement {
  const bar = document.createElement("div");
  bar.className = "timeline-panel-actions";
  bar.setAttribute("role", "toolbar");
  bar.setAttribute("aria-label", "Panel actions");

  const i = activePanelIndex;
  const p = project.panels[i];
  const layerSelected = !!activeLayer();
  const canEdit = !!p && layerSelected;

  const blankBeforeBtn = iconButton(StudioIcons.FrameInsertBefore, "Insert blank panel before", (e) => {
    e.stopPropagation();
    insertBlankPanelAt(i);
  });
  const blankAfterBtn = iconButton(StudioIcons.FrameInsertAfter, "Insert blank panel after", (e) => {
    e.stopPropagation();
    insertBlankPanelAt(i + 1);
  });
  const tlBtn = iconButton(StudioIcons.Timelapse, "Insert timelapse before", (e) => {
    e.stopPropagation();
    insertTimelapseBefore(i);
  });
  const dupBtn = iconButton(StudioIcons.CopyCheck, "Duplicate panel", (e) => {
    e.stopPropagation();
    duplicatePanel(i);
  });
  const copyBtn = iconButton(StudioIcons.Copy, "Copy panel contents", (e) => {
    e.stopPropagation();
    copyActivePanelContents();
  });
  const pasteBtn = iconButton(StudioIcons.ClipboardPaste, "Paste panel contents", (e) => {
    e.stopPropagation();
    pasteIntoActivePanel();
  });
  const delBtn = iconButton(StudioIcons.Trash, "Delete panel", (e) => {
    e.stopPropagation();
    deletePanel(i);
  });

  for (const btn of [blankBeforeBtn, blankAfterBtn, tlBtn, dupBtn, copyBtn, pasteBtn, delBtn]) {
    btn.disabled = !canEdit;
    bar.appendChild(btn);
  }
  if (canEdit) {
    pasteBtn.disabled = !panelContentClipboard || p.kind === "timelapse";
  }

  if (!layerSelected) {
    bar.title = "Select a layer to use panel actions";
  }

  return bar;
}

/** Notes editor for the panel whose note icon is expanded — below the filmstrip. */
function buildTimelineNotesPanel(): HTMLElement | null {
  let openId: string | null = null;
  for (const id of expandedPanelAnnotations) {
    if (project.panels.some((panel) => panel.id === id)) {
      openId = id;
      break;
    }
  }
  if (!openId) return null;
  const i = project.panels.findIndex((panel) => panel.id === openId);
  if (i < 0) return null;
  const p = project.panels[i];

  const wrap = document.createElement("div");
  wrap.className = "timeline-notes-panel";

  const header = document.createElement("div");
  header.className = "timeline-notes-header";
  const label = document.createElement("span");
  label.textContent = `Frame ${i + 1} note`;
  const close = document.createElement("button");
  close.type = "button";
  close.className = "timeline-notes-close";
  close.textContent = "Close";
  close.onclick = () => {
    expandedPanelAnnotations.clear();
    buildTimeline();
  };
  header.append(label, close);
  wrap.appendChild(header);

  const annotation = document.createElement("textarea");
  annotation.className = "panel-annotation";
  annotation.id = `panel-annotation-${p.id}`;
  annotation.rows = 3;
  annotation.maxLength = MAX_PANEL_ANNOTATION_CHARS;
  annotation.value = p.annotation ?? "";
  annotation.placeholder = "Dialogue / narration…";
  annotation.title = `Frame ${i + 1} annotation`;
  annotation.setAttribute("aria-label", `Frame ${i + 1} annotation`);
  annotation.draggable = false;
  let committedAnnotation = annotation.value;
  annotation.oninput = () => {
    p.annotation = annotation.value;
    markDirty();
    document.querySelectorAll(".panel-annotation-toggle").forEach((el) => {
      const btn = el as HTMLElement;
      if (btn.closest(".panel-cell")?.getAttribute("data-panel-id") === p.id) {
        btn.classList.toggle("has-note", !!annotation.value.trim());
      }
    });
  };
  annotation.onchange = () => {
    if (annotation.value === committedAnnotation) return;
    p.annotation = annotation.value;
    commitHistory();
    committedAnnotation = annotation.value;
    setStatus(`Frame ${i + 1} annotation updated`);
  };
  annotation.addEventListener("dragstart", (e) => e.stopPropagation());
  wrap.appendChild(annotation);

  requestAnimationFrame(() => annotation.focus());
  return wrap;
}

function buildPanelCell(
  filmstrip: HTMLElement,
  i: number,
  p: Panel,
  reusedThumb?: HTMLCanvasElement,
) {
  const cell = document.createElement("div");
  cell.className = "panel-cell"
    + (i === activePanelIndex ? " active" : "")
    + (isPanelInSelectedRange(i) ? " range-selected" : "");
  cell.dataset.index = String(i);
  cell.dataset.panelId = p.id;
  cell.draggable = true;

  const group = groupAtPanelIndex(project, i);
  if (group) cell.dataset.groupId = group.id;

  const thumb = reusedThumb ?? document.createElement("canvas");
  if (thumb.width !== 60) thumb.width = 60;
  if (thumb.height !== 107) thumb.height = 107;
  cell.appendChild(thumb);
  thumbCanvases.set(p.id, thumb);
  if (!reusedThumb) renderThumb(thumb, p);

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
  if (p.transitionToNext?.kind === "crossfade") {
    const tag = document.createElement("div");
    tag.textContent = `⇄ crossfade ${p.transitionToNext.durationTicks}fr`;
    tag.style.cssText = "font-size:9px;color:#8fd3ff;text-align:center;";
    cell.appendChild(tag);
  }

  const exposure = document.createElement("div");
  exposure.className = "exposure-control";

  if (timelineTimeUnit === "frames") {
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
  } else {
    const secInput = document.createElement("input");
    secInput.type = "number";
    secInput.value = formatSecondsValue(durationMsToSeconds(p.durationMs));
    secInput.min = "0.1";
    secInput.step = "0.1";
    secInput.className = "frame-dur sec-dur";
    secInput.title = "Duration in seconds";
    secInput.setAttribute("aria-label", "Duration in seconds");
    secInput.onchange = () => { setPanelDurationSec(i, Math.max(0.1, +secInput.value || 0.1)); };
    exposure.appendChild(secInput);
  }

  const annotationToggle = iconButton(
    StudioIcons.Note,
    expandedPanelAnnotations.has(p.id) ? `Hide frame ${i + 1} note` : `Show frame ${i + 1} note`,
    (e) => {
      e.stopPropagation();
      const open = expandedPanelAnnotations.has(p.id);
      expandedPanelAnnotations.clear();
      if (!open) expandedPanelAnnotations.add(p.id);
      buildTimeline();
    },
    "panel-annotation-toggle iconbtn" + (p.annotation?.trim() ? " has-note" : ""),
  );
  annotationToggle.setAttribute("aria-expanded", String(expandedPanelAnnotations.has(p.id)));
  annotationToggle.setAttribute("aria-controls", "timeline-notes-panel");
  exposure.appendChild(annotationToggle);
  cell.appendChild(exposure);

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
    const filmstripEl = cell.closest<HTMLElement>(".timeline-filmstrip");
    const vertical = filmstripEl ? filmstripFlowsVertically(filmstripEl) : false;
    const isBefore = vertical
      ? e.clientY < rect.top + rect.height / 2
      : e.clientX < rect.left + rect.width / 2;
    document.querySelectorAll(".panel-cell").forEach((c) =>
      c.classList.remove("drop-before", "drop-after"));
    cell.classList.add(isBefore ? "drop-before" : "drop-after");
  });
  cell.addEventListener("drop", (e) => {
    e.preventDefault();
    cell.classList.remove("drop-before", "drop-after");
    const raw = e.dataTransfer!.getData("text/plain");
    const rect = cell.getBoundingClientRect();
    const filmstripEl = cell.closest<HTMLElement>(".timeline-filmstrip");
    const vertical = filmstripEl ? filmstripFlowsVertically(filmstripEl) : false;
    const isBefore = vertical
      ? e.clientY < rect.top + rect.height / 2
      : e.clientX < rect.left + rect.width / 2;
    handlePanelDrop(i, isBefore, raw);
  });

  cell.onclick = (e) => {
    const t = e.target as HTMLElement;
    if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "BUTTON") return;
    if (e.shiftKey) {
      rangeEndIndex = i;
    } else {
      activePanelIndex = i;
      rangeAnchorIndex = i;
      rangeEndIndex = i;
    }
    activeSubPanelPath = [];
    selectedSubPanelId = null;
    selectedText = null;
    clearSelection();
    // Only the selection changed — no need to rebuild the whole filmstrip.
    if (!refreshTimelineSelection()) buildTimeline();
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

function filmstripFlowsVertically(filmstrip: HTMLElement): boolean {
  return getComputedStyle(filmstrip).flexDirection === "column";
}

function buildTimelineTabRow(active: TimelineTab): HTMLElement {
  const tabRow = document.createElement("div");
  tabRow.className = "timeline-tabs";
  const tabs: { id: TimelineTab; label: string }[] = [
    { id: "panels", label: "Panels" },
    { id: "anim", label: "Anim" },
    { id: "sequence", label: "Sequence" },
  ];
  for (const tab of tabs) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = tab.label;
    btn.className = "timeline-tab" + (tab.id === active ? " active" : "");
    btn.setAttribute("aria-selected", tab.id === active ? "true" : "false");
    btn.onclick = () => setTimelineTab(tab.id);
    tabRow.appendChild(btn);
  }
  return tabRow;
}

function buildDockOrientationControl(): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "timeline-dock-orient";
  const opts: { id: TimelineDockOverride; label: string; title: string }[] = [
    { id: "auto", label: "Auto", title: "Dock from project aspect ratio" },
    { id: "wide", label: "Wide", title: "Full-width bottom dock" },
    { id: "tall", label: "Tall", title: "Full-height side dock" },
  ];
  for (const opt of opts) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "timeline-dock-orient-btn" + (timelineDockOverride === opt.id ? " active" : "");
    btn.textContent = opt.label;
    btn.title = opt.title;
    btn.setAttribute("aria-pressed", timelineDockOverride === opt.id ? "true" : "false");
    btn.addEventListener("pointerdown", (e) => e.stopPropagation());
    btn.onclick = (e) => {
      e.stopPropagation();
      timelineDockOverride = opt.id;
      syncTimelineDock();
      buildTimeline();
    };
    wrap.appendChild(btn);
  }
  return wrap;
}

function resolveDockOrientation(): "wide" | "tall" {
  if (timelineDockOverride === "wide" || timelineDockOverride === "tall") return timelineDockOverride;
  return project.height >= project.width ? "tall" : "wide";
}

function clearTimelinePanelInlineGeometry(panel: HTMLElement) {
  panel.style.left = "";
  panel.style.right = "";
  panel.style.top = "";
  panel.style.bottom = "";
  panel.style.width = "";
  panel.style.height = "";
  panel.style.inset = "";
}

/** Floating for Panels/Anim; docked wide/tall only for Sequence. */
function syncTimelineDock() {
  const panel = document.querySelector<HTMLElement>(".timeline-panel");
  if (!panel) return;
  panel.classList.remove("dock-wide", "dock-tall", "is-floating");
  if (timelineTab === "sequence") {
    clearTimelinePanelInlineGeometry(panel);
    panel.classList.add(resolveDockOrientation() === "tall" ? "dock-tall" : "dock-wide");
  } else {
    panel.classList.add("is-floating");
  }
}

function setTimelineTab(tab: TimelineTab) {
  const prev = timelineTab;
  timelineTab = tab;
  if (tab !== "sequence") selectedAudioClipId = null;
  const timelinePanel = document.querySelector<HTMLElement>(".timeline-panel");
  if (prev !== tab) timelinePanel?.classList.add("is-mode-morphing");
  document.body.classList.toggle("timeline-panels", tab === "panels");
  document.body.classList.toggle("timeline-anim", tab === "anim");
  document.body.classList.toggle("timeline-sequence", tab === "sequence");
  syncTimelineDock();
  buildTimeline();
  buildInspector();
  requestAnimationFrame(() => {
    requestAnimationFrame(() => timelinePanel?.classList.remove("is-mode-morphing"));
  });
}

/** Selection-only timeline update.
 *
 *  Selecting a panel changes nothing about the filmstrip except which cells
 *  carry `.active` / `.range-selected` — but it used to run the full
 *  `buildTimeline()`, tearing down and recreating every cell (and re-running
 *  layout over the whole strip) on every click. On a 60-panel project that is
 *  the difference between flipping two classes and rebuilding 60 subtrees.
 *
 *  Returns false when the existing DOM no longer matches the project (panel
 *  added / removed / reordered), in which case the caller must fall back to a
 *  full rebuild. */
function refreshTimelineSelection(): boolean {
  const tl = $("timeline");
  const filmstrip = tl.querySelector(".timeline-filmstrip");
  if (!filmstrip) return false;
  const cells = filmstrip.querySelectorAll<HTMLElement>(".panel-cell");
  if (cells.length !== project.panels.length) return false;
  // Verify identity before mutating: a stale strip must go through the full
  // rebuild rather than get half-correct classes.
  for (const cell of cells) {
    const idx = Number(cell.dataset.index);
    if (!Number.isInteger(idx) || project.panels[idx]?.id !== cell.dataset.panelId) return false;
  }
  for (const cell of cells) {
    const idx = Number(cell.dataset.index);
    cell.classList.toggle("active", idx === activePanelIndex);
    cell.classList.toggle("range-selected", isPanelInSelectedRange(idx));
  }
  lastSyncedThumbIndex = -1;
  syncActiveThumb();
  return true;
}

function buildTimeline() {
  lastSyncedThumbIndex = -1;
  const tl = $("timeline");
  const previousFilmstrip = tl.querySelector(".timeline-filmstrip") as HTMLElement | null;
  const previousFilmstripScrollLeft = previousFilmstrip?.scrollLeft ?? 0;
  const previousFilmstripScrollTop = previousFilmstrip?.scrollTop ?? 0;
  const reusableThumbs = new Map(thumbCanvases);
  tl.innerHTML = "";
  tl.classList.toggle("track-mode", timelineTab === "anim");
  tl.classList.toggle("edit-mode", timelineTab === "sequence");
  thumbCanvases.clear();
  syncTimelineDock();

  if (timelineTab === "sequence") {
    buildEditTimeline(tl);
    return;
  }
  if (timelineTab === "anim") {
    buildTrackView(tl);
    return;
  }

  // Panels — filmstrip of all frames + onion skin.
  tl.appendChild(buildTransportBar());
  tl.appendChild(buildTimelineTabRow("panels"));

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
        const panel = project.panels[idx];
        buildPanelCell(cellsHost, idx, panel, reusableThumbs.get(panel.id));
      }
      filmstrip.appendChild(bracket);
      panelIdx += group.panelIds.length;
    } else {
      const panel = project.panels[panelIdx];
      buildPanelCell(filmstrip, panelIdx, panel, reusableThumbs.get(panel.id));
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
    activeSubPanelPath = [];
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

  const notesPanel = buildTimelineNotesPanel();
  if (notesPanel) {
    notesPanel.id = "timeline-notes-panel";
    tl.appendChild(notesPanel);
  }

  tl.appendChild(buildTimelinePanelActionsBar());
  tl.appendChild(buildOnionSkinBar());

  const activeCell = filmstrip.querySelector<HTMLElement>(".panel-cell.active");
  if (activeCell) {
    if (filmstripFlowsVertically(filmstrip)) {
      filmstrip.scrollTop = timelineScrollAfterRebuild({
        previousScrollLeft: previousFilmstripScrollTop,
        viewportWidth: filmstrip.clientHeight,
        contentWidth: filmstrip.scrollHeight,
        activeLeft: activeCell.offsetTop,
        activeRight: activeCell.offsetTop + activeCell.offsetHeight,
      });
    } else {
      filmstrip.scrollLeft = timelineScrollAfterRebuild({
        previousScrollLeft: previousFilmstripScrollLeft,
        viewportWidth: filmstrip.clientWidth,
        contentWidth: filmstrip.scrollWidth,
        activeLeft: activeCell.offsetLeft,
        activeRight: activeCell.offsetLeft + activeCell.offsetWidth,
      });
    }
  }
}

function buildEditTimeline(tl: HTMLElement) {
  tl.appendChild(buildTransportBar());
  tl.appendChild(buildTimelineTabRow("sequence"));
  tl.appendChild(buildDockOrientationControl());

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
  label.className = "track-name";
  label.style.gridColumn = "1 / -1";
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
          block.title = `Panel ${i + 1} · ${formatHoldDuration(p.durationMs, timelineTimeUnit, project.wiggleFps)} · loop ${iter + 1}/${group.repeat}`;

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
                snapPanelDurationToTimelineUnit(p);
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
      block.title = `Panel ${i + 1} · ${formatHoldDuration(p.durationMs, timelineTimeUnit, project.wiggleFps)}`;

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
          block.title = `Panel ${i + 1} · ${formatHoldDuration(p.durationMs, timelineTimeUnit, project.wiggleFps)}`;
        };
        const up = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
          window.removeEventListener("pointercancel", up);
          snapPanelDurationToTimelineUnit(p);
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
  if (!isSequenceTab()) return;
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

  // Transport above tabs so playback stays visible while switching views.
  tl.appendChild(buildTransportBar());
  tl.appendChild(buildTimelineTabRow("anim"));

  const header = document.createElement("div");
  header.className = "track-header";
  const lab = document.createElement("span");
  lab.textContent = timelineTimeUnit === "frames"
    ? `Panel ${activePanelIndex + 1} — ${totalTicks}fr @ ${wiggleFps}fps`
    : `Panel ${activePanelIndex + 1} — ${formatHoldDuration(panel.durationMs, "seconds", wiggleFps)} · ${totalTicks}fr @ ${wiggleFps}fps`;
  header.appendChild(lab);
  tl.appendChild(header);

  // Tick ruler — labels follow the active timeline unit.
  const ruler = document.createElement("div");
  ruler.className = "track-ruler";
  for (let t = 0; t <= totalTicks; t++) {
    const m = document.createElement("div");
    m.className = "tick";
    m.style.left = `${(t / totalTicks) * 100}%`;
    if (t % 2 === 0) {
      const tickLab = document.createElement("span");
      tickLab.textContent = timelineTimeUnit === "frames"
        ? String(t)
        : formatSecondsValue(t / wiggleFps);
      m.appendChild(tickLab);
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

  const addMotionRow = (name: string, read: () => LayerAnimation | undefined, write: (animation: LayerAnimation) => void) => {
    const animation = read();
    if (!animation?.enabled) return;
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
    track.appendChild(makeAnimBar("layer", animation, animation.startTick, totalTicks, (timing) => {
      const current = read();
      if (!current) return;
      write({ ...current, startTick: timing.startTick, durationTicks: timing.durationTicks });
    }));
    row.appendChild(track);
    tl.appendChild(row);
  };

  addRow(
    `Panel`,
    () => panel.enter, (a) => { panel.enter = a; commitHistory(); },
    () => panel.exit,  (a) => { panel.exit  = a; commitHistory(); },
  );

  let subAnimIndex = 0;
  walkSubPanels(panel, (sp) => {
    subAnimIndex++;
    addRow(
      sp.group ? `Group: ${subPanelLabel(sp)}` : `Sub ${subAnimIndex} (${sp.shape})`,
      () => sp.enter, (a) => { sp.enter = a; commitHistory(); },
      () => sp.exit,  (a) => { sp.exit  = a; commitHistory(); },
    );
    if (sp.group) {
      addMotionRow(`Group motion: ${subPanelLabel(sp)}`, () => sp.animation, (animation) => {
        sp.animation = animation;
        commitHistory();
      });
    }
  });

  const allPanelLayers = [...panel.layers];
  walkSubPanels(panel, (sp) => allPanelLayers.push(...sp.layers));
  allPanelLayers.forEach((l) => {
    if (l.fadeIn || l.fadeOut) {
      addRow(
        `Layer fade: ${l.name}`,
        () => l.fadeIn ? { kind: "fade", ...l.fadeIn } : undefined,
        (a) => { l.fadeIn = { durationTicks: a.durationTicks, startTick: a.startTick }; commitHistory(); },
        () => l.fadeOut ? { kind: "fade", ...l.fadeOut } : undefined,
        (a) => { l.fadeOut = { durationTicks: a.durationTicks, startTick: a.startTick }; commitHistory(); },
      );
    }
    addMotionRow(`Layer: ${l.name}`, () => l.animation, (animation) => {
      l.animation = animation;
      commitHistory();
    });
    (l.texts ?? []).forEach((t) => {
      addRow(
        `"${t.content.length > 12 ? t.content.slice(0, 12) + "…" : t.content}"`,
        () => t.enter, (a) => { t.enter = a; commitHistory(); },
        () => t.exit,  (a) => { t.exit  = a; commitHistory(); },
      );
    });
  });

  // Empty-state hint
  let hasSubAnim = false;
  walkSubPanels(panel, (sp) => {
    if ((sp.enter?.kind ?? "none") !== "none" || (sp.exit?.kind ?? "none") !== "none" || sp.animation?.enabled) hasSubAnim = true;
  });
  const hasAny = (panel.enter && panel.enter.kind !== "none") ||
                 (panel.exit && panel.exit.kind !== "none") ||
                 hasSubAnim ||
                 allPanelLayers.some(l => !!l.animation?.enabled || !!l.fadeIn || !!l.fadeOut) ||
                 allPanelLayers.some(l => (l.texts ?? []).some(t => (t.enter?.kind ?? "none") !== "none" || (t.exit?.kind ?? "none") !== "none"));
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
  if (timelineTimeUnit === "frames") {
    const totalFrames = Math.max(1, durationMsToAbsoluteTicks(total, project.wiggleFps));
    const step = Math.max(1, Math.ceil(totalFrames / 12));
    for (let f = 0; f <= totalFrames; f += step) {
      const tick = document.createElement("div");
      tick.className = "audio-ruler-tick";
      tick.style.left = `${(f / totalFrames) * 100}%`;
      tick.textContent = `${f}f`;
      ruler.appendChild(tick);
    }
    if (totalFrames % step !== 0) {
      const tick = document.createElement("div");
      tick.className = "audio-ruler-tick";
      tick.style.left = "100%";
      tick.textContent = `${totalFrames}f`;
      ruler.appendChild(tick);
    }
  } else {
    const ticks = Math.max(2, Math.ceil(total / 1000));
    for (let i = 0; i <= ticks; i++) {
      const tick = document.createElement("div");
      tick.className = "audio-ruler-tick";
      tick.style.left = `${(i / ticks) * 100}%`;
      tick.textContent = `${i}s`;
      ruler.appendChild(tick);
    }
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
  return formatTimelineTime(ms, "seconds", project.wiggleFps);
}

function formatPlayheadTime(ms: number) {
  return formatTimelineTime(ms, timelineTimeUnit, project.wiggleFps);
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
  mkCrumb(`Panel ${activePanelIndex + 1}`, activeSubPanelPath.length ? () => {
    exitToSubPanelPath([]);
    buildBreadcrumb();
    buildLayers();
    buildInspector();
    buildEditContext();
  } : undefined);
  const panel = activePanel();
  for (let depth = 0; depth < activeSubPanelPath.length; depth++) {
    const path = activeSubPanelPath.slice(0, depth + 1);
    const sp = subPanelAtPath(panel, path);
    const label = sp
      ? `▸ ${sp.group ? subPanelLabel(sp) : `${isBalloonShape(sp.shape) ? "Balloon" : "Sub-Panel"} (${sp.shape})`}`
      : "▸ Sub-Panel";
    host.appendChild(document.createTextNode(" "));
    const isLeaf = depth === activeSubPanelPath.length - 1;
    mkCrumb(label, isLeaf ? undefined : () => {
      exitToSubPanelPath(path);
      buildBreadcrumb();
      buildLayers();
      buildInspector();
      buildEditContext();
    });
  }
}

/** Toggle `.active` on existing layer rows so expand/collapse can CSS-ease. */
function syncLayerRowActiveStates(host: HTMLElement, activeIndex: number) {
  host.querySelectorAll<HTMLElement>(".layer-row").forEach((row) => {
    if (row.dataset.stackKind === "subpanel") {
      row.classList.toggle("active", false);
      return;
    }
    const index = Number(row.dataset.layerIndex);
    if (Number.isNaN(index)) return;
    const active = index === activeIndex;
    row.classList.toggle("active", active);
    const expanded = row.querySelector(".layer-expanded");
    if (expanded) expanded.setAttribute("aria-hidden", String(!active));
    const op = row.querySelector<HTMLInputElement>(".layer-op");
    if (op) op.tabIndex = active ? 0 : -1;
  });
}

function syncStackRowActiveStates(host: HTMLElement, opts: {
  activeLayerIndex: number;
  selectedSubPanelId: string | null;
}) {
  host.querySelectorAll<HTMLElement>(".layer-row").forEach((row) => {
    const kind = row.dataset.stackKind;
    if (kind === "subpanel") {
      const active = row.dataset.subPanelId === opts.selectedSubPanelId;
      row.classList.toggle("active", active);
      return;
    }
    const index = Number(row.dataset.layerIndex);
    if (Number.isNaN(index)) return;
    const active = index === opts.activeLayerIndex && !opts.selectedSubPanelId;
    row.classList.toggle("active", active);
    const expanded = row.querySelector(".layer-expanded");
    if (expanded) expanded.setAttribute("aria-hidden", String(!active));
    const op = row.querySelector<HTMLInputElement>(".layer-op");
    if (op) op.tabIndex = active ? 0 : -1;
  });
}

function bindStackRowReorder(
  row: HTMLElement,
  container: StackContainer,
  stackIndex: number,
  dropIntoGroup?: SubPanel,
) {
  const handle = row.querySelector<HTMLElement>(".drag-handle");
  if (!handle) return;
  handle.draggable = true;
  handle.addEventListener("dragstart", (e) => {
    e.dataTransfer!.setData("text/plain", `stack:${stackIndex}`);
    e.dataTransfer!.effectAllowed = "move";
    row.classList.add("dragging");
  });
  handle.addEventListener("dragend", () => {
    row.classList.remove("dragging");
    document.querySelectorAll(".layer-row").forEach((r) =>
      r.classList.remove("drop-above", "drop-below", "drop-into"));
  });
  row.addEventListener("dragover", (e) => {
    if (!e.dataTransfer?.types.includes("text/plain")) return;
    e.preventDefault();
    const rect = row.getBoundingClientRect();
    const intoGroup = !!dropIntoGroup?.group
      && e.clientY >= rect.top + rect.height * 0.25
      && e.clientY <= rect.bottom - rect.height * 0.25;
    const isAbove = e.clientY < rect.top + rect.height / 2;
    document.querySelectorAll(".layer-row").forEach((r) =>
      r.classList.remove("drop-above", "drop-below", "drop-into"));
    row.classList.add(intoGroup ? "drop-into" : isAbove ? "drop-above" : "drop-below");
  });
  row.addEventListener("drop", (e) => {
    e.preventDefault();
    row.classList.remove("drop-above", "drop-below", "drop-into");
    const raw = e.dataTransfer!.getData("text/plain");
    if (!raw.startsWith("stack:")) return;
    const from = +raw.slice(6);
    if (Number.isNaN(from)) return;
    const rect = row.getBoundingClientRect();
    const intoGroup = !!dropIntoGroup?.group
      && e.clientY >= rect.top + rect.height * 0.25
      && e.clientY <= rect.bottom - rect.height * 0.25;
    if (intoGroup) {
      const source = ensurePanelStack(container)[from];
      if (source?.kind === "layer" && moveLayerIntoGroup(container, source.id, dropIntoGroup)) {
        selectedSubPanelId = dropIntoGroup.id;
        commitHistory();
        buildLayers();
        buildInspector();
      }
      return;
    }
    const isAbove = e.clientY < rect.top + rect.height / 2;
    // Newest-on-top display: visual above → later in stack array.
    let to = isAbove ? stackIndex + 1 : stackIndex;
    if (from < to) to--;
    if (to === from) return;
    if (!moveStackItem(container, from, to)) return;
    commitHistory();
    buildLayers();
    buildInspector();
  });
}

type StackPreviewSource = { layer: Layer } | { subPanel: SubPanel };
const stackPreviewQueue: Array<() => void> = [];
let stackPreviewFrame = 0;

function pumpStackPreviews() {
  stackPreviewFrame = 0;
  // One full-resolution composite per frame keeps a large layer stack from
  // blocking the editor while its small previews populate.
  stackPreviewQueue.shift()?.();
  if (stackPreviewQueue.length) {
    stackPreviewFrame = requestAnimationFrame(pumpStackPreviews);
  }
}

function makeStackPreview(source: StackPreviewSource): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.className = "layer-preview";
  canvas.width = 48;
  canvas.height = 36;
  canvas.setAttribute("aria-hidden", "true");
  const panel = activePanel();
  const previewPanel: Panel = {
    ...panel,
    bg: "#000000",
    layers: "layer" in source ? [source.layer] : [],
    subPanels: "subPanel" in source ? [source.subPanel] : [],
    stack: "layer" in source
      ? [{ kind: "layer", id: source.layer.id }]
      : [{ kind: "subpanel", id: source.subPanel.id }],
    enter: undefined,
    exit: undefined,
    transitionToNext: undefined,
  };
  stackPreviewQueue.push(() => {
    if (!canvas.isConnected) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.scale(canvas.width / project.width, canvas.height / project.height);
    renderPanel(ctx, previewPanel, wiggleTick, project.width, project.height, {
      skipBg: true,
      skipAnim: true,
      skipJitter: true,
      renderCache: displayRenderCache,
      contentVersion: renderContentVersion,
      deferFillMasks: true,
    });
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  });
  if (!stackPreviewFrame) stackPreviewFrame = requestAnimationFrame(pumpStackPreviews);
  return canvas;
}

function layerContainerAccess(container: StackContainer, path: string[]) {
  const subPanel = path.length ? container as SubPanel : undefined;
  return {
    layers: container.layers,
    getActiveLayerIndex: () => container.activeLayerIndex ?? 0,
    setActiveLayerIndex: (i: number) => { container.activeLayerIndex = i; },
    isSubPanel: path.length > 0,
    subPanel,
    container,
  };
}

function selectLayerRow(
  container: StackContainer,
  containerPath: string[],
  layer: Layer,
  event: MouseEvent,
) {
  const key = containerPath.join("/");
  const displayIds = ensurePanelStack(container).slice().reverse()
    .filter((item): item is { kind: "layer"; id: string } => item.kind === "layer")
    .map((item) => item.id);
  if (selectedLayerContainerKey !== key) {
    selectedLayerIds.clear();
    selectedLayerAnchorId = null;
  }
  selectedLayerContainerKey = key;
  if (event.shiftKey && selectedLayerAnchorId) {
    const from = displayIds.indexOf(selectedLayerAnchorId);
    const to = displayIds.indexOf(layer.id);
    if (from >= 0 && to >= 0) {
      if (!event.metaKey && !event.ctrlKey) selectedLayerIds.clear();
      const [start, end] = from <= to ? [from, to] : [to, from];
      displayIds.slice(start, end + 1).forEach((id) => selectedLayerIds.add(id));
    }
  } else if (event.metaKey || event.ctrlKey) {
    if (selectedLayerIds.has(layer.id)) selectedLayerIds.delete(layer.id);
    else selectedLayerIds.add(layer.id);
    selectedLayerAnchorId = layer.id;
  } else {
    selectedLayerIds.clear();
    selectedLayerIds.add(layer.id);
    selectedLayerAnchorId = layer.id;
  }
  activeSubPanelPath = [...containerPath];
  const index = container.layers.findIndex((candidate) => candidate.id === layer.id);
  if (index >= 0) container.activeLayerIndex = index;
  selectedSubPanelId = null;
  selectedText = null;
}

function buildLayers() {
  stackPreviewQueue.length = 0;
  const host = $("layers");
  host.innerHTML = "";
  const panel = activePanel();
  if (panel.kind === "timelapse" && !activeSubPanelPath.length) {
    host.innerHTML = '<div class="context-hint">Timelapse panels have no layers — edit the source panel.</div>';
    return;
  }
  const cont = activeContainer();
  buildContainerStackLayers(host, panel, []);

  const addHost = document.getElementById("layer-add-actions") ?? host;
  if (addHost !== host) addHost.innerHTML = "";
  const addRow = addHost === host
    ? Object.assign(document.createElement("div"), { className: "layer-add-actions" })
    : addHost;

  addRow.appendChild(iconButton(StudioIcons.LayerAdd, "Add layer", () => {
    const layer = newLayer(`Layer ${cont.layers.length + 1}`);
    cont.layers.push(layer);
    noteRootLayerInserted(layer.id);
    cont.setActiveLayerIndex(cont.layers.length - 1);
    selectedSubPanelId = null;
    commitHistory();
    buildLayers();
  }, "ghost iconbtn"));

  addRow.appendChild(iconButton(StudioIcons.Tone, "Add manga tone layer", () => {
    const layer = newLayer("Manga tone", "tone");
    cont.layers.push(layer);
    noteRootLayerInserted(layer.id);
    cont.setActiveLayerIndex(cont.layers.length - 1);
    selectedSubPanelId = null;
    commitHistory();
    buildLayers();
    buildInspector();
  }, "ghost iconbtn"));

  addRow.appendChild(iconButton(StudioIcons.Raster, "Add raster layer", () => {
    const raster = newLayer("Raster", "raster", { width: project.width, height: project.height });
    cont.layers.push(raster);
    noteRootLayerInserted(raster.id);
    cont.setActiveLayerIndex(cont.layers.length - 1);
    selectedSubPanelId = null;
    getRasterCanvas(raster); // start decoding the seeded transparent bitmap
    commitHistory();
    buildLayers();
    buildInspector();
  }, "ghost iconbtn"));

  const groupButton = iconButton(StudioIcons.Layers, "Group selected layers", () => {
    groupSelectedLayers();
  }, "ghost iconbtn");
  groupButton.disabled = !activeLayer();
  addRow.appendChild(groupButton);

  if (addHost === host) host.appendChild(addRow);

  // Rulers are layer-bound: switching layers can swap which ruler applies,
  // so keep the perspective inspector in sync.
  if (currentBrush === PERSPECTIVE_KEY) buildPerspectiveInspector();
  refreshTimelinePanelActionsBar();
}

function buildContainerStackLayers(host: HTMLElement, container: StackContainer, containerPath: string[]) {
  const stack = ensurePanelStack(container);
  const cont = layerContainerAccess(container, containerPath);
  const panel = activePanel();
  const containerIsActive = containerPath.join("/") === activeSubPanelPath.join("/");

  for (let displayPos = 0; displayPos < stack.length; displayPos++) {
    const si = stack.length - 1 - displayPos;
    const item = stack[si];
    if (item.kind === "subpanel") {
      const sp = (container.subPanels ?? []).find((s) => s.id === item.id);
      if (!sp) continue;
      const isActive = selectedSubPanelId === sp.id;
      const row = document.createElement("div");
      row.className = "layer-row subpanel-row" + (isActive ? " active" : "")
        + (sp.locked ? " locked" : "");
      row.dataset.stackKind = "subpanel";
      row.dataset.stackIndex = String(si);
      row.dataset.subPanelId = sp.id;

      const handle = document.createElement("span");
      handle.textContent = "⋮⋮";
      handle.className = "drag-handle";
      handle.title = "Drag to reorder";
      row.appendChild(handle);

      const spacer = document.createElement("span");
      if (sp.group) {
        const visible = document.createElement("input");
        visible.type = "checkbox";
        visible.checked = sp.visible !== false;
        visible.title = "Show or hide this group";
        visible.onchange = () => {
          sp.visible = visible.checked;
          commitHistory();
        };
        row.appendChild(visible);
      } else {
        spacer.className = "layer-vis-spacer";
        spacer.title = "Sub-panels stay visible; enter to edit their layers";
        row.appendChild(spacer);
      }

      row.appendChild(makeStackPreview({ subPanel: sp }));

      const nameCell = document.createElement("div");
      nameCell.className = "layer-name-cell";
      if (sp.group) {
        const expanded = !collapsedLayerGroupIds.has(sp.id);
        const disclosure = iconButton(
          expanded ? StudioIcons.ChevronDown : StudioIcons.ChevronRight,
          expanded ? "Collapse group" : "Expand group",
          (e) => {
            e.stopPropagation();
            if (expanded) collapsedLayerGroupIds.add(sp.id);
            else collapsedLayerGroupIds.delete(sp.id);
            buildLayers();
          },
          "group-disclosure iconbtn",
        );
        disclosure.setAttribute("aria-expanded", String(expanded));
        nameCell.appendChild(disclosure);
      }
      const nameEl = document.createElement("span");
      nameEl.className = "layer-label";
      nameEl.textContent = subPanelLabel(sp);
      nameEl.title = sp.group
        ? "Click to select · double-click to open · drop layers here to group"
        : "Click to select · double-click to enter";
      nameCell.appendChild(nameEl);
      const kindTag = document.createElement("span");
      kindTag.className = "layer-tag";
      kindTag.textContent = sp.group ? "GRP" : isBalloonShape(sp.shape) ? "BLN" : "SUB";
      kindTag.title = sp.group
        ? "Layer group — nested layers share visibility and fade timing"
        : isBalloonShape(sp.shape)
        ? "Speech balloon — drag to place above or below"
        : "Sub-panel frame — drag to place drawings above or below";
      nameCell.appendChild(kindTag);
      row.appendChild(nameCell);

      const enterBtn = iconButton(StudioIcons.Layers, sp.group ? "Open group" : "Enter sub-panel", (e) => {
        e.stopPropagation();
        enterChildSubPanel(sp.id);
        buildBreadcrumb();
        buildLayers();
        buildInspector();
      });

      const del = iconButton(StudioIcons.Trash, sp.group ? "Delete group and its contents" : "Delete sub-panel", (e) => {
        e.stopPropagation();
        removeSubPanelById(panel, sp.id);
        if (activeSubPanelPath.includes(sp.id)) {
          activeSubPanelPath = sanitizeSubPanelPath(panel, activeSubPanelPath);
        }
        if (selectedSubPanelId === sp.id) selectedSubPanelId = null;
        selectedLayerIds.clear();
        selectedLayerAnchorId = null;
        selectedLayerContainerKey = "";
        commitHistory();
        buildBreadcrumb();
        buildLayers();
        buildInspector();
      });
      const rowActions = document.createElement("div");
      rowActions.className = "layer-actions";
      if (sp.group) {
        const lock = iconButton(
          sp.locked ? StudioIcons.Lock : StudioIcons.Unlock,
          sp.locked ? "Unlock group" : "Lock group",
          (e) => {
            e.stopPropagation();
            sp.locked = !sp.locked;
            commitHistory();
            buildLayers();
            buildInspector();
          },
        );
        lock.classList.toggle("active", !!sp.locked);
        rowActions.appendChild(lock);
      }
      rowActions.append(enterBtn, del);
      row.appendChild(rowActions);

      bindStackRowReorder(row, container, si, sp.group ? sp : undefined);

      row.onclick = (e) => {
        const t = e.target as HTMLElement;
        if (t.tagName === "INPUT" || t.tagName === "BUTTON" || t.classList.contains("drag-handle")) return;
        selectedSubPanelId = sp.id;
        selectedLayerIds.clear();
        selectedLayerAnchorId = null;
        selectedLayerContainerKey = "";
        selectedText = null;
        syncStackRowActiveStates(host, {
          activeLayerIndex: cont.getActiveLayerIndex(),
          selectedSubPanelId,
        });
        buildInspector();
        refreshTimelinePanelActionsBar();
      };
      row.ondblclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        enterChildSubPanel(sp.id);
        buildBreadcrumb();
        buildLayers();
        buildInspector();
      };
      host.appendChild(row);
      if (sp.group && !collapsedLayerGroupIds.has(sp.id)) {
        const children = document.createElement("div");
        children.className = "layer-group-children";
        children.dataset.groupId = sp.id;
        buildContainerStackLayers(children, sp, [...containerPath, sp.id]);
        host.appendChild(children);
      }
      continue;
    }

    const li = container.layers.findIndex((l) => l.id === item.id);
    if (li < 0) continue;
    appendLayerRow(host, panel, cont, li, {
      stackIndex: si,
      rootStack: true,
      isActive: containerIsActive && li === cont.getActiveLayerIndex() && !selectedSubPanelId,
      containerPath,
    });
  }
}

function appendLayerRow(
  host: HTMLElement,
  panel: Panel,
  cont: ReturnType<typeof activeContainer>,
  li: number,
  opts: { stackIndex: number; rootStack: boolean; isActive: boolean; containerPath: string[] }
) {
  const layer = cont.layers[li];
  const isActive = opts.isActive;
  const row = document.createElement("div");
  row.className = "layer-row" + (isActive ? " active" : "")
    + (selectedLayerIds.has(layer.id) ? " multi-selected" : "")
    + (layer.locked ? " locked" : "");
  row.dataset.stackKind = "layer";
  row.dataset.stackIndex = String(opts.stackIndex);
  row.dataset.layerIndex = String(li);
  row.dataset.layerId = layer.id;

  const handle = document.createElement("span");
  handle.textContent = "⋮⋮"; handle.className = "drag-handle"; handle.title = "Drag to reorder";
  row.appendChild(handle);

  const vis = document.createElement("input");
  vis.type = "checkbox"; vis.checked = layer.visible;
  vis.onchange = () => { layer.visible = vis.checked; commitHistory(); };
  row.appendChild(vis);

  row.appendChild(makeStackPreview({ layer }));

  const nameEl = document.createElement("span");
  nameEl.className = "layer-label";
  nameEl.textContent = layer.name;
  nameEl.title = "Click to rename";
  nameEl.tabIndex = 0;
  nameEl.setAttribute("role", "button");
  nameEl.setAttribute("aria-label", `Rename layer ${layer.name}`);
  const activateSelection = (event: MouseEvent) => {
    toneToolActive = false;
    toneToolPrevLayerIndex = null;
    selectLayerRow(cont.container, opts.containerPath, layer, event);
    syncBrushAvailability(true);
    buildBreadcrumb();
    buildLayers();
    buildInspector();
    buildBrushBar();
    refreshTimelinePanelActionsBar();
  };
  const beginRename = () => {
    if (!nameEl.isConnected) return;
    if (layer.locked) {
      setStatus("Layer is locked · unlock it before renaming");
      return;
    }
    if (!isActive) {
      toneToolActive = false;
      toneToolPrevLayerIndex = null;
      activeSubPanelPath = [...opts.containerPath];
      cont.setActiveLayerIndex(li);
      selectedSubPanelId = null;
      if (opts.rootStack) {
        syncStackRowActiveStates(host, { activeLayerIndex: li, selectedSubPanelId: null });
      } else {
        syncLayerRowActiveStates(host, li);
      }
      syncBrushAvailability(true);
      buildInspector();
      buildBrushBar();
    }
    const originalName = layer.name;
    const nm = document.createElement("input");
    nm.type = "text"; nm.value = layer.name; nm.className = "layer-name";
    nm.setAttribute("aria-label", `Layer name for ${layer.name}`);
    let finished = false;
    const finishRename = (commit: boolean) => {
      if (finished) return;
      finished = true;
      if (commit && nm.value !== originalName) {
        layer.name = nm.value;
        commitHistory();
      }
      buildLayers();
      buildInspector();
    };
    nm.addEventListener("click", (e) => e.stopPropagation());
    nm.addEventListener("keydown", (ke) => {
      ke.stopPropagation();
      if (ke.key === "Enter") {
        ke.preventDefault();
        finishRename(true);
      } else if (ke.key === "Escape") {
        ke.preventDefault();
        finishRename(false);
      }
    });
    nm.addEventListener("blur", () => finishRename(true));
    nameEl.replaceWith(nm);
    nm.focus();
    nm.select();
  };
  nameEl.addEventListener("click", (e) => {
    e.stopPropagation();
    if (e.metaKey || e.ctrlKey || e.shiftKey) {
      activateSelection(e);
      return;
    }
    beginRename();
  });
  nameEl.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== "F2") return;
    e.preventDefault();
    e.stopPropagation();
    beginRename();
  });
  const nameCell = document.createElement("div");
  nameCell.className = "layer-name-cell";
  const kindTag = document.createElement("span");
  kindTag.className = "layer-tag";
  if (layer.kind === "text") {
    kindTag.textContent = "T";
    kindTag.title = "Text layer";
  } else if (layer.kind === "tone") {
    kindTag.textContent = "TONE";
    kindTag.title = layer.tone?.coverage === "painted"
      ? "Manga tone layer — paint to reveal the pattern, static (never wiggles)"
      : "Manga tone layer — full-bleed pattern, static (never wiggles)";
  } else if (layer.kind === "raster") {
    kindTag.textContent = "PX";
    kindTag.title = "Raster layer — paints real pixels, never wiggles";
  } else {
    kindTag.textContent = "VR";
    kindTag.title = "Vector layer — strokes stay editable and can wiggle";
  }
  nameCell.append(nameEl, kindTag);
  const badge = layerMaskBadge(layer);
  if (badge) {
    const tag = document.createElement("span");
    tag.className = "layer-tag layer-tag-mask";
    tag.textContent = maskOverlayLayerId === layer.id ? "MASK*" : badge;
    tag.title = layer.mask?.enabled === false ? "Mask disabled" : "Layer mask";
    nameCell.appendChild(tag);
  }
  row.appendChild(nameCell);

  const del = iconButton(StudioIcons.Trash, "Delete layer", (e) => {
    e.stopPropagation();
    if (cont.layers.length <= 1) return;
    const removedId = layer.id;
    selectedLayerIds.delete(removedId);
    cont.layers.splice(li, 1);
    noteRootLayerRemoved(removedId);
    cont.setActiveLayerIndex(Math.max(0, Math.min(cont.getActiveLayerIndex(), cont.layers.length - 1)));
    prunePerspectiveGuides(panel);
    commitHistory();
    buildLayers();
    buildInspector();
  });
  if (cont.layers.length <= 1) del.disabled = true;
  const lock = iconButton(
    layer.locked ? StudioIcons.Lock : StudioIcons.Unlock,
    layer.locked ? "Unlock layer" : "Lock layer",
    (e) => {
      e.stopPropagation();
      layer.locked = !layer.locked;
      if (layer.locked && selectedText?.layer === layer) selectedText = null;
      commitHistory([layer]);
      buildLayers();
      buildInspector();
    },
  );
  lock.classList.toggle("active", !!layer.locked);
  const topActions = document.createElement("div");
  topActions.className = "layer-actions layer-top-actions";
  topActions.append(lock, del);
  row.appendChild(topActions);

  const expanded = document.createElement("div");
  expanded.className = "layer-expanded";
  expanded.setAttribute("aria-hidden", String(!isActive));
  const expandedInner = document.createElement("div");
  expandedInner.className = "layer-expanded-inner";

  const meter = document.createElement("div");
  meter.className = "layer-expanded-meter";
  const opLabel = document.createElement("span");
  opLabel.textContent = `${Math.round(layer.opacity * 100)}%`;
  opLabel.className = "layer-op-label";
  const op = document.createElement("input");
  op.type = "range"; op.min = "0"; op.max = "1"; op.step = "0.05";
  op.value = String(layer.opacity); op.className = "layer-op";
  op.tabIndex = isActive ? 0 : -1;
  op.disabled = !!layer.locked;
  op.oninput = () => { layer.opacity = +op.value; opLabel.textContent = `${Math.round(layer.opacity * 100)}%`; };
  op.onchange = () => { commitHistory(); };
  meter.append(op, opLabel);

  const activateRow = () => {
    activeSubPanelPath = [...opts.containerPath];
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
  if (layer.kind === "draw") {
    const rasterize = document.createElement("button");
    rasterize.type = "button";
    rasterize.className = "cellbtn iconbtn";
    rasterize.textContent = "PX";
    rasterize.title = "Rasterize layer (destructive)";
    rasterize.setAttribute("aria-label", rasterize.title);
    rasterize.onclick = (e) => { e.stopPropagation(); activateRow(); rasterizeActiveLayer(); };
    actions.appendChild(rasterize);
  }
  const paste = iconButton(StudioIcons.ClipboardPaste, "Paste above", (e) => {
    e.stopPropagation(); activateRow(); pasteLayerAboveActive();
  });
  paste.disabled = !layerClipboard;
  actions.appendChild(paste);
  if (layer.locked) {
    actions.querySelectorAll<HTMLButtonElement>("button").forEach((button) => { button.disabled = true; });
  }
  expandedInner.append(meter, actions);
  expanded.appendChild(expandedInner);
  row.appendChild(expanded);

  if (opts.rootStack) {
    bindStackRowReorder(row, cont.container, opts.stackIndex);
  } else {
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
  }

  row.onclick = (e) => {
    const t = e.target as HTMLElement;
    if (t.tagName === "INPUT" || t.tagName === "BUTTON" || t.classList.contains("drag-handle")) return;
    activateSelection(e);
  };
  host.appendChild(row);
}

function refreshTimelinePanelActionsBar() {
  if (timelineTab !== "panels") return;
  const existing = document.querySelector(".timeline-panel-actions");
  if (!existing?.parentElement) return;
  existing.replaceWith(buildTimelinePanelActionsBar());
}

// ---- inspector ------------------------------------------------------------

function buildProjectSettings() {
  const host = $("project-settings");
  host.innerHTML = "";

  const row = (label: string, child: HTMLElement) => {
    const wrap = document.createElement("div");
    wrap.className = "property-row";
    const lab = document.createElement("span");
    lab.textContent = label;
    lab.className = "property-label";
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
  fpsUnit.className = "property-note";
  fpsUnit.textContent = "Ticks per second for hand-drawn wiggle (default 8). Panel durations are measured in these ticks.";
  host.appendChild(fpsUnit);
}

function buildInspector() {
  updateToolContext();
  const host = $("inspector");
  const subPanelHost = $("subpanel-inspector");
  const balloonHost = $("balloon-inspector");
  host.innerHTML = "";
  subPanelHost.innerHTML = "";
  balloonHost.innerHTML = "";

  const summaryEl = document.getElementById("inspector-heading");

  if (selectedText) {
    if (summaryEl) setInspectorModuleSummaryLabel(summaryEl, "Text Properties");
  } else if (selectedSubPanelId) {
    const sp = findSubPanelById(activePanel(), selectedSubPanelId);
    if (summaryEl) {
      setInspectorModuleSummaryLabel(
        summaryEl,
        sp?.group ? "Layer Group" : sp && isBalloonShape(sp.shape) ? "Balloon Properties" : "Sub-Panel Properties",
      );
    }
  } else {
    if (summaryEl) setInspectorModuleSummaryLabel(summaryEl, "Panel");
  }

  if (isSequenceTab() && selectedAudioClipId) {
    appendEditInspector(host);
  }

  if (selectedText) {
    appendTextInspector(host, selectedText);
    if (selectedText.layer.locked || activeContainerIsLocked()) {
      host.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>("input, button, select")
        .forEach((control) => { control.disabled = true; });
    }
    return;
  }

  if (selectedSubPanelId) {
    const sp = findSubPanelById(activePanel(), selectedSubPanelId);
    if (!sp) { selectedSubPanelId = null; return; }
    if (sp.group) {
      appendLayerGroupInspector(subPanelHost, sp);
    } else if (isBalloonShape(sp.shape)) {
      const shapes = sp.shape === "custom" ? (["custom", ...BALLOON_SHAPES] as SubPanelShape[]) : BALLOON_SHAPES;
      appendSubPanelInspector(balloonHost, sp, shapes, (shape) => {
        pendingBalloonShape = isBalloonShape(shape) ? shape : pendingBalloonShape;
      });
    } else {
      const shapes = sp.shape === "custom" ? (["custom", ...PANEL_SHAPES] as SubPanelShape[]) : PANEL_SHAPES;
      appendSubPanelInspector(subPanelHost, sp, shapes, (shape) => {
        if (shape !== "custom") pendingSubPanelShape = shape;
      });
    }
  } else if (currentBrush === SUBPANEL_KEY) {
    appendSubPanelToolInspector(subPanelHost);
  } else if (currentBrush === CUT_SUBPANEL_KEY) {
    appendCutSubPanelToolInspector(subPanelHost);
  } else if (currentBrush === BALLOON_KEY) {
    appendBalloonToolInspector(balloonHost);
  }

  appendPanelAnimInspector(host, activePanel());
  buildLayerNoiseDisplace();
  buildLayerCompositing();
  buildLayerToneEffects();
  buildLayerAnimation();
  if (!activeLayerIsEditable()) {
    for (const id of ["layer-compositing", "layer-tone-effects", "layer-animation", "layer-noise-displace"]) {
      document.getElementById(id)?.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>(
        "input, button, select",
      ).forEach((control) => { control.disabled = true; });
    }
  }
}

function appendLayerGroupInspector(host: HTMLElement, group: SubPanel) {
  const row = (label: string, child: HTMLElement) => {
    const wrap = document.createElement("div");
    wrap.className = "inspector-field";
    const lab = document.createElement("span");
    lab.className = "inspector-field-label";
    lab.textContent = label;
    wrap.append(lab, child);
    host.appendChild(wrap);
  };

  const name = document.createElement("input");
  name.type = "text";
  name.value = group.name ?? "Layer Group";
  name.onchange = () => {
    group.name = name.value.trim() || "Layer Group";
    commitHistory();
    buildBreadcrumb();
    buildLayers();
  };
  row("Name", name);

  const visible = document.createElement("input");
  visible.type = "checkbox";
  visible.checked = group.visible !== false;
  visible.onchange = () => {
    group.visible = visible.checked;
    commitHistory();
    buildLayers();
  };
  row("Visible", visible);

  appendFadePicker(host, "Fade in", () => group.enter?.kind === "fade"
    ? { durationTicks: group.enter.durationTicks, startTick: group.enter.startTick }
    : undefined, (fade) => {
      group.enter = fade ? { kind: "fade", ...fade } : undefined;
      commitHistory();
      buildTimeline();
    });
  appendFadePicker(host, "Fade out", () => group.exit?.kind === "fade"
    ? { durationTicks: group.exit.durationTicks, startTick: group.exit.startTick }
    : undefined, (fade) => {
      group.exit = fade ? { kind: "fade", ...fade } : undefined;
      commitHistory();
      buildTimeline();
    });

  const note = document.createElement("div");
  note.className = "property-note";
  note.textContent = `${group.layers.length} direct layer${group.layers.length === 1 ? "" : "s"}. Drag another layer onto the middle of this row to add it.`;
  host.appendChild(note);

  const actions = document.createElement("div");
  actions.className = "inspector-buttons";
  const enter = document.createElement("button");
  enter.type = "button";
  enter.className = "cellbtn";
  enter.textContent = "Open group";
  enter.onclick = () => {
    enterChildSubPanel(group.id);
    buildBreadcrumb();
    buildLayers();
    buildInspector();
  };
  const ungroup = document.createElement("button");
  ungroup.type = "button";
  ungroup.className = "cellbtn";
  ungroup.textContent = "Ungroup";
  ungroup.title = "Move this group's contents back into its parent stack";
  ungroup.onclick = () => {
    if (!ungroupLayerGroup(group)) return;
    commitHistory();
    buildBreadcrumb();
    buildLayers();
    buildInspector();
  };
  actions.append(enter, ungroup);
  host.appendChild(actions);
}

/** Tone texture controls — shown for tone layers only, outside Layer Animation. */
function buildLayerToneEffects() {
  const host = document.getElementById("layer-tone-effects");
  if (!host) return;
  host.replaceChildren();

  const layer = activeLayer();
  const tone = layer?.kind === "tone" ? layer.tone : undefined;
  if (!layer || !tone) {
    host.hidden = true;
    return;
  }
  host.hidden = false;

  const title = document.createElement("div");
  title.className = "layer-tone-effects-title";
  title.textContent = "Tone";
  host.appendChild(title);

  const rowInto = (labelText: string, child: HTMLElement) => {
    const wrap = document.createElement("div");
    wrap.className = "inspector-field";
    const lab = document.createElement("span");
    lab.className = "inspector-field-label";
    lab.textContent = labelText;
    wrap.append(lab, child);
    host.appendChild(wrap);
  };

  const style = document.createElement("select");
  style.className = "chip";
  const toneStyles: { value: ToneStyle; label: string }[] = [
    { value: "halftone", label: "Halftone dots" },
    { value: "hatch", label: "Hatching" },
    { value: "crosshatch", label: "Crosshatching" },
  ];
  for (const option of toneStyles) {
    const el = document.createElement("option");
    el.value = option.value;
    el.textContent = option.label;
    el.selected = tone.style === option.value;
    style.appendChild(el);
  }
  style.onchange = () => {
    tone.style = style.value as ToneStyle;
    commitHistory([layer]);
    buildLayers();
  };
  rowInto("Texture", style);

  appendColorRow(host, "Color", () => tone.color, (color) => { tone.color = color; });

  const toneRange = (
    label: string,
    key: "spacing" | "size" | "angle",
    min: number,
    max: number,
    step: number
  ) => {
    const input = document.createElement("input");
    input.type = "range";
    input.min = String(min); input.max = String(max); input.step = String(step);
    input.value = String(tone[key]);
    input.oninput = () => {
      tone[key] = +input.value;
      editorPreviewInvalidated = true;
      requestLoopFrame();
    };
    input.onchange = () => commitHistory([layer]);
    rowInto(label, input);
  };
  toneRange("Spacing", "spacing", 4, 80, 1);
  toneRange("Dot / line", "size", 1, 48, 0.5);
  toneRange("Angle", "angle", 0, 180, 1);

  const gradient = document.createElement("select");
  gradient.className = "chip";
  for (const [value, label] of [["none", "None"], ["linear", "Linear fade"], ["radial", "Radial fade"]] as const) {
    const option = document.createElement("option");
    option.value = value; option.textContent = label;
    option.selected = (tone.gradient?.kind ?? "none") === value;
    gradient.appendChild(option);
  }
  gradient.onchange = () => {
    if (gradient.value === "none") delete tone.gradient;
    else {
      const kind = gradient.value as "linear" | "radial";
      tone.gradient = kind === "radial"
        ? { kind, start: { x: project.width / 2, y: project.height / 2 }, end: { x: project.width, y: project.height / 2 } }
        : { kind, start: { x: 0, y: project.height / 2 }, end: { x: project.width, y: project.height / 2 } };
    }
    commitHistory([layer]);
    buildLayerToneEffects();
  };
  rowInto("Gradient", gradient);

  if (tone.gradient) {
    const reverse = document.createElement("input");
    reverse.type = "checkbox";
    reverse.checked = !!tone.gradient.reverse;
    reverse.title = "Fade from light to dark instead of dark to light";
    reverse.onchange = () => {
      if (!tone.gradient) return;
      tone.gradient.reverse = reverse.checked;
      commitHistory([layer]);
    };
    rowInto("Reverse fade", reverse);
  }

  const coverAll = document.createElement("input");
  coverAll.type = "checkbox";
  coverAll.checked = tone.coverage === "full";
  coverAll.title = "Off: strokes reveal the tone pattern. On: the pattern fills the whole layer.";
  coverAll.onchange = () => {
    tone.coverage = coverAll.checked ? "full" : "painted";
    commitHistory([layer]);
    buildLayers();
  };
  rowInto("Cover entire layer", coverAll);
}

/** Noise displace sits above Layer Animation — raster/tone layers only. */
function buildLayerNoiseDisplace() {
  const host = document.getElementById("layer-noise-displace");
  if (!host) return;

  let inner = host.querySelector<HTMLElement>(".layer-noise-displace-inner");
  if (!inner) {
    inner = document.createElement("div");
    inner.className = "layer-noise-displace-inner";
    host.appendChild(inner);
  }

  const layer = activeLayer();
  const show = !!(layer && layerSupportsNoiseDisplace(layer));

  const hideFinished = () => {
    if (host.classList.contains("is-visible")) return;
    host.hidden = true;
    inner.replaceChildren();
  };

  if (!show) {
    if (!host.classList.contains("is-visible") && host.hidden) {
      inner.replaceChildren();
      return;
    }
    host.classList.remove("is-visible");
    host.addEventListener("transitionend", hideFinished, { once: true });
    window.setTimeout(hideFinished, 400);
    return;
  }

  const displaceOn = !!layer!.noiseDisplace?.enabled;
  const toggleId = "layer-noise-displace-enabled";
  inner.replaceChildren();

  const label = document.createElement("label");
  label.className = "brush-subtoggle" + (displaceOn ? " is-on" : "");
  label.htmlFor = toggleId;

  const title = document.createElement("span");
  title.className = "brush-subtoggle-label";
  title.textContent = "Noise displace";

  const toggle = document.createElement("input");
  toggle.type = "checkbox";
  toggle.id = toggleId;
  toggle.setAttribute("role", "switch");
  toggle.setAttribute("aria-controls", "layer-noise-displace-options");
  toggle.checked = displaceOn;
  toggle.title = "Warp this layer’s pixels with seeded noise each wiggle tick";
  toggle.onchange = () => {
    const displace = ensureNoiseDisplace(layer!);
    displace.enabled = toggle.checked;
    commitHistory([layer!]);
    editorPreviewInvalidated = true;
    requestLoopFrame();
    buildLayerNoiseDisplace();
  };

  const track = document.createElement("span");
  track.className = "brush-subtoggle-switch";
  track.setAttribute("aria-hidden", "true");
  label.append(title, toggle, track);
  inner.appendChild(label);

  if (displaceOn && layer!.noiseDisplace) {
    const options = document.createElement("div");
    options.id = "layer-noise-displace-options";
    options.className = "brush-subtoggle-body";

    const rowInto = (parent: HTMLElement, labelText: string, child: HTMLElement) => {
      const wrap = document.createElement("div");
      wrap.className = "inspector-field";
      const lab = document.createElement("span");
      lab.className = "inspector-field-label";
      lab.textContent = labelText;
      wrap.append(lab, child);
      parent.appendChild(wrap);
    };

    const displace = layer!.noiseDisplace;
    const previewInput = (write: () => void) => {
      write();
      editorPreviewInvalidated = true;
      requestLoopFrame();
    };
    const amp = document.createElement("input");
    amp.type = "range"; amp.min = "1"; amp.max = "32"; amp.step = "1";
    amp.value = String(displace.amplitude);
    amp.oninput = () => previewInput(() => { displace.amplitude = +amp.value; });
    amp.onchange = () => commitHistory([layer!]);
    rowInto(options, "Displace amt", amp);

    const cell = document.createElement("input");
    cell.type = "range"; cell.min = "8"; cell.max = "128"; cell.step = "4";
    cell.value = String(displace.cellSize);
    cell.oninput = () => previewInput(() => { displace.cellSize = +cell.value; });
    cell.onchange = () => commitHistory([layer!]);
    rowInto(options, "Cell size", cell);

    const speed = document.createElement("input");
    speed.type = "range"; speed.min = "0.25"; speed.max = "3"; speed.step = "0.25";
    speed.value = String(displace.speed);
    speed.oninput = () => previewInput(() => { displace.speed = +speed.value; });
    speed.onchange = () => commitHistory([layer!]);
    rowInto(options, "Displace spd", speed);

    inner.appendChild(options);
  }

  const panelActions = document.createElement("div");
  panelActions.className = "layer-noise-displace-panel-actions";

  const includeToneId = "layer-noise-displace-include-tone";
  const includeLabel = document.createElement("label");
  includeLabel.className = "brush-subtoggle" + (noiseDisplaceIncludeTone ? " is-on" : "");
  includeLabel.htmlFor = includeToneId;
  const includeTitle = document.createElement("span");
  includeTitle.className = "brush-subtoggle-label";
  includeTitle.textContent = "Include tone";
  const includeToggle = document.createElement("input");
  includeToggle.type = "checkbox";
  includeToggle.id = includeToneId;
  includeToggle.setAttribute("role", "switch");
  includeToggle.checked = noiseDisplaceIncludeTone;
  includeToggle.title = "Also apply or clear noise displace on tone layers in this panel";
  includeToggle.onchange = () => {
    noiseDisplaceIncludeTone = includeToggle.checked;
    buildLayerNoiseDisplace();
  };
  const includeTrack = document.createElement("span");
  includeTrack.className = "brush-subtoggle-switch";
  includeTrack.setAttribute("aria-hidden", "true");
  includeLabel.append(includeTitle, includeToggle, includeTrack);
  panelActions.appendChild(includeLabel);

  const buttonRow = document.createElement("div");
  buttonRow.className = "layer-noise-displace-panel-buttons";

  const applyAll = document.createElement("button");
  applyAll.type = "button";
  applyAll.className = "act";
  applyAll.textContent = "Apply to all";
  applyAll.title = noiseDisplaceIncludeTone
    ? "Enable noise displace on every raster and tone layer in this panel using these settings"
    : "Enable noise displace on every raster layer in this panel using these settings";
  applyAll.onclick = () => {
    const source = layer!.noiseDisplace ?? DEFAULT_NOISE_DISPLACE;
    const changed = applyNoiseDisplaceToPanelLayers(
      activePanel().layers,
      source,
      { includeTone: noiseDisplaceIncludeTone, enabled: true }
    );
    if (changed.length) {
      commitHistory(changed);
      editorPreviewInvalidated = true;
      requestLoopFrame();
    }
    buildLayerNoiseDisplace();
  };

  const clearAll = document.createElement("button");
  clearAll.type = "button";
  clearAll.className = "ghost";
  clearAll.textContent = "Clear all";
  clearAll.title = noiseDisplaceIncludeTone
    ? "Disable noise displace on every raster and tone layer in this panel"
    : "Disable noise displace on every raster layer in this panel";
  clearAll.onclick = () => {
    const source = layer!.noiseDisplace ?? DEFAULT_NOISE_DISPLACE;
    const changed = applyNoiseDisplaceToPanelLayers(
      activePanel().layers,
      source,
      { includeTone: noiseDisplaceIncludeTone, enabled: false }
    );
    if (changed.length) {
      commitHistory(changed);
      editorPreviewInvalidated = true;
      requestLoopFrame();
    }
    buildLayerNoiseDisplace();
  };

  buttonRow.append(applyAll, clearAll);
  panelActions.appendChild(buttonRow);
  inner.appendChild(panelActions);

  const wasHidden = host.hidden;
  host.hidden = false;
  if (wasHidden || !host.classList.contains("is-visible")) {
    host.classList.remove("is-visible");
    void host.offsetHeight;
    requestAnimationFrame(() => host.classList.add("is-visible"));
  } else {
    host.classList.add("is-visible");
  }
}

/** Blend (and mask when present) — above Layer Animation, no fold wrapper. */
function buildLayerCompositing() {
  const host = document.getElementById("layer-compositing");
  if (!host) return;
  host.replaceChildren();

  const layer = activeLayer();
  if (!layer) {
    host.hidden = true;
    return;
  }
  host.hidden = false;

  const rowInto = (labelText: string, child: HTMLElement) => {
    const wrap = document.createElement("div");
    wrap.className = "inspector-field";
    const lab = document.createElement("span");
    lab.className = "inspector-field-label";
    lab.textContent = labelText;
    wrap.append(lab, child);
    host.appendChild(wrap);
  };

  const blend = document.createElement("select");
  blend.className = "chip";
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
    buildLayerCompositing();
  };
  rowInto("Blend", blend);

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
    rowInto("Mask", maskControls);
  }
}

function buildLayerAnimation() {
  const host = document.getElementById("layer-animation");
  const enableToggle = document.getElementById("layer-animation-enabled") as HTMLInputElement | null;
  const toggleLabel = enableToggle?.closest(".brush-subtoggle");
  if (!host || !enableToggle) return;

  const group = selectedLayerGroup();
  const target = group ?? activeLayer();
  const enabled = !!target?.animation?.enabled;
  enableToggle.disabled = !target || !!group?.locked;
  enableToggle.checked = enabled;
  toggleLabel?.classList.toggle("is-on", enabled);
  host.removeAttribute("hidden");

  const openShell = () => {
    host.classList.add("is-open");
  };
  const closeShell = () => {
    host.classList.remove("is-open");
  };

  if (!enabled) {
    if (host.classList.contains("is-open")) {
      closeShell();
      const clear = () => {
        if (host.classList.contains("is-open")) return;
        host.replaceChildren();
      };
      host.addEventListener("transitionend", clear, { once: true });
      window.setTimeout(clear, 400);
    } else {
      host.replaceChildren();
    }
    return;
  }

  if (!target) return;

  let inner = host.querySelector<HTMLElement>(".layer-animation-inner");
  if (!inner) {
    inner = document.createElement("div");
    inner.className = "layer-animation-inner";
    host.appendChild(inner);
  }
  inner.replaceChildren();
  if (group) appendGroupAnimationInspector(inner, group);
  else appendLayerInspector(inner, target as Layer);

  if (host.classList.contains("is-open")) return;
  // Start collapsed, then open on the next frame so the height can ease.
  closeShell();
  void host.offsetHeight;
  requestAnimationFrame(openShell);
  window.setTimeout(() => fitInspectorPanelInViewport(), 360);
}

/** Keep the floating inspector on-screen after Layer Animation expands. */
function fitInspectorPanelInViewport() {
  const panel = document.querySelector<HTMLElement>(
    '.right-sidebar.inspector-group[data-workspace-panel="inspector"]'
  );
  if (!panel) return;
  const rect = panel.getBoundingClientRect();
  const margin = 8;
  const minTop = workspaceDockTop;
  if (rect.bottom <= window.innerHeight - margin && rect.top >= minTop) return;
  const nextTop = Math.min(
    rect.top,
    Math.max(minTop, window.innerHeight - rect.height - margin)
  );
  moveWorkspacePanel(panel, rect.left, nextTop);
}

function setLayerAnimationEnabled(on: boolean) {
  const group = selectedLayerGroup();
  const target = group ?? activeLayer();
  if (!target) return;
  if (group?.locked) {
    setStatus("Group is locked · unlock it before editing animation");
    buildLayerAnimation();
    return;
  }
  if (on) {
    const anim = ensureLayerAnimation(target);
    anim.enabled = true;
    // Group motion uses numeric A/B transforms; layers can additionally place
    // those keyframes directly on the canvas.
    if (!group && !animHintShown) {
      animHintShown = true;
      setStatus("Use Set start (A) / Set end (B), then drag on the canvas");
    }
  } else if (target.animation) {
    target.animation.enabled = false;
    keyframeArm = null;
  }
  commitHistory();
  buildTimeline();
  buildLayers();
  buildInspector();
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
  const content = document.createElement("textarea");
  content.rows = 3; content.value = t.content;
  content.style.cssText = "width:100%;resize:vertical;background:transparent;color:var(--ink);border:1px solid var(--line);border-radius:3px;padding:4px;font-size:12px;line-height:1.35;font-family:inherit;";
  content.oninput = () => { t.content = content.value; };
  content.onchange = () => commitHistory();
  row("Content", content);

  // Font
  const font = document.createElement("div");
  buildFontPickerIn(font, t.fontFamily, (family) => {
    t.fontFamily = family;
    commitHistory();
  });
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
    inp.style.cssText = "width:100%;background:transparent;color:var(--ink);border:1px solid var(--line);border-radius:3px;padding:2px;font-size:11px;";
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

function appendSubPanelToolInspector(host: HTMLElement) {
  const hint = document.createElement("div");
  hint.className = "hint";
  hint.textContent = "Drag on the canvas to create a manga panel frame. Pick rect or rounded below.";
  host.appendChild(hint);

  const row = document.createElement("div");
  row.className = "context-action-row";
  for (const shape of PANEL_SHAPES) {
    const btn = document.createElement("button");
    btn.className = "chip" + (pendingSubPanelShape === shape ? " active" : "");
    btn.textContent = shape.charAt(0).toUpperCase() + shape.slice(1);
    btn.onclick = () => {
      pendingSubPanelShape = shape;
      buildInspector();
    };
    row.appendChild(btn);
  }
  host.appendChild(row);
}

function appendCutSubPanelToolInspector(host: HTMLElement) {
  const hint = document.createElement("div");
  hint.className = "hint";
  hint.textContent = "Drag a straight cut across a sub-panel to split it into two. Select either piece and delete the one you don't want.";
  host.appendChild(hint);
}

function appendBalloonToolInspector(host: HTMLElement) {
  const hint = document.createElement("div");
  hint.className = "hint";
  hint.textContent = "Drag on the canvas to create a speech balloon. Balloons default to white fill with a tail.";
  host.appendChild(hint);

  const row = document.createElement("div");
  row.className = "context-action-row";
  for (const shape of BALLOON_SHAPES) {
    const btn = document.createElement("button");
    btn.className = "chip" + (pendingBalloonShape === shape ? " active" : "");
    btn.textContent = shape.charAt(0).toUpperCase() + shape.slice(1);
    btn.onclick = () => {
      pendingBalloonShape = shape;
      buildInspector();
    };
    row.appendChild(btn);
  }
  host.appendChild(row);
}

function appendSubPanelInspector(
  host: HTMLElement,
  sp: SubPanel,
  allowedShapes: SubPanelShape[],
  syncPendingShape: (shape: SubPanelShape) => void,
) {
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
  for (const s of allowedShapes) {
    const o = document.createElement("option"); o.value = s; o.textContent = s;
    if (s === sp.shape) o.selected = true;
    if (s === "custom" && sp.shape !== "custom") o.disabled = true;
    shape.appendChild(o);
  }
  shape.onchange = () => {
    applySubPanelShapeDefaults(sp, shape.value as SubPanelShape);
    syncPendingShape(sp.shape);
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
    inp.style.cssText = "width:100%;background:transparent;color:var(--ink);border:1px solid var(--line);border-radius:3px;padding:2px;font-size:11px;";
    inp.onchange = () => {
      setSubPanelBounds(sp, { ...sp.bounds, [key]: +inp.value });
      commitHistory();
    };
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
      inp.style.cssText = "width:100%;background:transparent;color:var(--ink);border:1px solid var(--line);border-radius:3px;padding:2px;font-size:11px;";
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
  del.textContent = isBalloonShape(sp.shape) ? "Delete balloon" : "Delete sub-panel";
  del.className = "ghost";
  del.onclick = () => {
    const p = activePanel();
    removeSubPanelById(p, sp.id);
    if (activeSubPanelPath.includes(sp.id)) {
      activeSubPanelPath = sanitizeSubPanelPath(p, activeSubPanelPath);
    }
    selectedSubPanelId = null;
    selectedText = null;
    commitHistory();
    buildBreadcrumb(); buildLayers(); buildInspector();
  };
  delWrap.appendChild(del);
  host.appendChild(delWrap);
}

function appendPanelAnimInspector(host: HTMLElement, p: Panel) {
  const section = document.createElement("div");
  section.className = "inspector-section";

  appendColorRow(section, "Background", () => p.bg, (c) => { p.bg = c; });
  const fadeShortcuts = document.createElement("div");
  fadeShortcuts.className = "inspector-buttons";
  const fadeTicks = () => Math.max(1, Math.min(
    4,
    Math.round((p.durationMs / 1000) * project.wiggleFps / 2)
  ));
  const shortcut = (label: string, action: () => void) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "cellbtn";
    button.textContent = label;
    button.onclick = action;
    fadeShortcuts.appendChild(button);
  };
  shortcut("Fade clip in", () => {
    p.enter = { kind: "fade", durationTicks: fadeTicks() };
    commitHistory(); buildTimeline(); buildInspector();
  });
  shortcut("Fade clip out", () => {
    p.exit = { kind: "fade", durationTicks: fadeTicks() };
    commitHistory(); buildTimeline(); buildInspector();
  });
  shortcut("Fade clip in + out", () => {
    const durationTicks = fadeTicks();
    p.enter = { kind: "fade", durationTicks };
    p.exit = { kind: "fade", durationTicks };
    commitHistory(); buildTimeline(); buildInspector();
  });
  section.appendChild(fadeShortcuts);
  appendAnimPicker(section, "Clip enter", () => p.enter, (a) => { p.enter = a; commitHistory(); buildTimeline(); });
  appendAnimPicker(section, "Clip exit",  () => p.exit,  (a) => { p.exit  = a; commitHistory(); buildTimeline(); });
  appendPanelTransitionPicker(section, p);
  host.appendChild(section);
}

/** Remember which Layer Animation subtoggles the user left open across rebuilds. */
const layerAnimFoldOpen = new Set<string>(["motion"]);

function makeLayerAnimFold(title: string, key: string): { fold: HTMLDetailsElement; body: HTMLElement } {
  const fold = document.createElement("details");
  fold.className = "sidebar-fold layer-anim-fold";
  fold.open = layerAnimFoldOpen.has(key);
  fold.addEventListener("toggle", () => {
    if (fold.open) layerAnimFoldOpen.add(key);
    else layerAnimFoldOpen.delete(key);
  });
  const summary = document.createElement("summary");
  summary.textContent = title;
  const body = document.createElement("div");
  body.className = "sidebar-fold-body";
  fold.append(summary, body);
  return { fold, body };
}

function appendGroupAnimationInspector(host: HTMLElement, group: SubPanel) {
  const anim = group.animation;
  if (!anim?.enabled) return;
  const section = document.createElement("div");
  section.className = "inspector-section layer-anim-sections";
  const { fold, body } = makeLayerAnimFold("Group motion", "group-motion");
  fold.open = true;

  const row = (label: string, child: HTMLElement) => {
    const wrap = document.createElement("div");
    wrap.className = "inspector-field";
    const lab = document.createElement("span");
    lab.className = "inspector-field-label";
    lab.textContent = label;
    wrap.append(lab, child);
    body.appendChild(wrap);
  };
  const commit = () => {
    commitHistory();
    buildTimeline();
  };

  const timing = document.createElement("div");
  timing.className = "inspector-field-pair";
  for (const [key, label] of [["startTick", "Start"], ["durationTicks", "Ticks"]] as const) {
    const lab = document.createElement("label");
    lab.textContent = label;
    const input = document.createElement("input");
    input.type = "number";
    input.min = key === "durationTicks" ? "1" : "0";
    input.step = "1";
    input.value = String(anim[key]);
    input.onchange = () => {
      anim[key] = key === "durationTicks"
        ? Math.max(1, +input.value || 1)
        : Math.max(0, +input.value || 0);
      commit();
    };
    lab.appendChild(input);
    timing.appendChild(lab);
  }
  row("Timing", timing);

  const easing = document.createElement("select");
  for (const kind of EASINGS) {
    const option = document.createElement("option");
    option.value = kind;
    option.textContent = kind;
    option.selected = kind === anim.easing;
    easing.appendChild(option);
  }
  easing.onchange = () => { anim.easing = easing.value as EasingKind; commit(); };
  row("Easing", easing);

  const loop = document.createElement("select");
  for (const kind of LAYER_LOOPS) {
    const option = document.createElement("option");
    option.value = kind;
    option.textContent = kind;
    option.selected = kind === (anim.loop ?? "none");
    loop.appendChild(option);
  }
  loop.onchange = () => { anim.loop = loop.value as LayerLoopKind; commit(); };
  row("Loop", loop);

  appendLayerTransformGrid(body, "From", anim.from, commit);
  appendLayerTransformGrid(body, "To", anim.to, commit);

  const buttons = document.createElement("div");
  buttons.className = "inspector-buttons";
  buttons.appendChild(iconButton(StudioIcons.CopyCheck, "Copy group animation", (event) => {
    event.preventDefault();
    copyActiveLayerAnimation();
  }, "cellbtn iconbtn inspector-iconbtn"));
  const paste = iconButton(StudioIcons.ClipboardCheck, "Paste group animation", (event) => {
    event.preventDefault();
    pasteAnimationToActiveLayer();
  }, "cellbtn iconbtn inspector-iconbtn");
  paste.disabled = !animationClipboard;
  buttons.appendChild(paste);
  body.appendChild(buttons);

  section.appendChild(fold);
  host.appendChild(section);
}

function appendLayerInspector(host: HTMLElement, layer: Layer) {
  const section = document.createElement("div");
  section.className = "inspector-section layer-anim-sections";

  const rowInto = (parent: HTMLElement, label: string, child: HTMLElement) => {
    const wrap = document.createElement("div");
    wrap.className = "inspector-field";
    const lab = document.createElement("span");
    lab.className = "inspector-field-label";
    lab.textContent = label;
    wrap.append(lab, child);
    parent.appendChild(wrap);
  };

  // ── Fades ──────────────────────────────────────────────────────────
  {
    const { fold, body } = makeLayerAnimFold("Fades", "fades");
    appendFadePicker(body, "Fade in", () => layer.fadeIn, (fade) => {
      layer.fadeIn = fade;
      commitHistory();
      buildTimeline();
    });
    appendFadePicker(body, "Fade out", () => layer.fadeOut, (fade) => {
      layer.fadeOut = fade;
      commitHistory();
      buildTimeline();
    });
    section.appendChild(fold);
  }

  // Tone texture controls live in buildLayerToneEffects() — always visible
  // for tone layers, not gated behind Layer Animation.

  // ── Motion (open by default) ───────────────────────────────────────
  if (layer.animation?.enabled) {
    const { fold, body } = makeLayerAnimFold("Motion", "motion");
    const anim = layer.animation;

    const tickWrap = document.createElement("div");
    tickWrap.className = "inspector-field-pair";
    const tickInput = (key: "startTick" | "durationTicks", label: string) => {
      const lab = document.createElement("label");
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
    rowInto(body, "Timing", tickWrap);

    const easing = document.createElement("select");
    for (const kind of EASINGS) {
      const o = document.createElement("option");
      o.value = kind;
      o.textContent = kind;
      if (kind === anim.easing) o.selected = true;
      easing.appendChild(o);
    }
    easing.onchange = () => { anim.easing = easing.value as EasingKind; commitHistory(); };
    rowInto(body, "Easing", easing);

    const loop = document.createElement("select");
    for (const kind of LAYER_LOOPS) {
      const o = document.createElement("option");
      o.value = kind;
      o.textContent = kind;
      if (kind === (anim.loop ?? "none")) o.selected = true;
      loop.appendChild(o);
    }
    loop.onchange = () => { anim.loop = loop.value as LayerLoopKind; commitHistory(); };
    rowInto(body, "Loop", loop);

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
    keyButtons.append(fromBtn, toBtn);
    rowInto(body, "Keyframes", keyButtons);

    appendLayerTransformGrid(body, "From", anim.from, () => {
      commitHistory();
      buildTimeline();
    });
    appendLayerTransformGrid(body, "To", anim.to, () => {
      commitHistory();
      buildTimeline();
    });

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
    body.appendChild(buttons);

    section.appendChild(fold);
  }

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
  wrap.className = "inspector-field is-split";
  const lab = document.createElement("span");
  lab.className = "inspector-field-label";
  lab.textContent = label;
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
  wrap.append(sel, ticks);
  host.appendChild(wrap);
}

function appendFadePicker(
  host: HTMLElement,
  label: string,
  read: () => FadeSpec | undefined,
  write: (fade: FadeSpec | undefined) => void
) {
  const wrap = document.createElement("div");
  wrap.className = "inspector-field is-split";
  const lab = document.createElement("span");
  lab.className = "inspector-field-label";
  lab.textContent = label;
  wrap.appendChild(lab);

  const current = read();
  const mode = document.createElement("select");
  for (const [value, text] of [["none", "Off"], ["fade", "Fade"]] as const) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = text;
    option.selected = value === (current ? "fade" : "none");
    mode.appendChild(option);
  }

  const ticks = document.createElement("input");
  ticks.type = "number";
  ticks.min = "1";
  ticks.max = "32";
  ticks.step = "1";
  ticks.value = String(current?.durationTicks ?? 4);
  ticks.title = "Duration in animation frames";
  ticks.setAttribute("aria-label", `${label} duration in frames`);
  ticks.disabled = !current;

  mode.onchange = () => {
    ticks.disabled = mode.value === "none";
    write(mode.value === "none"
      ? undefined
      : { durationTicks: Math.max(1, +ticks.value || 4) });
  };
  ticks.onchange = () => {
    if (mode.value === "none") return;
    write({
      durationTicks: Math.max(1, +ticks.value || 4),
      startTick: read()?.startTick,
    });
  };
  wrap.append(mode, ticks);
  host.appendChild(wrap);
}

function appendPanelTransitionPicker(host: HTMLElement, panel: Panel) {
  const wrap = document.createElement("div");
  wrap.className = "inspector-field is-split";
  const label = document.createElement("span");
  label.className = "inspector-field-label";
  label.textContent = "To next";

  const mode = document.createElement("select");
  const cut = document.createElement("option");
  cut.value = "cut";
  cut.textContent = "Cut";
  const crossfade = document.createElement("option");
  crossfade.value = "crossfade";
  crossfade.textContent = "Crossfade";
  mode.append(cut, crossfade);
  mode.value = panel.transitionToNext?.kind ?? "cut";
  mode.disabled = project.panels.length < 2;
  mode.title = mode.disabled ? "Add another panel to create a transition" : "Blend this panel into the next timeline frame";

  const ticks = document.createElement("input");
  ticks.type = "number";
  ticks.min = "1";
  ticks.max = "32";
  ticks.step = "1";
  ticks.value = String(panel.transitionToNext?.durationTicks ?? 4);
  ticks.disabled = mode.disabled || mode.value === "cut";
  ticks.title = "Crossfade duration in animation frames";
  ticks.setAttribute("aria-label", "Crossfade duration in frames");

  const commit = () => {
    panel.transitionToNext = mode.value === "crossfade"
      ? { kind: "crossfade", durationTicks: Math.max(1, +ticks.value || 4) }
      : undefined;
    ticks.disabled = mode.disabled || mode.value === "cut";
    commitHistory();
    buildTimeline();
  };
  mode.onchange = commit;
  ticks.onchange = commit;
  wrap.append(label, mode, ticks);
  host.appendChild(wrap);
}

// ---- panel ops ------------------------------------------------------------

function rebuildAfterPanelTimingChange() {
  commitHistory();
  buildTimeline();
  buildInspector();
}

function toggleTimelineTimeUnit() {
  timelineTimeUnit = timelineTimeUnit === "frames" ? "seconds" : "frames";
  buildTimeline();
  updatePlayheadChrome();
  setStatus(timelineTimeUnit === "frames" ? "Timeline unit: frames" : "Timeline unit: seconds");
}

/** Snap a dragged panel hold to the active timeline unit. */
function snapPanelDurationToTimelineUnit(panel: Panel) {
  if (timelineTimeUnit === "frames") {
    setPanelExposureTicks(
      panel,
      durationMsToExposureTicks(panel.durationMs, project.wiggleFps),
      project.wiggleFps,
    );
  } else {
    const tenths = Math.round(durationMsToSeconds(panel.durationMs) * 10) / 10;
    setPanelDurationSeconds(panel, tenths);
  }
}

function setPanelExposure(i: number, ticks: number) {
  const panel = project.panels[i];
  if (!panel) return;
  setPanelExposureTicks(panel, ticks, project.wiggleFps);
  rebuildAfterPanelTimingChange();
  setStatus(`Panel ${i + 1}: ${formatHoldDuration(panel.durationMs, "frames", project.wiggleFps)}`);
}

function setPanelDurationSec(i: number, seconds: number) {
  const panel = project.panels[i];
  if (!panel) return;
  setPanelDurationSeconds(panel, seconds);
  rebuildAfterPanelTimingChange();
  setStatus(`Panel ${i + 1}: ${formatHoldDuration(panel.durationMs, "seconds", project.wiggleFps)}`);
}

function adjustPanelExposure(i: number, deltaTicks: number) {
  const panel = project.panels[i];
  if (!panel) return;
  adjustPanelExposureTicks(panel, deltaTicks, project.wiggleFps);
  rebuildAfterPanelTimingChange();
  setStatus(`Panel ${i + 1}: ${formatHoldDuration(panel.durationMs, "frames", project.wiggleFps)}`);
}

function insertBlankPanelAt(index: number) {
  const source = project.panels[activePanelIndex] ?? project.panels[0];
  if (!source) return;
  const blank = createBlankPanelFrom(source, () => crypto.randomUUID());
  const insertAt = Math.max(0, Math.min(index, project.panels.length));
  project.panels.splice(insertAt, 0, blank);
  activePanelIndex = insertAt;
  activeSubPanelPath = [];
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
  activeSubPanelPath = [];
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
  activeSubPanelPath = [];
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
  requestLoopFrame();
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
  requestLoopFrame();
  if (playing) void startAudioPreview(playheadMs);
}

function updatePlayheadChrome() {
  const el = document.getElementById("audio-playhead-label");
  if (el) el.textContent = formatPlayheadTime(playheadMs);
  const fc = document.getElementById("frame-counter");
  if (fc) {
    if (isSequenceTab()) {
      fc.textContent = formatPlayheadTime(playheadMs);
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
  currentSize = Math.round(+(e.target as HTMLInputElement).value * 10) / 10;
  updateBrushSizeControl();
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
($("stroke-smoothing-enabled") as HTMLInputElement).onchange = (e) => {
  const on = (e.target as HTMLInputElement).checked;
  setStrokeSmoothingSettings({
    mode: on ? lastActiveSmoothingMode : "off",
  });
  commitHistory([]);
};
($("layer-animation-enabled") as HTMLInputElement).onchange = (e) => {
  setLayerAnimationEnabled((e.target as HTMLInputElement).checked);
};
($("stroke-smoothing-mode") as HTMLSelectElement).onchange = (e) => {
  const mode = (e.target as HTMLSelectElement).value as "weighted" | "stabilizer";
  lastActiveSmoothingMode = mode;
  setStrokeSmoothingSettings({ mode });
  commitHistory([]);
};
($("stroke-smoothing-distance") as HTMLInputElement).oninput = (e) => {
  setStrokeSmoothingSettings({ distance: +(e.target as HTMLInputElement).value });
};
($("stroke-smoothing-distance") as HTMLInputElement).onchange = () => {
  commitHistory([]);
};
($("stroke-smoothing-delay") as HTMLInputElement).oninput = (e) => {
  setStrokeSmoothingSettings({ delayDistance: +(e.target as HTMLInputElement).value });
};
($("stroke-smoothing-delay") as HTMLInputElement).onchange = () => {
  commitHistory([]);
};
($("stroke-smoothing-finish") as HTMLInputElement).onchange = (e) => {
  setStrokeSmoothingSettings({ finishStabilizedStroke: (e.target as HTMLInputElement).checked });
  commitHistory([]);
};
($("stroke-smoothing-pressure") as HTMLInputElement).onchange = (e) => {
  setStrokeSmoothingSettings({ smoothPressure: (e.target as HTMLInputElement).checked });
  commitHistory([]);
};

// ---- text controls --------------------------------------------------------

async function loadInstalledFonts(): Promise<number> {
  if (installedFontsLoaded) {
    return availableFontOptions.filter((option) => option.id.startsWith("local:")).length;
  }
  if (installedFontsLoading) return installedFontsLoading;
  installedFontsLoading = (async () => {
    const installed = await queryInstalledFontOptions();
    const byFamily = new Map<string, FontOption>();
    for (const option of [...FONT_OPTIONS, ...installed]) {
      const key = option.family.toLocaleLowerCase();
      if (!byFamily.has(key)) byFamily.set(key, option);
    }
    availableFontOptions = [...byFamily.values()];
    installedFontsLoaded = true;
    return installed.length;
  })();
  try {
    return await installedFontsLoading;
  } finally {
    installedFontsLoading = null;
  }
}

function buildFontPickerIn(
  host: HTMLElement,
  selectedFamily: string,
  onSelect: (family: string) => void
) {
  host.innerHTML = "";
  host.classList.add("font-picker");

  const picker = document.createElement("div");
  picker.className = "brush-picker";
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "brush-picker-trigger";
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");
  trigger.setAttribute("aria-label", `Font: ${selectedFamily}`);
  const triggerLabel = document.createElement("span");
  triggerLabel.className = "brush-picker-label";
  triggerLabel.textContent = selectedFamily;
  triggerLabel.style.fontFamily = fontFamilyCss(selectedFamily);
  trigger.appendChild(triggerLabel);

  const menu = document.createElement("div");
  menu.className = "brush-menu font-menu";
  menu.setAttribute("role", "listbox");
  menu.hidden = true;
  const search = document.createElement("input");
  search.type = "text";
  search.className = "font-menu-search";
  search.placeholder = "Search fonts";
  search.autocomplete = "off";
  search.spellcheck = false;
  search.setAttribute("aria-label", "Search fonts");
  menu.appendChild(search);
  const scroll = document.createElement("div");
  scroll.className = "font-menu-scroll";
  menu.appendChild(scroll);

  let currentFamily = selectedFamily;
  let open = false;
  let onDocumentPointerDown: ((event: PointerEvent) => void) | null = null;
  let unmountFloating: (() => void) | null = null;

  const choose = (family: string) => {
    currentFamily = family;
    triggerLabel.textContent = family;
    triggerLabel.style.fontFamily = fontFamilyCss(family);
    trigger.setAttribute("aria-label", `Font: ${family}`);
    onSelect(family);
    closePicker();
  };

  const renderOptions = () => {
    scroll.innerHTML = "";
    const query = search.value.trim();
    const normalizedQuery = query.toLocaleLowerCase();
    const matches = availableFontOptions.filter((option) =>
      !normalizedQuery
      || option.family.toLocaleLowerCase().includes(normalizedQuery)
      || option.label.toLocaleLowerCase().includes(normalizedQuery)
    );
    const hasExactMatch = matches.some(
      (option) => option.family.toLocaleLowerCase() === normalizedQuery
    );
    const options = query && !hasExactMatch
      ? [{ id: `custom:${query}`, family: query, label: `Use “${query}”` }, ...matches]
      : matches;

    if (!options.length) {
      const empty = document.createElement("div");
      empty.className = "font-menu-empty";
      empty.textContent = "No matching fonts";
      scroll.appendChild(empty);
    }
    for (const optionData of options) {
      const option = document.createElement("button");
      option.type = "button";
      const active = optionData.family === currentFamily;
      option.className = "brush-option font-option" + (active ? " active" : "");
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", String(active));
      option.style.fontFamily = fontFamilyCss(optionData.family);
      const label = document.createElement("span");
      label.textContent = optionData.label;
      option.appendChild(label);
      option.onclick = () => choose(optionData.family);
      scroll.appendChild(option);
    }

    if (supportsInstalledFontAccess() && !installedFontsLoaded && !installedFontsUnavailable) {
      const loading = document.createElement("div");
      loading.className = "font-menu-empty";
      loading.textContent = "Loading installed fonts…";
      scroll.appendChild(loading);
    }
  };

  const autoLoadInstalledFonts = () => {
    if (
      installedFontsLoaded
      || installedFontsUnavailable
      || !supportsInstalledFontAccess()
    ) return;
    void loadInstalledFonts().then((count) => {
      setStatus(`${count} installed font families are now available`);
      if (!open) return;
      renderOptions();
      search.focus();
    }).catch((error) => {
      installedFontsUnavailable = true;
      if (open) renderOptions();
      const message = error instanceof DOMException && error.name === "NotAllowedError"
        ? "Installed font access was not allowed"
        : "Installed fonts are unavailable in this browser";
      showToast(message, "info");
    });
  };

  const closePicker = () => {
    if (!open) return;
    open = false;
    picker.classList.remove("open");
    menu.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    search.value = "";
    unmountFloating?.();
    unmountFloating = null;
    if (onDocumentPointerDown) {
      document.removeEventListener("pointerdown", onDocumentPointerDown);
      onDocumentPointerDown = null;
    }
    if (closeFontPicker === closePicker) closeFontPicker = null;
  };
  const openPicker = () => {
    if (open) return;
    closeFontPicker?.();
    open = true;
    picker.classList.add("open");
    menu.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    closeFontPicker = closePicker;
    renderOptions();
    unmountFloating = mountFloatingMenu(menu, trigger, picker);
    search.focus();
    autoLoadInstalledFonts();
    onDocumentPointerDown = (event) => {
      const target = event.target;
      if (target instanceof Node && (picker.contains(target) || menu.contains(target))) return;
      closePicker();
    };
    window.setTimeout(() => {
      if (onDocumentPointerDown) document.addEventListener("pointerdown", onDocumentPointerDown);
    }, 0);
  };
  const focusOption = (direction: 1 | -1) => {
    const options = [...scroll.querySelectorAll<HTMLButtonElement>(".font-option")];
    if (!options.length) return;
    const index = options.indexOf(document.activeElement as HTMLButtonElement);
    const next = index < 0
      ? (direction === 1 ? 0 : options.length - 1)
      : Math.max(0, Math.min(options.length - 1, index + direction));
    options[next]?.focus();
  };

  trigger.onclick = () => {
    if (open) closePicker();
    else openPicker();
  };
  trigger.onkeydown = (event) => {
    if (event.key !== "ArrowDown" && event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openPicker();
  };
  search.oninput = renderOptions;
  search.onkeydown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closePicker();
      trigger.focus();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      focusOption(1);
    } else if (event.key === "Enter" && search.value.trim()) {
      event.preventDefault();
      const exact = availableFontOptions.find(
        (option) => option.family.toLocaleLowerCase() === search.value.trim().toLocaleLowerCase()
      );
      choose(exact?.family ?? search.value.trim());
    }
  };
  menu.onkeydown = (event) => {
    if (event.target === search) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closePicker();
      trigger.focus();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      focusOption(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusOption(-1);
    }
  };
  picker.addEventListener("focusout", (event) => {
    const next = event.relatedTarget;
    if (next instanceof Node && (picker.contains(next) || menu.contains(next))) return;
    window.setTimeout(() => {
      if (!open) return;
      const active = document.activeElement;
      if (active instanceof Node && (picker.contains(active) || menu.contains(active))) return;
      closePicker();
    }, 0);
  });

  picker.appendChild(trigger);
  picker.appendChild(menu);
  host.appendChild(picker);
}

function buildFontPicker() {
  buildFontPickerIn($("font-picker"), currentFont, (family) => {
    currentFont = family;
  });
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
($("gradient-kind") as HTMLSelectElement).onchange = (e) => {
  currentGradientKind = (e.target as HTMLSelectElement).value as "linear" | "radial";
};
($("gradient-end-color") as HTMLInputElement).oninput = (e) => {
  currentGradientEndColor = (e.target as HTMLInputElement).value;
  buildGradientEndPalette();
};

// ---- palette UX -----------------------------------------------------------

function setLospecError(msg: string) {
  const el = $("lospec-error");
  el.textContent = msg;
  el.hidden = !msg;
}

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
  transparentPaintSelected = false;
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

async function runExport(
  format: "webm" | "mp4" | "panel-mp4" | "png" | "png-transparent" | "jpeg" | "gif" | "panel-gif"
) {
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
  const exportLabel =
    format === "webm" ? "WebM"
    : format === "mp4" ? "Full sequence MP4"
    : format === "panel-mp4" ? "Current panel MP4"
    : format === "png" ? "PNG"
    : format === "png-transparent" ? "PNG (no background)"
    : format === "jpeg" ? "JPEG"
    : format === "gif" ? "Full sequence GIF"
    : "Current panel GIF";
  $("export-title").textContent = `Exporting ${exportLabel}…`;
  $("export-audio-choice").hidden = true;
  $("export-progress-panel").hidden = false;
  const needsEncoder = format === "mp4" || format === "panel-mp4" || format === "gif" || format === "panel-gif";
  updateExportProgress(needsEncoder ? "Loading encoder…" : "Starting…", 0);
  openExportOverlay();

  const shouldCancel = () => exportCancelled;
  const onProgressEvent = (progress: Parameters<typeof exportProgressStatus>[0]) => {
    updateExportProgress(exportProgressStatus(progress), progress.progress);
  };
  const skipJitter = !($("export-jitter") as HTMLInputElement).checked;
  const panelPad = String(activePanelIndex + 1).padStart(3, "0");

  try {
    if (format === "webm") {
      const blob = await exportWebM(project, undefined, {
        contentVersion: renderContentVersion,
        onProgressEvent,
        shouldCancel,
        skipJitter,
      });
      downloadBlob(blob, "wigo.webm");
      setStatus("WebM done");
    } else if (format === "mp4") {
      const blob = await exportMP4(project, 30, undefined, {
        includeAudioTail,
        contentVersion: renderContentVersion,
        onProgressEvent,
        shouldCancel,
        skipJitter,
      });
      downloadBlob(blob, "wigo.mp4");
      setStatus("MP4 done");
    } else if (format === "panel-mp4") {
      const blob = await exportMP4(project, 30, undefined, {
        panelIndex: activePanelIndex,
        contentVersion: renderContentVersion,
        onProgressEvent,
        shouldCancel,
        skipJitter,
      });
      downloadBlob(blob, `wigo-panel-${panelPad}.mp4`);
      setStatus("Current panel MP4 done");
    } else if (format === "png" || format === "png-transparent" || format === "jpeg") {
      const blob = await exportStillImage(
        project,
        format === "jpeg" ? "jpeg" : "png",
        {
          panelIndex: activePanelIndex,
          tick: wiggleTick,
          transparent: format === "png-transparent",
          contentVersion: renderContentVersion,
          onProgressEvent,
          shouldCancel,
          skipJitter,
        }
      );
      const filename = format === "jpeg"
        ? `wigo-panel-${panelPad}.jpg`
        : format === "png-transparent"
          ? `wigo-panel-${panelPad}-transparent.png`
          : `wigo-panel-${panelPad}.png`;
      downloadBlob(blob, filename);
      setStatus(`${exportLabel} done`);
    } else if (format === "gif") {
      const blob = await exportGIF(project, 12, {
        contentVersion: renderContentVersion,
        onProgressEvent,
        shouldCancel,
        skipJitter,
      });
      downloadBlob(blob, "wigo.gif");
      setStatus("Full sequence GIF done");
    } else {
      const blob = await exportGIF(project, 12, {
        panelIndex: activePanelIndex,
        contentVersion: renderContentVersion,
        onProgressEvent,
        shouldCancel,
        skipJitter,
      });
      downloadBlob(blob, `wigo-panel-${panelPad}.gif`);
      setStatus("Current panel GIF done");
    }
  } catch (err) {
    if (isAbortError(err) || exportCancelled) {
      setStatus("Export cancelled");
    } else {
      showError(`${exportLabel} failed: ${exportErrorMessage(err)}`);
    }
  } finally {
    closeExportOverlay();
    exportCancelled = false;
    if (wasPlaying) void startPlayback(playheadMs);
  }
}

($("export-panel-png") as HTMLButtonElement).onclick = () => { void runExport("png"); };
($("export-panel-png-transparent") as HTMLButtonElement).onclick = () => { void runExport("png-transparent"); };
($("export-panel-jpeg") as HTMLButtonElement).onclick = () => { void runExport("jpeg"); };
($("export-panel-gif") as HTMLButtonElement).onclick = () => { void runExport("panel-gif"); };
($("export-gif") as HTMLButtonElement).onclick = () => { void runExport("gif"); };
($("export-webm") as HTMLButtonElement).onclick = () => { void runExport("webm"); };
($("export-mp4") as HTMLButtonElement).onclick = () => { void runExport("mp4"); };
($("export-panel-mp4") as HTMLButtonElement).onclick = () => { void runExport("panel-mp4"); };
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

/** Untitled library starters that were never edited this session — safe to
 *  drop when the user opens/creates another project instead of keeping them. */
function isDisposableLibraryProject(): boolean {
  if (!projectLibraryReady || !activeLibraryProjectId) return false;
  if (persistenceState.currentFileHandle || persistenceState.currentFileName) return false;
  const record = projectBoardRecords.find((item) => item.id === activeLibraryProjectId);
  if (!record || !/^Untitled(?:\s+\d+)?$/i.test(record.name)) return false;
  if (_isDirty || history.canUndo() || history.canRedo()) return false;
  return isBlankQuickStartProject(project);
}

/** Removes the current quick-start Untitled from the library when unused.
 *  Returns true when discarded (caller should skip flushAutosave). */
async function discardDisposableLibraryProject(): Promise<boolean> {
  if (!isDisposableLibraryProject() || !activeLibraryProjectId) return false;
  const id = activeLibraryProjectId;
  await deleteProjectLibraryRecord(id);
  projectBoardRecords = projectBoardRecords.filter((record) => record.id !== id);
  projectFileHandles.delete(id);
  activeLibraryProjectId = null;
  if (projectBoardMeta.activeProjectId === id) {
    projectBoardMeta.activeProjectId = null;
  }
  return true;
}

/** Persist the current project before switching away, unless it was only an
 *  unused quick-start canvas (those are deleted instead). */
async function prepareToLeaveCurrentProject(): Promise<boolean> {
  if (await discardDisposableLibraryProject()) return true;
  return flushAutosave(true);
}

function updateCanvasHint() {
  const hint = $("canvas-hint");
  const dismissed =
    localStorage.getItem(CANVAS_HINT_KEY) === "1" ||
    localStorage.getItem(LEGACY_CANVAS_HINT_KEY) === "1";
  hint.hidden = dismissed || !projectCanvasIsEmpty();
}

function dismissCanvasHint() {
  localStorage.setItem(CANVAS_HINT_KEY, "1");
  localStorage.removeItem(LEGACY_CANVAS_HINT_KEY);
  $("canvas-hint").hidden = true;
}

function showFirstLaunchStatus() {
  const el = $("status");
  const shown =
    localStorage.getItem(CMDK_HINT_KEY) === "1" ||
    localStorage.getItem(LEGACY_CMDK_HINT_KEY) === "1";
  if (!shown) {
    localStorage.setItem(CMDK_HINT_KEY, "1");
    localStorage.removeItem(LEGACY_CMDK_HINT_KEY);
    el.innerHTML = 'Ready · <span class="status-hint">Press <kbd>⌘K</kbd> for commands</span>';
    el.classList.add("is-visible");
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
  closeProjectMenu();
  closeViewMenu();
  closeExportMenu();
  const menu = $("help-menu");
  const opening = !menu.classList.contains("open");
  menu.classList.toggle("open");
  $("help-menu-button").classList.toggle("open");
  if (opening) positionTopbarMenu(menu);
  else clearTopbarMenuPosition(menu);
};

let _statusTimer = 0;
function setStatus(s: string, durationMs = 3500) {
  const el = $("status");
  el.textContent = s;
  el.classList.add("is-visible");
  clearTimeout(_statusTimer);
  if (durationMs > 0) {
    _statusTimer = window.setTimeout(() => {
      el.classList.remove("is-visible");
    }, durationMs);
  }
}

function syncTikTokOverlayToggle() {
  const button = $("tiktok-overlay-toggle") as HTMLButtonElement;
  button.classList.toggle("active", tiktokOverlayEnabled);
  button.setAttribute("aria-pressed", String(tiktokOverlayEnabled));
  button.title = tiktokOverlayEnabled
    ? "Hide TikTok UI visibility guide"
    : "Show TikTok UI visibility guide (not an export crop)";
}

function toggleTikTokOverlay() {
  tiktokOverlayEnabled = !tiktokOverlayEnabled;
  editorPreviewInvalidated = true;
  syncTikTokOverlayToggle();
  requestLoopFrame();
  setStatus(`TikTok UI visibility guide ${tiktokOverlayEnabled ? "on" : "off"}`);
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
    { id: "edit-undo", label: "Undo", group: "Edit", shortcut: "⌘Z", enabled: () => history.canUndo(), run: () => performUndoRedo(false) },
    { id: "edit-redo", label: "Redo", group: "Edit", shortcut: "⇧⌘Z", enabled: () => history.canRedo(), run: () => performUndoRedo(true) },
    { id: "view-panels", label: "Open Panels timeline", group: "View", run: () => setTimelineTab("panels") },
    { id: "view-anim", label: "Open Anim timeline", group: "View", run: () => setTimelineTab("anim") },
    { id: "view-sequence", label: "Open Sequence timeline", group: "View", run: () => setTimelineTab("sequence") },
    { id: "view-fit", label: "Fit Canvas", group: "View", run: fitViewport },
    { id: "view-actual", label: "Actual Size", group: "View", run: resetViewport },
    { id: "view-tiktok-overlay", label: "Toggle TikTok UI Guide", group: "View", run: toggleTikTokOverlay },
    { id: "view-onion", label: "Toggle Onion Skin", group: "Draw", run: () => {
      onionEnabled = !onionEnabled;
      const ot = document.getElementById("onion-toggle") as HTMLInputElement | null;
      if (ot) ot.checked = onionEnabled;
      const label = ot?.closest(".onion-skin-toggle") as HTMLElement | null;
      if (label) {
        label.title = onionEnabled ? "Disable onion skin" : "Enable onion skin";
        label.classList.toggle("is-on", onionEnabled);
      }
      const bar = ot?.closest("details.onion-skin-bar") as HTMLDetailsElement | null;
      if (bar) {
        bar.classList.toggle("is-enabled", onionEnabled);
        bar.open = onionEnabled;
      }
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
    { id: "layer-copy", label: "Copy Layer", group: "Layer", shortcut: "⌘C",
      enabled: () => !!activeLayer(),
      run: () => copyActiveLayer(),
    },
    { id: "layer-paste", label: "Paste Layer Above", group: "Layer", shortcut: "⌘V",
      enabled: () => !!layerClipboard && activePanel().kind !== "timelapse",
      run: () => pasteLayerAboveActive(),
    },
    { id: "layer-rasterize", label: "Rasterize Layer", group: "Layer",
      enabled: () => activeLayer()?.kind === "draw",
      run: () => rasterizeActiveLayer(),
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
      setTimelineTab("sequence");
      mediaRecorder?.state === "recording" ? stopRecording() : void startRecording();
    } },
    { id: "edit-import-audio", label: "Import Audio", group: "Edit", run: () => {
      setTimelineTab("sequence");
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
    { id: "export-panel-png-command", label: "Current panel PNG", group: "Export", run: () => ($("export-panel-png") as HTMLButtonElement).click() },
    { id: "export-panel-png-transparent-command", label: "PNG (no background)", group: "Export", run: () => ($("export-panel-png-transparent") as HTMLButtonElement).click() },
    { id: "export-panel-jpeg-command", label: "Current panel JPEG", group: "Export", run: () => ($("export-panel-jpeg") as HTMLButtonElement).click() },
    { id: "export-panel-gif-command", label: "Current panel GIF", group: "Export", run: () => ($("export-panel-gif") as HTMLButtonElement).click() },
    { id: "export-gif-command", label: "Full sequence GIF", group: "Export", run: () => ($("export-gif") as HTMLButtonElement).click() },
    { id: "export-webm-command", label: "Quick WebM", group: "Export", run: () => ($("export-webm") as HTMLButtonElement).click() },
    { id: "export-panel-mp4-command", label: "Current panel MP4", group: "Export", run: () => ($("export-panel-mp4") as HTMLButtonElement).click() },
    { id: "export-mp4-command", label: "Full sequence MP4", group: "Export", run: () => ($("export-mp4") as HTMLButtonElement).click() },
    { id: "help-commands", label: "Command Palette", group: "Help", shortcut: "⌘K", run: openCommandPalette },
    { id: "help-about", label: "About Wigo Studio", group: "Help", run: openAboutDialog },
    { id: "marquee-rect", label: "Marquee: Rectangle", group: "Edit", run: () => {
      marqueeToolKind = "rect";
      currentBrush = MARQUEE_KEY;
      rememberRecentTool(MARQUEE_KEY);
      buildBrushBar();
    } },
    { id: "marquee-ellipse", label: "Marquee: Ellipse", group: "Edit", run: () => {
      marqueeToolKind = "ellipse";
      currentBrush = MARQUEE_KEY;
      rememberRecentTool(MARQUEE_KEY);
      buildBrushBar();
    } },
    { id: "marquee-lasso", label: "Marquee: Lasso", group: "Edit", run: () => {
      marqueeToolKind = "lasso";
      currentBrush = MARQUEE_KEY;
      rememberRecentTool(MARQUEE_KEY);
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
    { id: "selection-copy", label: "Copy Selection", group: "Edit",
      enabled: () => selectionState?.mode === "object" ||
        (selectionState?.mode === "region" && activeLayer()?.kind === "raster"),
      run: () => selectionState?.mode === "region" ? copyRasterRegionSelection() : copySelection(),
    },
    { id: "selection-cut", label: "Cut Selection", group: "Edit",
      enabled: () => !!selectionState,
      run: () => cutSelection(),
    },
    { id: "selection-duplicate", label: "Duplicate Selection", group: "Edit",
      enabled: () => selectionState?.mode === "object" && isObjectSelectionIdle(selectionState),
      run: () => duplicateSelection(),
    },
    { id: "selection-delete", label: "Delete Selection", group: "Edit",
      enabled: () => isObjectSelectionIdle(selectionState) ||
        (selectionState?.mode === "region" && activeLayer()?.kind === "raster"),
      run: () => { if (!deleteRasterRegionSelection()) deleteSelection(); },
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

function projectRecordName(existing?: ProjectLibraryRecord): string {
  if (persistenceState.currentFileName) {
    return persistenceState.currentFileName
      .replace(/\.(?:wigo|wiggle)\.json$/i, "")
      .replace(/\.json$/i, "");
  }
  return existing?.name ?? `Untitled ${projectBoardRecords.length + 1}`;
}

function currentProjectRecord(json: string, refreshPreview: boolean): ProjectLibraryRecord | null {
  if (!activeLibraryProjectId) return null;
  const existing = projectBoardRecords.find((record) => record.id === activeLibraryProjectId);
  const position = existing ?? nextWorldPosition();
  return {
    id: activeLibraryProjectId,
    name: projectRecordName(existing),
    json,
    previewDataUrl: refreshPreview
      ? renderProjectPreview(project, activePanelIndex)
      : existing?.previewDataUrl ?? null,
    x: position.x,
    y: position.y,
    updatedAt: Date.now(),
    activePanelIndex,
    viewport: { ...viewport },
  };
}

function replaceProjectBoardRecord(record: ProjectLibraryRecord) {
  const index = projectBoardRecords.findIndex((item) => item.id === record.id);
  if (index < 0) projectBoardRecords.push(record);
  else projectBoardRecords[index] = record;
}

async function persistCurrentProjectRecord(json: string, refreshPreview: boolean): Promise<boolean> {
  if (!projectLibraryReady || !activeLibraryProjectId) return false;
  const record = currentProjectRecord(json, refreshPreview);
  if (!record) return false;
  await putProjectLibraryRecord(record);
  replaceProjectBoardRecord(record);
  return true;
}

async function flushAutosave(refreshPreview = false, announce = false): Promise<boolean> {
  if (_autosaveInFlight) {
    while (_autosaveInFlight) await new Promise<void>((resolve) => setTimeout(resolve, 16));
    if (!_isDirty && !refreshPreview) return true;
  }
  if (!_isDirty && !refreshPreview) return true;

  const { json } = autosaveSerialization.snapshot(project);
  const currentHash = projectHashFromString(json);
  _autosaveInFlight = true;
  let librarySaved = false;
  let externalSaved = false;
  try {
    if (
      persistenceState.currentFileHandle &&
      _isDirty &&
      currentHash !== persistenceState.lastSavedHash
    ) {
      try {
        await writeHandleString(persistenceState.currentFileHandle, json);
        persistenceState.lastSavedHash = currentHash;
        externalSaved = true;
      } catch (err) {
        setStatus("external file sync failed; preserving work in the project library");
        console.warn("External project autosave failed", err);
      }
    } else if (persistenceState.currentFileHandle) {
      externalSaved = true;
    }

    if (projectLibraryReady) {
      librarySaved = await persistCurrentProjectRecord(json, refreshPreview);
    } else if (!persistenceState.currentFileHandle) {
      const snapshot = writeRecoverySnapshotString(json);
      if (!snapshot) setStatus("recovery unavailable — project is too large for browser storage");
      librarySaved = !!snapshot;
    }

    if (librarySaved || externalSaved) {
      markClean();
      if (librarySaved) clearRecoverySnapshot();
      if (announce) {
        setStatus(externalSaved && persistenceState.currentFileHandle
          ? `saved ${persistenceState.currentFileName ?? persistenceState.currentFileHandle.name}`
          : "saved to project library");
      }
      return true;
    }
    return false;
  } catch (err) {
    setStatus("auto-save failed: " + (err as Error).message);
    return false;
  } finally {
    _autosaveInFlight = false;
    updateFileChrome();
  }
}

/** World rectangles for every project (active frame + preview cards) plus
 *  visible reference images for the active project. */
function boardWorldRects(): WorldRect[] {
  const rects = projectBoardRecords.map((record) => {
    if (record.id === activeLibraryProjectId) {
      return { x: record.x, y: record.y, width: project.width, height: project.height };
    }
    const info = projectBoardRecordInfo(record);
    return { x: record.x, y: record.y, width: info.width, height: info.height };
  });
  const frame = activeWorldRect();
  for (const ref of project.referenceImages ?? []) {
    if (!ref.visible) continue;
    rects.push(referenceWorldRect(ref, frame));
  }
  return rects;
}

/** A free world position for a new project: just right of the current spread. */
function nextWorldPosition(): { x: number; y: number } {
  const bounds = boundingRect(boardWorldRects());
  if (!bounds) return { x: 0, y: 0 };
  return { x: bounds.x + bounds.width + 240, y: bounds.y };
}

// The surrounding editor chrome fades as the active project shrinks on screen,
// so pulling back turns the workspace into a clean board of every idea. CSS maps
// the --chrome-fade variable onto the sidebars/toolbox/timeline; the top bar
// stays put so navigation controls remain reachable.
let chromeFaded = false;
// True once the active project is a small thumbnail on the board; throttles the
// wiggle redraw (see effectiveWiggleFps).
let boardOverview = false;

// Scale at which the active project's frame just fits the surface. Fading is
// measured relative to this so it means the same thing ("zoomed out past the
// project fitting the screen") for portrait, square, and landscape canvases.
function activeFitScale(): number {
  const rect = surfaceRect();
  const frame = activeWorldRect();
  const fit = Math.min(
    (rect.width - CHROME_FADE_PAD) / Math.max(1, frame.width),
    (rect.height - CHROME_FADE_PAD) / Math.max(1, frame.height)
  );
  return fit > 0 ? fit : 1;
}
const CHROME_FADE_PAD = 80;
// Chrome stays solid through comfortable editing zooms, then dissolves into
// board overview. Visual fade and hit-testing are decoupled: panels remain
// clickable while still visible, and only stop intercepting once fully hidden.
const CHROME_FADE_RANGE = DEFAULT_CHROME_FADE;

function updateChromeFade() {
  const ratio = viewport.scale / activeFitScale();
  const opacity = chromeOpacity(ratio, CHROME_FADE_RANGE);
  document.documentElement.style.setProperty("--chrome-fade", opacity.toFixed(3));
  // Only drop pointer-events in true overview (opacity 0). Ghosted-but-readable
  // chrome at mid-zoom stays interactive so a comfortable pull-back doesn't
  // steal the UI out from under the user.
  const faded = opacity <= 0;
  if (faded !== chromeFaded) {
    chromeFaded = faded;
    document.body.classList.toggle("chrome-faded", faded);
  }
  // Deep board-overview zoom throttles the live wiggle redraw.
  boardOverview = ratio < 0.4;
}

function saveProjectBoardMetaSoon() {
  if (!projectLibraryReady) return;
  if (projectBoardMetaSaveTimer !== null) clearTimeout(projectBoardMetaSaveTimer);
  projectBoardMetaSaveTimer = setTimeout(() => {
    projectBoardMetaSaveTimer = null;
    void writeProjectBoardMeta(projectBoardMeta).catch((err) => {
      console.warn("Could not save project board position", err);
    });
  }, 250);
}

function formatBoardUpdatedAt(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function projectBoardRecordInfo(record: ProjectLibraryRecord): {
  width: number;
  height: number;
  panelCount: number;
} {
  try {
    const parsed = JSON.parse(record.json) as {
      panels?: unknown[];
      width?: number;
      height?: number;
    };
    return {
      width: parsed.width && parsed.width > 0 ? parsed.width : 1080,
      height: parsed.height && parsed.height > 0 ? parsed.height : 1080,
      panelCount: parsed.panels?.length ?? 0,
    };
  } catch {
    return { width: 1080, height: 1080, panelCount: 0 };
  }
}

// Preview cards are rebuilt whenever the record set or active project changes.
// The active project is intentionally skipped — its live canvas occupies that
// world slot instead of a static preview.
function buildProjectBoard() {
  boardWorld.querySelectorAll(".board-card").forEach((el) => el.remove());
  positionActiveCanvas();
  buildReferenceImages();
  for (const record of projectBoardRecords) {
    if (record.id === activeLibraryProjectId) continue;
    const info = projectBoardRecordInfo(record);
    const card = document.createElement("div");
    card.className = "board-card";
    card.style.left = `${record.x}px`;
    card.style.top = `${record.y}px`;
    card.style.width = `${info.width}px`;
    card.style.height = `${info.height}px`;
    card.dataset.projectId = record.id;
    card.setAttribute("role", "button");
    card.setAttribute("aria-label", `Open ${record.name}`);
    card.addEventListener("pointerdown", (event) => {
      if (!boardMoveToolActive || event.button !== 0) return;
      beginCanvasPlacement(event, card, record, false);
    });

    if (record.previewDataUrl) {
      const img = document.createElement("img");
      img.src = record.previewDataUrl;
      img.alt = "";
      img.draggable = false;
      card.appendChild(img);
    } else {
      const empty = document.createElement("div");
      empty.className = "board-card-placeholder";
      empty.textContent = "Preview appears after the first autosave";
      card.appendChild(empty);
    }

    const label = document.createElement("div");
    label.className = "board-card-label";
    const title = document.createElement("span");
    title.textContent = record.name;
    const sub = document.createElement("span");
    sub.className = "board-card-sub";
    sub.textContent =
      `${info.width}×${info.height} · ${info.panelCount} panel${info.panelCount === 1 ? "" : "s"} · ${formatBoardUpdatedAt(record.updatedAt)}`;
    label.append(title, sub);
    card.appendChild(label);

    // Click the preview to dive into the project; drag the label to arrange it.
    card.addEventListener("click", (event) => {
      if (boardMoveToolActive) {
        card.dataset.dragged = "";
        return;
      }
      if ((event.target as HTMLElement).closest(".board-card-label")) return;
      if (card.dataset.dragged === "1") { card.dataset.dragged = ""; return; }
      void focusProjectFromBoard(record.id);
    });
    attachCardDrag(card, label, record);

    boardWorld.appendChild(card);
  }
}

// Drag a card's label to reposition it in world space. Screen deltas are
// divided by the camera scale so the card tracks the cursor at any zoom.
function attachCardDrag(card: HTMLElement, handle: HTMLElement, record: ProjectLibraryRecord) {
  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    handle.setPointerCapture(event.pointerId);
    card.classList.add("dragging");
    const startX = event.clientX;
    const startY = event.clientY;
    const originX = record.x;
    const originY = record.y;
    let moved = false;
    const move = (next: PointerEvent) => {
      const dx = (next.clientX - startX) / viewport.scale;
      const dy = (next.clientY - startY) / viewport.scale;
      if (!moved && Math.hypot(next.clientX - startX, next.clientY - startY) > 3) moved = true;
      record.x = originX + dx;
      record.y = originY + dy;
      card.style.left = `${record.x}px`;
      card.style.top = `${record.y}px`;
    };
    const up = () => {
      card.classList.remove("dragging");
      if (moved) card.dataset.dragged = "1";
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      void putProjectLibraryRecord(record);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  });
}

// Board placement is intentionally application state only: picking up a canvas
// changes its library record, never project pixels, raw points, or render data.
function beginCanvasPlacement(
  event: PointerEvent,
  element: HTMLElement,
  record: ProjectLibraryRecord,
  active: boolean
) {
  if (event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  const startX = event.clientX;
  const startY = event.clientY;
  const originX = record.x;
  const originY = record.y;
  let moved = false;
  element.classList.remove("canvas-settling");
  // Alternate a tiny deterministic tilt so repeated pickups feel handmade
  // without introducing random state into any render path.
  const tilt = record.id.length % 2 === 0 ? "-0.6deg" : "0.6deg";
  element.style.setProperty("--board-pickup-tilt", tilt);
  element.classList.add("canvas-picked-up");
  try { element.setPointerCapture(event.pointerId); } catch {}

  const move = (next: PointerEvent) => {
    if (next.pointerId !== event.pointerId) return;
    const screenDx = next.clientX - startX;
    const screenDy = next.clientY - startY;
    if (!moved && Math.hypot(screenDx, screenDy) > 3) moved = true;
    record.x = originX + screenDx / viewport.scale;
    record.y = originY + screenDy / viewport.scale;
    if (active) {
      positionActiveCanvas();
    } else {
      element.style.left = `${record.x}px`;
      element.style.top = `${record.y}px`;
    }
  };
  const finish = (next: PointerEvent) => {
    if (next.pointerId !== event.pointerId) return;
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", finish);
    window.removeEventListener("pointercancel", finish);
    element.classList.remove("canvas-picked-up");
    // Restart the little weight-settle animation even on quick successive moves.
    void element.offsetWidth;
    element.classList.add("canvas-settling");
    element.addEventListener("animationend", () => element.classList.remove("canvas-settling"), { once: true });
    if (moved) element.dataset.dragged = "1";
    void putProjectLibraryRecord(record);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", finish);
  window.addEventListener("pointercancel", finish);
}

// Smoothly glide the camera to a target over ~320ms; used when diving into a
// project so the preview stays in view while the session loads underneath.
let cameraTween: number | null = null;
function animateCameraTo(target: Camera, durationMs = 320): Promise<void> {
  if (cameraTween !== null) cancelAnimationFrame(cameraTween);
  const from = { ...viewport };
  const start = performance.now();
  return new Promise((resolve) => {
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      // easeInOutCubic
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      viewport = {
        scale: from.scale + (target.scale - from.scale) * e,
        tx: from.tx + (target.tx - from.tx) * e,
        ty: from.ty + (target.ty - from.ty) * e,
      };
      applyViewport();
      if (t < 1) {
        cameraTween = requestAnimationFrame(step);
      } else {
        cameraTween = null;
        resolve();
      }
    };
    cameraTween = requestAnimationFrame(step);
  });
}

function syncBoardProjectsToggle(animate = false) {
  const button = document.getElementById("board-projects-toggle") as HTMLButtonElement | null;
  if (!button) return;
  const label = boardCardsVisible ? "Hide projects" : "Show projects";
  button.title = label;
  button.setAttribute("aria-label", label);
  button.setAttribute("aria-pressed", boardCardsVisible ? "true" : "false");
  button.classList.remove("open");
  button.replaceChildren(svgIcon(boardCardsVisible ? StudioIcons.Eye : StudioIcons.EyeOff, 16));
  if (!animate) return;
  button.classList.remove("is-popping");
  // Retrigger the keyframe even on rapid toggles.
  void button.offsetWidth;
  button.classList.add("is-popping");
  const svg = button.querySelector("svg");
  const clear = () => button.classList.remove("is-popping");
  svg?.addEventListener("animationend", clear, { once: true });
  window.setTimeout(clear, 480);
}

function setBoardCardsVisible(visible: boolean, animate = false) {
  boardCardsVisible = visible;
  boardWorld.classList.toggle("cards-hidden", !visible);
  syncBoardProjectsToggle(animate);
}

function setBoardMoveTool(active: boolean) {
  boardMoveToolActive = active;
  document.body.classList.toggle("board-move-tool", active);
  const button = $("board-move-canvas");
  button.setAttribute("aria-pressed", active ? "true" : "false");
  button.classList.toggle("open", active);
  setStatus(active ? "Move canvas: drag any canvas to place it" : "Canvas move tool off");
}

// Arrange every project on a tidy grid (newest first, top-left), then fit them
// all into view. The grid cell is the largest frame so nothing overlaps.
async function organizeProjects() {
  if (!projectLibraryReady || !projectBoardRecords.length) return;
  const ordered = [...projectBoardRecords].sort((a, b) => b.updatedAt - a.updatedAt);
  let cellW = 1080;
  let cellH = 1080;
  for (const record of ordered) {
    const info = projectBoardRecordInfo(record);
    cellW = Math.max(cellW, info.width);
    cellH = Math.max(cellH, info.height);
  }
  // A roughly square grid reads best and, being 2-D, actually shrinks on zoom
  // so "fit all" lands in board mode.
  const columns = Math.max(1, Math.ceil(Math.sqrt(ordered.length)));
  const positions = organizeGrid(ordered.length, { width: cellW, height: cellH }, columns, 260);
  for (let i = 0; i < ordered.length; i++) {
    ordered[i].x = positions[i].x;
    ordered[i].y = positions[i].y;
    await putProjectLibraryRecord(ordered[i]);
  }
  buildProjectBoard();
  fitAllProjects();
}

// Camera that frames a record's world rect the way "focus" should land: fit it
// into the surface at a comfortable size.
function cameraForRecord(record: Pick<ProjectLibraryRecord, "x" | "y">, width: number, height: number): Camera {
  const rect = surfaceRect();
  if (rect.width <= 0 || rect.height <= 0) return { ...viewport };
  return fitCamera({ width: rect.width, height: rect.height }, {
    x: record.x, y: record.y, width, height,
  }, 40);
}

// Dive into another project: glide the camera over to its card, then swap the
// live session in underneath. The camera is not reset afterwards — it already
// sits over the newly active frame. The target's JPEG preview stays in the DOM
// until paintActivePanelNow fills the live canvas, so the handoff has no blank flash.
async function focusProjectFromBoard(id: string) {
  if (id === activeLibraryProjectId) {
    fitViewport();
    return;
  }
  const target = projectBoardRecords.find((record) => record.id === id);
  if (!target) {
    setStatus("project is no longer available");
    return;
  }
  const info = projectBoardRecordInfo(target);
  await animateCameraTo(cameraForRecord(target, info.width, info.height));
  const saved = await prepareToLeaveCurrentProject();
  if (!saved) return;
  // Re-read after leave in case the board changed; fall back to the in-memory card.
  const record = (await getProjectLibraryRecord(id)) ?? target;
  const next = migrateProject(JSON.parse(record.json));
  activeLibraryProjectId = id;
  projectBoardMeta.activeProjectId = id;
  persistenceState.currentFileHandle = projectFileHandles.get(id) ?? null;
  persistenceState.currentFileName = record.name.startsWith("Untitled") ? null : record.name;
  persistenceState.lastSavedHash = projectHashFromString(record.json);
  // preserveCamera: animateCameraTo already framed the target; don't snap again.
  resetProjectSession(next, `opened ${record.name}`, record.json, { preserveCamera: true });
  activePanelIndex = Math.max(0, Math.min(record.activePanelIndex, next.panels.length - 1));
  rangeAnchorIndex = activePanelIndex;
  rangeEndIndex = activePanelIndex;
  buildTimeline();
  buildLayers();
  buildBreadcrumb();
  buildInspector();
  // Live frame now sits under the still-present target preview card. Paint
  // before rebuild so dropping the card reveals real pixels, not a blank matte.
  paintActivePanelNow();
  buildProjectBoard();
  applyViewport();
  await writeProjectBoardMeta(projectBoardMeta);
}

async function addProjectToLibrary(
  next: Project,
  name: string,
  fileHandle: FileSystemFileHandle | null = null,
  serialized?: string
): Promise<ProjectLibraryRecord | null> {
  if (!projectLibraryReady) return null;
  const json = serialized ?? serializeProject(next);
  const id = crypto.randomUUID();
  const position = nextWorldPosition();
  const record: ProjectLibraryRecord = {
    id,
    name,
    json,
    previewDataUrl: renderProjectPreview(next, 0),
    ...position,
    updatedAt: Date.now(),
    activePanelIndex: 0,
    viewport: { scale: 1, tx: 0, ty: 0 },
  };
  await putProjectLibraryRecord(record);
  projectBoardRecords.push(record);
  if (fileHandle) projectFileHandles.set(id, fileHandle);
  activeLibraryProjectId = id;
  projectBoardMeta.activeProjectId = id;
  await writeProjectBoardMeta(projectBoardMeta);
  return record;
}

async function initializeProjectLibrary() {
  if (!projectLibraryAvailable()) {
    setStatus("Project Board storage unavailable; using single-project recovery");
    return;
  }
  try {
    projectBoardRecords = await listProjectLibraryRecords();
    projectBoardMeta = await readProjectBoardMeta();
    projectLibraryReady = true;
    // One-time migration: old records were positioned on a shrunken display
    // grid. Spread them out into full-resolution world coordinates and discard
    // the stale (display-space) camera so we re-fit from scratch.
    let migratedPositions = false;
    if (!projectBoardMeta.worldMigrated && projectBoardRecords.length) {
      for (const record of projectBoardRecords) {
        const moved = migrateLegacyPosition({ x: record.x, y: record.y });
        record.x = moved.x;
        record.y = moved.y;
        await putProjectLibraryRecord(record);
      }
      projectBoardMeta.worldMigrated = true;
      migratedPositions = true;
    }
    const requested = projectBoardMeta.activeProjectId;
    const activeRecord = requested
      ? projectBoardRecords.find((record) => record.id === requested)
      : null;
    if (activeRecord) {
      const next = migrateProject(JSON.parse(activeRecord.json));
      activeLibraryProjectId = activeRecord.id;
      persistenceState.currentFileHandle = null;
      persistenceState.currentFileName = activeRecord.name.startsWith("Untitled") ? null : activeRecord.name;
      persistenceState.lastSavedHash = projectHashFromString(activeRecord.json);
      resetProjectSession(next, `restored ${activeRecord.name}`, activeRecord.json);
      activePanelIndex = Math.max(0, Math.min(activeRecord.activePanelIndex, next.panels.length - 1));
      rangeAnchorIndex = activePanelIndex;
      rangeEndIndex = activePanelIndex;
      buildTimeline();
      buildLayers();
      buildBreadcrumb();
      buildInspector();
      buildProjectBoard();
      // Restore the saved board camera unless we just migrated (its coordinate
      // space is gone) — resetProjectSession already left us fit on the project.
      if (!migratedPositions && projectBoardMeta.camera) {
        viewport = { ...projectBoardMeta.camera };
      }
      applyViewport();
    } else {
      const json = autosaveSerialization.snapshot(project).json;
      const record = await addProjectToLibrary(project, "Untitled 1", null, json);
      if (record) resetCurrentFile(project, json);
      buildProjectBoard();
      applyViewport();
    }
    if (migratedPositions) await writeProjectBoardMeta(projectBoardMeta);
  } catch (err) {
    projectLibraryReady = false;
    setStatus("Project Board unavailable: " + (err as Error).message);
  }
}

function currentDirty(): boolean {
  return _isDirty;
}

function updateFileChrome() {
  $("file-name").textContent = persistenceState.currentFileName ?? "Untitled";
  const meta = document.querySelector(".topbar-file-meta");
  meta?.classList.toggle("is-dirty", currentDirty());
}

function resetProjectSession(
  next: Project,
  fileStatus: string,
  serialized?: string,
  opts?: { preserveCamera?: boolean }
) {
  applySanitizedGroups(next);
  project = next;
  autosaveSerialization.reset(project, serialized);
  pruneRasterStoreForProject(project);
  history.init(project, { activePanelIndex: 0 });
  updateUndoRedoButtons();
  markClean();
  resizeCanvasForProject();
  activePanelIndex = 0;
  rangeAnchorIndex = 0;
  rangeEndIndex = 0;
  lastSequencePosition = null;
  activeSubPanelPath = [];
  selectedSubPanelId = null;
  selectedText = null;
  selectedReferenceImageId = null;
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
  // Board focus already animated the camera onto the target — don't retouch it.
  if (!opts?.preserveCamera) fitViewport();
  else positionActiveCanvas();
  updateExportMenuLabels();
  updateCanvasHint();
  updateFileChrome();
  setStatus(fileStatus);
}

async function saveProject() {
  try {
    const { json } = autosaveSerialization.snapshot(project);
    const result = await persistSaveProject(project, json);
    if (activeLibraryProjectId && persistenceState.currentFileHandle) {
      projectFileHandles.set(activeLibraryProjectId, persistenceState.currentFileHandle);
    }
    if (projectLibraryReady) await persistCurrentProjectRecord(json, true);
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
    const { json } = autosaveSerialization.snapshot(project);
    const result = await saveAsProject(
      project,
      persistenceState.currentFileName ?? "wigo-studio-project.wigo.json",
      json
    );
    if (activeLibraryProjectId && persistenceState.currentFileHandle) {
      projectFileHandles.set(activeLibraryProjectId, persistenceState.currentFileHandle);
    }
    if (projectLibraryReady) await persistCurrentProjectRecord(json, true);
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
    await prepareToLeaveCurrentProject();
    const handle = persistenceState.currentFileHandle;
    const json = serializeProject(result.project);
    await addProjectToLibrary(result.project, result.fileName, handle, json);
    resetProjectSession(result.project, `opened ${result.fileName}`, json);
    buildProjectBoard();
    fitViewport();
    buildFileMenu();
  } catch (err) {
    if (!isAbortError(err)) setStatus("open failed: " + (err as Error).message);
  }
}

async function newProject(presetKey?: string) {
  await prepareToLeaveCurrentProject();
  const preset = presetKey ? canvasPresetByKey(presetKey) : defaultCanvasPreset();
  const { width, height } = preset ?? defaultCanvasPreset();
  const next = createProject(width, height);
  const json = serializeProject(next);
  resetCurrentFile(next, json);
  await addProjectToLibrary(next, `Untitled ${projectBoardRecords.length + 1}`, null, json);
  clearRecoverySnapshot();
  resetProjectSession(next, `new project (${formatCanvasDimensions(width, height)})`, json);
  buildProjectBoard();
  fitViewport();
  buildFileMenu();
}

function openPresetPicker() {
  closeAllTopbarMenus();
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
      void newProject(preset.key);
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
    const json = await file.text();
    const next = migrateProject(JSON.parse(json));
    const canonical = serializeProject(next);
    persistenceState.lastSavedHash = projectHashFromString(canonical);
    resetProjectSession(next, `reverted ${persistenceState.currentFileName ?? file.name}`, canonical);
    await persistCurrentProjectRecord(canonical, true);
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
  const menu = $("file-menu");
  menu.classList.remove("open");
  $("file-menu-button").classList.remove("open");
  clearTopbarMenuPosition(menu);
}

function closeProjectMenu() {
  const menu = $("project-menu");
  menu.classList.remove("open");
  $("project-menu-button").classList.remove("open");
  clearTopbarMenuPosition(menu);
}

function closeViewMenu() {
  const menu = $("view-menu");
  menu.classList.remove("open");
  $("view-menu-button").classList.remove("open");
  clearTopbarMenuPosition(menu);
}

function closeExportMenu() {
  const menu = $("export-menu");
  menu.classList.remove("open");
  $("export-menu-button").classList.remove("open");
  clearTopbarMenuPosition(menu);
}

function closeHelpMenu() {
  const menu = $("help-menu");
  menu.classList.remove("open");
  $("help-menu-button").classList.remove("open");
  clearTopbarMenuPosition(menu);
}

function closeAllTopbarMenus() {
  closeFileMenu();
  closeProjectMenu();
  closeViewMenu();
  closeExportMenu();
  closeHelpMenu();
}

type ViewChromePanel = "toolbox" | "settings" | "palettes" | "timeline" | "inspector";

function workspacePanelEl(id: ViewChromePanel): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-workspace-panel="${id}"]`);
}

function isWorkspacePanelVisible(id: ViewChromePanel): boolean {
  const panel = workspacePanelEl(id);
  return !!panel && !panel.hidden;
}

function setWorkspacePanelVisible(id: ViewChromePanel, visible: boolean) {
  const panel = workspacePanelEl(id);
  if (!panel) return;
  panel.hidden = !visible;
  // Detached module floaters that originated from this group stay independent.
  if (id === "inspector" || id === "settings" || id === "palettes" || id === "timeline") {
    document.querySelectorAll<HTMLElement>(`.inspector-module-panel[data-inspector-group="${id === "inspector" ? "main" : id}"]`)
      .forEach((floater) => { floater.hidden = !visible; });
  }
  refreshWorkspacePanelDividers();
}

function viewMenuCheck(
  label: string,
  checked: boolean,
  onChange: (next: boolean) => void,
): HTMLLabelElement {
  const row = document.createElement("label");
  row.className = "control-check menu-item-check";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = checked;
  input.onchange = () => onChange(input.checked);
  row.append(input, document.createTextNode(` ${label}`));
  return row;
}

function buildViewMenu() {
  const menu = $("view-menu");
  menu.innerHTML = "";

  menu.appendChild(viewMenuCheck("Tools", isWorkspacePanelVisible("toolbox"), (visible) => {
    setWorkspacePanelVisible("toolbox", visible);
  }));
  menu.appendChild(viewMenuCheck("Brush", isWorkspacePanelVisible("settings"), (visible) => {
    setWorkspacePanelVisible("settings", visible);
  }));
  menu.appendChild(viewMenuCheck("Color", isWorkspacePanelVisible("palettes"), (visible) => {
    setWorkspacePanelVisible("palettes", visible);
  }));
  menu.appendChild(viewMenuCheck("Timeline", isWorkspacePanelVisible("timeline"), (visible) => {
    setWorkspacePanelVisible("timeline", visible);
  }));
  menu.appendChild(viewMenuCheck("Inspector", isWorkspacePanelVisible("inspector"), (visible) => {
    setWorkspacePanelVisible("inspector", visible);
  }));
  menu.appendChild(divider());
  menu.appendChild(viewMenuCheck("Other projects", boardCardsVisible, (visible) => {
    setBoardCardsVisible(visible);
  }));
  menu.appendChild(viewMenuCheck("TikTok UI guide", tiktokOverlayEnabled, (visible) => {
    if (visible === tiktokOverlayEnabled) return;
    toggleTikTokOverlay();
  }));
}

function clearTopbarMenuPosition(menu: HTMLElement) {
  menu.style.left = "";
  menu.style.right = "";
  menu.style.maxHeight = "";
  menu.style.overflowY = "";
}

/** Keep topbar dropdowns inside the viewport (flip + scroll if needed). */
function positionTopbarMenu(menu: HTMLElement) {
  clearTopbarMenuPosition(menu);
  const margin = 8;
  const rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth - margin) {
    menu.style.left = "auto";
    menu.style.right = "0";
  } else if (rect.left < margin) {
    menu.style.left = "0";
    menu.style.right = "auto";
  }
  const next = menu.getBoundingClientRect();
  const maxBottom = window.innerHeight - margin;
  if (next.bottom > maxBottom) {
    menu.style.maxHeight = `${Math.max(120, maxBottom - next.top)}px`;
    menu.style.overflowY = "auto";
  }
}

function buildFileMenu() {
  const menu = $("file-menu");
  menu.innerHTML = "";
  menu.appendChild(menuButton("New Project…", "", openPresetPicker));
  menu.appendChild(menuButton("Open…", "⌘O", openProject));
  menu.appendChild(menuButton("Save", "⌘S", saveProject));
  menu.appendChild(menuButton("Save As…", "⇧⌘S", saveProjectAs));
  menu.appendChild(divider());

  menu.appendChild(divider());
  menu.appendChild(menuButton("Revert", "", revertProject, !persistenceState.currentFileHandle));
}

($("file-menu-button") as HTMLButtonElement).onclick = (e) => {
  e.stopPropagation();
  closeProjectMenu();
  closeViewMenu();
  closeExportMenu();
  closeHelpMenu();
  buildFileMenu();
  const menu = $("file-menu");
  const opening = !menu.classList.contains("open");
  menu.classList.toggle("open");
  $("file-menu-button").classList.toggle("open");
  if (opening) positionTopbarMenu(menu);
  else clearTopbarMenuPosition(menu);
};
($("board-projects-toggle") as HTMLButtonElement).onclick = () => {
  setBoardCardsVisible(!boardCardsVisible, true);
};
($("board-organize") as HTMLButtonElement).onclick = () => {
  if (!boardCardsVisible) setBoardCardsVisible(true);
  void organizeProjects();
};
const boardMoveButton = $("board-move-canvas") as HTMLButtonElement;
boardMoveButton.onclick = () => setBoardMoveTool(!boardMoveToolActive);
syncBoardProjectsToggle();

// Drag empty world space to pan the board. Events on the live canvas, a card,
// or a floating control are left for their own handlers.
stageArea.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  const target = event.target as HTMLElement;
  if (target === canvas || target.closest(".board-card, .board-ref, .zoom-pill, .canvas-hint")) return;
  if (selectedReferenceImageId) selectReferenceImage(null);
  event.preventDefault();
  stageArea.setPointerCapture(event.pointerId);
  stageArea.classList.add("panning");
  const startX = event.clientX;
  const startY = event.clientY;
  const originTx = viewport.tx;
  const originTy = viewport.ty;
  const move = (next: PointerEvent) => {
    viewport = { scale: viewport.scale, tx: originTx + next.clientX - startX, ty: originTy + next.clientY - startY };
    applyViewport();
  };
  const up = () => {
    stageArea.classList.remove("panning");
    stageArea.removeEventListener("pointermove", move);
    stageArea.removeEventListener("pointerup", up);
    stageArea.removeEventListener("pointercancel", up);
  };
  stageArea.addEventListener("pointermove", move);
  stageArea.addEventListener("pointerup", up);
  stageArea.addEventListener("pointercancel", up);
});

($("export-menu-button") as HTMLButtonElement).onclick = (e) => {
  e.stopPropagation();
  closeFileMenu();
  closeProjectMenu();
  closeViewMenu();
  closeHelpMenu();
  const menu = $("export-menu");
  const opening = !menu.classList.contains("open");
  if (opening) ($("export-jitter") as HTMLInputElement).checked = jitterEnabled;
  menu.classList.toggle("open");
  $("export-menu-button").classList.toggle("open");
  if (opening) positionTopbarMenu(menu);
  else clearTopbarMenuPosition(menu);
};
($("project-menu-button") as HTMLButtonElement).onclick = (e) => {
  e.stopPropagation();
  closeFileMenu();
  closeViewMenu();
  closeExportMenu();
  closeHelpMenu();
  buildProjectSettings();
  const menu = $("project-menu");
  const opening = !menu.classList.contains("open");
  menu.classList.toggle("open");
  $("project-menu-button").classList.toggle("open");
  if (opening) positionTopbarMenu(menu);
  else clearTopbarMenuPosition(menu);
};
($("view-menu-button") as HTMLButtonElement).onclick = (e) => {
  e.stopPropagation();
  closeFileMenu();
  closeProjectMenu();
  closeExportMenu();
  closeHelpMenu();
  buildViewMenu();
  const menu = $("view-menu");
  const opening = !menu.classList.contains("open");
  menu.classList.toggle("open");
  $("view-menu-button").classList.toggle("open");
  if (opening) positionTopbarMenu(menu);
  else clearTopbarMenuPosition(menu);
};
document.addEventListener("click", (e) => {
  if (!(e.target as HTMLElement).closest(".menu-wrap")) {
    closeAllTopbarMenus();
  }
});

($("undo-btn") as HTMLButtonElement).onclick = () => performUndoRedo(false);
($("redo-btn") as HTMLButtonElement).onclick = () => performUndoRedo(true);
updateUndoRedoButtons();

// Electron's Edit menu sends these instead of dispatching a native keydown —
// mirror the keyboard handler's editable-field carve-out so text-field undo
// (e.g. in a renamed-panel input) still goes through execCommand.
menuBridge()?.onMenuUndo(() => {
  const active = document.activeElement as HTMLElement | null;
  const inEditable = active?.tagName === "INPUT" || active?.tagName === "TEXTAREA" || active?.isContentEditable;
  if (inEditable) document.execCommand("undo");
  else performUndoRedo(false);
});
menuBridge()?.onMenuRedo(() => {
  const active = document.activeElement as HTMLElement | null;
  const inEditable = active?.tagName === "INPUT" || active?.tagName === "TEXTAREA" || active?.isContentEditable;
  if (inEditable) document.execCommand("redo");
  else performUndoRedo(true);
});

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
    await prepareToLeaveCurrentProject();
    const json = serializeProject(next);
    await addProjectToLibrary(next, file.name, null, json);
    resetProjectSession(next, `opened ${file.name}`, json);
    buildProjectBoard();
    fitViewport();
    buildFileMenu();
  } catch (err) {
    setStatus("load failed: " + (err as Error).message);
  }
  (e.target as HTMLInputElement).value = "";
};

async function autosaveTick() {
  if (!_isDirty) return;
  const saved = await flushAutosave();
  if (saved) setStatus(`auto-saved ${new Date().toLocaleTimeString()}`);
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
  recover.onclick = async () => {
    try {
      const next = recoverProject(snapshot);
      await prepareToLeaveCurrentProject();
      const json = serializeProject(next);
      resetCurrentFile(next, json);
      await addProjectToLibrary(next, `Recovered ${projectBoardRecords.length + 1}`, null, json);
      resetProjectSession(next, "recovered unsaved work", json);
      clearRecoverySnapshot();
      updateFileChrome();
      buildProjectBoard();
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
  host.classList.add("is-visible");
  clearTimeout(_statusTimer);
}

setInterval(() => { void autosaveTick(); }, 5000);

async function initializePersistentWorkspace() {
  await initializeProjectLibrary();
  showRecoveryPrompt();
}

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

  const canvasOwnsKeyboard = target === canvas || target === stageArea || target === document.body;
  if (!inEditable && canvasOwnsKeyboard &&
      (e.key === " " || e.key === "Spacebar" || e.code === "Space")) {
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
    if (key === "a" && canvasOwnsKeyboard) {
      e.preventDefault();
      selectionState = {
        mode: "region",
        phase: "idle",
        shape: { kind: "rect", x: 0, y: 0, w: project.width, h: project.height },
        tool: "rect",
      };
      buildEditContext();
      requestLoopFrame();
      setStatus("Selected all");
      return;
    }
    if (key === "d" && canvasOwnsKeyboard) {
      e.preventDefault();
      clearSelection();
      buildEditContext();
      requestLoopFrame();
      setStatus("Selection cleared");
      return;
    }
    if (key === "i" && e.shiftKey && canvasOwnsKeyboard &&
        selectionState?.mode === "region" && selectionState.phase === "idle") {
      e.preventDefault();
      invertActiveSelection();
      requestLoopFrame();
      setStatus(selectionState.inverted ? "Selection inverted" : "Selection uninverted");
      return;
    }
    if (key === "c") {
      if (selectedReferenceImageId && copySelectedReferenceImage()) {
        e.preventDefault();
        return;
      }
      if (selectionState?.mode === "object") { e.preventDefault(); copySelection(); return; }
      if (selectionState?.mode === "region" && activeLayer()?.kind === "raster") {
        e.preventDefault();
        copyRasterRegionSelection();
        return;
      }
      if (activeLayer()) { e.preventDefault(); copyActiveLayer(); return; }
    }
    if (key === "x" && selectionState) {
      e.preventDefault();
      cutSelection();
      return;
    }
  }

  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
    if (inEditable) return;
    e.preventDefault();
    performUndoRedo(e.shiftKey);
    return;
  }

  if (e.ctrlKey && !e.metaKey && e.key.toLowerCase() === "y") {
    if (inEditable) return;
    e.preventDefault();
    performUndoRedo(true);
    return;
  }

  if (!inEditable && canvasOwnsKeyboard && selectionState?.mode === "region" &&
      selectionState.phase === "idle" &&
      ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
    e.preventDefault();
    const step = e.shiftKey ? 10 : 1;
    const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
    const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
    selectionState = {
      ...selectionState,
      shape: translateShape(selectionState.shape, dx, dy),
    };
    requestLoopFrame();
    return;
  }

  // Delete / Backspace: selected reference image, or raster/object selection.
  if ((e.key === "Delete" || e.key === "Backspace") && !inEditable) {
    if (selectedReferenceImageId && deleteSelectedReferenceImage()) {
      e.preventDefault();
      return;
    }
    if (isObjectSelectionIdle(selectionState) ||
        (selectionState?.mode === "region" && activeLayer()?.kind === "raster")) {
      e.preventDefault();
      if (!deleteRasterRegionSelection()) deleteSelection();
      return;
    }
  }
  // Escape clears any in-progress or active selection.
  if (e.key === "Escape" && !inEditable) {
    // When zoomed out into board/overview territory, Escape flies back to the
    // active project rather than clearing anything.
    if (chromeFaded) {
      fitViewport();
      return;
    }
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
    closeAllTopbarMenus();
    if (selectionState) {
      // Commit before clearing if an explicit extracted-object move is active.
      if (selectionState.phase === "moving" && selectionState.mode === "object") {
        syncRasterMarqueeItems(selectionState.items);
        commitHistory();
      } else if (selectionState.phase === "transforming") {
        syncRasterMarqueeItems(selectionState.items);
        transformSnapshots = null;
        commitHistory();
      }
      clearSelection();
      buildEditContext();
      setStatus("Selection cleared");
    }
    if (keyframeArm) { keyframeArm = null; buildBrushBar(); buildInspector(); setStatus("Keyframe placement cancelled"); }
    if (selectedText) { selectedText = null; buildInspector(); }
    if (selectedSubPanelId) { selectedSubPanelId = null; buildInspector(); }
    if (selectedReferenceImageId) {
      selectReferenceImage(null);
      setStatus("Reference deselected");
    }
    return;
  }
});

window.addEventListener("paste", (event) => {
  const target = event.target as HTMLElement | null;
  const tag = target?.tagName;
  const inEditable = tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable;
  if (inEditable) return;

  const imageFiles = clipboardRasterFiles(event.clipboardData);
  if (imageFiles.length > 0) {
    event.preventDefault();
    void pasteRasterImages(imageFiles);
    return;
  }
  if (clipboardContainsImage(event.clipboardData)) {
    event.preventDefault();
    showToast("Only PNG and JPEG images can be pasted", "info");
    return;
  }
  if (lastEditClipboardKind === "reference" && referenceClipboard) {
    event.preventDefault();
    void pasteReferenceClipboardAsRaster();
    return;
  }
  if (lastEditClipboardKind === "selection" && selectionClipboard) {
    event.preventDefault();
    pasteSelection();
    return;
  }
  if (lastEditClipboardKind === "layer" && layerClipboard) {
    event.preventDefault();
    pasteLayerAboveActive();
  }
});

// Finder / OS file drops onto the board → project-attached reference images
// (editor-only; never exported). Shift+drop keeps the older path: paste into
// the active panel as a raster drawing layer. Window-level preventDefault
// stops Chromium from navigating to the file URL when the drop lands outside
// the stage.
window.addEventListener("dragover", (event) => {
  if (!dataTransferHasFiles(event.dataTransfer)) return;
  event.preventDefault();
});
window.addEventListener("drop", (event) => {
  if (!dataTransferHasFiles(event.dataTransfer)) return;
  event.preventDefault();
});
stageArea.addEventListener("dragover", (event) => {
  if (!dataTransferHasFiles(event.dataTransfer)) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
});
stageArea.addEventListener("drop", (event) => {
  if (!dataTransferHasFiles(event.dataTransfer)) return;
  event.preventDefault();
  const imageFiles = clipboardRasterFiles(event.dataTransfer);
  if (imageFiles.length > 0) {
    if (event.shiftKey) {
      void pasteRasterImages(imageFiles);
    } else {
      void dropReferenceImages(imageFiles, event.clientX, event.clientY);
    }
    return;
  }
  if (clipboardContainsImage(event.dataTransfer)) {
    showToast("Only PNG and JPEG images can be dropped", "info");
  }
});

window.addEventListener("keyup", (e) => {
  if (e.key !== " " && e.key !== "Spacebar" && e.code !== "Space") return;
  spacePanDown = false;
  panDrag = null;
  stageArea.classList.remove("space-pan", "panning");
});

// ---- movable workspace panels --------------------------------------------

const workspacePanels: HTMLElement[] = [];
const workspacePanelStack: HTMLElement[] = [];
const workspaceDockTop = 52;
const workspacePanelMargin = 8;
const workspacePanelGap = 4;
let workspacePanelDividers: HTMLElement[] = [];
let workspaceDividerResizing = false;
let workspacePanelResizeObserver: ResizeObserver | null = null;
let workspacePanelSettleQueued = false;
const workspaceDragBlockers = [
  "button", "input", "select", "textarea", "a", "summary", "label", "canvas",
  "[contenteditable]", "[role='button']", "[role='slider']", "[draggable='true']",
  ".panel-cell", ".layer-row", ".layer-item",
].join(",");

function refreshWorkspacePanelLayers() {
  workspacePanelStack.forEach((item, layer) => {
    item.style.setProperty("--workspace-panel-layer", String(layer));
  });
}

function raiseWorkspacePanel(panel: HTMLElement) {
  const index = workspacePanelStack.indexOf(panel);
  if (index >= 0) workspacePanelStack.splice(index, 1);
  workspacePanelStack.push(panel);
  refreshWorkspacePanelLayers();
}

function floatingWorkspacePanels() {
  return workspacePanels.filter((panel) => !panel.hidden
    && !(panel.classList.contains("timeline-panel") && !panel.classList.contains("is-floating")));
}

function workspacePanelMinWidth(panel: HTMLElement) {
  return panel.classList.contains("toolbox-panel") ? 52 : 196;
}

function workspacePanelMinHeight(panel: HTMLElement) {
  return panel.querySelector(":scope > .inspector-module[open]") ? 72 : 40;
}

function overlapLength(startA: number, endA: number, startB: number, endB: number) {
  return Math.max(0, Math.min(endA, endB) - Math.max(startA, startB));
}

function workspacePanelsOverlap(a: HTMLElement, b: HTMLElement) {
  const ar = a.getBoundingClientRect();
  const br = b.getBoundingClientRect();
  return overlapLength(ar.left, ar.right, br.left, br.right) > 1
    && overlapLength(ar.top, ar.bottom, br.top, br.bottom) > 1;
}

function workspacePanelsShareLane(a: HTMLElement, b: HTMLElement) {
  const ar = a.getBoundingClientRect();
  const br = b.getBoundingClientRect();
  return Math.abs(ar.left - br.left) <= 12
    && overlapLength(ar.left, ar.right, br.left, br.right) >= 32;
}

/** Turn each intersecting cluster into a shared vertical lane. Every member
 * competes for the available viewport height and scrolls internally, rather
 * than sitting over another panel's controls. */
function settleWorkspacePanelIntersections() {
  const panels = floatingWorkspacePanels();
  const toolbox = panels.find((panel) => panel.classList.contains("toolbox-panel"));
  let laneMinLeft = workspacePanelMargin;
  if (toolbox) {
    const rail = toolbox.getBoundingClientRect();
    laneMinLeft = Math.max(rail.right, rail.left + workspacePanelMinWidth(toolbox))
      + workspacePanelGap;
    for (const panel of panels) {
      if (panel === toolbox || !workspacePanelsOverlap(panel, toolbox)) continue;
      const rect = panel.getBoundingClientRect();
      const nextLeft = laneMinLeft;
      if (nextLeft + rect.width <= window.innerWidth - workspacePanelMargin) {
        panel.style.left = `${nextLeft}px`;
        panel.style.right = "auto";
      }
    }
  }

  const candidates = panels.filter((panel) => panel !== toolbox);
  const unseen = new Set(candidates);
  while (unseen.size) {
    const seed = unseen.values().next().value as HTMLElement;
    unseen.delete(seed);
    const component = [seed];
    for (let i = 0; i < component.length; i++) {
      for (const candidate of [...unseen]) {
        if (!workspacePanelsOverlap(component[i], candidate)
          && !workspacePanelsShareLane(component[i], candidate)) continue;
        unseen.delete(candidate);
        component.push(candidate);
      }
    }
    if (component.length < 2) continue;

    component.sort((a, b) => {
      const ar = a.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      return ar.top - br.top || ar.left - br.left;
    });
    const rects = component.map((panel) => panel.getBoundingClientRect());
    const laneLeft = Math.max(laneMinLeft, Math.min(...rects.map((rect) => rect.left)));
    const laneTop = Math.max(workspaceDockTop, Math.min(...rects.map((rect) => rect.top)));
    const laneWidth = Math.min(
      Math.max(...rects.map((rect) => rect.width)),
      window.innerWidth - workspacePanelMargin - laneLeft,
    );
    const usableHeight = window.innerHeight - workspacePanelMargin - laneTop
      - workspacePanelGap * (component.length - 1);
    const minimums = component.map(workspacePanelMinHeight);
    const minimumTotal = minimums.reduce((sum, height) => sum + height, 0);
    if (laneWidth < Math.max(...component.map(workspacePanelMinWidth)) || usableHeight < minimumTotal) {
      continue;
    }
    const desiredExtras = rects.map((rect, i) => Math.max(0, rect.height - minimums[i]));
    const desiredExtraTotal = desiredExtras.reduce((sum, height) => sum + height, 0);
    const availableExtra = usableHeight - minimumTotal;
    let top = laneTop;
    component.forEach((panel, i) => {
      const proportionalExtra = desiredExtraTotal > 0
        ? availableExtra * desiredExtras[i] / desiredExtraTotal
        : availableExtra / component.length;
      const height = minimums[i] + proportionalExtra;
      panel.style.left = `${laneLeft}px`;
      panel.style.right = "auto";
      panel.style.top = `${top}px`;
      panel.style.bottom = "auto";
      panel.style.width = `${laneWidth}px`;
      panel.style.height = `${height}px`;
      top += height + workspacePanelGap;
    });
  }
  refreshWorkspacePanelDividers();
}

function clearWorkspacePanelDividers() {
  workspacePanelDividers.forEach((divider) => divider.remove());
  workspacePanelDividers = [];
}

function attachWorkspacePanelDivider(
  orientation: "vertical" | "horizontal",
  first: HTMLElement,
  second: HTMLElement,
  start: number,
  end: number,
  boundary: number,
) {
  const divider = document.createElement("div");
  divider.className = `workspace-panel-divider ${orientation}`;
  divider.setAttribute("role", "separator");
  divider.setAttribute("aria-orientation", orientation);
  divider.setAttribute("aria-valuenow", String(Math.round(boundary)));
  divider.tabIndex = 0;
  if (orientation === "vertical") {
    divider.style.left = `${boundary - 5}px`;
    divider.style.top = `${start}px`;
    divider.style.height = `${end - start}px`;
  } else {
    divider.style.left = `${start}px`;
    divider.style.top = `${boundary - 5}px`;
    divider.style.width = `${end - start}px`;
  }
  divider.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    workspaceDividerResizing = true;
    divider.classList.add("is-resizing");
    divider.setPointerCapture(event.pointerId);
    const firstRect = first.getBoundingClientRect();
    const secondRect = second.getBoundingClientRect();
    const minFirst = orientation === "vertical"
      ? workspacePanelMinWidth(first) : workspacePanelMinHeight(first);
    const minSecond = orientation === "vertical"
      ? workspacePanelMinWidth(second) : workspacePanelMinHeight(second);
    const outerStart = orientation === "vertical" ? firstRect.left : firstRect.top;
    const outerEnd = orientation === "vertical" ? secondRect.right : secondRect.bottom;
    const move = (next: PointerEvent) => {
      const pointer = orientation === "vertical" ? next.clientX : next.clientY;
      const split = Math.max(outerStart + minFirst + workspacePanelGap / 2,
        Math.min(outerEnd - minSecond - workspacePanelGap / 2, pointer));
      if (orientation === "vertical") {
        first.style.width = `${split - workspacePanelGap / 2 - outerStart}px`;
        second.style.left = `${split + workspacePanelGap / 2}px`;
        second.style.right = "auto";
        second.style.width = `${outerEnd - split - workspacePanelGap / 2}px`;
      } else {
        first.style.height = `${split - workspacePanelGap / 2 - outerStart}px`;
        second.style.top = `${split + workspacePanelGap / 2}px`;
        second.style.bottom = "auto";
        second.style.height = `${outerEnd - split - workspacePanelGap / 2}px`;
      }
    };
    const finish = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      workspaceDividerResizing = false;
      refreshWorkspacePanelDividers();
      fitViewport();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  });
  divider.addEventListener("keydown", (event) => {
    const backward = orientation === "vertical" ? event.key === "ArrowLeft" : event.key === "ArrowUp";
    const forward = orientation === "vertical" ? event.key === "ArrowRight" : event.key === "ArrowDown";
    if (!backward && !forward) return;
    event.preventDefault();
    workspaceDividerResizing = true;
    const amount = (event.shiftKey ? 24 : 8) * (backward ? -1 : 1);
    const firstRect = first.getBoundingClientRect();
    const secondRect = second.getBoundingClientRect();
    if (orientation === "vertical") {
      const boundary = firstRect.right + workspacePanelGap / 2 + amount;
      const min = firstRect.left + workspacePanelMinWidth(first) + workspacePanelGap / 2;
      const max = secondRect.right - workspacePanelMinWidth(second) - workspacePanelGap / 2;
      const split = Math.max(min, Math.min(max, boundary));
      first.style.width = `${split - workspacePanelGap / 2 - firstRect.left}px`;
      second.style.left = `${split + workspacePanelGap / 2}px`;
      second.style.right = "auto";
      second.style.width = `${secondRect.right - split - workspacePanelGap / 2}px`;
      divider.style.left = `${split - 5}px`;
      divider.setAttribute("aria-valuenow", String(Math.round(split)));
    } else {
      const boundary = firstRect.bottom + workspacePanelGap / 2 + amount;
      const min = firstRect.top + workspacePanelMinHeight(first) + workspacePanelGap / 2;
      const max = secondRect.bottom - workspacePanelMinHeight(second) - workspacePanelGap / 2;
      const split = Math.max(min, Math.min(max, boundary));
      first.style.height = `${split - workspacePanelGap / 2 - firstRect.top}px`;
      second.style.top = `${split + workspacePanelGap / 2}px`;
      second.style.bottom = "auto";
      second.style.height = `${secondRect.bottom - split - workspacePanelGap / 2}px`;
      divider.style.top = `${split - 5}px`;
      divider.setAttribute("aria-valuenow", String(Math.round(split)));
    }
    fitViewport();
  });
  const finishKeyboardResize = () => {
    if (!workspaceDividerResizing) return;
    workspaceDividerResizing = false;
    refreshWorkspacePanelDividers();
  };
  divider.addEventListener("keyup", finishKeyboardResize);
  divider.addEventListener("blur", finishKeyboardResize);
  document.body.appendChild(divider);
  workspacePanelDividers.push(divider);
}

/** Add a hoverable shared seam wherever non-overlapping panels meet. */
function refreshWorkspacePanelDividers() {
  if (workspaceDividerResizing) return;
  clearWorkspacePanelDividers();
  const panels = floatingWorkspacePanels();
  for (let i = 0; i < panels.length; i++) {
    for (let j = i + 1; j < panels.length; j++) {
      const a = panels[i];
      const b = panels[j];
      const ar = a.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      const verticalOverlap = overlapLength(ar.top, ar.bottom, br.top, br.bottom);
      const horizontalOverlap = overlapLength(ar.left, ar.right, br.left, br.right);
      if (verticalOverlap >= 32) {
        const left = ar.left <= br.left ? a : b;
        const right = left === a ? b : a;
        const lr = left.getBoundingClientRect();
        const rr = right.getBoundingClientRect();
        if (Math.abs(rr.left - lr.right - workspacePanelGap) <= 2) {
          attachWorkspacePanelDivider("vertical", left, right,
            Math.max(lr.top, rr.top), Math.min(lr.bottom, rr.bottom),
            (lr.right + rr.left) / 2);
        }
      }
      if (horizontalOverlap >= 32) {
        const top = ar.top <= br.top ? a : b;
        const bottom = top === a ? b : a;
        const tr = top.getBoundingClientRect();
        const dr = bottom.getBoundingClientRect();
        if (Math.abs(dr.top - tr.bottom - workspacePanelGap) <= 2) {
          attachWorkspacePanelDivider("horizontal", top, bottom,
            Math.max(tr.left, dr.left), Math.min(tr.right, dr.right),
            (tr.bottom + dr.top) / 2);
        }
      }
    }
  }
}

function moveWorkspacePanel(panel: HTMLElement, left: number, top: number) {
  if (panel.classList.contains("timeline-panel") && !panel.classList.contains("is-floating")) {
    syncTimelineDock();
    return;
  }
  const rect = panel.getBoundingClientRect();
  const margin = 8;
  const minTop = workspaceDockTop;
  const maxLeft = Math.max(margin, window.innerWidth - rect.width - margin);
  const maxTop = Math.max(minTop, window.innerHeight - rect.height - margin);
  panel.style.left = `${Math.max(margin, Math.min(maxLeft, left))}px`;
  panel.style.right = "auto";
  panel.style.top = `${Math.max(minTop, Math.min(maxTop, top))}px`;
  panel.style.bottom = "auto";
  refreshWorkspacePanelDividers();
}

function isWorkspacePanelDragSurface(panel: HTMLElement, event: PointerEvent) {
  const target = event.target;
  if (!(target instanceof Element) || target.closest(workspaceDragBlockers)) return false;
  const rect = panel.getBoundingClientRect();
  const resizeCorner = 20;
  return event.clientX < rect.right - resizeCorner || event.clientY < rect.bottom - resizeCorner;
}

function registerWorkspacePanel(panel: HTMLElement) {
  if (panel.dataset.workspacePanelReady === "true") return;
  panel.dataset.workspacePanelReady = "true";
  workspacePanels.push(panel);
  workspacePanelStack.push(panel);
  refreshWorkspacePanelLayers();
  workspacePanelResizeObserver?.observe(panel);

  panel.addEventListener("pointerdown", (event) => {
    raiseWorkspacePanel(panel);
    if (event.button !== 0) return;
    if (panel.classList.contains("timeline-panel") && !panel.classList.contains("is-floating")) return;
    if (!isWorkspacePanelDragSurface(panel, event)) return;
    event.preventDefault();
    const rect = panel.getBoundingClientRect();
    const offsetX = event.clientX - rect.left;
    const offsetY = event.clientY - rect.top;
    panel.focus({ preventScroll: true });
    panel.classList.add("is-moving");
    panel.setPointerCapture(event.pointerId);
    const joinableModule = panel.classList.contains("inspector-module-panel")
      ? directInspectorModules(panel)[0] ?? null
      : null;

    const move = (next: PointerEvent) => {
      moveWorkspacePanel(panel, next.clientX - offsetX, next.clientY - offsetY);
      if (joinableModule) {
        queueModuleDropPreview(inspectorModuleDropAt(next.clientX, next.clientY, panel));
      }
    };
    const finish = (cancelled: boolean) => {
      const acceptedDrop = !cancelled && joinableModule ? readyModuleDrop : null;
      if (joinableModule) clearModuleDropPreview();
      panel.classList.remove("is-moving");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      if (joinableModule && acceptedDrop) joinInspectorModule(joinableModule, acceptedDrop);
      else {
        settleWorkspacePanelIntersections();
        fitViewport();
      }
    };
    const up = () => finish(false);
    const cancel = () => finish(true);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
  });

  panel.addEventListener("keydown", (event) => {
    if (event.target !== panel) return;
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    if (panel.classList.contains("timeline-panel") && !panel.classList.contains("is-floating")) return;
    event.preventDefault();
    const rect = panel.getBoundingClientRect();
    const amount = event.shiftKey ? 48 : 12;
    const dx = event.key === "ArrowLeft" ? -amount : event.key === "ArrowRight" ? amount : 0;
    const dy = event.key === "ArrowUp" ? -amount : event.key === "ArrowDown" ? amount : 0;
    raiseWorkspacePanel(panel);
    moveWorkspacePanel(panel, rect.left + dx, rect.top + dy);
    settleWorkspacePanelIntersections();
  });

  panel.addEventListener("pointerdown", (event) => {
    const rect = panel.getBoundingClientRect();
    const onNativeResizeEdge = event.clientX >= rect.right - 14 || event.clientY >= rect.bottom - 14;
    if (!onNativeResizeEdge) return;
    const finishResize = () => {
      window.removeEventListener("pointerup", finishResize);
      window.removeEventListener("pointercancel", finishResize);
      settleWorkspacePanelIntersections();
      fitViewport();
    };
    window.addEventListener("pointerup", finishResize);
    window.addEventListener("pointercancel", finishResize);
  });
}

function unregisterWorkspacePanel(panel: HTMLElement) {
  workspacePanelResizeObserver?.unobserve(panel);
  const panelIndex = workspacePanels.indexOf(panel);
  if (panelIndex >= 0) workspacePanels.splice(panelIndex, 1);
  const stackIndex = workspacePanelStack.indexOf(panel);
  if (stackIndex >= 0) workspacePanelStack.splice(stackIndex, 1);
  refreshWorkspacePanelLayers();
  refreshWorkspacePanelDividers();
}

function initWorkspacePanels() {
  document.querySelectorAll<HTMLElement>(".workspace-panel").forEach(registerWorkspacePanel);
  syncTimelineDock();
  initPalettesPanelCollapseDirection();
  initTimelinePanelCollapseDirection();

  window.addEventListener("resize", () => {
    syncTimelineDock();
    for (const panel of workspacePanels) {
      if (panel.classList.contains("timeline-panel") && !panel.classList.contains("is-floating")) continue;
      if (!panel.style.left) continue;
      const rect = panel.getBoundingClientRect();
      moveWorkspacePanel(panel, rect.left, rect.top);
    }
    settleWorkspacePanelIntersections();
    requestLoopFrame();
  });

  workspacePanelResizeObserver = new ResizeObserver(() => {
    refreshWorkspacePanelDividers();
    if (workspaceDividerResizing || workspacePanelSettleQueued) return;
    workspacePanelSettleQueued = true;
    requestAnimationFrame(() => {
      workspacePanelSettleQueued = false;
      const panels = floatingWorkspacePanels();
      if (panels.some((panel, i) => panels.slice(i + 1)
        .some((other) => workspacePanelsOverlap(panel, other)))) {
        settleWorkspacePanelIntersections();
      }
    });
  });
  workspacePanels.forEach((panel) => workspacePanelResizeObserver?.observe(panel));
  settleWorkspacePanelIntersections();
}

/**
 * Color docks to the bottom, so a plain height shrink drops the header.
 * Pin `top` before collapse so the panel eases upward like the Brush panel.
 */
function initPalettesPanelCollapseDirection() {
  const panel = document.querySelector<HTMLElement>(".palettes-group");
  const details = panel?.querySelector<HTMLDetailsElement>("details.palette-section");
  if (!panel || !details) return;

  const pinTop = () => {
    const rect = panel.getBoundingClientRect();
    panel.style.top = `${Math.round(rect.top)}px`;
    panel.style.bottom = "auto";
  };

  const pinBeforeClose = () => {
    if (!details.open) return;
    pinTop();
    // Native panel resizing leaves an inline height behind. It otherwise
    // survives the details collapse as an empty shell below the Color header.
    panel.style.height = "auto";
    panel.style.maxHeight = "none";
  };

  // Pin while still expanded — `toggle` fires after open flips, too late to measure.
  const summary = details.querySelector("summary");
  summary?.addEventListener("pointerdown", pinBeforeClose);
  summary?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") pinBeforeClose();
  });
  details.addEventListener("toggle", () => {
    if (!details.open) {
      panel.style.height = "auto";
      panel.style.maxHeight = "none";
    } else {
      panel.style.maxHeight = "min(480px, calc(100vh - 100px))";
    }
    requestAnimationFrame(() => {
      settleWorkspacePanelIntersections();
      fitViewport();
    });
  });
}

/**
 * Floating Timeline often has a resized fixed height; clear it and pin top
 * before collapse so ::details-content can ease the panel upward.
 */
function initTimelinePanelCollapseDirection() {
  const panel = document.querySelector<HTMLElement>(".timeline-panel");
  const details = document.getElementById("timeline-region") as HTMLDetailsElement | null;
  if (!panel || !details) return;

  const prepareCollapse = () => {
    if (!details.open) return;
    if (!panel.classList.contains("is-floating")) return;
    const rect = panel.getBoundingClientRect();
    panel.style.top = `${Math.round(rect.top)}px`;
    panel.style.left = `${Math.round(rect.left)}px`;
    panel.style.right = "auto";
    panel.style.bottom = "auto";
    panel.style.width = `${Math.round(rect.width)}px`;
    // Drop resize-locked height so content height can drive the collapse.
    panel.style.height = "auto";
    panel.style.maxHeight = "none";
  };

  const summary = details.querySelector("summary");
  summary?.addEventListener("pointerdown", prepareCollapse);
  summary?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") prepareCollapse();
  });
}

type InspectorModule = HTMLDetailsElement;
type InspectorModuleDrop = {
  edge: "before" | "after";
  group: HTMLElement;
  reference: InspectorModule | null;
};

let inspectorGroupSerial = 0;
let pendingModuleDrop: InspectorModuleDrop | null = null;
let readyModuleDrop: InspectorModuleDrop | null = null;
let moduleDropTimer: number | null = null;

function directInspectorModules(group: HTMLElement) {
  return Array.from(group.children).filter(
    (child): child is InspectorModule => child instanceof HTMLDetailsElement
      && child.classList.contains("inspector-module"),
  );
}

function inspectorModuleTitle(module: InspectorModule) {
  const label = module.querySelector<HTMLElement>(".module-summary-label");
  return label?.textContent?.trim() || module.dataset.inspectorModule || "Inspector";
}

function setInspectorModuleSummaryLabel(summary: HTMLElement, label: string) {
  const text = summary.querySelector<HTMLElement>(".module-summary-label");
  if (text) text.textContent = label;
  else summary.textContent = label;
}

function cleanupEmptyInspectorGroup(group: HTMLElement | null) {
  if (!group || directInspectorModules(group).length > 0) return;
  if (group.classList.contains("inspector-module-panel")) {
    unregisterWorkspacePanel(group);
    group.remove();
    return;
  }
  if (group.dataset.inspectorGroup === "timeline") group.hidden = true;
}

function createInspectorModuleGroup(module: InspectorModule, left: number, top: number) {
  const oldGroup = module.closest<HTMLElement>(".inspector-group");
  const nextModule = module.nextElementSibling instanceof HTMLDetailsElement
    && module.nextElementSibling.classList.contains("inspector-module")
    ? module.nextElementSibling
    : null;
  module.dataset.returnBefore = nextModule?.dataset.inspectorModule ?? "";
  const panel = document.createElement("aside");
  const key = module.dataset.inspectorModule || "module";
  panel.className = "right-sidebar workspace-panel inspector-group inspector-module-panel";
  panel.dataset.workspacePanel = `inspector-${key}-${++inspectorGroupSerial}`;
  panel.dataset.inspectorGroup = panel.dataset.workspacePanel;
  panel.tabIndex = 0;
  panel.setAttribute("aria-label", `${inspectorModuleTitle(module)} panel. Drag empty space or use arrow keys to move.`);
  panel.appendChild(module);
  $("workspace-main").appendChild(panel);
  registerWorkspacePanel(panel);
  moveWorkspacePanel(panel, left, top);
  raiseWorkspacePanel(panel);
  cleanupEmptyInspectorGroup(oldGroup);
  updateInspectorModuleButtons();
  return panel;
}

function joinInspectorModule(module: InspectorModule, drop: InspectorModuleDrop) {
  const oldGroup = module.closest<HTMLElement>(".inspector-group");
  const reference = drop.reference;
  if (reference) {
    if (drop.edge === "before") reference.before(module);
    else reference.after(module);
  } else {
    const status = drop.group.querySelector<HTMLElement>("#status");
    drop.group.insertBefore(module, status);
  }
  drop.group.hidden = false;
  cleanupEmptyInspectorGroup(oldGroup);
  updateInspectorModuleButtons();
  raiseWorkspacePanel(drop.group);
  fitViewport();
}

function clearModuleDropPreview() {
  if (moduleDropTimer !== null) window.clearTimeout(moduleDropTimer);
  moduleDropTimer = null;
  pendingModuleDrop = null;
  readyModuleDrop = null;
  document.querySelectorAll(".module-drop-ready").forEach((el) => el.classList.remove("module-drop-ready"));
  document.querySelectorAll(".module-drop-before").forEach((el) => el.classList.remove("module-drop-before"));
  document.querySelectorAll(".module-drop-after").forEach((el) => el.classList.remove("module-drop-after"));
}

function inspectorModuleDropAt(x: number, y: number, draggedGroup: HTMLElement) {
  const groups = document.elementsFromPoint(x, y)
    .map((element) => element.closest<HTMLElement>(".inspector-group"))
    .filter((group): group is HTMLElement => !!group && group !== draggedGroup);
  const group = groups[0];
  if (!group) return null;
  const modules = directInspectorModules(group);
  for (const module of modules) {
    const rect = module.getBoundingClientRect();
    if (y <= rect.top + rect.height / 2) {
      return { group, reference: module, edge: "before" } satisfies InspectorModuleDrop;
    }
    if (y <= rect.bottom) {
      return { group, reference: module, edge: "after" } satisfies InspectorModuleDrop;
    }
  }
  return {
    group,
    reference: modules[modules.length - 1] ?? null,
    edge: modules.length ? "after" : "before",
  } satisfies InspectorModuleDrop;
}

function sameInspectorModuleDrop(a: InspectorModuleDrop | null, b: InspectorModuleDrop | null) {
  return !!a && !!b && a.group === b.group && a.reference === b.reference && a.edge === b.edge;
}

function queueModuleDropPreview(drop: InspectorModuleDrop | null) {
  if (!drop) {
    clearModuleDropPreview();
    return;
  }
  if (sameInspectorModuleDrop(drop, pendingModuleDrop)) return;
  clearModuleDropPreview();
  pendingModuleDrop = drop;
  moduleDropTimer = window.setTimeout(() => {
    if (!sameInspectorModuleDrop(drop, pendingModuleDrop)) return;
    readyModuleDrop = drop;
    drop.group.classList.add("module-drop-ready");
    drop.reference?.classList.add(drop.edge === "before" ? "module-drop-before" : "module-drop-after");
  }, 280);
}

function toggleInspectorModuleGroup(module: InspectorModule) {
  const group = module.closest<HTMLElement>(".inspector-group");
  if (!group) return;
  const isSingleDetached = group.classList.contains("inspector-module-panel")
    && directInspectorModules(group).length === 1;
  if (isSingleDetached) {
    const homeGroup = document.querySelector<HTMLElement>(
      `[data-inspector-group="${CSS.escape(module.dataset.moduleHomeGroup ?? "main")}"]`,
    ) ?? document.querySelector<HTMLElement>('[data-inspector-group="main"]')!;
    const modules = directInspectorModules(homeGroup);
    const returnBefore = modules.find(
      (candidate) => candidate.dataset.inspectorModule === module.dataset.returnBefore,
    ) ?? null;
    joinInspectorModule(module, {
      group: homeGroup,
      reference: returnBefore ?? modules[modules.length - 1] ?? null,
      edge: returnBefore ? "before" : modules.length ? "after" : "before",
    });
    return;
  }
  const rect = group.getBoundingClientRect();
  const detachedLeft = rect.left > window.innerWidth / 2
    ? rect.left - 292
    : rect.right + 12;
  createInspectorModuleGroup(module, detachedLeft, rect.top + 22);
  fitViewport();
}

function updateInspectorModuleButtons() {
  document.querySelectorAll<InspectorModule>(".inspector-module").forEach((module) => {
    const group = module.closest<HTMLElement>(".inspector-group");
    const button = module.querySelector<HTMLButtonElement>(".module-popout");
    if (!group || !button) return;
    const singleDetached = group.classList.contains("inspector-module-panel")
      && directInspectorModules(group).length === 1;
    const title = inspectorModuleTitle(module);
    button.replaceChildren(svgIcon(StudioIcons.Layers, 13));
    button.setAttribute("aria-label", singleDetached ? `Return ${title} to its panel group` : `Detach ${title}`);
    button.title = singleDetached ? "Return to its panel group" : "Detach into its own panel";
  });
}

function initInspectorModule(module: InspectorModule) {
  if (module.dataset.moduleReady === "true") return;
  module.dataset.moduleReady = "true";
  const homeGroup = module.closest<HTMLElement>(".inspector-group");
  if (homeGroup && !homeGroup.classList.contains("inspector-module-panel")) {
    module.dataset.moduleHomeGroup = homeGroup.dataset.inspectorGroup ?? "main";
  }
  const summary = module.querySelector<HTMLElement>(":scope > summary");
  if (!summary) return;
  const label = document.createElement("span");
  label.className = "module-summary-label";
  label.textContent = summary.textContent?.trim() || module.dataset.inspectorModule || "Inspector";
  summary.replaceChildren(label);
  summary.title = "Click to expand or collapse · Alt+Arrow to reorder · Alt+Enter to detach or join";

  const dragHandle = document.createElement("button");
  dragHandle.type = "button";
  dragHandle.className = "module-drag-handle";
  dragHandle.replaceChildren(svgIcon(StudioIcons.DragGrip, 13));
  dragHandle.setAttribute("aria-label", `Drag ${label.textContent}`);
  dragHandle.title = "Drag to detach, move, or join";
  dragHandle.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });

  const popout = document.createElement("button");
  popout.type = "button";
  popout.className = "module-popout";
  popout.addEventListener("pointerdown", (event) => event.stopPropagation());
  popout.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    toggleInspectorModuleGroup(module);
  });
  summary.replaceChildren(dragHandle, label, popout);

  summary.addEventListener("click", (event) => {
    if (module.dataset.suppressToggle !== "true") return;
    event.preventDefault();
    event.stopPropagation();
  }, true);

  summary.addEventListener("keydown", (event) => {
    if (!event.altKey || event.target !== summary) return;
    if (event.key === "Enter") {
      event.preventDefault();
      toggleInspectorModuleGroup(module);
      return;
    }
    if (!["ArrowUp", "ArrowDown"].includes(event.key)) return;
    const group = module.closest<HTMLElement>(".inspector-group");
    if (!group) return;
    const modules = directInspectorModules(group);
    const index = modules.indexOf(module);
    const nextIndex = event.key === "ArrowUp" ? index - 1 : index + 1;
    if (nextIndex < 0 || nextIndex >= modules.length) return;
    event.preventDefault();
    if (nextIndex < index) modules[nextIndex].before(module);
    else modules[nextIndex].after(module);
  });

  dragHandle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startY = event.clientY;
    const sourceGroup = module.closest<HTMLElement>(".inspector-group");
    const sourceNext = module.nextElementSibling;
    let draggedGroup: HTMLElement | null = null;
    let offsetX = 0;
    let offsetY = 0;

    const move = (next: PointerEvent) => {
      if (!draggedGroup) {
        if (Math.hypot(next.clientX - startX, next.clientY - startY) < 6) return;
        next.preventDefault();
        const rect = module.getBoundingClientRect();
        offsetX = next.clientX - rect.left;
        offsetY = next.clientY - rect.top;
        module.dataset.suppressToggle = "true";
        module.classList.add("is-module-dragging");
        draggedGroup = createInspectorModuleGroup(module, rect.left, rect.top);
        dragHandle.setPointerCapture(event.pointerId);
      }
      moveWorkspacePanel(draggedGroup, next.clientX - offsetX, next.clientY - offsetY);
      queueModuleDropPreview(inspectorModuleDropAt(next.clientX, next.clientY, draggedGroup));
    };

    const finish = (cancelled: boolean) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      if (!draggedGroup) return;
      const acceptedDrop = readyModuleDrop;
      clearModuleDropPreview();
      module.classList.remove("is-module-dragging");
      if (cancelled && sourceGroup) {
        sourceGroup.insertBefore(module, sourceNext && sourceNext.parentElement === sourceGroup ? sourceNext : sourceGroup.querySelector("#status"));
        cleanupEmptyInspectorGroup(draggedGroup);
        updateInspectorModuleButtons();
      } else if (acceptedDrop) {
        joinInspectorModule(module, acceptedDrop);
      } else {
        updateInspectorModuleButtons();
        fitViewport();
      }
      window.setTimeout(() => delete module.dataset.suppressToggle, 0);
    };
    const up = () => finish(false);
    const cancel = () => finish(true);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
  });
}

function initInspectorModules() {
  document.querySelectorAll<InspectorModule>(".inspector-module").forEach(initInspectorModule);
  updateInspectorModuleButtons();
}

// initial paint
initWorkspacePanels();
initInspectorModules();
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
setTimelineTab("panels");
showFirstLaunchStatus();
updateCanvasHint();
const settleInitialWorkspace = () => requestAnimationFrame(() => {
  settleWorkspacePanelIntersections();
  fitViewport();
});
if (perfEnabled) void loadPerfProjectFromParam().finally(settleInitialWorkspace);
else void initializePersistentWorkspace().finally(settleInitialWorkspace);
// File chrome updates are event-driven via markDirty()/markClean() — the old
// 500ms poll is gone.
