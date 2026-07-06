// ============================================================================
// core/fill.ts — scanline flood fill on a CanvasRenderingContext2D.
//
// Pure pixel op: identical canvas + identical (point, color) -> identical
// result. That's what keeps determinism intact when fills are re-applied each
// wiggle tick — they track the jiggling line.
// ============================================================================

export function floodFill(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  hex: string,
  width: number,
  height: number,
  tolerance = 0
): boolean {
  const img = ctx.getImageData(0, 0, width, height);
  const changed = floodFillImageData(img, x, y, hex, width, height, tolerance);
  if (changed) ctx.putImageData(img, 0, 0);
  return changed;
}

export function floodFillImageData(
  img: ImageData,
  x: number,
  y: number,
  hex: string,
  width: number,
  height: number,
  tolerance = 0
): boolean {
  const px = Math.floor(x);
  const py = Math.floor(y);
  if (px < 0 || py < 0 || px >= width || py >= height) return false;

  const d = img.data;
  const idx = (ix: number, iy: number) => (iy * width + ix) * 4;

  const startIdx = idx(px, py);
  const sr = d[startIdx], sg = d[startIdx + 1], sb = d[startIdx + 2], sa = d[startIdx + 3];
  const [tr, tg, tb] = hexToRgb(hex);
  if (sr === tr && sg === tg && sb === tb && sa === 255) return false;

  const tol = Math.max(0, tolerance);
  const match = (p: number) =>
    Math.abs(d[p] - sr) <= tol &&
    Math.abs(d[p + 1] - sg) <= tol &&
    Math.abs(d[p + 2] - sb) <= tol &&
    d[p + 3] === sa;

  const stack: number[] = [py * width + px];
  const pushRuns = (row: number, lx: number, rx: number) => {
    let inRun = false;
    for (let i = lx; i <= rx; i++) {
      const p = idx(i, row);
      if (match(p)) {
        if (!inRun) {
          stack.push(row * width + i);
          inRun = true;
        }
      } else {
        inRun = false;
      }
    }
  };

  let changed = false;
  while (stack.length) {
    const n = stack.pop()!;
    const sy = Math.floor(n / width);
    const sx = n - sy * width;
    if (sy < 0 || sy >= height) continue;
    if (!match(idx(sx, sy))) continue;

    let lx = sx;
    while (lx >= 0 && match(idx(lx, sy))) lx--;
    lx++;
    let rx = sx;
    while (rx < width && match(idx(rx, sy))) rx++;
    rx--;
    if (lx > rx) continue;

    for (let i = lx; i <= rx; i++) {
      const p = idx(i, sy);
      d[p] = tr; d[p + 1] = tg; d[p + 2] = tb; d[p + 3] = 255;
    }
    changed = true;
    if (sy > 0) {
      pushRuns(sy - 1, lx, rx);
    }
    if (sy < height - 1) {
      pushRuns(sy + 1, lx, rx);
    }
  }
  return changed;
}

export function hexToRgb(hex: string): [number, number, number] {
  const m = hex.replace("#", "");
  return [
    parseInt(m.slice(0, 2), 16) | 0,
    parseInt(m.slice(2, 4), 16) | 0,
    parseInt(m.slice(4, 6), 16) | 0,
  ];
}
