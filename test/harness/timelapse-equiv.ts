import {
  clearTimelapseCache,
  renderPanel,
  trimFramePool,
} from "../../src/core/render";
import type { Layer, Panel, Project } from "../../src/core/types";

type FrameOpts = {
  incremental: boolean;
  tick: number;
  progress: number;
  contentVersion?: number;
  skipJitter?: boolean;
  clearBefore?: boolean;
  project: { project: Project; panel: Panel };
};

function strokeWithLength(length: number, brush = "round") {
  return {
    brush,
    color: "#ffffff",
    size: 2,
    points: [{ x: 20, y: 40 }, { x: 20 + length, y: 40 }],
  };
}

function makeLayer(name: string, length: number, extra: Partial<Layer> = {}): Layer {
  return {
    id: name,
    name,
    visible: true,
    opacity: 1,
    strokes: [strokeWithLength(length)],
    fills: [],
    ...extra,
  };
}

function makeTimelapseProject(layers: Layer[] = [
  makeLayer("Color", 24),
  makeLayer("Lineart", 40),
]) {
  const source: Panel = {
    id: "source",
    durationMs: 1000,
    bg: "#1a1c2c",
    paletteId: null,
    layers,
  };
  const panel: Panel = {
    id: "timelapse",
    durationMs: 1000,
    bg: "#1a1c2c",
    paletteId: null,
    kind: "timelapse",
    timelapse: { sourceId: "source" },
    layers: [],
  };
  const project: Project = {
    version: 5,
    width: 320,
    height: 240,
    wiggleFps: 8,
    panels: [panel, source],
    audio: { tracks: [] },
  };
  return { project, panel };
}

function makeFillFallbackProject() {
  return makeTimelapseProject([
    makeLayer("Ink", 36, {
      fills: [{
        point: { x: 30, y: 40 },
        color: "#ff6b6b",
        seed: 1,
        afterStrokeIndex: 0,
      }],
    }),
  ]);
}

function makeEraserFallbackProject() {
  return makeTimelapseProject([
    makeLayer("Ink", 30),
    makeLayer("Erase", 20, {
      strokes: [strokeWithLength(20, "eraser")],
    }),
  ]);
}

function renderTimelapse(opts: FrameOpts): string {
  if (opts.clearBefore !== false) {
    clearTimelapseCache();
    trimFramePool();
  }
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 240;
  const ctx = canvas.getContext("2d")!;
  const { project, panel } = opts.project;
  renderPanel(ctx, panel, opts.tick, project.width, project.height, {
    allPanels: project.panels,
    timelapseProgress: opts.progress,
    timelapseIncremental: opts.incremental,
    contentVersion: opts.contentVersion ?? 1,
    skipJitter: opts.skipJitter ?? true,
    wiggleFps: 8,
  });
  return canvas.toDataURL();
}

function renderSequence(
  incremental: boolean,
  tick: number,
  progressSteps: number[],
  project: { project: Project; panel: Panel },
  opts?: { clearBefore?: boolean; skipJitter?: boolean; contentVersion?: number }
): string {
  if (opts?.clearBefore !== false) {
    clearTimelapseCache();
    trimFramePool();
  }
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 240;
  const ctx = canvas.getContext("2d")!;
  const { project: p, panel } = project;
  for (const progress of progressSteps) {
    renderPanel(ctx, panel, tick, p.width, p.height, {
      allPanels: p.panels,
      timelapseProgress: progress,
      timelapseIncremental: incremental,
      contentVersion: opts?.contentVersion ?? 1,
      skipJitter: opts?.skipJitter ?? true,
      wiggleFps: 8,
    });
  }
  return canvas.toDataURL();
}

function compareModes(
  label: string,
  mismatches: string[],
  tick: number,
  progress: number,
  project: { project: Project; panel: Panel },
  skipJitter = true
) {
  const incremental = renderTimelapse({
    incremental: true,
    tick,
    progress,
    project,
    skipJitter,
    clearBefore: true,
  });
  const full = renderTimelapse({
    incremental: false,
    tick,
    progress,
    project,
    skipJitter,
    clearBefore: true,
  });
  if (incremental !== full) {
    mismatches.push(`${label}: incremental vs full mismatch`);
  }
}

async function runTimelapseEquivTests(): Promise<string[]> {
  const mismatches: string[] = [];
  const simple = makeTimelapseProject();

  compareModes("partial", mismatches, 2, 0.35, simple);
  compareModes("complete", mismatches, 2, 1, simple);
  compareModes("tick-change", mismatches, 5, 0.7, simple);
  compareModes("tick-zero", mismatches, 0, 0.125, simple);
  compareModes("jitter-on", mismatches, 4, 0.55, simple, false);

  // Warm-cache scrub-back: progress decreases within one session.
  const scrubWarm = renderSequence(true, 3, [0.8, 0.4], simple, { clearBefore: true });
  const scrubFull = renderTimelapse({
    incremental: false,
    tick: 3,
    progress: 0.4,
    project: simple,
    clearBefore: true,
  });
  if (scrubWarm !== scrubFull) {
    mismatches.push("scrub-back-warm: incremental mismatch vs full");
  }

  // Warm-cache tick change at fixed progress.
  clearTimelapseCache();
  trimFramePool();
  renderSequence(true, 3, [0.5], simple, { clearBefore: true });
  const tickWarm = renderSequence(true, 4, [0.5], simple, { clearBefore: false });
  const tickFull = renderTimelapse({
    incremental: false,
    tick: 4,
    progress: 0.5,
    project: simple,
    clearBefore: true,
  });
  if (tickWarm !== tickFull) {
    mismatches.push("tick-change-warm: incremental mismatch vs full");
  }

  const seqEnd = renderSequence(true, 4, [0.2, 0.4, 0.6, 0.85, 1], simple);
  const fullEnd = renderTimelapse({
    incremental: false,
    tick: 4,
    progress: 1,
    project: simple,
    clearBefore: true,
  });
  if (seqEnd !== fullEnd) {
    mismatches.push("sequence-to-complete: mismatch vs full");
  }

  // Fallback paths must still match full render.
  const fillProject = makeFillFallbackProject();
  compareModes("fill-fallback", mismatches, 2, 0.6, fillProject);

  const eraserProject = makeEraserFallbackProject();
  compareModes("eraser-fallback", mismatches, 1, 0.45, eraserProject);

  return mismatches;
}

declare global {
  interface Window {
    __timelapseEquivReady?: boolean;
    runTimelapseEquivTests?: () => Promise<string[]>;
  }
}

window.runTimelapseEquivTests = runTimelapseEquivTests;
window.__timelapseEquivReady = true;
