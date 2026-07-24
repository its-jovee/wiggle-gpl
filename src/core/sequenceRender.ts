// ============================================================================
// core/sequenceRender.ts — deterministic sequence-frame composition.
//
// A panel transition overlaps pixels only; it does not alter panel exposure,
// local time, wiggle ticks, or stored drawing geometry. Playback, WebM, and MP4
// all use this path so crossfades agree frame-for-frame.
// ============================================================================

import type { Project } from "./types";
import { renderPanel, type RenderOpts } from "./render";
import { timelapseProgressQuantized } from "./renderSchedule";
import {
  sequenceTransitionAtTime,
  type SequenceTransitionPosition,
} from "./sequence";

type SequenceBuffers = {
  outgoing: HTMLCanvasElement;
  incoming: HTMLCanvasElement;
};

const buffersByCanvas = new WeakMap<HTMLCanvasElement, SequenceBuffers>();

function buffersFor(canvas: HTMLCanvasElement): SequenceBuffers {
  let buffers = buffersByCanvas.get(canvas);
  if (!buffers) {
    buffers = {
      outgoing: document.createElement("canvas"),
      incoming: document.createElement("canvas"),
    };
    buffersByCanvas.set(canvas, buffers);
  }
  for (const buffer of [buffers.outgoing, buffers.incoming]) {
    if (buffer.width !== canvas.width) buffer.width = canvas.width;
    if (buffer.height !== canvas.height) buffer.height = canvas.height;
  }
  return buffers;
}

function renderAtLocalTime(
  ctx: CanvasRenderingContext2D,
  project: Project,
  panelIndex: number,
  localMs: number,
  opts?: RenderOpts
): void {
  const panel = project.panels[panelIndex];
  const tick = Math.floor((localMs / 1000) * project.wiggleFps);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.restore();
  renderPanel(ctx, panel, tick, project.width, project.height, {
    ...opts,
    allPanels: project.panels,
    timelapseProgress: panel.kind === "timelapse"
      ? timelapseProgressQuantized(localMs, panel.durationMs, project.wiggleFps)
      : undefined,
    localMs,
    wiggleFps: project.wiggleFps,
  });
}

export function renderSequenceFrame(
  ctx: CanvasRenderingContext2D,
  project: Project,
  elapsedMs: number,
  opts?: RenderOpts,
  resolved?: SequenceTransitionPosition
): SequenceTransitionPosition {
  const position = resolved ?? sequenceTransitionAtTime(project, elapsedMs);
  if (!position.transition) {
    renderAtLocalTime(ctx, project, position.index, position.localMs, opts);
    return position;
  }

  const canvas = ctx.canvas as HTMLCanvasElement;
  const buffers = buffersFor(canvas);
  const outgoingCtx = buffers.outgoing.getContext("2d")!;
  const incomingCtx = buffers.incoming.getContext("2d")!;
  renderAtLocalTime(outgoingCtx, project, position.index, position.localMs, opts);
  renderAtLocalTime(incomingCtx, project, position.transition.nextIndex, 0, opts);

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.globalAlpha = 1 - position.transition.progress;
  ctx.drawImage(buffers.outgoing, 0, 0);
  ctx.globalAlpha = position.transition.progress;
  ctx.drawImage(buffers.incoming, 0, 0);
  ctx.restore();
  return position;
}
