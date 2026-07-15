import { renderPanel } from "../../src/core/render";
import type { Layer, Panel, Project } from "../../src/core/types";

const W = 100;
const H = 100;
// Dot centers sit at (W/2, H/2) + k*spacing, so with spacing 10 both
// (50, 50) and (10, 10) land exactly on a halftone dot — deterministic sampling.
const TONE = { style: "halftone" as const, color: "#000000", spacing: 10, size: 6, angle: 0 };

function toneLayer(coverage: "full" | "painted", strokes: Layer["strokes"] = []): Layer {
  return {
    id: "tone",
    name: "Tone",
    visible: true,
    opacity: 1,
    kind: "tone",
    tone: { ...TONE, coverage },
    strokes,
    fills: [],
  };
}

function inkStroke(x1: number, y1: number, x2: number, y2: number, brush = "round", size = 3) {
  return { brush, color: "#000000", size, points: [{ x: x1, y: y1 }, { x: x2, y: y2 }] };
}

function panelWith(layer: Layer): { project: Project; panel: Panel } {
  const panel: Panel = {
    id: "panel",
    durationMs: 1000,
    bg: "#ffffff",
    paletteId: null,
    layers: [layer],
  };
  const project: Project = {
    version: 10,
    width: W,
    height: H,
    wiggleFps: 8,
    panels: [panel],
    brushPresets: [],
    drawingSettings: { smoothing: { mode: "off", distance: 24, delayDistance: 16, finishStabilizedStroke: true, smoothPressure: false } },
  };
  return { project, panel };
}

function alphaAt(ctx: CanvasRenderingContext2D, x: number, y: number): number {
  return ctx.getImageData(x, y, 1, 1).data[3];
}

function renderToCanvas(panel: Panel, project: Project, tick = 0): CanvasRenderingContext2D {
  const canvas = document.createElement("canvas");
  canvas.width = project.width;
  canvas.height = project.height;
  const ctx = canvas.getContext("2d")!;
  renderPanel(ctx, panel, tick, project.width, project.height, {
    wiggleFps: project.wiggleFps,
    localMs: panel.durationMs,
    skipBg: true,
  });
  return ctx;
}

async function runToneEquivTests(): Promise<string[]> {
  const failures: string[] = [];

  // Painted: pattern only shows up under ink.
  {
    const { project, panel } = panelWith(toneLayer("painted", [inkStroke(40, 50, 60, 50)]));
    const ctx = renderToCanvas(panel, project);
    if (alphaAt(ctx, 50, 50) === 0) failures.push("painted: expected tone under stroke at (50,50)");
    if (alphaAt(ctx, 10, 10) !== 0) failures.push("painted: expected no tone away from stroke at (10,10)");
  }

  // Full coverage: pattern shows everywhere regardless of strokes.
  {
    const { project, panel } = panelWith(toneLayer("full"));
    const ctx = renderToCanvas(panel, project);
    if (alphaAt(ctx, 50, 50) === 0) failures.push("full: expected tone at (50,50) with no strokes");
    if (alphaAt(ctx, 10, 10) === 0) failures.push("full: expected tone at (10,10) with no strokes");
  }

  // Eraser punches holes in the painted mask.
  {
    const { project, panel } = panelWith(toneLayer("painted", [
      inkStroke(0, 10, 99, 10),
      inkStroke(0, 10, 20, 10, "eraser", 30),
    ]));
    const ctx = renderToCanvas(panel, project);
    if (alphaAt(ctx, 10, 10) !== 0) failures.push("eraser: expected hole at (10,10)");
  }

  // Static across ticks — no wiggle clock on tone layers.
  {
    const { project, panel } = panelWith(toneLayer("painted", [inkStroke(40, 50, 60, 50)]));
    const a = renderToCanvas(panel, project, 0).canvas.toDataURL();
    const b = renderToCanvas(panel, project, 7).canvas.toDataURL();
    if (a !== b) failures.push("painted tone differs between ticks — should be static");
  }

  return failures;
}

declare global {
  interface Window {
    __toneEquivReady?: boolean;
    runToneEquivTests?: () => Promise<string[]>;
  }
}

window.runToneEquivTests = runToneEquivTests;
window.__toneEquivReady = true;
