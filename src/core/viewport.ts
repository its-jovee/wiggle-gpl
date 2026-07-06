// ============================================================================
// core/viewport.ts — canvas viewport state.
//
// The project canvas keeps its real pixel dimensions. This module only manages
// the CSS transform used for editor zoom/pan, plus coordinate conversion from
// screen space back into canvas pixels for drawing tools.
// ============================================================================

export type ViewportState = {
  scale: number;
  tx: number;
  ty: number;
};

const MIN_SCALE = 0.1;
const MAX_SCALE = 8;

export const EDITOR_OVERSCAN = 0.5;

export function overscanPx(w: number, h: number): { x: number; y: number } {
  return { x: Math.round(w * EDITOR_OVERSCAN), y: Math.round(h * EDITOR_OVERSCAN) };
}

export function clampScale(scale: number): number {
  return Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale));
}

export function applyTransform(canvas: HTMLCanvasElement, state: ViewportState) {
  canvas.style.transformOrigin = "0 0";
  canvas.style.transform = `translate(${state.tx}px, ${state.ty}px) scale(${state.scale})`;
}

export function screenToCanvas(canvas: HTMLCanvasElement, clientX: number, clientY: number) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((clientX - rect.left) / rect.width) * canvas.width,
    y: ((clientY - rect.top) / rect.height) * canvas.height,
  };
}

export function zoomAboutPoint(
  canvas: HTMLCanvasElement,
  area: HTMLElement,
  nextScale: number,
  clientX: number,
  clientY: number
): ViewportState {
  const scale = clampScale(nextScale);
  const pos = screenToCanvas(canvas, clientX, clientY);
  const areaRect = area.getBoundingClientRect();
  const baseLeft = areaRect.left + canvas.offsetLeft;
  const baseTop = areaRect.top + canvas.offsetTop;
  const baseWidth = canvas.offsetWidth;
  const baseHeight = canvas.offsetHeight;
  const fx = pos.x / canvas.width;
  const fy = pos.y / canvas.height;
  return {
    scale,
    tx: clientX - baseLeft - fx * baseWidth * scale,
    ty: clientY - baseTop - fy * baseHeight * scale,
  };
}

export function fitToArea(canvas: HTMLCanvasElement, area: HTMLElement): ViewportState {
  const areaRect = area.getBoundingClientRect();
  const baseWidth = canvas.offsetWidth;
  const baseHeight = canvas.offsetHeight;
  const scale = clampScale(Math.min(areaRect.width / baseWidth, areaRect.height / baseHeight) * 0.96);
  return {
    scale,
    tx: (areaRect.width - baseWidth * scale) / 2 - canvas.offsetLeft,
    ty: (areaRect.height - baseHeight * scale) / 2 - canvas.offsetTop,
  };
}

export function resetToActualSize(canvas: HTMLCanvasElement, area: HTMLElement): ViewportState {
  const areaRect = area.getBoundingClientRect();
  const baseWidth = canvas.offsetWidth;
  const baseHeight = canvas.offsetHeight;
  return {
    scale: 1,
    tx: (areaRect.width - baseWidth) / 2 - canvas.offsetLeft,
    ty: (areaRect.height - baseHeight) / 2 - canvas.offsetTop,
  };
}
