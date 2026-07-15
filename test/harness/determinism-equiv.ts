import { createRenderCache, renderPanel } from "../../src/core/render";
import type { Layer, Panel } from "../../src/core/types";

const WIDTH = 160;
const HEIGHT = 120;

function stroke(brush: string, points: { x: number; y: number }[], color: string, size: number) {
  return { brush, points, color, size };
}

function fixture(): Panel {
  const ink: Layer = {
    id: "ink",
    name: "Ink",
    visible: true,
    opacity: 1,
    kind: "draw",
    strokes: [
      stroke("round", [{ x: 16, y: 20 }, { x: 140, y: 38 }, { x: 92, y: 98 }], "#1d1d2b", 8),
    ],
    fills: [],
  };
  const tone: Layer = {
    id: "tone",
    name: "Tone",
    visible: true,
    opacity: 0.7,
    kind: "tone",
    tone: { style: "halftone", color: "#ff4f81", spacing: 11, size: 5, angle: 0, coverage: "full" },
    strokes: [],
    fills: [],
    blendMode: "screen",
  };
  const clipped: Layer = {
    id: "clipped",
    name: "Clipped",
    visible: true,
    opacity: 0.8,
    kind: "draw",
    clipToBelow: true,
    strokes: [stroke("marker", [{ x: 22, y: 92 }, { x: 146, y: 78 }], "#36d399", 5)],
    fills: [],
  };
  return { id: "determinism", durationMs: 1000, bg: "#f6f4ff", paletteId: null, layers: [ink, tone, clipped] };
}

function frame(panel: Panel, tick: number): string {
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext("2d")!;
  renderPanel(ctx, panel, tick, WIDTH, HEIGHT, {
    skipAnim: true,
    renderCache: createRenderCache(16),
    wiggleFps: 8,
  });
  return canvas.toDataURL("image/png");
}

async function runDeterminismTests(): Promise<string[]> {
  const failures: string[] = [];
  const panel = fixture();
  for (const tick of [0, 1, 7, 19]) {
    if (frame(panel, tick) !== frame(panel, tick)) failures.push(`tick ${tick} differs between renders`);
  }
  return failures;
}

declare global {
  interface Window {
    __determinismEquivReady?: boolean;
    runDeterminismEquivTests?: () => Promise<string[]>;
  }
}

window.runDeterminismEquivTests = runDeterminismTests;
window.__determinismEquivReady = true;
