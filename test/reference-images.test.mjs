import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const outDir = join(tmpdir(), "wigostudio-reference-images-test");

function compile() {
  rmSync(outDir, { recursive: true, force: true });
  execFileSync("npx", [
    "tsc",
    "--ignoreConfig",
    "--outDir", outDir,
    "--module", "commonjs",
    "--target", "ES2020",
    "--lib", "ES2020,DOM",
    "--skipLibCheck",
    "--esModuleInterop",
    "--noEmit", "false",
    "src/core/audioTypes.ts",
    "src/core/types.ts",
    "src/core/brushSettings.ts",
    "src/core/projectValidation.ts",
    "src/core/rasterImport.ts",
    "src/core/strokeSmoothing.ts",
    "src/core/panelStack.ts",
  ], { stdio: "inherit" });
}

compile();
const types = await import(`${outDir}/types.js`);
const validation = await import(`${outDir}/projectValidation.js`);
const rasterImport = await import(`${outDir}/rasterImport.js`);

const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

test("newProject is v13 with an empty referenceImages list", () => {
  const project = types.newProject();
  assert.equal(project.version, 13);
  assert.deepEqual(project.referenceImages, []);
});

test("migrateProject v12 backfills empty referenceImages", () => {
  const migrated = types.migrateProject({
    version: 12,
    width: 1080,
    height: 1920,
    wiggleFps: 8,
    panels: [{
      id: "p1",
      durationMs: 1000,
      bg: "#ffffff",
      paletteId: null,
      layers: [{
        id: "l1", name: "Layer 1", visible: true, opacity: 1,
        blendMode: "normal", strokes: [], fills: [],
      }],
      stack: [{ kind: "layer", id: "l1" }],
    }],
    brushPresets: [],
    drawingSettings: {
      smoothing: {
        mode: "off", distance: 24, delayDistance: 16,
        finishStabilizedStroke: true, smoothPressure: false,
      },
    },
  });
  assert.equal(migrated.version, 13);
  assert.deepEqual(migrated.referenceImages, []);
});

test("reference images round-trip through migrate + validate", () => {
  const project = types.newProject();
  project.referenceImages = [
    types.newReferenceImage("Moodboard", TINY_PNG, 1, 1, -200, 40, 2),
  ];
  assert.deepEqual(validation.validateProject(project), { ok: true });

  const roundTripped = types.migrateProject(JSON.parse(JSON.stringify(project)));
  assert.equal(roundTripped.version, 13);
  assert.equal(roundTripped.referenceImages.length, 1);
  assert.equal(roundTripped.referenceImages[0].name, "Moodboard");
  assert.equal(roundTripped.referenceImages[0].x, -200);
  assert.equal(roundTripped.referenceImages[0].scale, 2);
  assert.equal(roundTripped.referenceImages[0].data, TINY_PNG);
});

test("isBlankQuickStartProject is false once a reference is attached", () => {
  const blank = types.newProject();
  assert.equal(types.isBlankQuickStartProject(blank), true);
  blank.referenceImages.push(
    types.newReferenceImage("Ref", TINY_PNG, 1, 1, 0, 0, 1)
  );
  assert.equal(types.isBlankQuickStartProject(blank), false);
});

test("validateProject rejects oversized reference lists and bad data URLs", () => {
  const project = types.newProject();
  project.referenceImages = Array.from({ length: validation.MAX_REFERENCE_IMAGES + 1 }, (_, i) =>
    types.newReferenceImage(`R${i}`, TINY_PNG, 1, 1, 0, 0, 1)
  );
  const tooMany = validation.validateProject(project);
  assert.equal(tooMany.ok, false);
  assert.match(tooMany.errors.join("; "), /reference images exceeds max/);

  project.referenceImages = [
    { ...types.newReferenceImage("Bad", "data:image/jpeg;base64,AAA", 1, 1, 0, 0, 1) },
  ];
  const badMime = validation.validateProject(project);
  assert.equal(badMime.ok, false);
  assert.match(badMime.errors.join("; "), /PNG data URL/);
});

test("referenceImageName mirrors raster naming with a Reference default", () => {
  assert.equal(rasterImport.referenceImageName({ name: "pose.png", type: "image/png" }), "pose");
  assert.equal(rasterImport.referenceImageName({ name: "image.jpg", type: "image/jpeg" }), "Reference");
});
