// ============================================================================
// tools/pointerController.ts — exhaustive pointer-down dispatch by active tool.
//
// The canvas owns capture and gesture continuation, but choosing which editor
// tool begins a gesture belongs to the tool system. Keeping this registry
// exhaustive means adding a new EditorToolKind cannot silently fall through to
// paint: TypeScript requires its controller at the dispatch boundary.
// ============================================================================

import type { Vec2 } from "../core/types";
import { EDITOR_TOOL_KINDS, type ActiveTool, type EditorToolKind } from "./activeTool";

export type ToolPointerInput = {
  event: PointerEvent;
  point: Vec2;
};

export type ToolPointerController = {
  pointerDown(input: ToolPointerInput): void;
};

export type ToolPointerControllerRegistry = Record<EditorToolKind, ToolPointerController>;
export type ToolPointerHandlers = Record<EditorToolKind, (input: ToolPointerInput) => void>;

export function createToolPointerControllers(
  handlers: ToolPointerHandlers,
): ToolPointerControllerRegistry {
  return Object.fromEntries(EDITOR_TOOL_KINDS.map((kind) => [
    kind,
    { pointerDown: handlers[kind] },
  ])) as ToolPointerControllerRegistry;
}

/** Returns false only for a paint brush, whose stroke pipeline is shared with
 * raster/vector painting rather than represented as an editor pseudo-tool. */
export function dispatchToolPointerDown(
  activeTool: ActiveTool,
  input: ToolPointerInput,
  controllers: ToolPointerControllerRegistry,
): boolean {
  if (activeTool.kind === "brush") return false;
  controllers[activeTool.kind].pointerDown(input);
  return true;
}
