// Browser harness for Phase 2 Krita-inspired raster brushes.
import { brushByKey, BRUSHES } from "../../src/brushes/registry";
import {
  brushesForTool,
  isBrushKeyAvailable,
  resolveBrushForLayer,
} from "../../src/brushes/groups";
import { effectiveBrushSettings, DEFAULT_BRUSH_SETTINGS } from "../../src/core/brushSettings";
import { RasterStrokeSession } from "../../src/core/rasterEditing";

declare global {
  interface Window {
    __kritaRasterReady?: boolean;
    runKritaRasterTests?: () => string[];
  }
}

const PHASE2_KEYS = [
  "krita.quick",
  "krita.pixelHard",
  "krita.pixelSoft",
  "krita.pixelArt",
  "krita.inkPrecision",
  "krita.inkFineliner",
  "krita.inkGpen",
  "krita.markerChisel",
  "krita.markerDry",
  "krita.pencilHard",
  "krita.pencilSoft",
  "krita.paintTextured",
  "krita.eraserHard",
  "krita.eraserSoft",
];

function hashCanvas(canvas: HTMLCanvasElement): string {
  const data = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
  let h = 2166136261;
  for (let i = 0; i < data.length; i++) {
    h ^= data[i];
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

function paintStroke(
  brushKey: string,
  opts: {
    pressure?: number;
    flow?: number;
    pressureSize?: boolean;
    pressureFlow?: boolean;
    eraseOverlay?: boolean;
  } = {}
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 96;
  canvas.height = 48;
  const ctx = canvas.getContext("2d")!;
  if (opts.eraseOverlay) {
    ctx.fillStyle = "#336699";
    ctx.fillRect(0, 0, 96, 48);
  }
  const brush = brushByKey(brushKey);
  const session = new RasterStrokeSession(
    ctx,
    brush,
    {
      color: "#cc3355",
      size: 3,
      erase: brush.erase === true,
      brushSettings: {
        ...DEFAULT_BRUSH_SETTINGS,
        flow: opts.flow ?? 1,
        pressureSize: opts.pressureSize ?? true,
        pressureFlow: opts.pressureFlow ?? false,
      },
    },
    0,
    3,
    "#ffffff",
    { x: 8, y: 24 },
    opts.pressure ?? 1
  );
  session.append({ x: 88, y: 24 }, opts.pressure ?? 1);
  return canvas;
}

function alphaSum(canvas: HTMLCanvasElement): number {
  const data = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
  let sum = 0;
  for (let i = 3; i < data.length; i += 4) sum += data[i];
  return sum;
}

function runKritaRasterTests(): string[] {
  const failures: string[] = [];

  for (const key of PHASE2_KEYS) {
    const brush = BRUSHES.find((b) => b.key === key);
    if (!brush) {
      failures.push(`missing brush ${key}`);
      continue;
    }
    if (!brush.rasterOnly) failures.push(`${key} should be rasterOnly`);
  }

  // Hidden on draw, visible on raster
  if (isBrushKeyAvailable("krita.quick", "draw")) {
    failures.push("krita.quick should be unavailable on draw layers");
  }
  if (!isBrushKeyAvailable("krita.quick", "raster")) {
    failures.push("krita.quick should be available on raster layers");
  }
  const fallback = resolveBrushForLayer("krita.quick", "draw");
  if (!fallback.changed || fallback.brush.rasterOnly) {
    failures.push("raster-only brush should fall back on draw layers");
  }
  const drawClassic = brushesForTool("classic", "draw").some((b) => b.key.startsWith("krita."));
  if (drawClassic) failures.push("classic tool on draw should omit krita.* brushes");
  const rasterClassic = brushesForTool("classic", "raster").some((b) => b.key === "krita.quick");
  if (!rasterClassic) failures.push("classic tool on raster should include krita.quick");

  // Determinism
  const a = paintStroke("krita.pixelHard");
  const b = paintStroke("krita.pixelHard");
  if (hashCanvas(a) !== hashCanvas(b)) failures.push("pixelHard not deterministic");

  // Pressure size: low pressure paints less coverage when pressureSize on
  const hi = paintStroke("krita.inkGpen", { pressure: 1, pressureSize: true });
  const lo = paintStroke("krita.inkGpen", { pressure: 0.2, pressureSize: true });
  if (alphaSum(hi) <= alphaSum(lo)) {
    failures.push("pressure size should increase coverage at higher pressure");
  }

  // Pressure flow
  const flowHi = paintStroke("krita.pixelSoft", {
    pressure: 1,
    pressureSize: false,
    pressureFlow: true,
  });
  const flowLo = paintStroke("krita.pixelSoft", {
    pressure: 0.15,
    pressureSize: false,
    pressureFlow: true,
  });
  if (alphaSum(flowHi) <= alphaSum(flowLo)) {
    failures.push("pressure flow should increase coverage at higher pressure");
  }

  // Phase 3 chalk: pressure + determinism
  for (const key of ["krita.chalkSoft", "krita.chalkGrainy", "krita.chalkDetail", "krita.charcoalStick"]) {
    const brush = BRUSHES.find((b) => b.key === key);
    if (!brush?.rasterOnly) failures.push(`${key} missing or not rasterOnly`);
  }
  const chalkA = paintStroke("krita.chalkGrainy", { pressure: 0.9 });
  const chalkB = paintStroke("krita.chalkGrainy", { pressure: 0.9 });
  if (hashCanvas(chalkA) !== hashCanvas(chalkB)) failures.push("chalkGrainy not deterministic");
  const chalkHi = paintStroke("krita.chalkSoft", {
    pressure: 1,
    pressureSize: false,
    pressureFlow: true,
  });
  const chalkLo = paintStroke("krita.chalkSoft", {
    pressure: 0.2,
    pressureSize: false,
    pressureFlow: true,
  });
  if (alphaSum(chalkHi) <= alphaSum(chalkLo)) {
    failures.push("chalk soft pressure/flow should increase coverage");
  }

  // Phase 4 spray: bounded + deterministic + seed variation
  for (const key of ["krita.spray", "krita.sprayTexture", "krita.sprayDots"]) {
    const brush = BRUSHES.find((b) => b.key === key);
    if (!brush?.rasterOnly) failures.push(`${key} missing or not rasterOnly`);
  }
  if (!isBrushKeyAvailable("krita.spray", "raster") || isBrushKeyAvailable("krita.spray", "draw")) {
    failures.push("spray should be raster-gated");
  }
  const sprayA = paintStroke("krita.spray", { pressure: 1 });
  const sprayB = paintStroke("krita.spray", { pressure: 1 });
  if (hashCanvas(sprayA) !== hashCanvas(sprayB)) failures.push("spray not deterministic");

  // Large size stays bounded: stamp with huge size and count fills via helper cap
  {
    const canvas = document.createElement("canvas");
    canvas.width = 160;
    canvas.height = 160;
    const ctx = canvas.getContext("2d")!;
    let fills = 0;
    const orig = ctx.fill.bind(ctx);
    ctx.fill = (...args: Parameters<CanvasRenderingContext2D["fill"]>) => {
      fills++;
      return orig(...args);
    };
    brushByKey("krita.spray").stamp({
      ctx,
      pos: { x: 80, y: 80 },
      delta: { x: 1, y: 0 },
      color: "#f00",
      size: 40,
      tick: 1,
      seed: 2,
      bg: "#000",
      pressure: 1,
      flow: 1,
    });
    if (fills > 48) failures.push(`spray unbounded at large size: ${fills}`);
    if (fills < 1) failures.push("large spray produced no particles");
  }

  // Phase 5 hatch/grid: deterministic per-dab stamps
  for (const key of [
    "krita.hatchParallel",
    "krita.hatchCross",
    "krita.hatchFollow",
    "krita.gridBasic",
  ]) {
    const brush = BRUSHES.find((b) => b.key === key);
    if (!brush?.rasterOnly) failures.push(`${key} missing or not rasterOnly`);
  }
  const hatchA = paintStroke("krita.hatchCross");
  const hatchB = paintStroke("krita.hatchCross");
  if (hashCanvas(hatchA) !== hashCanvas(hatchB)) failures.push("hatchCross not deterministic");
  const gridA = paintStroke("krita.gridBasic");
  const gridB = paintStroke("krita.gridBasic");
  if (hashCanvas(gridA) !== hashCanvas(gridB)) failures.push("gridBasic not deterministic");

  // Phase 6 bristle / tangent normal
  for (const key of ["krita.bristle", "krita.tangentNormal"]) {
    const brush = BRUSHES.find((b) => b.key === key);
    if (!brush?.rasterOnly) failures.push(`${key} missing or not rasterOnly`);
  }
  const bristleA = paintStroke("krita.bristle");
  const bristleB = paintStroke("krita.bristle");
  if (hashCanvas(bristleA) !== hashCanvas(bristleB)) failures.push("bristle not deterministic");

  // Bristle work stays bounded at large size
  {
    let strokes = 0;
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext("2d")!;
    const orig = ctx.stroke.bind(ctx);
    ctx.stroke = (...args: Parameters<CanvasRenderingContext2D["stroke"]>) => {
      strokes++;
      return orig(...args);
    };
    brushByKey("krita.bristle").stamp({
      ctx,
      pos: { x: 64, y: 64 },
      delta: { x: 1, y: 0.2 },
      color: "#321",
      size: 30,
      tick: 2,
      seed: 5,
      bg: "#fff",
      pressure: 1,
      flow: 1,
    });
    if (strokes > 18) failures.push(`bristle unbounded at large size: ${strokes}`);
  }

  // Tangent normal encodes direction into RGB (not stroke color)
  {
    const canvas = document.createElement("canvas");
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext("2d")!;
    brushByKey("krita.tangentNormal").stamp({
      ctx,
      pos: { x: 16, y: 16 },
      delta: { x: 1, y: 0 },
      color: "#ff00ff",
      size: 4,
      tick: 1,
      seed: 1,
      bg: "#000",
      pressure: 1,
      flow: 1,
    });
    const px = ctx.getImageData(16, 16, 1, 1).data;
    // Heading 0 → +X normal → R high, G mid, B mid-high
    if (px[0] < 180) failures.push(`tangentNormal expected high R for +X, got ${px[0]}`);
    if (Math.abs(px[0] - px[2]) < 10) failures.push("tangentNormal RGB channels look flat");
  }

  // Eraser compositing punches existing pixels
  const erased = paintStroke("krita.eraserHard", { eraseOverlay: true });
  const mid = erased.getContext("2d")!.getImageData(40, 20, 16, 8).data;
  let punched = false;
  for (let i = 3; i < mid.length; i += 4) {
    if (mid[i] < 200) { punched = true; break; }
  }
  if (!punched) failures.push("eraserHard should punch destination-out holes");

  // Existing brush lookup still safe
  if (brushByKey("round").key !== "round") failures.push("round lookup broken");
  if (brushByKey("missing_legacy").key !== "round") {
    failures.push("missing brush should fall back to round");
  }

  // effective settings still apply
  const eff = effectiveBrushSettings(2, 3, {
    ...DEFAULT_BRUSH_SETTINGS,
    pressureSize: true,
    pressureFlow: true,
    flow: 0.5,
  });
  if (eff.stampSize(3, 0.5) >= eff.stampSize(3, 1)) {
    failures.push("effective stampSize pressure curve broken");
  }
  if (eff.stampFlow(0.5) >= eff.stampFlow(1)) {
    failures.push("effective stampFlow pressure curve broken");
  }

  return failures;
}

window.runKritaRasterTests = runKritaRasterTests;
window.__kritaRasterReady = true;
