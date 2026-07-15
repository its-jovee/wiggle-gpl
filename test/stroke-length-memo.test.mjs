import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const outDir = join(tmpdir(), "wigglestudio-stroke-length-memo-test");

function compile() {
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
    "src/core/render.ts",
    "src/core/layerVersion.ts",
  ], { stdio: "inherit" });
}

compile();
const render = await import(`${outDir}/core/render.js`);
const layerVersion = await import(`${outDir}/core/layerVersion.js`);

function strokeWithLength(length) {
  return {
    brush: "pencil",
    color: "#ffffff",
    size: 1,
    points: [{ x: 0, y: 0 }, { x: length, y: 0 }],
  };
}

function layer(strokeLengths) {
  return {
    id: "l1",
    name: "l1",
    visible: true,
    opacity: 1,
    strokes: strokeLengths.map(strokeWithLength),
    fills: [],
  };
}

test("computeLayerStrokeLength returns the same cached value until the layer version bumps", () => {
  const l = layer([10, 5]);
  assert.equal(render.computeLayerStrokeLength(l), 15);

  // Mutate strokes in place without bumping the version — memo should still
  // return the stale (cached) length.
  l.strokes.push(strokeWithLength(100));
  assert.equal(render.computeLayerStrokeLength(l), 15);

  layerVersion.bumpLayerVersion(l);
  assert.equal(render.computeLayerStrokeLength(l), 115);
});

test("computeLayerStrokeLength memo is keyed per layer object (WeakMap)", () => {
  const a = layer([3]);
  const b = layer([7]);
  assert.equal(render.computeLayerStrokeLength(a), 3);
  assert.equal(render.computeLayerStrokeLength(b), 7);
  assert.equal(render.computeLayerStrokeLength(a), 3);
});
