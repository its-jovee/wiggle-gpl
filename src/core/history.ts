// ============================================================================
// core/history.ts — undo/redo via JSON snapshots of the Project.
//
// Naive whole-project JSON.stringify on every commit was an O(project-size)
// stall paid on the most repeated action in the app (stroke commit). Instead,
// each entry splits the project into `meta` (everything but panels — small,
// always re-serialized) and one JSON string per panel. Unchanged panels REUSE
// the exact same string reference as the previous entry, so a stroke commit
// that only touches the active panel costs O(1 panel), not O(project).
//
// `panelJson` is a module-level cache of each panel's last serialization,
// keyed by panel id, kept in sync across push/undo/redo so a push always
// diffs against whatever is currently "on screen" in the stack.
//
// Each entry also carries a small `ctx` (editing context, e.g. which panel
// was active) so undo/redo can restore not just project state but where the
// user was looking when they made the edit.
// ============================================================================

import { Panel, Project } from "./types";

export type HistoryCtx = { activePanelIndex: number };
export type HistoryChange = {
  changedPanelIds: string[];
  panelOrderChanged: boolean;
  metaChanged: boolean;
};
export type HistoryResult = { project: Project; ctx: HistoryCtx; change: HistoryChange };
export type PreparedHistory = {
  result: HistoryResult;
  fromPointer: number;
  toPointer: number;
};

type Entry = { meta: string; panels: string[]; panelIds: string[]; ctx: HistoryCtx };

const MAX = 50;
let stack: Entry[] = [];
let pointer = -1;
let panelJson = new Map<string, string>();

function serializeMeta(project: Project): string {
  return JSON.stringify({ ...project, panels: undefined });
}

/** Serialize `project.panels`, reusing the cached string for any panel whose
 *  id is absent from `changedPanelIds` (when provided). Updates the cache in
 *  place for every panel actually (re)serialized. */
function serializePanels(project: Project, changedPanelIds?: Set<string>): string[] {
  return project.panels.map(panel => {
    if (changedPanelIds && !changedPanelIds.has(panel.id)) {
      const cached = panelJson.get(panel.id);
      if (cached !== undefined) return cached;
    }
    const json = JSON.stringify(panel);
    panelJson.set(panel.id, json);
    return json;
  });
}

function reconstruct(
  entry: Entry,
  refreshCache: boolean,
  reuseProject?: Project,
  reusablePanelIds?: Set<string>,
): Project {
  const reusablePanels = new Map(reuseProject?.panels.map(panel => [panel.id, panel]) ?? []);
  const panels = entry.panelIds.map((id, i) => {
    if (reusablePanelIds?.has(id)) {
      const reusable = reusablePanels.get(id);
      if (reusable) return reusable;
    }
    return JSON.parse(entry.panels[i]) as Panel;
  });
  const project = { ...JSON.parse(entry.meta), panels } as Project;
  if (refreshCache) panelJson = new Map(project.panels.map((p, i) => [p.id, entry.panels[i]]));
  return project;
}

function changeBetween(from: Entry, to: Entry): HistoryChange {
  const fromById = new Map(from.panelIds.map((id, i) => [id, from.panels[i]]));
  const toById = new Map(to.panelIds.map((id, i) => [id, to.panels[i]]));
  const changedPanelIds: string[] = [];
  const ids = new Set([...from.panelIds, ...to.panelIds]);
  for (const id of ids) {
    if (fromById.get(id) !== toById.get(id)) changedPanelIds.push(id);
  }
  const panelOrderChanged = from.panelIds.length !== to.panelIds.length
    || from.panelIds.some((id, i) => id !== to.panelIds[i]);
  return {
    changedPanelIds,
    panelOrderChanged,
    metaChanged: from.meta !== to.meta,
  };
}

function prepare(direction: "undo" | "redo", reuseProject?: Project): PreparedHistory | null {
  const toPointer = direction === "undo" ? pointer - 1 : pointer + 1;
  if (toPointer < 0 || toPointer >= stack.length) return null;
  const from = stack[pointer];
  const to = stack[toPointer];
  const change = changeBetween(from, to);
  const changed = new Set(change.changedPanelIds);
  const reusablePanelIds = new Set(to.panelIds.filter(id => !changed.has(id)));
  return {
    result: {
      project: reconstruct(to, false, reuseProject, reusablePanelIds),
      ctx: to.ctx,
      change,
    },
    fromPointer: pointer,
    toPointer,
  };
}

export function init(project: Project, ctx: HistoryCtx = { activePanelIndex: 0 }) {
  panelJson = new Map();
  const entry: Entry = {
    meta: serializeMeta(project),
    panels: serializePanels(project),
    panelIds: project.panels.map(p => p.id),
    ctx,
  };
  stack = [entry];
  pointer = 0;
}

/** `changedPanelIds`: ids of panels whose content changed since the last
 *  push — unchanged panels reuse their cached serialization by reference.
 *  Omit to force a full re-serialize of every panel (always correct; used by
 *  structural/global edits where the touched set isn't obvious). */
export function push(project: Project, ctx: HistoryCtx, changedPanelIds?: Set<string>) {
  stack = stack.slice(0, pointer + 1);
  const entry: Entry = {
    meta: serializeMeta(project),
    panels: serializePanels(project, changedPanelIds),
    panelIds: project.panels.map(p => p.id),
    ctx,
  };
  stack.push(entry);
  if (stack.length > MAX) stack.shift();
  pointer = stack.length - 1;
}

export function undo(): HistoryResult | null {
  const prepared = prepare("undo");
  return prepared ? commitPrepared(prepared) : null;
}

export function redo(): HistoryResult | null {
  const prepared = prepare("redo");
  return prepared ? commitPrepared(prepared) : null;
}

export function prepareUndo(reuseProject?: Project): PreparedHistory | null {
  return prepare("undo", reuseProject);
}
export function prepareRedo(reuseProject?: Project): PreparedHistory | null {
  return prepare("redo", reuseProject);
}

/** Commit a previously prepared transition after any async resources it needs
 * have been made ready. Returning null means another transition won the race. */
export function commitPrepared(prepared: PreparedHistory): HistoryResult | null {
  if (pointer !== prepared.fromPointer) return null;
  pointer = prepared.toPointer;
  const entry = stack[pointer];
  panelJson = new Map(entry.panelIds.map((id, i) => [id, entry.panels[i]]));
  return prepared.result;
}

export function canUndo() { return pointer > 0; }
export function canRedo() { return pointer < stack.length - 1; }

/** Dev-only: reconstruct the project from the entry the pointer currently
 *  sits on, for verifying a just-completed push against the live project
 *  (see the `?historycheck` flag in main.ts). Idempotent — does not advance
 *  or rewind the stack. */
export function debugCurrentReconstruction(): Project {
  return reconstruct(stack[pointer], true);
}

/** Test-only: raw entry list, for asserting reference-sharing of unchanged
 *  panel strings between consecutive entries. */
export function debugStack(): readonly { meta: string; panels: string[]; panelIds: string[]; ctx: HistoryCtx }[] {
  return stack;
}
