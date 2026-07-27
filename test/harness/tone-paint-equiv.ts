import { renderPanel } from "../../src/core/render";
import { applyToneGradient } from "../../src/core/tone";
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

function inkStroke(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  brush = "round",
  size = 3,
  erase = false
) {
  return {
    brush,
    color: "#000000",
    size,
    ...(erase ? { erase: true } : {}),
    points: [{ x: x1, y: y1 }, { x: x2, y: y2 }],
  };
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
    version: 13,
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

function rgbaAt(ctx: CanvasRenderingContext2D, x: number, y: number): number[] {
  return [...ctx.getImageData(x, y, 1, 1).data];
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

  // A gradient dragged onto a new painted-tone layer must become visible;
  // existing painted masks stay constrained to their strokes.
  {
    const empty = toneLayer("painted");
    applyToneGradient(empty.tone!, "linear", { x: 0, y: 50 }, { x: 100, y: 50 }, false);
    if (empty.tone!.coverage !== "full") failures.push("empty tone gradient: expected full coverage");
    const masked = toneLayer("painted", [inkStroke(40, 50, 60, 50)]);
    applyToneGradient(masked.tone!, "radial", { x: 50, y: 50 }, { x: 100, y: 50 }, true);
    if (masked.tone!.coverage !== "painted") failures.push("masked tone gradient: expected painted coverage");
  }

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

  // Transparent palette intent makes the selected normal brush erase too.
  {
    const { project, panel } = panelWith(toneLayer("painted", [
      inkStroke(0, 10, 99, 10),
      inkStroke(0, 10, 20, 10, "round", 30, true),
    ]));
    const ctx = renderToCanvas(panel, project);
    if (alphaAt(ctx, 10, 10) !== 0) failures.push("transparent paint: expected normal brush to erase at (10,10)");
  }

  // Static across ticks — no wiggle clock on tone layers.
  {
    const { project, panel } = panelWith(toneLayer("painted", [inkStroke(40, 50, 60, 50)]));
    const a = renderToCanvas(panel, project, 0).canvas.toDataURL();
    const b = renderToCanvas(panel, project, 7).canvas.toDataURL();
    if (a !== b) failures.push("painted tone differs between ticks — should be static");
  }

  // Linear and radial manga-tone gradients fade pattern density.
  for (const kind of ["linear", "radial"] as const) {
    const layer = toneLayer("full");
    layer.tone!.gradient = kind === "linear"
      ? { kind, start: { x: 0, y: 50 }, end: { x: 100, y: 50 } }
      : { kind, start: { x: 50, y: 50 }, end: { x: 100, y: 50 } };
    const { project, panel } = panelWith(layer);
    const ctx = renderToCanvas(panel, project);
    const near = alphaAt(ctx, kind === "linear" ? 10 : 50, 50);
    const far = alphaAt(ctx, 90, 50);
    if (near <= far) failures.push(`${kind} tone gradient: expected density to fade outward`);
  }

  // Normal draw-layer gradients interpolate both linear and radial fills.
  for (const kind of ["linear", "radial"] as const) {
    const start = kind === "linear" ? { x: 1, y: 50 } : { x: 50, y: 50 };
    const end = kind === "linear" ? { x: 99, y: 50 } : { x: 99, y: 50 };
    const layer: Layer = {
      id: `gradient-${kind}`, name: "Gradient", visible: true, opacity: 1, kind: "draw",
      strokes: [], texts: [],
      fills: [{ point: start, color: "#ff0000", seed: 1, afterStrokeIndex: -1,
        gradient: { kind, start, end, endColor: "#0000ff" } }],
    };
    const { project, panel } = panelWith(layer);
    const ctx = renderToCanvas(panel, project);
    const first = rgbaAt(ctx, start.x, start.y);
    const last = rgbaAt(ctx, 90, 50);
    if (first[0] <= first[2] || last[2] <= last[0]) failures.push(`${kind} color gradient did not interpolate red to blue`);
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
