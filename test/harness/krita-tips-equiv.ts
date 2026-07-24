// Browser harness for kritaTips + raster-only availability (Phase 1).
import {
  __resetKritaTipCachesForTests,
  scatterOffset,
  stampGeneratedTip,
  stampHardDisc,
  stampSprayParticles,
  unit01,
} from "../../src/brushes/kritaTips";
import {
  isBrushAvailable,
  resolveBrushForLayer,
} from "../../src/brushes/groups";
import type { Brush, BrushContext } from "../../src/brushes/registry";

declare global {
  interface Window {
    __kritaTipsReady?: boolean;
    runKritaTipsTests?: () => string[];
  }
}

function hashCanvas(canvas: HTMLCanvasElement): string {
  const data = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
  let h = 2166136261;
  for (let i = 0; i < data.length; i++) {
    h ^= data[i];
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

function makeCtx(size = 64): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  return { canvas, ctx: canvas.getContext("2d")! };
}

function baseBrush(ctx: CanvasRenderingContext2D, seed = 7): BrushContext {
  return {
    ctx,
    pos: { x: 32, y: 32 },
    delta: { x: 1, y: 0.2 },
    color: "#c44",
    size: 2,
    tick: 3,
    seed,
    bg: "#000",
    pressure: 1,
    flow: 1,
    dist: 10,
  };
}

function runKritaTipsTests(): string[] {
  const failures: string[] = [];
  __resetKritaTipCachesForTests();

  // Deterministic unit noise / scatter
  const a = unit01(1, 2, 3);
  const b = unit01(1, 2, 3);
  if (a !== b) failures.push("unit01 not deterministic");
  const s1 = scatterOffset(4, 9, 0, 10);
  const s2 = scatterOffset(4, 9, 0, 10);
  if (s1.x !== s2.x || s1.y !== s2.y) failures.push("scatterOffset not deterministic");
  const s3 = scatterOffset(4, 9, 1, 10);
  if (s3.x === s1.x && s3.y === s1.y) failures.push("scatterOffset expected variation by index");

  // Identical tip stamps → identical pixels
  const A = makeCtx();
  const B = makeCtx();
  stampGeneratedTip(baseBrush(A.ctx), "chalkGrain", 14, 0.8, { angle: 0.3 });
  stampGeneratedTip(baseBrush(B.ctx), "chalkGrain", 14, 0.8, { angle: 0.3 });
  if (hashCanvas(A.canvas) !== hashCanvas(B.canvas)) {
    failures.push("stampGeneratedTip not deterministic");
  }

  // Different seed → different pixels (noise spin + tip variant)
  const C = makeCtx();
  stampGeneratedTip(baseBrush(C.ctx, 99), "chalkGrain", 14, 0.8);
  if (hashCanvas(A.canvas) === hashCanvas(C.canvas)) {
    failures.push("stampGeneratedTip expected seed variation");
  }

  // Explicit angle override is stable across seeds when variant collides —
  // spray particles must still vary by seed.
  const sprayA = makeCtx(96);
  const sprayB = makeCtx(96);
  stampSprayParticles(baseBrush(sprayA.ctx, 2), 28, 12, 2);
  stampSprayParticles(baseBrush(sprayB.ctx, 50), 28, 12, 2);
  if (hashCanvas(sprayA.canvas) === hashCanvas(sprayB.canvas)) {
    failures.push("stampSprayParticles expected seed variation");
  }

  // Hard disc + spray bounds
  const D = makeCtx();
  stampHardDisc(baseBrush(D.ctx), 8);
  const dData = D.canvas.getContext("2d")!.getImageData(0, 0, 64, 64).data;
  let painted = false;
  for (let i = 3; i < dData.length; i += 4) {
    if (dData[i] !== 0) { painted = true; break; }
  }
  if (!painted) failures.push("hard disc produced empty canvas");

  const E = makeCtx(128);
  let fills = 0;
  const sprayCtx = E.ctx;
  const origFill = sprayCtx.fill.bind(sprayCtx);
  sprayCtx.fill = (...args: Parameters<CanvasRenderingContext2D["fill"]>) => {
    fills++;
    return origFill(...args);
  };
  stampSprayParticles(baseBrush(sprayCtx), 40, 200, 2);
  if (fills > 48) failures.push(`spray particle count unbounded: ${fills}`);
  if (fills < 1) failures.push("spray produced no particles");

  // Availability / fallback (mock raster-only brush injected via resolve path)
  const mock: Brush = {
    key: "krita.testProbe",
    label: "Probe",
    spacing: 2,
    rasterOnly: true,
    stamp: () => {},
  };
  if (isBrushAvailable(mock, "draw")) failures.push("rasterOnly should be unavailable on draw");
  if (!isBrushAvailable(mock, "raster")) failures.push("rasterOnly should be available on raster");

  // Existing brushes remain available on draw layers
  const round = resolveBrushForLayer("round", "draw");
  if (round.changed || round.brush.key !== "round") {
    failures.push("round should remain available on draw layers");
  }
  const missing = resolveBrushForLayer("does-not-exist-brush", "draw");
  if (!missing.changed || missing.brush.key !== "round") {
    failures.push("missing brush should fall back safely");
  }

  return failures;
}

window.runKritaTipsTests = runKritaTipsTests;
window.__kritaTipsReady = true;
