// ============================================================================
// core/panelOps.ts — pure helpers for animation-panel workflow commands.
//
// These helpers clone JSON project data and regenerate ids at the panel/content
// boundary. They never alter stroke points or render-time behavior.
// ============================================================================

import type { Layer, Panel, PanelStackItem, PerspectiveGuide, SubPanel } from "./types";
import { defaultPanelStack, remapPanelStack } from "./panelStack";

export type IdFactory = () => string;

export type PanelContentsClipboard = {
  bg: string;
  paletteId: string | null;
  layers: Layer[];
  activeLayerIndex?: number;
  subPanels: SubPanel[];
  stack?: PanelStackItem[];
  guides?: PerspectiveGuide[];
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function regenerateLayerIds(layer: Layer, idFactory: IdFactory): Layer {
  const copy = clone(layer);
  copy.id = idFactory();
  if (copy.texts) {
    copy.texts = copy.texts.map((text) => ({ ...text, id: idFactory() }));
  }
  return copy;
}

export function regenerateSubPanelIds(subPanel: SubPanel, idFactory: IdFactory): SubPanel {
  const copy = clone(subPanel);
  copy.id = idFactory();
  const layerIdMap = new Map<string, string>();
  const childIdMap = new Map<string, string>();
  copy.layers = copy.layers.map((layer) => {
    const oldId = layer.id;
    const next = regenerateLayerIds(layer, idFactory);
    layerIdMap.set(oldId, next.id);
    return next;
  });
  copy.subPanels = (copy.subPanels ?? []).map((child) => {
    const oldId = child.id;
    const next = regenerateSubPanelIds(child, idFactory);
    childIdMap.set(oldId, next.id);
    return next;
  });
  const remapped = remapPanelStack(copy.stack, layerIdMap, childIdMap);
  copy.stack = remapped ?? defaultPanelStack(copy);
  return copy;
}

function regenerateGuideIds(guide: PerspectiveGuide, idFactory: IdFactory): PerspectiveGuide {
  return { ...clone(guide), id: idFactory() };
}

export function regeneratePanelContentIds<T extends Pick<Panel, "layers" | "subPanels" | "guides" | "stack">>(
  panel: T,
  idFactory: IdFactory
): T {
  const copy = clone(panel);
  const layerIdMap = new Map<string, string>();
  const subPanelIdMap = new Map<string, string>();
  copy.layers = copy.layers.map((layer) => {
    const oldId = layer.id;
    const next = regenerateLayerIds(layer, idFactory);
    layerIdMap.set(oldId, next.id);
    return next;
  });
  copy.subPanels = (copy.subPanels ?? []).map((subPanel) => {
    const oldId = subPanel.id;
    const next = regenerateSubPanelIds(subPanel, idFactory);
    subPanelIdMap.set(oldId, next.id);
    return next;
  });
  if (copy.guides) copy.guides = copy.guides.map((guide) => regenerateGuideIds(guide, idFactory));
  const remapped = remapPanelStack(copy.stack, layerIdMap, subPanelIdMap);
  copy.stack = remapped ?? defaultPanelStack(copy);
  return copy;
}

export function createBlankPanelFrom(source: Panel, idFactory: IdFactory): Panel {
  return {
    id: idFactory(),
    durationMs: source.durationMs,
    bg: source.bg,
    paletteId: source.paletteId,
    layers: [],
    activeLayerIndex: 0,
    kind: "normal",
    subPanels: [],
    stack: [],
  };
}

export function clonePanelForDuplicate(source: Panel, idFactory: IdFactory): Panel {
  const panelId = idFactory();
  const withNestedIds = regeneratePanelContentIds(source, idFactory);
  withNestedIds.id = panelId;
  return withNestedIds;
}

export function copyPanelContents(source: Panel): PanelContentsClipboard {
  return {
    bg: source.bg,
    paletteId: source.paletteId,
    layers: clone(source.layers),
    activeLayerIndex: source.activeLayerIndex,
    subPanels: clone(source.subPanels ?? []),
    stack: clone(source.stack ?? defaultPanelStack(source)),
    guides: source.guides ? clone(source.guides) : undefined,
  };
}

export function pastePanelContents(
  target: Panel,
  clipboard: PanelContentsClipboard,
  idFactory: IdFactory
): void {
  const content = regeneratePanelContentIds({
    layers: clipboard.layers,
    subPanels: clipboard.subPanels,
    stack: clipboard.stack ?? defaultPanelStack(clipboard),
    guides: clipboard.guides,
  }, idFactory);
  target.bg = clipboard.bg;
  target.paletteId = clipboard.paletteId;
  target.layers = content.layers;
  target.activeLayerIndex = Math.min(
    Math.max(0, clipboard.activeLayerIndex ?? 0),
    Math.max(0, content.layers.length - 1)
  );
  target.subPanels = content.subPanels;
  target.stack = content.stack ?? defaultPanelStack(content);
  if (clipboard.guides) target.guides = content.guides;
}
