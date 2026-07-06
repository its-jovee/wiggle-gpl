// ============================================================================
// core/export.ts — render the sequence to video at 1080x1920.
//
// TWO PATHS:
//   exportWebM()  — MediaRecorder, ~real-time capture. Good for quick previews.
//   exportMP4()   — deterministic frame-by-frame → ffmpeg.wasm → H.264 MP4.
//                   Frame-accurate TikTok output; no MediaRecorder timing drift.
//                   ffmpeg core loads from public/ffmpeg/ (same-origin, bundled
//                   at build time from @ffmpeg/core — see scripts/copy-ffmpeg.mjs).
// ============================================================================

import { Project } from "./types";
import { renderPanel, clearTimelapseCache } from "./render";
import { timelapseProgressQuantized } from "./renderSchedule";
import { expandedDurationMs, sequenceAtTime } from "./sequence";
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
};

export type MP4ExportOptions = {
  includeAudioTail?: boolean;
  contentVersion?: number;
  onProgressEvent?: ExportProgressCallback;
  shouldCancel?: () => boolean;
};

/** Offscreen canvas at full TikTok resolution. */
function makeStage(project: Project) {
  const canvas = document.createElement("canvas");
  canvas.width = project.width;
  canvas.height = project.height;
  const ctx = canvas.getContext("2d")!;
  return { canvas, ctx };
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
        const { index, localMs } = sequenceAtTime(project, elapsed);
        const panel = project.panels[index];
        const tick = Math.floor((localMs / 1000) * project.wiggleFps);
        renderPanel(ctx, panel, tick, project.width, project.height, {
          allPanels: project.panels,
          timelapseProgress: panel.kind === "timelapse"
            ? timelapseProgressQuantized(localMs, panel.durationMs, project.wiggleFps) : undefined,
          localMs,
          wiggleFps: project.wiggleFps,
          contentVersion,
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
    const visualMs = expandedDurationMs(project);
    const audioMs = totalAudioDuration(project.audio);
    const totalMs = opts?.includeAudioTail ? Math.max(visualMs, audioMs) : visualMs;
    const totalFrames = Math.round((totalMs / 1000) * exportFps);
    const contentVersion = opts?.contentVersion ?? 0;

    // Lazy-load ffmpeg so it doesn't bloat initial page load.
    const { FFmpeg } = await import("@ffmpeg/ffmpeg");
    const { fetchFile, toBlobURL } = await import("@ffmpeg/util");
    const ffmpeg = new FFmpeg();
    const base = new URL("ffmpeg/", window.location.href).href;
    await ffmpeg.load({
      coreURL: await toBlobURL(`${base}ffmpeg-core.js`, "text/javascript"),
      wasmURL: await toBlobURL(`${base}ffmpeg-core.wasm`, "application/wasm"),
    });

    for (let f = 0; f < totalFrames; f++) {
      if (opts?.shouldCancel?.()) throw new DOMException("Export cancelled", "AbortError");
      const elapsedMs = (f / exportFps) * 1000;
      const visualElapsedMs = Math.min(elapsedMs, Math.max(0, visualMs - 1));
      const { index, localMs } = sequenceAtTime(project, visualElapsedMs);
      const panel = project.panels[index];
      // Deterministic tick: derived purely from time, never from a wall clock.
      const tick = Math.floor((localMs / 1000) * project.wiggleFps);
      renderPanel(ctx, panel, tick, project.width, project.height, {
        allPanels: project.panels,
        timelapseProgress: panel.kind === "timelapse"
          ? timelapseProgressQuantized(localMs, panel.durationMs, project.wiggleFps) : undefined,
        localMs,
        wiggleFps: project.wiggleFps,
        contentVersion,
      });

      const blob: Blob = await new Promise((r) => canvas.toBlob((b) => r(b!), "image/png"));
      const name = `frame${String(f).padStart(5, "0")}.png`;
      await ffmpeg.writeFile(name, await fetchFile(blob));
      progress.render((f + 1) / totalFrames, f + 1, totalFrames);
    }

    const audioArgs = await writeAudioInputs(ffmpeg, project);
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
