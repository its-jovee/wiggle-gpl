// Safety harness for the pipelined export frame staging.
//
// stageFramesForFFmpeg overlaps each frame's PNG encode with the previous
// frame's wasm FS write. That is only correct if writes still land in strict
// frame order and each frame's bytes are the ones that frame rendered — a
// misordered or cross-wired pipeline would silently scramble exported video.
//
// This drives the real function against a stub ffmpeg that records the order
// and payload of every write, then compares against a strictly serial
// reference render of the same project.
import { stageFramesForFFmpeg } from "../../src/core/export";
import type { Layer, Panel, Project } from "../../src/core/types";

const WIDTH = 80;
const HEIGHT = 140;
const FPS = 10;

function project(): Project {
  const layer: Layer = {
    id: "ink",
    name: "Ink",
    visible: true,
    opacity: 1,
    kind: "draw",
    // A moving stroke, so consecutive frames genuinely differ and a swapped
    // pair would be detectable.
    strokes: [{ brush: "round", color: "#101020", size: 6, points: [
      { x: 10, y: 20 }, { x: 60, y: 60 }, { x: 20, y: 120 },
    ] }],
    fills: [],
  };
  const panel: Panel = {
    id: "p0", durationMs: 1000, bg: "#ffffff", paletteId: null, layers: [layer],
  };
  return {
    version: 5, width: WIDTH, height: HEIGHT, wiggleFps: 8,
    panels: [panel], audio: { tracks: [] },
  } as unknown as Project;
}

function stage() {
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  return { canvas, ctx: canvas.getContext("2d")! };
}

function hash(bytes: Uint8Array): string {
  let h = 2166136261;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

async function runExportPipelineTests(): Promise<string[]> {
  const failures: string[] = [];
  const proj = project();
  const totalFrames = 12;
  const target = { project: proj, panelIndex: 0, contentVersion: 0, skipJitter: false };

  // --- pipelined run -------------------------------------------------------
  const writes: { name: string; hash: string }[] = [];
  const ffmpeg = {
    async writeFile(name: string, data: Uint8Array) {
      // Uneven delays make an order bug far more likely to surface than a
      // uniform stub would.
      await new Promise((r) => setTimeout(r, name.endsWith("3.png") ? 12 : 1));
      writes.push({ name, hash: hash(data) });
    },
  };
  const seen: number[] = [];
  const s = stage();
  await stageFramesForFFmpeg(
    ffmpeg, s.ctx, s.canvas, target, totalFrames, FPS, proj.panels[0].durationMs,
    (done) => seen.push(done),
    undefined
  );

  // Names must be strictly ascending and complete.
  const expectedNames = Array.from({ length: totalFrames },
    (_, i) => `frame${String(i).padStart(5, "0")}.png`);
  const gotNames = writes.map((w) => w.name);
  if (gotNames.join(",") !== expectedNames.join(",")) {
    failures.push(`write order wrong:\n  got ${gotNames.join(",")}\n  want ${expectedNames.join(",")}`);
  }
  if (seen.length !== totalFrames) {
    failures.push(`progress fired ${seen.length}x, expected ${totalFrames}`);
  }

  // --- strictly serial reference -------------------------------------------
  const refWrites: { name: string; hash: string }[] = [];
  const refFfmpeg = {
    async writeFile(name: string, data: Uint8Array) {
      refWrites.push({ name, hash: hash(data) });
    },
  };
  const s2 = stage();
  await stageFramesForFFmpeg(
    refFfmpeg, s2.ctx, s2.canvas, target, totalFrames, FPS, proj.panels[0].durationMs,
    () => {},
    undefined
  );

  for (let i = 0; i < totalFrames; i++) {
    if (writes[i]?.hash !== refWrites[i]?.hash) {
      failures.push(
        `frame ${i} bytes differ from serial reference ` +
        `(pipelined ${writes[i]?.hash}, serial ${refWrites[i]?.hash})`
      );
    }
  }
  // Guard against a degenerate test where every frame renders identically.
  if (new Set(refWrites.map((w) => w.hash)).size < 2) {
    failures.push("reference frames are all identical — test cannot detect misordering");
  }

  // --- cancellation --------------------------------------------------------
  {
    let calls = 0;
    const s3 = stage();
    let threw = "";
    try {
      await stageFramesForFFmpeg(
        { async writeFile() { calls++; } }, s3.ctx, s3.canvas, target,
        totalFrames, FPS, proj.panels[0].durationMs, () => {},
        () => calls >= 3
      );
    } catch (err) {
      threw = (err as Error).name;
    }
    if (threw !== "AbortError") failures.push(`cancel should throw AbortError, got "${threw}"`);
  }

  return failures;
}

declare global {
  interface Window {
    __exportPipelineReady?: boolean;
    runExportPipelineTests?: () => Promise<string[]>;
  }
}

window.runExportPipelineTests = runExportPipelineTests;
window.__exportPipelineReady = true;
