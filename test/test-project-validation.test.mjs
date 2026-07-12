import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const outDir = join(tmpdir(), "wigglestudio-project-validation-test");

function compileProjectValidation() {
  rmSync(outDir, { recursive: true, force: true });
  execFileSync("npx", [
    "tsc",
    "--outDir", outDir,
    "--module", "commonjs",
    "--moduleResolution", "node",
    "--target", "ES2020",
    "--lib", "ES2020,DOM",
    "--skipLibCheck",
    "--esModuleInterop",
    "--noEmit", "false",
    "src/core/audioTypes.ts",
    "src/core/types.ts",
    "src/core/brushSettings.ts",
    "src/core/projectValidation.ts",
  ], { stdio: "inherit" });
}

compileProjectValidation();
const types = await import(`${outDir}/types.js`);
const validation = await import(`${outDir}/projectValidation.js`);

function baseProject() {
  return types.newProject();
}

test("validateProject accepts a fresh default project", () => {
  assert.deepEqual(validation.validateProject(baseProject()), { ok: true });
});

test("newProject includes default drawing smoothing settings", () => {
  assert.deepEqual(baseProject().drawingSettings.smoothing, {
    mode: "off",
    distance: 24,
    delayDistance: 16,
    finishStabilizedStroke: true,
    smoothPressure: false,
  });
});

test("new tone layer stores static manga texture settings", () => {
  const tone = types.newLayer("Manga tone", "tone");
  assert.equal(tone.kind, "tone");
  assert.deepEqual(tone.tone, {
    style: "halftone",
    color: "#202020",
    spacing: 18,
    size: 5,
    angle: 45,
  });
});

test("validateProject rejects oversized dimensions", () => {
  const project = baseProject();
  project.width = validation.MAX_PROJECT_DIMENSION + 1;
  const result = validation.validateProject(project);
  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /width/);
});

test("validateProject rejects too many panels", () => {
  const project = baseProject();
  while (project.panels.length <= validation.MAX_PANELS) {
    project.panels.push(types.newPanel());
  }
  const result = validation.validateProject(project);
  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /panels exceeds max/);
});

test("validateProject rejects too many stroke points", () => {
  const project = baseProject();
  project.panels[0].layers[0].strokes.push({
    brush: "round",
    color: "#fff",
    size: 4,
    points: Array.from({ length: validation.MAX_POINTS_PER_STROKE + 1 }, (_, i) => ({ x: i, y: 0 })),
  });
  const result = validation.validateProject(project);
  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /points exceeds max/);
});

test("capProjectFillLimits clamps fill tolerance and gap close", () => {
  const project = baseProject();
  project.panels[0].layers[0].fills.push({
    point: { x: 10, y: 10 },
    color: "#fff",
    seed: 1,
    afterStrokeIndex: 0,
    tolerance: 999,
    gapClosePx: 999,
  });
  validation.capProjectFillLimits(project);
  const fill = project.panels[0].layers[0].fills[0];
  assert.equal(fill.tolerance, validation.MAX_FILL_TOLERANCE);
  assert.equal(fill.gapClosePx, validation.MAX_FILL_GAP_CLOSE);
  assert.deepEqual(validation.validateProject(project), { ok: true });
});

test("capProjectDrawingSettings clamps smoothing controls", () => {
  const project = baseProject();
  project.drawingSettings.smoothing.distance = -30;
  project.drawingSettings.smoothing.delayDistance = 500;
  validation.capProjectDrawingSettings(project);

  assert.equal(project.drawingSettings.smoothing.distance, 1);
  assert.equal(project.drawingSettings.smoothing.delayDistance, 128);
  assert.deepEqual(validation.validateProject(project), { ok: true });
});

test("migrateProject caps fill limits and validates", () => {
  const migrated = types.migrateProject({
    version: 8,
    width: 1080,
    height: 1920,
    wiggleFps: 8,
    brushPresets: [],
    panels: [{
      ...types.newPanel(),
      layers: [{
        ...types.newLayer(),
        fills: [{
          point: { x: 1, y: 1 },
          color: "#000",
          seed: 2,
          afterStrokeIndex: 0,
          tolerance: 200,
          gapClosePx: 200,
        }],
      }],
    }],
    audio: { sampleRate: 48000, assets: [], tracks: [] },
  });
  assert.equal(migrated.panels[0].layers[0].fills[0].tolerance, validation.MAX_FILL_TOLERANCE);
  assert.equal(migrated.panels[0].layers[0].fills[0].gapClosePx, validation.MAX_FILL_GAP_CLOSE);
});

test("migrateProject backfills and clamps drawing smoothing settings", () => {
  const migrated = types.migrateProject({
    version: 8,
    width: 1080,
    height: 1920,
    wiggleFps: 8,
    brushPresets: [],
    drawingSettings: {
      smoothing: {
        mode: "stabilizer",
        distance: 999,
        delayDistance: -10,
        finishStabilizedStroke: false,
        smoothPressure: true,
      },
    },
    panels: [types.newPanel()],
    audio: { sampleRate: 48000, assets: [], tracks: [] },
  });

  assert.deepEqual(migrated.drawingSettings.smoothing, {
    mode: "stabilizer",
    distance: 128,
    delayDistance: 1,
    finishStabilizedStroke: false,
    smoothPressure: true,
  });
});

test("migrateProject clamps stroke and preset brush settings", () => {
  const invalidBrushSettings = {
    spacingScale: 99,
    flow: -2,
    pressureSize: false,
    pressureFlow: true,
  };
  const panel = types.newPanel();
  panel.layers[0].strokes.push({
    brush: "round",
    color: "#ffffff",
    size: 2,
    brushSettings: { ...invalidBrushSettings },
    points: [{ x: 1, y: 1 }],
  });
  panel.subPanels = [{
    id: "sub-1",
    bounds: { x: 0, y: 0, w: 100, h: 100 },
    shape: "rect",
    border: { brush: "round", color: "#ffffff", thickness: 2, wiggleAmplitude: 2 },
    bg: null,
    layers: [{
      ...types.newLayer(),
      strokes: [{
        brush: "round",
        color: "#ffffff",
        size: 2,
        brushSettings: { ...invalidBrushSettings },
        points: [{ x: 2, y: 2 }],
      }],
    }],
    activeLayerIndex: 0,
  }];

  const migrated = types.migrateProject({
    version: 8,
    width: 1080,
    height: 1920,
    wiggleFps: 8,
    brushPresets: [{
      id: "preset-1",
      name: "Bad Preset",
      brush: "round",
      size: 2,
      settings: { ...invalidBrushSettings },
    }],
    drawingSettings: types.newDrawingSettings(),
    panels: [panel],
    audio: { sampleRate: 48000, assets: [], tracks: [] },
  });

  const expected = {
    spacingScale: 3,
    flow: 0.1,
    pressureSize: false,
    pressureFlow: true,
  };
  assert.deepEqual(migrated.panels[0].layers[0].strokes[0].brushSettings, expected);
  assert.deepEqual(migrated.panels[0].subPanels[0].layers[0].strokes[0].brushSettings, expected);
  assert.deepEqual(migrated.brushPresets[0].settings, expected);
});

test("migrateProject throws on invalid dimensions", () => {
  assert.throws(
    () => types.migrateProject({
      version: 8,
      width: 99999,
      height: 1080,
      wiggleFps: 8,
      brushPresets: [],
      panels: [types.newPanel()],
      audio: { sampleRate: 48000, assets: [], tracks: [] },
    }),
    /invalid project/
  );
});
