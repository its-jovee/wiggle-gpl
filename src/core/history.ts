// ============================================================================
// core/history.ts — undo/redo via JSON snapshots of the Project.
//
// The data model is plain JSON, so structuredClone-via-JSON is safe and cheap
// for the panel counts we care about. Snapshot stack is capped; redo is
// truncated on every new push.
// ============================================================================

import { Project } from "./types";

const MAX = 50;
let stack: string[] = [];
let pointer = -1;

export function init(project: Project) {
  stack = [JSON.stringify(project)];
  pointer = 0;
}

export function push(project: Project) {
  stack = stack.slice(0, pointer + 1);
  stack.push(JSON.stringify(project));
  if (stack.length > MAX) stack.shift();
  pointer = stack.length - 1;
}

export function undo(): Project | null {
  if (pointer <= 0) return null;
  pointer--;
  return JSON.parse(stack[pointer]) as Project;
}

export function redo(): Project | null {
  if (pointer >= stack.length - 1) return null;
  pointer++;
  return JSON.parse(stack[pointer]) as Project;
}

export function canUndo() { return pointer > 0; }
export function canRedo() { return pointer < stack.length - 1; }
