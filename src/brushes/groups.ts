// ============================================================================
// brushes/groups.ts — editor-facing brush tool categories.
//
// Brush registry groups describe the brush list. These tool categories describe
// how the editor presents brushes in the toolbar. Erasers are classified by the
// load-bearing `erase` flag so new eraser brushes don't leak into paint tools.
// ============================================================================

import { BRUSHES, Brush } from "./registry";

export type BrushToolKey = "classic" | "texture" | "scatter" | "eraser";

export type BrushTool = {
  key: BrushToolKey;
  label: string;
};

export const BRUSH_TOOLS: BrushTool[] = [
  { key: "classic", label: "Classic" },
  { key: "texture", label: "Texture" },
  { key: "scatter", label: "Scatter & FX" },
  { key: "eraser", label: "Eraser" },
];

export function brushToolForBrush(brush: Brush): BrushToolKey {
  if (brush.erase) return "eraser";
  if (brush.group === "Texture") return "texture";
  if (brush.group === "Scatter & FX") return "scatter";
  return "classic";
}

export function brushToolForKey(key: string): BrushToolKey {
  const brush = BRUSHES.find((b) => b.key === key);
  return brush ? brushToolForBrush(brush) : "classic";
}

export function brushesForTool(tool: BrushToolKey): Brush[] {
  return BRUSHES.filter((brush) => brushToolForBrush(brush) === tool);
}

export function defaultBrushForTool(tool: BrushToolKey): Brush {
  return brushesForTool(tool)[0] ?? BRUSHES[0];
}
