// ============================================================================
// core/panelStack.ts — z-order for layers and sub-panels (panel or nested frame).
//
// Panels and SubPanels keep layers and subPanels as separate stores. `stack` is
// the single draw-order list: ids only, bottom to top. Missing/legacy
// containers resolve to [...layers, ...subPanels], which matches the pre-stack
// composite order pixel-for-pixel.
// ============================================================================

import type { Layer, Panel, PanelStackItem, SubPanel } from "./types";

/** Anything that owns a local layer/sub-panel stack (Panel or SubPanel). */
export type StackContainer = {
  layers: Layer[];
  subPanels?: SubPanel[];
  stack?: PanelStackItem[];
  activeLayerIndex?: number;
};

/** Legacy / default order: every local layer, then every child sub-panel. */
export function defaultPanelStack(
  container: Pick<StackContainer, "layers" | "subPanels">
): PanelStackItem[] {
  return [
    ...container.layers.map((l) => ({ kind: "layer" as const, id: l.id })),
    ...(container.subPanels ?? []).map((sp) => ({ kind: "subpanel" as const, id: sp.id })),
  ];
}

/**
 * Pure repair: drop orphans/duplicates, append any missing entities at the
 * top (end). Does not mutate `container`.
 */
export function resolvedPanelStack(
  container: Pick<StackContainer, "layers" | "subPanels" | "stack">
): PanelStackItem[] {
  const layerIds = new Set(container.layers.map((l) => l.id));
  const spIds = new Set((container.subPanels ?? []).map((s) => s.id));
  const seen = new Set<string>();
  const next: PanelStackItem[] = [];
  const key = (item: PanelStackItem) => `${item.kind}:${item.id}`;

  for (const item of container.stack ?? defaultPanelStack(container)) {
    if (item.kind === "layer") {
      if (!layerIds.has(item.id) || seen.has(key(item))) continue;
    } else if (item.kind === "subpanel") {
      if (!spIds.has(item.id) || seen.has(key(item))) continue;
    } else {
      continue;
    }
    next.push(item);
    seen.add(key(item));
  }
  for (const l of container.layers) {
    const k = `layer:${l.id}`;
    if (!seen.has(k)) {
      next.push({ kind: "layer", id: l.id });
      seen.add(k);
    }
  }
  for (const sp of container.subPanels ?? []) {
    const k = `subpanel:${sp.id}`;
    if (!seen.has(k)) {
      next.push({ kind: "subpanel", id: sp.id });
      seen.add(k);
    }
  }
  return next;
}

/** Write a repaired stack onto the container and return it. */
export function ensurePanelStack(container: StackContainer): PanelStackItem[] {
  const stack = resolvedPanelStack(container);
  container.stack = stack;
  return stack;
}

/**
 * Reorder `layers` / `subPanels` arrays to match stack order among each kind.
 * Keeps activeLayerIndex coherent when layers move relative to each other.
 */
export function syncEntityOrderFromStack(container: StackContainer): void {
  const stack = ensurePanelStack(container);
  const layerById = new Map(container.layers.map((l) => [l.id, l]));
  const spById = new Map((container.subPanels ?? []).map((s) => [s.id, s]));
  const activeId = container.layers[container.activeLayerIndex ?? 0]?.id;
  container.layers = stack
    .filter((i): i is { kind: "layer"; id: string } => i.kind === "layer")
    .map((i) => layerById.get(i.id))
    .filter((l): l is Layer => !!l);
  container.subPanels = stack
    .filter((i): i is { kind: "subpanel"; id: string } => i.kind === "subpanel")
    .map((i) => spById.get(i.id))
    .filter((s): s is SubPanel => !!s);
  if (activeId) {
    const idx = container.layers.findIndex((l) => l.id === activeId);
    if (idx >= 0) container.activeLayerIndex = idx;
  }
}

/** Move one stack entry. `to` is the index in the post-removal array. */
export function moveStackItem(container: StackContainer, from: number, to: number): boolean {
  const stack = ensurePanelStack(container);
  if (from < 0 || from >= stack.length) return false;
  if (to < 0 || to > stack.length - 1) return false;
  if (from === to) return false;
  const [item] = stack.splice(from, 1);
  stack.splice(to, 0, item);
  container.stack = stack;
  syncEntityOrderFromStack(container);
  return true;
}

/** Place a layer id in the stack just above `afterLayerId` (or at top). */
export function stackInsertLayer(
  container: StackContainer,
  layerId: string,
  afterLayerId?: string | null
): void {
  const stack = ensurePanelStack(container).filter(
    (i) => !(i.kind === "layer" && i.id === layerId)
  );
  const item: PanelStackItem = { kind: "layer", id: layerId };
  if (afterLayerId) {
    const at = stack.findIndex((i) => i.kind === "layer" && i.id === afterLayerId);
    if (at >= 0) {
      stack.splice(at + 1, 0, item);
      container.stack = stack;
      return;
    }
  }
  stack.push(item);
  container.stack = stack;
}

/** Place a sub-panel id at the top of the stack (newest on top). */
export function stackInsertSubPanel(container: StackContainer, subPanelId: string): void {
  const stack = ensurePanelStack(container).filter(
    (i) => !(i.kind === "subpanel" && i.id === subPanelId)
  );
  stack.push({ kind: "subpanel", id: subPanelId });
  container.stack = stack;
}

export function stackRemoveLayer(container: StackContainer, layerId: string): void {
  container.stack = ensurePanelStack(container).filter(
    (i) => !(i.kind === "layer" && i.id === layerId)
  );
}

export function stackRemoveSubPanel(container: StackContainer, subPanelId: string): void {
  container.stack = ensurePanelStack(container).filter(
    (i) => !(i.kind === "subpanel" && i.id === subPanelId)
  );
}

/** Replace direct layers with one group at the top-most selected position.
 * Child order remains bottom-to-top, matching the parent stack. */
export function replaceLayersWithGroup(container: StackContainer, group: SubPanel): boolean {
  if (!group.group || group.layers.length === 0) return false;
  const selectedIds = new Set(group.layers.map((layer) => layer.id));
  if (group.layers.some((layer) => !container.layers.some((candidate) => candidate.id === layer.id))) {
    return false;
  }
  const stack = ensurePanelStack(container);
  const selectedEntries = stack
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.kind === "layer" && selectedIds.has(item.id));
  if (selectedEntries.length !== selectedIds.size) return false;
  const topIndex = Math.max(...selectedEntries.map(({ index }) => index));
  const insertAt = stack.slice(0, topIndex + 1)
    .filter((item) => item.kind !== "layer" || !selectedIds.has(item.id)).length;
  const layerById = new Map(container.layers.map((layer) => [layer.id, layer]));
  group.layers = selectedEntries
    .map(({ item }) => item.kind === "layer" ? layerById.get(item.id) : undefined)
    .filter((layer): layer is Layer => !!layer);
  group.stack = group.layers.map((layer) => ({ kind: "layer", id: layer.id }));
  group.activeLayerIndex = Math.max(0, group.layers.length - 1);
  container.layers = container.layers.filter((layer) => !selectedIds.has(layer.id));
  (container.subPanels ??= []).push(group);
  const nextStack = stack.filter((item) => item.kind !== "layer" || !selectedIds.has(item.id));
  nextStack.splice(insertAt, 0, { kind: "subpanel", id: group.id });
  container.stack = nextStack;
  container.activeLayerIndex = Math.max(0, Math.min(
    container.activeLayerIndex ?? 0,
    container.layers.length - 1,
  ));
  return true;
}

/** Whether a container exposes any visible, unlocked drawing target. Locked
 * groups block their complete descendant tree. */
export function containerHasUnlockedLayer(container: StackContainer): boolean {
  if (container.layers.some((layer) => layer.visible && !layer.locked)) return true;
  return (container.subPanels ?? []).some((subPanel) =>
    subPanel.visible !== false && !subPanel.locked && containerHasUnlockedLayer(subPanel)
  );
}

/** Remap stack ids after panel/content id regeneration. */
export function remapPanelStack(
  stack: PanelStackItem[] | undefined,
  layerIdMap: Map<string, string>,
  subPanelIdMap: Map<string, string>
): PanelStackItem[] | undefined {
  if (!stack) return undefined;
  const next: PanelStackItem[] = [];
  for (const item of stack) {
    if (item.kind === "layer") {
      const id = layerIdMap.get(item.id);
      if (id) next.push({ kind: "layer", id });
    } else {
      const id = subPanelIdMap.get(item.id);
      if (id) next.push({ kind: "subpanel", id });
    }
  }
  return next;
}

export function subPanelLabel(sp: SubPanel): string {
  if (sp.group) return sp.name?.trim() || "Layer Group";
  const shape =
    sp.shape === "rect" ? "Rect"
    : sp.shape === "rounded" ? "Rounded"
    : sp.shape === "balloon" ? "Balloon"
    : sp.shape === "thought" ? "Thought"
    : sp.shape === "custom" ? "Custom"
    : "Burst";
  const kind =
    sp.shape === "balloon" || sp.shape === "thought" || sp.shape === "burst"
      ? "Balloon"
      : "Sub-Panel";
  return `${kind} (${shape})`;
}

/** Depth-first walk of every sub-panel in the tree (root children first). */
export function walkSubPanels(
  panel: Pick<Panel, "subPanels">,
  fn: (sp: SubPanel, path: string[], depth: number) => void
): void {
  const visit = (list: SubPanel[] | undefined, path: string[], depth: number) => {
    for (const sp of list ?? []) {
      const nextPath = [...path, sp.id];
      fn(sp, nextPath, depth);
      visit(sp.subPanels, nextPath, depth + 1);
    }
  };
  visit(panel.subPanels, [], 0);
}

/** Total sub-panel count in the tree (all nesting levels). */
export function countSubPanels(panel: Pick<Panel, "subPanels">): number {
  let n = 0;
  walkSubPanels(panel, () => { n++; });
  return n;
}

/** Path from panel root to the sub-panel with `id`, or null. */
export function findSubPanelPath(
  panel: Pick<Panel, "subPanels">,
  id: string
): string[] | null {
  let found: string[] | null = null;
  walkSubPanels(panel, (_sp, path) => {
    if (!found && path[path.length - 1] === id) found = path;
  });
  return found;
}

/** Resolve a path of sub-panel ids from the panel root. */
export function subPanelAtPath(
  panel: Pick<Panel, "subPanels">,
  path: string[]
): SubPanel | null {
  let list = panel.subPanels ?? [];
  let current: SubPanel | null = null;
  for (const id of path) {
    current = list.find((s) => s.id === id) ?? null;
    if (!current) return null;
    list = current.subPanels ?? [];
  }
  return current;
}

/** Truncate a path so every prefix still resolves (e.g. after undo). */
export function sanitizeSubPanelPath(
  panel: Pick<Panel, "subPanels">,
  path: string[]
): string[] {
  const next: string[] = [];
  for (const id of path) {
    const candidate = [...next, id];
    if (!subPanelAtPath(panel, candidate)) break;
    next.push(id);
  }
  return next;
}

/** Max nesting depth among all sub-panels (0 = none, 1 = root-only frames). */
export function maxSubPanelDepth(panel: Pick<Panel, "subPanels">): number {
  let max = 0;
  walkSubPanels(panel, (_sp, _path, depth) => {
    max = Math.max(max, depth + 1);
  });
  return max;
}
