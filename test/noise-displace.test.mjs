import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const outDir = join(tmpdir(), "wigostudio-noise-displace-test");

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
    "src/core/rng.ts",
    "src/core/noiseDisplace.ts",
  ], { stdio: "inherit" });
}

compile();
const nd = await import(`${outDir}/noiseDisplace.js`);

test("cellDisplaceOffset is deterministic for identical seeds", () => {
  const a = nd.cellDisplaceOffset(3, 42, 1, 2, 8, 1);
  const b = nd.cellDisplaceOffset(3, 42, 1, 2, 8, 1);
  assert.deepEqual(a, b);
});

test("cellDisplaceOffset changes with tick", () => {
  const a = nd.cellDisplaceOffset(0, 42, 1, 2, 8, 1);
  const b = nd.cellDisplaceOffset(1, 42, 1, 2, 8, 1);
  assert.notDeepEqual(a, b);
});

test("fractional displacement speed holds deterministic phases", () => {
  const phase0 = nd.cellDisplaceOffset(0, 42, 1, 2, 8, 0.25);
  assert.deepEqual(nd.cellDisplaceOffset(3, 42, 1, 2, 8, 0.25), phase0);
  assert.notDeepEqual(nd.cellDisplaceOffset(4, 42, 1, 2, 8, 0.25), phase0);
});

test("fast displacement speed advances deterministic phases", () => {
  assert.deepEqual(
    nd.cellDisplaceOffset(1, 42, 1, 2, 8, 3),
    nd.cellDisplaceOffset(3, 42, 1, 2, 8, 1)
  );
});

test("activeNoiseDisplace gates on kind, enabled, and skipJitter", () => {
  const raster = {
    id: "r1",
    kind: "raster",
    noiseDisplace: { enabled: true, amplitude: 6, cellSize: 48, speed: 1 },
  };
  const draw = {
    id: "d1",
    kind: "draw",
    noiseDisplace: { enabled: true, amplitude: 6, cellSize: 48, speed: 1 },
  };
  assert.ok(nd.activeNoiseDisplace(raster, false));
  assert.equal(nd.activeNoiseDisplace(raster, true), null);
  assert.equal(nd.activeNoiseDisplace(draw, false), null);
  assert.equal(nd.activeNoiseDisplace({ ...raster, noiseDisplace: { ...raster.noiseDisplace, enabled: false } }, false), null);
});

test("layerSupportsNoiseDisplace only raster and tone", () => {
  assert.equal(nd.layerSupportsNoiseDisplace({ kind: "raster" }), true);
  assert.equal(nd.layerSupportsNoiseDisplace({ kind: "tone" }), true);
  assert.equal(nd.layerSupportsNoiseDisplace({ kind: "draw" }), false);
  assert.equal(nd.layerSupportsNoiseDisplace({ kind: "text" }), false);
  assert.equal(nd.layerSupportsNoiseDisplace({}), false);
});

test("applyNoiseDisplaceToPanelLayers skips draw and respects includeTone", () => {
  const raster = { id: "r1", kind: "raster" };
  const tone = { id: "t1", kind: "tone" };
  const draw = { id: "d1", kind: "draw" };
  const settings = { enabled: false, amplitude: 12, cellSize: 32, speed: 2 };

  const withoutTone = nd.applyNoiseDisplaceToPanelLayers(
    [raster, tone, draw],
    settings,
    { includeTone: false, enabled: true }
  );
  assert.deepEqual(withoutTone.map((l) => l.id), ["r1"]);
  assert.equal(raster.noiseDisplace.enabled, true);
  assert.equal(raster.noiseDisplace.amplitude, 12);
  assert.equal(tone.noiseDisplace, undefined);
  assert.equal(draw.noiseDisplace, undefined);

  const withTone = nd.applyNoiseDisplaceToPanelLayers(
    [raster, tone, draw],
    settings,
    { includeTone: true, enabled: true }
  );
  assert.deepEqual(withTone.map((l) => l.id), ["r1", "t1"]);
  assert.equal(tone.noiseDisplace.enabled, true);
  assert.equal(tone.noiseDisplace.cellSize, 32);
  assert.equal(tone.noiseDisplace.speed, 2);
});

test("applyNoiseDisplaceToPanelLayers clear keeps amp/cell/speed", () => {
  const raster = {
    id: "r1",
    kind: "raster",
    noiseDisplace: { enabled: true, amplitude: 10, cellSize: 24, speed: 1.5 },
  };
  const tone = {
    id: "t1",
    kind: "tone",
    noiseDisplace: { enabled: true, amplitude: 4, cellSize: 64, speed: 0.5 },
  };
  const bare = { id: "r2", kind: "raster" };
  const changed = nd.applyNoiseDisplaceToPanelLayers(
    [raster, tone, bare],
    { enabled: true, amplitude: 99, cellSize: 8, speed: 3 },
    { includeTone: true, enabled: false }
  );
  assert.deepEqual(changed.map((l) => l.id), ["r1", "t1"]);
  assert.equal(raster.noiseDisplace.enabled, false);
  assert.equal(raster.noiseDisplace.amplitude, 10);
  assert.equal(raster.noiseDisplace.cellSize, 24);
  assert.equal(raster.noiseDisplace.speed, 1.5);
  assert.equal(tone.noiseDisplace.enabled, false);
  assert.equal(tone.noiseDisplace.amplitude, 4);
  assert.equal(bare.noiseDisplace, undefined);
});
