// ============================================================================
// core/sequence.ts — expand panel groups into the playback/export timeline.
//
// Groups are flat, contiguous runs of panels repeated N times. One pure
// expansion path feeds playback, export, and the Edit timeline so display
// and MP4/WebM output stay frame-identical.
// ============================================================================

import type { FrameGroup, Project } from "./types";

export type TimelineEntry = {
  panelIndex: number;
  durationMs: number;
  groupId?: string;
  iteration?: number;
};

export type SequencePosition = {
  index: number;
  localMs: number;
  groupId?: string;
  iteration?: number;
  entryIndex?: number;
};

export type SequenceTransitionPosition = SequencePosition & {
  transition?: {
    nextIndex: number;
    nextEntryIndex: number;
    progress: number;
    durationMs: number;
  };
};

/** Drop dangling ids, enforce contiguity, clamp repeat >= 1, one group per panel. */
export function sanitizeGroups(project: Project): FrameGroup[] {
  if (!project.groups?.length) return [];

  const panelIds = new Set(project.panels.map((p) => p.id));
  const assigned = new Set<string>();
  const result: FrameGroup[] = [];

  for (const g of project.groups) {
    const ordered = project.panels
      .map((p) => p.id)
      .filter((id) => g.panelIds.includes(id) && panelIds.has(id) && !assigned.has(id));
    if (ordered.length === 0) continue;

    const runs: string[][] = [];
    let current: string[] = [];
    let lastIdx = -2;
    for (const id of ordered) {
      const idx = project.panels.findIndex((p) => p.id === id);
      if (idx === lastIdx + 1) current.push(id);
      else {
        if (current.length) runs.push(current);
        current = [id];
      }
      lastIdx = idx;
    }
    if (current.length) runs.push(current);

    const best = runs.sort((a, b) => b.length - a.length)[0] ?? [];
    if (best.length === 0) continue;

    for (const id of best) assigned.add(id);
    result.push({
      id: g.id,
      panelIds: best,
      repeat: Math.max(1, Math.round(g.repeat) || 1),
    });
  }

  return result;
}

export function applySanitizedGroups(project: Project): void {
  project.groups = sanitizeGroups(project);
}

export function groupsForProject(project: Project): FrameGroup[] {
  return sanitizeGroups(project);
}

export function findGroupForPanel(project: Project, panelId: string): FrameGroup | undefined {
  return groupsForProject(project).find((g) => g.panelIds.includes(panelId));
}

export function groupAtPanelIndex(project: Project, index: number): FrameGroup | undefined {
  const panel = project.panels[index];
  if (!panel) return undefined;
  return findGroupForPanel(project, panel.id);
}

function groupStartMap(project: Project, groups: FrameGroup[]): Map<number, FrameGroup> {
  const map = new Map<number, FrameGroup>();
  for (const g of groups) {
    const startIdx = project.panels.findIndex((p) => p.id === g.panelIds[0]);
    if (startIdx >= 0) map.set(startIdx, g);
  }
  return map;
}

export function expandTimeline(project: Project): TimelineEntry[] {
  const groups = groupsForProject(project);
  const starts = groupStartMap(project, groups);
  const entries: TimelineEntry[] = [];

  let i = 0;
  while (i < project.panels.length) {
    const group = starts.get(i);
    if (group) {
      const panelIndices = group.panelIds.map((id) => project.panels.findIndex((p) => p.id === id));
      for (let iter = 0; iter < group.repeat; iter++) {
        for (const pi of panelIndices) {
          const p = project.panels[pi];
          entries.push({
            panelIndex: pi,
            durationMs: p.durationMs,
            groupId: group.id,
            iteration: iter,
          });
        }
      }
      i += group.panelIds.length;
    } else {
      const p = project.panels[i];
      entries.push({ panelIndex: i, durationMs: p.durationMs });
      i++;
    }
  }

  return entries;
}

export function expandedDurationMs(project: Project): number {
  return expandTimeline(project).reduce((sum, e) => sum + e.durationMs, 0);
}

/** Start time (ms) of the first expanded occurrence of a panel. Used so Play
 *  begins at the selected / currently edited frame rather than a stale playhead. */
export function sequenceStartMsForPanel(project: Project, panelIndex: number): number {
  if (panelIndex < 0 || panelIndex >= project.panels.length) return 0;
  const entries = expandTimeline(project);
  let startMs = 0;
  for (const e of entries) {
    if (e.panelIndex === panelIndex) return startMs;
    startMs += e.durationMs;
  }
  return 0;
}

export function sequenceAtTime(project: Project, elapsedMs: number): SequencePosition {
  const entries = expandTimeline(project);
  const total = entries.reduce((sum, e) => sum + e.durationMs, 0) || 1;
  let t = elapsedMs % total;

  for (let ei = 0; ei < entries.length; ei++) {
    const e = entries[ei];
    if (t < e.durationMs) {
      return {
        index: e.panelIndex,
        localMs: t,
        groupId: e.groupId,
        iteration: e.iteration,
        entryIndex: ei,
      };
    }
    t -= e.durationMs;
  }

  const last = entries[entries.length - 1];
  return {
    index: last?.panelIndex ?? 0,
    localMs: 0,
    groupId: last?.groupId,
    iteration: last?.iteration,
    entryIndex: Math.max(0, entries.length - 1),
  };
}

/**
 * Resolve a panel overlap without changing sequence duration. Crossfades use
 * the tail of the outgoing entry and the first visual state of the next entry.
 * The final expanded entry never wraps to the first during one-shot export.
 */
export function sequenceTransitionAtTime(
  project: Project,
  elapsedMs: number
): SequenceTransitionPosition {
  const position = sequenceAtTime(project, elapsedMs);
  const entries = expandTimeline(project);
  const entryIndex = position.entryIndex ?? 0;
  const entry = entries[entryIndex];
  const next = entries[entryIndex + 1];
  const panel = entry ? project.panels[entry.panelIndex] : undefined;
  const transition = panel?.transitionToNext;
  if (!entry || !next || !transition || transition.kind !== "crossfade") return position;

  const requestedMs = (Math.max(1, transition.durationTicks) * 1000) / project.wiggleFps;
  const durationMs = Math.min(entry.durationMs, requestedMs);
  const startMs = entry.durationMs - durationMs;
  if (position.localMs < startMs) return position;

  return {
    ...position,
    transition: {
      nextIndex: next.panelIndex,
      nextEntryIndex: entryIndex + 1,
      progress: Math.max(0, Math.min(1, (position.localMs - startMs) / durationMs)),
      durationMs,
    },
  };
}

function removePanelsFromGroups(project: Project, panelIds: string[]): void {
  if (!project.groups?.length) return;
  const remove = new Set(panelIds);
  project.groups = project.groups
    .map((g) => ({ ...g, panelIds: g.panelIds.filter((id) => !remove.has(id)) }))
    .filter((g) => g.panelIds.length > 0);
}

export function createFrameGroup(
  project: Project,
  startIndex: number,
  endIndex: number,
  repeat = 2
): FrameGroup {
  const lo = Math.min(startIndex, endIndex);
  const hi = Math.max(startIndex, endIndex);
  const panelIds = project.panels.slice(lo, hi + 1).map((p) => p.id);
  removePanelsFromGroups(project, panelIds);
  const group: FrameGroup = {
    id: crypto.randomUUID(),
    panelIds,
    repeat: Math.max(1, repeat),
  };
  if (!project.groups) project.groups = [];
  project.groups.push(group);
  applySanitizedGroups(project);
  return group;
}

export function ungroup(project: Project, groupId: string): void {
  if (!project.groups?.length) return;
  project.groups = project.groups.filter((g) => g.id !== groupId);
}

export function setGroupRepeat(project: Project, groupId: string, repeat: number): void {
  const g = project.groups?.find((grp) => grp.id === groupId);
  if (!g) return;
  g.repeat = Math.max(1, Math.round(repeat) || 1);
}

export function syncGroupPanelIds(project: Project): void {
  if (!project.groups?.length) return;
  for (const g of project.groups) {
    g.panelIds = project.panels
      .map((p) => p.id)
      .filter((id) => g.panelIds.includes(id));
  }
  applySanitizedGroups(project);
}

export function onPanelDeleted(project: Project, panelId: string): void {
  if (!project.groups?.length) return;
  project.groups = project.groups
    .map((g) => ({ ...g, panelIds: g.panelIds.filter((id) => id !== panelId) }))
    .filter((g) => g.panelIds.length > 0);
}

export function onPanelDuplicated(
  project: Project,
  sourcePanelId: string,
  newPanelId: string
): void {
  const group = findGroupForPanel(project, sourcePanelId);
  if (!group) return;
  const sourceIdx = group.panelIds.indexOf(sourcePanelId);
  if (sourceIdx < 0) return;
  group.panelIds.splice(sourceIdx + 1, 0, newPanelId);
  syncGroupPanelIds(project);
}

export function movePanelBlock(project: Project, indices: number[], toIndex: number): void {
  const sorted = [...indices].sort((a, b) => a - b);
  const block = sorted.map((i) => project.panels[i]);
  for (let i = sorted.length - 1; i >= 0; i--) {
    project.panels.splice(sorted[i], 1);
  }
  let insertAt = toIndex;
  for (const idx of sorted) {
    if (idx < toIndex) insertAt--;
  }
  insertAt = Math.max(0, Math.min(insertAt, project.panels.length));
  project.panels.splice(insertAt, 0, ...block);
  syncGroupPanelIds(project);
}

export function moveGroup(project: Project, groupId: string, toIndex: number): void {
  const group = groupsForProject(project).find((g) => g.id === groupId);
  if (!group) return;
  const indices = group.panelIds
    .map((id) => project.panels.findIndex((p) => p.id === id))
    .filter((i) => i >= 0)
    .sort((a, b) => a - b);
  if (indices.length === 0) return;
  movePanelBlock(project, indices, toIndex);
}

export function addPanelToGroup(project: Project, groupId: string, panelId: string): void {
  const group = project.groups?.find((g) => g.id === groupId);
  if (!group || group.panelIds.includes(panelId)) return;
  removePanelsFromGroups(project, [panelId]);
  const panelIdx = project.panels.findIndex((p) => p.id === panelId);
  const groupIndices = group.panelIds
    .map((id) => project.panels.findIndex((p) => p.id === id))
    .filter((i) => i >= 0);
  if (groupIndices.length === 0) {
    group.panelIds.push(panelId);
  } else {
    const minG = Math.min(...groupIndices);
    const maxG = Math.max(...groupIndices);
    if (panelIdx === minG - 1) group.panelIds.unshift(panelId);
    else if (panelIdx === maxG + 1) group.panelIds.push(panelId);
    else return;
  }
  applySanitizedGroups(project);
}

export function formatSequenceCounter(
  project: Project,
  pos: SequencePosition,
  playing: boolean
): string {
  if (playing && pos.groupId != null && pos.iteration != null) {
    const group = groupsForProject(project).find((g) => g.id === pos.groupId);
    if (group) {
      const panelInGroup = group.panelIds.indexOf(project.panels[pos.index]?.id ?? "") + 1;
      const panelCount = group.panelIds.length;
      return `${pos.index + 1}/${project.panels.length} (loop ${pos.iteration + 1}/${group.repeat}, frame ${panelInGroup}/${panelCount})`;
    }
  }
  return `${pos.index + 1} / ${project.panels.length}`;
}
