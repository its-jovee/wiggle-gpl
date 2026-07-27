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

function makeLayerGroupPanel(hidden = false): Panel {
  const redFrame: SubPanel = {
    id: "red-frame",
    bounds: { x: 20, y: 20, w: 50, h: 50 },
    shape: "rect",
    border: { brush: "round", color: "#ff0000", thickness: 0, wiggleAmplitude: 0 },
    bg: "#ff0000",
    layers: [emptyLayer("red-layer")],
    subPanels: [],
    stack: [{ kind: "layer", id: "red-layer" }],
  };
  const group: SubPanel = {
    id: "group",
    group: true,
    name: "Characters",
    visible: !hidden,
    // Deliberately tiny: groups must not clip contents to these compatibility bounds.
    bounds: { x: 0, y: 0, w: 5, h: 5 },
    shape: "rect",
    border: { brush: "round", color: "#000000", thickness: 0, wiggleAmplitude: 0 },
    bg: null,
    layers: [],
    subPanels: [redFrame],
    stack: [{ kind: "subpanel", id: "red-frame" }],
    enter: { kind: "fade", durationTicks: 4 },
  };
  return {
    id: "group-panel",
    durationMs: 1000,
    bg: "#ffffff",
    paletteId: null,
    layers: [],
    subPanels: [group],
    stack: [{ kind: "subpanel", id: "group" }],
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

  // A layer group is an unclipped nested stack and its fade wraps all content.
  renderPanel(ctx, makeLayerGroupPanel(), 2, WIDTH, HEIGHT, {
    skipAnim: false,
    skipJitter: true,
    localMs: 250,
    wiggleFps: 8,
    renderCache: createRenderCache(4),
  });
  const faded = sample(ctx, 50, 40);
  if (faded.r < 245 || faded.g < 110 || faded.g > 150 || faded.b < 110 || faded.b > 150) {
    mismatches.push(`expected half-faded group at (50,40), got rgba(${faded.r},${faded.g},${faded.b},${faded.a})`);
  }

  // Fade the group as one isolated composite. Two overlapping opaque red
  // children should still produce 50% red, not accumulate to 75% opacity.
  {
    const overlapPanel = makeLayerGroupPanel();
    const group = overlapPanel.subPanels![0];
    const duplicate = structuredClone(group.subPanels![0]);
    duplicate.id = "red-frame-2";
    duplicate.layers[0].id = "red-layer-2";
    duplicate.stack = [{ kind: "layer", id: "red-layer-2" }];
    group.subPanels!.push(duplicate);
    group.stack!.push({ kind: "subpanel", id: duplicate.id });
    renderPanel(ctx, overlapPanel, 2, WIDTH, HEIGHT, {
      skipAnim: false, skipJitter: true, localMs: 250, wiggleFps: 8,
    });
    const overlap = sample(ctx, 50, 40);
    if (overlap.g < 110 || overlap.g > 150 || overlap.b < 110 || overlap.b > 150) {
      mismatches.push(`expected atomically faded overlap, got rgba(${overlap.r},${overlap.g},${overlap.b},${overlap.a})`);
    }
  }

  // Layer-style motion applies to the complete group composite.
  {
    const movingPanel = makeLayerGroupPanel();
    const group = movingPanel.subPanels![0];
    group.enter = undefined;
    group.animation = {
      enabled: true,
      startTick: 0,
      durationTicks: 8,
      from: { x: 0, y: 0, opacity: 1, scale: 1, rotation: 0 },
      to: { x: 20, y: 0, opacity: 1, scale: 1, rotation: 0 },
      easing: "linear",
      loop: "none",
    };
    renderPanel(ctx, movingPanel, 4, WIDTH, HEIGHT, {
      skipAnim: false, skipJitter: true, localMs: 500, wiggleFps: 8,
    });
    const moved = sample(ctx, 75, 40);
    if (moved.r < 220 || moved.g > 40 || moved.b > 40) {
      mismatches.push(`expected animated group motion at (75,40), got rgba(${moved.r},${moved.g},${moved.b},${moved.a})`);
    }
  }

  renderPanel(ctx, makeLayerGroupPanel(true), 2, WIDTH, HEIGHT, {
    skipAnim: false,
    skipJitter: true,
    localMs: 250,
    wiggleFps: 8,
    renderCache: createRenderCache(4),
  });
  const hidden = sample(ctx, 50, 40);
  if (hidden.r < 245 || hidden.g < 245 || hidden.b < 245) {
    mismatches.push(`expected hidden group to show panel background, got rgba(${hidden.r},${hidden.g},${hidden.b},${hidden.a})`);
  }

  return mismatches;
};

window.__nestedClipReady = true;
