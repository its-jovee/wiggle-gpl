// ============================================================================
// core/export.ts — render panels / sequences to downloadable files.
//
// PATHS:
//   exportStillImage() — single-frame PNG or JPEG (optional transparent PNG).
//   exportWebM()       — MediaRecorder, ~real-time capture. Good for quick previews.
//   exportMP4()        — deterministic frame-by-frame → ffmpeg.wasm → H.264 MP4.
//   exportGIF()        — same frame loop → ffmpeg.wasm palette GIF.
//
// ffmpeg core loads from public/ffmpeg/ (same-origin, bundled at build time
// from @ffmpeg/core — see scripts/copy-ffmpeg.mjs).
// ============================================================================

import { Project } from "./types";
import { renderPanel, clearTimelapseCache } from "./render";
import { renderSequenceFrame } from "./sequenceRender";
import { timelapseProgressQuantized } from "./renderSchedule";
import { expandedDurationMs } from "./sequence";
import { buildAudioExportPlan, totalAudioDuration } from "./audioTimeline";
import { audioBridge } from "./electronAudio";
import {
  createExportProgressReporter,
  type ExportProgressCallback,
} from "./exportProgress";

export type ExportRenderOpts = {
  contentVersion?: number;
  onProgressEvent?: ExportProgressCallback;
  shouldCancel?: () => boolean;
  skipJitter?: boolean;
};

export type MP4ExportOptions = {
  includeAudioTail?: boolean;
  /** Restrict the export to one panel, without timeline audio. */
  panelIndex?: number;
  contentVersion?: number;
  onProgressEvent?: ExportProgressCallback;
  shouldCancel?: () => boolean;
  skipJitter?: boolean;
};

export type StillImageFormat = "png" | "jpeg";

export type StillExportOptions = {
  /** Panel to export. Defaults to 0. */
  panelIndex?: number;
  /** Wiggle tick for the still. Defaults to 0. */
  tick?: number;
  /** Omit panel background (PNG only — JPEG always fills opaque). */
  transparent?: boolean;
  /** JPEG quality 0–1. Defaults to 0.92. */
  quality?: number;
  contentVersion?: number;
  skipJitter?: boolean;
  onProgressEvent?: ExportProgressCallback;
  shouldCancel?: () => boolean;
};

export type GIFExportOptions = {
  /** Restrict the export to one panel. */
  panelIndex?: number;
  contentVersion?: number;
  onProgressEvent?: ExportProgressCallback;
  shouldCancel?: () => boolean;
  skipJitter?: boolean;
};

/** Offscreen canvas at full project resolution. */
function makeStage(project: Project) {
  const canvas = document.createElement("canvas");
  canvas.width = project.width;
  canvas.height = project.height;
  const ctx = canvas.getContext("2d")!;
  return { canvas, ctx };
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) reject(new Error(`Failed to encode ${type}`));
        else resolve(blob);
      },
      type,
      quality
    );
  });
}

/**
 * Render every frame and stage it in ffmpeg's virtual FS as `frame%05d.png`.
 *
 * The naive form of this loop is strictly serial — render, await the PNG
 * encode, await the wasm FS write, then start the next frame — so the main
 * thread sits idle during the encode (which the browser performs off-thread)
 * and again during the write. Overlapping them keeps one frame's encode/write
 * in flight while the next frame renders.
 *
 * This is safe because `canvas.toBlob` snapshots the bitmap at call time: the
 * canvas may be redrawn for the next frame while the previous encode is still
 * running. Writes are chained through a single promise so ffmpeg's FS is never
 * touched concurrently, and frames still land in strict index order.
 *
 * Determinism is untouched — `elapsedMs` is derived from the frame index, not
 * a wall clock, exactly as before.
 */
export async function stageFramesForFFmpeg(
  ffmpeg: { writeFile(name: string, data: Uint8Array): Promise<unknown> },
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  frameTarget: FrameRenderTarget,
  totalFrames: number,
  exportFps: number,
  visualMs: number,
  onFrame: (frame: number) => void,
  shouldCancel?: () => boolean
): Promise<void> {
  const { fetchFile } = await import("@ffmpeg/util");
  let inFlight: Promise<void> = Promise.resolve();

  try {
    for (let f = 0; f < totalFrames; f++) {
      if (shouldCancel?.()) throw new DOMException("Export cancelled", "AbortError");
      const elapsedMs = (f / exportFps) * 1000;
      const visualElapsedMs = Math.min(elapsedMs, Math.max(0, visualMs - 1));
      renderExportFrame(ctx, frameTarget, visualElapsedMs);

      // Snapshot now; the encode proceeds while the next frame renders.
      const blobPromise = canvasToBlob(canvas, "image/png");
      const name = `frame${String(f).padStart(5, "0")}.png`;
      const previous = inFlight;
      inFlight = (async () => {
        const bytes = await fetchFile(await blobPromise);
        await previous; // preserve write order
        await ffmpeg.writeFile(name, bytes);
        onFrame(f + 1);
      })();
      // Bound the pipeline to one outstanding frame so a long export cannot
      // accumulate hundreds of 8MB blobs in memory.
      if (f > 0) await previous;
    }
    await inFlight;
  } catch (err) {
    // Never leave the trailing frame's promise unobserved — an abandoned
    // rejection here would surface as an unhandled rejection long after the
    // export already failed.
    await inFlight.catch(() => {});
    throw err;
  }
}

async function loadFFmpeg() {
  const { FFmpeg } = await import("@ffmpeg/ffmpeg");
  const { toBlobURL } = await import("@ffmpeg/util");
  const ffmpeg = new FFmpeg();
  const base = new URL("ffmpeg/", window.location.href).href;
  await ffmpeg.load({
    coreURL: await toBlobURL(`${base}ffmpeg-core.js`, "text/javascript"),
    wasmURL: await toBlobURL(`${base}ffmpeg-core.wasm`, "application/wasm"),
  });
  return ffmpeg;
}

type FrameRenderTarget = {
  project: Project;
  panelIndex?: number;
  contentVersion: number;
  skipJitter: boolean;
};

function renderExportFrame(
  ctx: CanvasRenderingContext2D,
  target: FrameRenderTarget,
  visualElapsedMs: number,
  opts?: { skipBg?: boolean }
) {
  const { project, panelIndex, contentVersion, skipJitter } = target;
  const panel = panelIndex === undefined ? undefined : project.panels[panelIndex];
  if (panelIndex !== undefined && !panel) throw new Error("Cannot export a missing panel");

  if (opts?.skipBg) {
    ctx.clearRect(0, 0, project.width, project.height);
  }

  if (panel) {
    const localMs = visualElapsedMs;
    const tick = Math.floor((localMs / 1000) * project.wiggleFps);
    renderPanel(ctx, panel, tick, project.width, project.height, {
      allPanels: project.panels,
      timelapseProgress: panel.kind === "timelapse"
        ? timelapseProgressQuantized(localMs, panel.durationMs, project.wiggleFps) : undefined,
      localMs,
      wiggleFps: project.wiggleFps,
      contentVersion,
      skipJitter,
      skipBg: opts?.skipBg,
    });
  } else {
    renderSequenceFrame(ctx, project, visualElapsedMs, {
      contentVersion,
      skipJitter,
      skipBg: opts?.skipBg,
    });
  }
}

// --- Still image (PNG / JPEG) ----------------------------------------------
export async function exportStillImage(
  project: Project,
  format: StillImageFormat,
  opts?: StillExportOptions
): Promise<Blob> {
  clearTimelapseCache();
  const progress = createExportProgressReporter(
    format === "png" ? "PNG" : "JPEG",
    undefined,
    opts?.onProgressEvent
  );
  try {
    if (opts?.shouldCancel?.()) throw new DOMException("Export cancelled", "AbortError");
    const panelIndex = opts?.panelIndex ?? 0;
    const panel = project.panels[panelIndex];
    if (!panel) throw new Error("Cannot export a missing panel");

    const transparent = format === "png" && !!opts?.transparent;
    const { canvas, ctx } = makeStage(project);
    // skipBg leaves the target uncleared — wipe first for a clean alpha channel.
    ctx.clearRect(0, 0, project.width, project.height);
    progress.render(0.3);

    const tick = opts?.tick ?? 0;
    const localMs = Math.min(panel.durationMs * 0.5, Math.max(0, panel.durationMs - 1));
    renderPanel(ctx, panel, tick, project.width, project.height, {
      allPanels: project.panels,
      timelapseProgress: panel.kind === "timelapse"
        ? timelapseProgressQuantized(localMs, panel.durationMs, project.wiggleFps) : undefined,
      localMs,
      wiggleFps: project.wiggleFps,
      contentVersion: opts?.contentVersion ?? 0,
      skipJitter: opts?.skipJitter ?? false,
      skipBg: transparent,
    });

    if (opts?.shouldCancel?.()) throw new DOMException("Export cancelled", "AbortError");
    progress.render(0.8);

    const mime = format === "png" ? "image/png" : "image/jpeg";
    const quality = format === "jpeg" ? (opts?.quality ?? 0.92) : undefined;
    const blob = await canvasToBlob(canvas, mime, quality);
    progress.done();
    return blob;
  } catch (err) {
    progress.failed(err);
    throw err;
  } finally {
    clearTimelapseCache();
  }
}

// --- Path 1: MediaRecorder WebM (validate the pipeline end-to-end) ----------
export async function exportWebM(
  project: Project,
  onProgress?: (p: number) => void,
  renderOpts?: ExportRenderOpts
): Promise<Blob> {
  clearTimelapseCache();
  const progress = createExportProgressReporter("WebM", onProgress, renderOpts?.onProgressEvent);
  try {
    const { canvas, ctx } = makeStage(project);
    const stream = canvas.captureStream(60);
    const rec = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp9" });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);

    const totalMs = expandedDurationMs(project);
    const start = performance.now();
    const contentVersion = renderOpts?.contentVersion ?? 0;

    return await new Promise((resolve, reject) => {
      let aborted = false;
      rec.onstop = () => {
        if (aborted) {
          progress.failed(new DOMException("Export cancelled", "AbortError"));
          reject(new DOMException("Export cancelled", "AbortError"));
          return;
        }
        progress.done();
        resolve(new Blob(chunks, { type: "video/webm" }));
      };
      rec.start();

      function frame() {
        if (renderOpts?.shouldCancel?.()) {
          aborted = true;
          rec.stop();
          return;
        }
        const elapsed = performance.now() - start;
        if (elapsed >= totalMs) { rec.stop(); return; }
        renderSequenceFrame(ctx, project, elapsed, {
          contentVersion,
          skipJitter: renderOpts?.skipJitter ?? false,
        });
        progress.render(elapsed / totalMs);
        requestAnimationFrame(frame);
      }
      frame();
    });
  } catch (err) {
    progress.failed(err);
    throw err;
  } finally {
    clearTimelapseCache();
  }
}

// --- Path 2: deterministic MP4 via ffmpeg.wasm ------------------------------
// This is the one you actually ship for TikTok. Frame-accurate, exact fps.
export async function exportMP4(
  project: Project,
  exportFps = 30,
  onProgress?: (p: number) => void,
  opts?: MP4ExportOptions
): Promise<Blob> {
  clearTimelapseCache();
  const progress = createExportProgressReporter("MP4", onProgress, opts?.onProgressEvent);
  try {
    const { canvas, ctx } = makeStage(project);
    const panel = opts?.panelIndex === undefined ? undefined : project.panels[opts.panelIndex];
    if (opts?.panelIndex !== undefined && !panel) throw new Error("Cannot export a missing panel");
    const visualMs = panel?.durationMs ?? expandedDurationMs(project);
    const audioMs = totalAudioDuration(project.audio);
    const totalMs = panel ? visualMs : (opts?.includeAudioTail ? Math.max(visualMs, audioMs) : visualMs);
    const totalFrames = Math.max(1, Math.round((totalMs / 1000) * exportFps));
    const contentVersion = opts?.contentVersion ?? 0;
    const skipJitter = opts?.skipJitter ?? false;

    const ffmpeg = await loadFFmpeg();
    const frameTarget: FrameRenderTarget = {
      project,
      panelIndex: opts?.panelIndex,
      contentVersion,
      skipJitter,
    };

    await stageFramesForFFmpeg(
      ffmpeg, ctx, canvas, frameTarget, totalFrames, exportFps, visualMs,
      (done) => progress.render(done / totalFrames, done, totalFrames),
      opts?.shouldCancel
    );

    const audioArgs = panel ? { inputs: [], output: ["-an"] } : await writeAudioInputs(ffmpeg, project);
    progress.encode();

    // TikTok-optimal H.264 settings:
    //   - High@4.1 covers 1080×1920@30fps cleanly and is widely supported.
    //   - yuv420p chroma for universal playback (TikTok rejects 4:2:2/4:4:4).
    //   - CRF 20 = visually lossless-ish at this resolution; ffmpeg.wasm is
    //     slow, so we use `preset fast` to keep export time reasonable.
    //   - GOP = fps (1s) helps TikTok's quick scrubbing & re-encode pipeline.
    //   - +faststart moves the moov atom to the head so playback starts
    //     immediately (uploads stream-decode it).
    //   - BT.709 color tags match what a 1080p screen capture should look like.
    const args = [
      "-framerate", String(exportFps),
      "-i", "frame%05d.png",
      ...audioArgs.inputs,
      "-c:v", "libx264",
      "-pix_fmt", "yuv420p",
      "-profile:v", "high",
      "-level", "4.1",
      "-preset", "fast",
      "-crf", "20",
      "-r", String(exportFps),
      "-g", String(exportFps),
      "-movflags", "+faststart",
      "-color_primaries", "bt709",
      "-color_trc", "bt709",
      "-colorspace", "bt709",
      ...audioArgs.output,
      "-t", String(totalMs / 1000),
      "out.mp4",
    ];
    await ffmpeg.exec(args);

    const data = await ffmpeg.readFile("out.mp4");
    // data is Uint8Array; copy into a fresh ArrayBuffer-backed view for Blob.
    const bytes = data as Uint8Array;
    const blob = new Blob([new Uint8Array(bytes)], { type: "video/mp4" });
    progress.done();
    return blob;
  } catch (err) {
    progress.failed(err);
    throw err;
  } finally {
    clearTimelapseCache();
  }
}

// --- Animated GIF via ffmpeg.wasm ------------------------------------------
// Two-pass palette (palettegen → paletteuse) for cleaner colors than a single
// quantized encode. Default 12fps keeps file size reasonable at full res.
export async function exportGIF(
  project: Project,
  exportFps = 12,
  opts?: GIFExportOptions
): Promise<Blob> {
  clearTimelapseCache();
  const progress = createExportProgressReporter("GIF", undefined, opts?.onProgressEvent);
  try {
    const { canvas, ctx } = makeStage(project);
    const panel = opts?.panelIndex === undefined ? undefined : project.panels[opts.panelIndex];
    if (opts?.panelIndex !== undefined && !panel) throw new Error("Cannot export a missing panel");
    const totalMs = panel?.durationMs ?? expandedDurationMs(project);
    const totalFrames = Math.max(1, Math.round((totalMs / 1000) * exportFps));
    const contentVersion = opts?.contentVersion ?? 0;
    const skipJitter = opts?.skipJitter ?? false;

    const ffmpeg = await loadFFmpeg();
    const frameTarget: FrameRenderTarget = {
      project,
      panelIndex: opts?.panelIndex,
      contentVersion,
      skipJitter,
    };

    await stageFramesForFFmpeg(
      ffmpeg, ctx, canvas, frameTarget, totalFrames, exportFps, totalMs,
      // Reserve the last ~20% of the progress bar for palette encode.
      (done) => progress.render((done / totalFrames) * 0.8, done, totalFrames),
      opts?.shouldCancel
    );

    progress.encode();
    await ffmpeg.exec([
      "-framerate", String(exportFps),
      "-i", "frame%05d.png",
      "-vf", `fps=${exportFps},scale=iw:ih:flags=lanczos,palettegen=stats_mode=diff`,
      "palette.png",
    ]);
    await ffmpeg.exec([
      "-framerate", String(exportFps),
      "-i", "frame%05d.png",
      "-i", "palette.png",
      "-lavfi", `fps=${exportFps},scale=iw:ih:flags=lanczos [x]; [x][1:v] paletteuse=dither=bayer:bayer_scale=5`,
      "-loop", "0",
      "out.gif",
    ]);

    const data = await ffmpeg.readFile("out.gif");
    const bytes = data as Uint8Array;
    const blob = new Blob([new Uint8Array(bytes)], { type: "image/gif" });
    progress.done();
    return blob;
  } catch (err) {
    progress.failed(err);
    throw err;
  } finally {
    clearTimelapseCache();
  }
}

async function writeAudioInputs(
  ffmpeg: { writeFile(name: string, data: Uint8Array): Promise<unknown> },
  project: Project
): Promise<{ inputs: string[]; output: string[] }> {
  const clips = buildAudioExportPlan(project.audio);
  if (clips.length === 0) return { inputs: [], output: ["-an"] };
  const bridge = audioBridge();
  if (!bridge) throw new Error("desktop audio bridge unavailable");

  const inputs: string[] = [];
  const filterParts: string[] = [];
  const mixLabels: string[] = [];

  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i];
    const exists = await bridge.fileExists(clip.assetPath);
    if (!exists) throw new Error(`missing audio file: ${clip.assetPath}`);
    const bytes = new Uint8Array(await bridge.readFile(clip.assetPath));
    const name = `audio${i}${extensionForPath(clip.assetPath)}`;
    await ffmpeg.writeFile(name, bytes);
    inputs.push("-i", name);

    const inputIndex = i + 1; // frame sequence is input 0
    const duration = clip.durationMs / 1000;
    const offset = clip.offsetMs / 1000;
    const fadeIn = Math.min(clip.fadeInMs / 1000, duration / 2);
    const fadeOut = Math.min(clip.fadeOutMs / 1000, duration / 2);
    const delay = Math.max(0, Math.round(clip.startMs));
    const label = `a${i}`;
    const filters = [
      `[${inputIndex}:a]`,
      `atrim=start=${fmt(offset)}:duration=${fmt(duration)}`,
      "asetpts=PTS-STARTPTS",
      `volume=${fmt(clip.volume)}`,
    ];
    if (fadeIn > 0) filters.push(`afade=t=in:st=0:d=${fmt(fadeIn)}`);
    if (fadeOut > 0) filters.push(`afade=t=out:st=${fmt(Math.max(0, duration - fadeOut))}:d=${fmt(fadeOut)}`);
    filters.push(`adelay=${delay}|${delay}`);
    filterParts.push(`${filters.join(",")}[${label}]`);
    mixLabels.push(`[${label}]`);
  }

  filterParts.push(`${mixLabels.join("")}amix=inputs=${mixLabels.length}:duration=longest:normalize=0[aout]`);
  return {
    inputs,
    output: [
      "-filter_complex", filterParts.join(";"),
      "-map", "0:v:0",
      "-map", "[aout]",
      "-c:a", "aac",
      "-b:a", "192k",
      "-shortest",
    ],
  };
}

function extensionForPath(path: string) {
  const clean = path.split(/[\\/]/).pop() ?? "audio";
  const dot = clean.lastIndexOf(".");
  const ext = dot >= 0 ? clean.slice(dot).toLowerCase() : ".wav";
  return /^[.][a-z0-9]+$/.test(ext) ? ext : ".wav";
}

function fmt(n: number) {
  return Number.isFinite(n) ? n.toFixed(3).replace(/0+$/, "").replace(/[.]$/, "") : "0";
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
