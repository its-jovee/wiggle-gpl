import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const outDir = join(tmpdir(), "wigostudio-brush-presets-test");

function compileBrushPresets() {
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
    "src/core/brushPresets.ts",
  ], { stdio: "inherit" });
}

compileBrushPresets();
const types = await import(`${outDir}/types.js`);
const presets = await import(`${outDir}/brushPresets.js`);

test("v7 project migrates to current version with empty project brush presets", () => {
  const migrated = types.migrateProject({
    version: 7,
    width: 1080,
    height: 1920,
    wiggleFps: 8,
    panels: [types.newPanel()],
    audio: { sampleRate: 48000, assets: [], tracks: [] },
  });

  assert.equal(migrated.version, 13);
  assert.deepEqual(migrated.brushPresets, []);
});

test("brush presets normalize apply update delete and round-trip", () => {
  const preset = presets.normalizeBrushPreset({
    id: "p1",
    name: "Sketch",
    brush: "pencil",
    size: 12,
    settings: {
      spacingScale: 9,
      flow: -1,
      pressureSize: false,
      pressureFlow: true,
    },
  });

  assert.deepEqual(presets.applyBrushPreset(preset), {
    brush: "pencil",
    size: 12,
    settings: {
      spacingScale: 3,
      flow: 0.1,
      pressureSize: false,
      pressureFlow: true,
    },
  });

  const updated = presets.upsertBrushPreset([preset], {
    ...preset,
    name: "Sketch 2",
    size: 4,
  });
  assert.equal(updated.length, 1);
  assert.equal(updated[0].name, "Sketch 2");
  assert.equal(updated[0].size, 4);

  const roundTrip = JSON.parse(JSON.stringify(updated));
  assert.deepEqual(roundTrip, updated);
  assert.deepEqual(presets.deleteBrushPreset(updated, "p1"), []);
});

test("brush presets allow hairline sizes down to 0.1", () => {
  const hairline = presets.normalizeBrushPreset({
    id: "thin",
    name: "Hairline",
    brush: "ink",
    size: 0.1,
  });
  assert.equal(hairline.size, 0.1);

  const half = presets.normalizeBrushPreset({ size: 0.5 });
  assert.equal(half.size, 0.5);

  const clamped = presets.normalizeBrushPreset({ size: 0 });
  assert.equal(clamped.size, 0.1);
});
