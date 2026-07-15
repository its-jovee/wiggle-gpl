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
export type HistoryResult = { project: Project; ctx: HistoryCtx };

type Entry = { meta: string; panels: string[]; ctx: HistoryCtx };

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

function reconstruct(entry: Entry): Project {
  const project = { ...JSON.parse(entry.meta), panels: entry.panels.map(s => JSON.parse(s) as Panel) } as Project;
  panelJson = new Map(project.panels.map((p, i) => [p.id, entry.panels[i]]));
  return project;
}

export function init(project: Project, ctx: HistoryCtx = { activePanelIndex: 0 }) {
  panelJson = new Map();
  const entry: Entry = { meta: serializeMeta(project), panels: serializePanels(project), ctx };
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
    ctx,
  };
  stack.push(entry);
  if (stack.length > MAX) stack.shift();
  pointer = stack.length - 1;
}

export function undo(): HistoryResult | null {
  if (pointer <= 0) return null;
  pointer--;
  const entry = stack[pointer];
  return { project: reconstruct(entry), ctx: entry.ctx };
}

export function redo(): HistoryResult | null {
  if (pointer >= stack.length - 1) return null;
  pointer++;
  const entry = stack[pointer];
  return { project: reconstruct(entry), ctx: entry.ctx };
}

export function canUndo() { return pointer > 0; }
export function canRedo() { return pointer < stack.length - 1; }

/** Dev-only: reconstruct the project from the entry the pointer currently
 *  sits on, for verifying a just-completed push against the live project
 *  (see the `?historycheck` flag in main.ts). Idempotent — does not advance
 *  or rewind the stack. */
export function debugCurrentReconstruction(): Project {
  return reconstruct(stack[pointer]);
}

/** Test-only: raw entry list, for asserting reference-sharing of unchanged
 *  panel strings between consecutive entries. */
export function debugStack(): readonly { meta: string; panels: string[]; ctx: HistoryCtx }[] {
  return stack;
}
