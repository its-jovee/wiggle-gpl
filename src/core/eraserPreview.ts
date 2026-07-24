// ============================================================================
// core/eraserPreview.ts — editor-only eraser cursor helpers.
//
// Actual erasing still happens through the normal deterministic brush render
// path. The eraser's circular cursor is a DOM overlay (see main.ts) that tracks
// the pointer directly via pointermove, decoupled from the canvas render loop
// so it never lags. These pure helpers classify eraser brushes and compute the
// erased radius that sizes that overlay.
// ============================================================================

export type ErasePreviewBrush = {
  erase?: boolean;
};

export function isErasePreviewBrush(brush: ErasePreviewBrush | null | undefined): boolean {
  return brush?.erase === true;
}

export function eraserPreviewRadius(brushSize: number): number {
  return Math.max(1, brushSize * 6);
}
