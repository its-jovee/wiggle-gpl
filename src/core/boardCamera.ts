// ============================================================================
// core/boardCamera.ts — the single camera shared by the editor and the board.
//
// The infinite board and the live editor use one coordinate system: "world"
// space, measured in project pixels. A project's frame occupies a rectangle in
// world space (its saved x/y and its pixel width/height). The camera is the CSS
// transform `translate(tx, ty) scale(scale)` applied to the world container, so
// editing a project "at 100%" simply means the camera scale is 1 over that
// project's slot, and zooming out to survey every project is the same camera at
// a small scale. These helpers are pure so they can be unit-tested without a DOM.
// ============================================================================

export type Camera = {
  scale: number;
  tx: number;
  ty: number;
};

export type WorldRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type Size = {
  width: number;
  height: number;
};

// The editor needs to zoom in past 1:1 (fine drawing); the board needs to zoom
// far out to fit many full-resolution project frames on screen at once. World
// coordinates are project pixels, so the floor has to be tiny.
export const MIN_CAMERA_SCALE = 0.02;
export const MAX_CAMERA_SCALE = 8;

export function clampCameraScale(scale: number): number {
  if (!Number.isFinite(scale)) return 1;
  return Math.max(MIN_CAMERA_SCALE, Math.min(MAX_CAMERA_SCALE, scale));
}

export function screenToWorld(
  camera: Camera,
  screenX: number,
  screenY: number
): { x: number; y: number } {
  return {
    x: (screenX - camera.tx) / camera.scale,
    y: (screenY - camera.ty) / camera.scale,
  };
}

export function worldToScreen(
  camera: Camera,
  worldX: number,
  worldY: number
): { x: number; y: number } {
  return {
    x: worldX * camera.scale + camera.tx,
    y: worldY * camera.scale + camera.ty,
  };
}

/**
 * Zoom to `nextScale` while keeping the world point currently under
 * (screenX, screenY) pinned to that same screen position — the standard
 * "zoom about the cursor" behaviour shared by wheel, pinch, and the zoom pill.
 * Screen coordinates are relative to the board surface's top-left.
 */
export function zoomAbout(
  camera: Camera,
  nextScale: number,
  screenX: number,
  screenY: number
): Camera {
  const scale = clampCameraScale(nextScale);
  const world = screenToWorld(camera, screenX, screenY);
  return {
    scale,
    tx: screenX - world.x * scale,
    ty: screenY - world.y * scale,
  };
}

export function panCamera(camera: Camera, dx: number, dy: number): Camera {
  return { scale: camera.scale, tx: camera.tx + dx, ty: camera.ty + dy };
}

/**
 * Camera that centres `rect` inside a surface of `surface` size, leaving
 * `padding` screen pixels of margin. Used for both "fit this project" and
 * "fit all projects" — the caller supplies either one frame's rect or the
 * bounding rect of every card.
 */
export function fitCamera(
  surface: Size,
  rect: WorldRect,
  padding = 48
): Camera {
  const availW = Math.max(1, surface.width - padding * 2);
  const availH = Math.max(1, surface.height - padding * 2);
  const rectW = Math.max(1, rect.width);
  const rectH = Math.max(1, rect.height);
  const scale = clampCameraScale(Math.min(availW / rectW, availH / rectH));
  return {
    scale,
    tx: (surface.width - rectW * scale) / 2 - rect.x * scale,
    ty: (surface.height - rectH * scale) / 2 - rect.y * scale,
  };
}

/** Bounding rect that encloses every supplied rect. Null when the list empty. */
export function boundingRect(rects: WorldRect[]): WorldRect | null {
  if (!rects.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.width);
    maxY = Math.max(maxY, r.y + r.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * How much of the board surface the active project frame currently fills, as
 * the fraction of the dominant axis (max of width/height coverage). 1 means the
 * frame fills the surface on at least one axis; small values mean the project is
 * a distant speck. Drives the chrome fade and draw-input gating.
 */
export function activeCoverage(
  camera: Camera,
  frame: Size,
  surface: Size
): number {
  if (surface.width <= 0 || surface.height <= 0) return 0;
  const coverW = (frame.width * camera.scale) / surface.width;
  const coverH = (frame.height * camera.scale) / surface.height;
  return Math.max(coverW, coverH);
}

export type FadeRange = {
  /** Fit-relative zoom at or above which chrome is fully opaque. */
  full: number;
  /** Fit-relative zoom at or below which chrome is fully hidden (and non-interactive). */
  hidden: number;
};

/** Fit-relative zoom: solid chrome above `full`, gone at/below `hidden`. */
export const DEFAULT_CHROME_FADE: FadeRange = { full: 0.55, hidden: 0.3 };

/**
 * Opacity (0..1) for the surrounding editor chrome given fit-relative zoom
 * (`viewport.scale / fitScale`). Solid while editing at a comfortable pull-back;
 * fades only once you're clearly into board/overview territory. Callers should
 * keep chrome interactive while opacity > 0 and only disable hit-testing at 0.
 */
export function chromeOpacity(
  coverage: number,
  range: FadeRange = DEFAULT_CHROME_FADE
): number {
  const { full, hidden } = range;
  if (coverage >= full) return 1;
  if (coverage <= hidden) return 0;
  return (coverage - hidden) / (full - hidden);
}

/**
 * Grid layout for "Organize": evenly spaced world positions for `count` frames
 * of `frame` size, `columns` wide, with `gap` world pixels between them. Frames
 * are assumed uniform for spacing; callers with mixed sizes still get a tidy,
 * non-overlapping grid keyed off the largest expected frame.
 */
export function organizeGrid(
  count: number,
  frame: Size,
  columns = 3,
  gap = 240
): { x: number; y: number }[] {
  const cols = Math.max(1, Math.floor(columns));
  const stepX = frame.width + gap;
  const stepY = frame.height + gap;
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < count; i++) {
    out.push({
      x: (i % cols) * stepX,
      y: Math.floor(i / cols) * stepY,
    });
  }
  return out;
}

// Records created before the world used project-pixel coordinates were laid out
// on a fixed ~560px display-size grid (see the old nextProjectBoardPosition).
// Scaling those legacy positions up by this factor spreads them back out so
// full-resolution frames don't overlap after the migration.
export const LEGACY_POSITION_SCALE = 4;

export function migrateLegacyPosition(
  pos: { x: number; y: number },
  scale = LEGACY_POSITION_SCALE
): { x: number; y: number } {
  return { x: pos.x * scale, y: pos.y * scale };
}
