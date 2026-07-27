// Nested sub-panel clip harness: a child frame that extends past its parent
// must not paint outside the parent outline.
import { renderPanel, createRenderCache } from "../../src/core/render";
import type { Panel, SubPanel } from "../../src/core/types";

const WIDTH = 80;
const HEIGHT = 80;

function emptyLayer(id: string) {
  return {
    id,
    name: id,
    visible: true,
    opacity: 1,
    kind: "draw" as const,
    strokes: [],
    fills: [],
  };
}

function makeNestedPanel(): Panel {
  const child: SubPanel = {
    id: "child",
    bounds: { x: 30, y: 10, w: 40, h: 40 }, // overflows parent right edge (parent ends at x=40)
    shape: "rect",
    border: { brush: "round", color: "#000000", thickness: 1, wiggleAmplitude: 0 },
    bg: "#ff0000",
    layers: [emptyLayer("child-layer")],
    subPanels: [],
    stack: [{ kind: "layer", id: "child-layer" }],
  };
  const parent: SubPanel = {
    id: "parent",
    bounds: { x: 10, y: 10, w: 30, h: 40 },
    shape: "rect",
    border: { brush: "round", color: "#000000", thickness: 1, wiggleAmplitude: 0 },
    bg: null,
    layers: [emptyLayer("parent-layer")],
    subPanels: [child],
    stack: [
      { kind: "layer", id: "parent-layer" },
      { kind: "subpanel", id: "child" },
    ],
  };
  return {
    id: "nest",
    durationMs: 1000,
    bg: "#ffffff",
    paletteId: null,
    layers: [emptyLayer("root")],
    subPanels: [parent],
    stack: [
      { kind: "layer", id: "root" },
      { kind: "subpanel", id: "parent" },
    ],
  };
}

function sample(ctx: CanvasRenderingContext2D, x: number, y: number) {
  const d = ctx.getImageData(x, y, 1, 1).data;
  return { r: d[0], g: d[1], b: d[2], a: d[3] };
}

declare global {
  interface Window {
    __nestedClipReady?: boolean;
    runNestedSubPanelClipTests?: () => string[];
  }
}

window.runNestedSubPanelClipTests = () => {
  const mismatches: string[] = [];
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.clearRect(0, 0, WIDTH, HEIGHT);
  renderPanel(ctx, makeNestedPanel(), 0, WIDTH, HEIGHT, {
    skipAnim: true,
    skipJitter: true,
    wiggleFps: 8,
    renderCache: createRenderCache(4),
  });

  // Inside parent ∩ child → red fill should show.
  const inside = sample(ctx, 35, 30);
  if (inside.r < 200 || inside.g > 40 || inside.b > 40) {
    mismatches.push(`expected red inside parent at (35,30), got rgba(${inside.r},${inside.g},${inside.b},${inside.a})`);
  }

  // Outside parent but inside child's unclipped bounds → must stay white bg.
  const outside = sample(ctx, 50, 30);
  if (outside.r < 200 || outside.g < 200 || outside.b < 200) {
    mismatches.push(`expected parent clip at (50,30), got rgba(${outside.r},${outside.g},${outside.b},${outside.a})`);
  }

  return mismatches;
};

window.__nestedClipReady = true;
