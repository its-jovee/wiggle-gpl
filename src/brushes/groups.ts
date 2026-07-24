// ============================================================================
// brushes/groups.ts — editor-facing brush tool categories.
//
// Brush registry groups describe the brush list. These tool categories describe
// how the editor presents brushes in the toolbar. Erasers are classified by the
// load-bearing `erase` flag so new eraser brushes don't leak into paint tools.
// Raster-only (Krita-inspired) brushes are filtered by active layer kind.
// ============================================================================

import { BRUSHES, Brush, brushByKey } from "./registry";

export type BrushToolKey = "classic" | "texture" | "scatter" | "eraser";

export type BrushTool = {
  key: BrushToolKey;
  label: string;
};

export type BrushLayerKind = "draw" | "raster" | "tone" | "text" | string;

export const BRUSH_TOOLS: BrushTool[] = [
  { key: "classic", label: "Classic" },
  { key: "texture", label: "Texture" },
  { key: "scatter", label: "Scatter & FX" },
  { key: "eraser", label: "Eraser" },
];

/** Safe draw-layer fallback when a raster-only brush cannot be used. */
export const RASTER_ONLY_FALLBACK_KEY = "round";

export function brushToolForBrush(brush: Brush): BrushToolKey {
  if (brush.erase) return "eraser";
  if (brush.group === "Texture") return "texture";
  if (brush.group === "Scatter & FX") return "scatter";
  // Krita-inspired family groups still map into the nearest tool chrome.
  if (brush.group?.startsWith("Krita")) {
    if (brush.group.includes("Spray") || brush.group.includes("FX")) return "scatter";
    if (brush.group.includes("Chalk") || brush.group.includes("Dry")) return "texture";
    return "classic";
  }
  return "classic";
}

export function brushToolForKey(key: string): BrushToolKey {
  const brush = BRUSHES.find((b) => b.key === key);
  return brush ? brushToolForBrush(brush) : "classic";
}

/** Raster-only brushes require an active raster layer; everything else is ok. */
export function isBrushAvailable(brush: Brush, layerKind?: BrushLayerKind | null): boolean {
  if (!brush.rasterOnly) return true;
  return layerKind === "raster";
}

export function isBrushKeyAvailable(key: string, layerKind?: BrushLayerKind | null): boolean {
  const brush = BRUSHES.find((b) => b.key === key);
  if (!brush) return false;
  return isBrushAvailable(brush, layerKind);
}

export function brushesForTool(
  tool: BrushToolKey,
  layerKind?: BrushLayerKind | null
): Brush[] {
  return BRUSHES.filter((brush) => {
    if (brushToolForBrush(brush) !== tool) return false;
    return isBrushAvailable(brush, layerKind);
  });
}

export function defaultBrushForTool(
  tool: BrushToolKey,
  layerKind?: BrushLayerKind | null
): Brush {
  return brushesForTool(tool, layerKind)[0] ?? BRUSHES[0];
}

/**
 * Resolve a brush key for the active layer. Missing keys fall back via
 * brushByKey. Raster-only keys on non-raster layers fall back to a safe
 * classic brush (preserving erase intent when possible).
 */
export function resolveBrushForLayer(
  key: string,
  layerKind?: BrushLayerKind | null
): { brush: Brush; changed: boolean; reason?: string } {
  const found = BRUSHES.find((b) => b.key === key);
  if (!found) {
    const brush = brushByKey(key);
    return {
      brush,
      changed: brush.key !== key,
      reason: `Unknown brush “${key}”; using ${brush.label}`,
    };
  }
  if (isBrushAvailable(found, layerKind)) {
    return { brush: found, changed: false };
  }
  const tool = brushToolForBrush(found);
  const fallback =
    (tool === "eraser"
      ? brushesForTool("eraser", layerKind)[0]
      : undefined)
    ?? defaultBrushForTool(tool === "eraser" ? "eraser" : "classic", layerKind)
    ?? brushByKey(RASTER_ONLY_FALLBACK_KEY);
  return {
    brush: fallback,
    changed: true,
    reason: `${found.label} is raster-only; switched to ${fallback.label}`,
  };
}
