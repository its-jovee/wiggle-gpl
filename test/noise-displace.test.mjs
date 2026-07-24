import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const outDir = join(tmpdir(), "wigglestudio-noise-displace-test");

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
