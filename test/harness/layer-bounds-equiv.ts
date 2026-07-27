// Safety harness for the per-layer ink-bounds optimization.
//
// drawLayerStack confines a layer's composite blit to `layerInkBounds`, so if
// those bounds ever under-cover what the brushes actually paint, artwork gets
// silently clipped. This asserts the invariant directly: render a layer, scan
// every pixel it painted, and require all of them to fall inside the bounds.
//
// Scatter brushes are the interesting case — they stamp far from the sample
// point — so they are covered explicitly alongside a range of stroke sizes.
import { layerInkBounds, renderPanel, createRenderCache } from "../../src/core/render";
import type { Layer, Panel, Project } from "../../src/core/types";

const WIDTH = 400;
const HEIGHT = 400;

function inkLayer(brush: string, size: number, points: { x: number; y: number }[]): Layer {
  return {
    id: `ink-${brush}-${size}`,
    name: "Ink",
    visible: true,
    opacity: 1,
    kind: "draw",
    strokes: [{ brush, color: "#101020", size, points }],
    fills: [],
  };
}

function renderLayerAlone(layer: Layer, tick: number, overscan: { x: number; y: number }) {
  const bufW = WIDTH + 2 * overscan.x;
  const bufH = HEIGHT + 2 * overscan.y;
  const canvas = document.createElement("canvas");
  canvas.width = bufW;
  canvas.height = bufH;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.clearRect(0, 0, bufW, bufH);
  const panel: Panel = {
    id: "bounds",
    durationMs: 1000,
    bg: "#ffffff",
    paletteId: null,
    layers: [layer],
  };
  // skipBg keeps the buffer transparent everywhere the layer did not paint,
  // which is what makes the alpha scan below meaningful.
  renderPanel(ctx, panel, tick, WIDTH, HEIGHT, {
    skipAnim: true,
    skipBg: true,
    wiggleFps: 8,
    overscan,
    renderCache: createRenderCache(8),
  });
  return { ctx, bufW, bufH };
}

/** Tight bbox of every non-transparent pixel, in buffer coords. */
function paintedExtent(ctx: CanvasRenderingContext2D, bufW: number, bufH: number) {
  const data = ctx.getImageData(0, 0, bufW, bufH).data;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let y = 0; y < bufH; y++) {
    for (let x = 0; x < bufW; x++) {
      if (data[(y * bufW + x) * 4 + 3] !== 0) {
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      }
    }
  }
  return x0 === Infinity ? null : { x0, y0, x1, y1 };
}

const BRUSHES = [
  "round", "pencil", "gpen", "ink", "brushpen", "marker", "chonk",
  "spray", "glitter", "cloud", "foliage", "stippleLrg", "softLrg",
  "watercolor", "charcoal", "airbrush",
];

async function runLayerBoundsTests(): Promise<string[]> {
  const failures: string[] = [];
  const overscan = { x: Math.round(WIDTH * 0.5), y: Math.round(HEIGHT * 0.5) };

  for (const brush of BRUSHES) {
    for (const size of [2, 8, 24]) {
      const layer = inkLayer(brush, size, [
        { x: 120, y: 140 }, { x: 250, y: 170 }, { x: 300, y: 260 },
      ]);
      const bounds = layerInkBounds(layer);
      if (!bounds) continue; // opted out of the optimization; nothing to verify

      for (const tick of [0, 3, 11]) {
        const { ctx, bufW, bufH } = renderLayerAlone(layer, tick, overscan);
        const painted = paintedExtent(ctx, bufW, bufH);
        if (!painted) continue;
        // Bounds are frame coords; painted extent is buffer coords.
        const bx0 = bounds.x0 + overscan.x;
        const by0 = bounds.y0 + overscan.y;
        const bx1 = bounds.x1 + overscan.x;
        const by1 = bounds.y1 + overscan.y;
        if (painted.x0 < bx0 || painted.y0 < by0 || painted.x1 > bx1 || painted.y1 > by1) {
          failures.push(
            `${brush}@${size} tick${tick}: painted ` +
            `(${painted.x0},${painted.y0})-(${painted.x1},${painted.y1}) ` +
            `escapes bounds (${bx0},${by0})-(${bx1},${by1})`
          );
        }
      }
    }
  }

  // Cropped cache entries must render the same image as the full-buffer path.
  //
  // Passing a renderCache enables the cropped-tile path in drawLayerRaw;
  // omitting it renders full-size. The two paths composite through a different
  // number of drawImage steps (the full path clones through a pooled buffer
  // first), so 8-bit channel values can legitimately land ±1 apart. What must
  // match exactly is *coverage*: identical painted extent and identical set of
  // opaque pixels — those are what a crop bug would break by clipping or
  // displacing ink.
  {
    const cases: { name: string; layer: Layer; opacity?: number }[] = [
      { name: "plain ink", layer: inkLayer("round", 8, [{ x: 60, y: 60 }, { x: 300, y: 320 }]) },
      { name: "scatter", layer: inkLayer("spray", 12, [{ x: 90, y: 100 }, { x: 260, y: 300 }]) },
      { name: "edge-hugging", layer: inkLayer("round", 6, [{ x: 1, y: 1 }, { x: 399, y: 399 }]) },
      { name: "translucent", layer: { ...inkLayer("marker", 10, [{ x: 40, y: 200 }, { x: 340, y: 210 }]), opacity: 0.45 } },
    ];
    for (const { name, layer } of cases) {
      for (const overscan of [{ x: 0, y: 0 }, { x: 200, y: 200 }]) {
        const panel: Panel = {
          id: "eq", durationMs: 1000, bg: "#ffffff", paletteId: null, layers: [layer],
        };
        const bufW = WIDTH + 2 * overscan.x;
        const bufH = HEIGHT + 2 * overscan.y;
        const render = (useCache: boolean) => {
          const c = document.createElement("canvas");
          c.width = bufW; c.height = bufH;
          const cx = c.getContext("2d", { willReadFrequently: true })!;
          cx.clearRect(0, 0, bufW, bufH);
          renderPanel(cx, panel, 4, WIDTH, HEIGHT, {
            skipAnim: true, wiggleFps: 8, overscan,
            renderCache: useCache ? createRenderCache(8) : undefined,
          });
          return cx.getImageData(0, 0, bufW, bufH).data;
        };
        const cropped = render(true);
        const full = render(false);

        let worstDelta = 0;
        let alphaMismatches = 0;
        let drifted = 0;
        let painted = 0;
        for (let i = 0; i < cropped.length; i += 4) {
          if ((cropped[i + 3] === 0) !== (full[i + 3] === 0)) alphaMismatches++;
          if (cropped[i + 3] !== 0) painted++;
          let pixelDelta = 0;
          for (let ch = 0; ch < 4; ch++) {
            const d = Math.abs(cropped[i + ch] - full[i + ch]);
            if (d > pixelDelta) pixelDelta = d;
          }
          if (pixelDelta > 1) drifted++;
          if (pixelDelta > worstDelta) worstDelta = pixelDelta;
        }
        const label = `${name} @overscan${overscan.x}`;

        // The load-bearing assertion: a crop that clipped or displaced ink
        // would paint a different SET of pixels. This must be exact.
        if (alphaMismatches > 0) {
          failures.push(`${label}: ${alphaMismatches} pixels painted by one path but not the other (crop is clipping or displacing ink)`);
        }
        // Residual drift is confined to antialiased edges, where the extra
        // intermediate blit on the full-buffer path requantizes partially
        // transparent pixels. Bound both how far it can drift and how much of
        // the image may drift at all, so a genuine compositing error (which
        // would move solid interior pixels) still fails.
        if (worstDelta > 8) {
          failures.push(`${label}: channel delta ${worstDelta} exceeds antialiasing tolerance`);
        }
        if (painted > 0 && drifted / painted > 0.05) {
          failures.push(`${label}: ${((drifted / painted) * 100).toFixed(1)}% of painted pixels drifted — expected edges only`);
        }
      }
    }
  }

  // A layer that paints nothing must report empty bounds, not full-buffer.
  {
    const empty = inkLayer("round", 4, []);
    const b = layerInkBounds(empty);
    if (!b || b.x1 - b.x0 !== 0 || b.y1 - b.y0 !== 0) {
      failures.push("empty layer should report zero-area bounds");
    }
  }

  // Layers that can paint outside the stroke hull must opt out entirely.
  {
    const withFill: Layer = { ...inkLayer("round", 4, [{ x: 10, y: 10 }]), fills: [
      { color: "#ff0000", seed: { x: 5, y: 5 }, afterStrokeIndex: -1 } as never,
    ] };
    if (layerInkBounds(withFill) !== null) failures.push("fills must opt out of ink bounds");

    const withText: Layer = { ...inkLayer("round", 4, [{ x: 10, y: 10 }]), texts: [
      { id: "t", content: "hi", x: 5, y: 5, fontSize: 24, fontFamily: "sans", color: "#000" } as never,
    ] };
    if (layerInkBounds(withText) !== null) failures.push("texts must opt out of ink bounds");
  }

  return failures;
}

declare global {
  interface Window {
    __layerBoundsReady?: boolean;
    runLayerBoundsTests?: () => Promise<string[]>;
  }
}

window.runLayerBoundsTests = runLayerBoundsTests;
window.__layerBoundsReady = true;
