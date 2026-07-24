import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const outDir = join(tmpdir(), "wigglestudio-render-test");

function compileRender() {
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
    "src/core/render.ts",
  ], { stdio: "inherit" });
}

function strokeWithLength(length) {
  return {
    brush: "pencil",
    color: "#ffffff",
    size: 1,
    points: [{ x: 0, y: 0 }, { x: length, y: 0 }],
  };
}

function layer(name, length) {
  return {
    id: name,
    name,
    visible: true,
    opacity: 1,
    strokes: [strokeWithLength(length)],
    fills: [],
  };
}

compileRender();
const render = await import(`${outDir}/core/render.js`);

test("timelapse spends reveal budget from UI top layer to bottom layer", () => {
  const layers = [
    layer("Color", 10),
    layer("Shadow", 5),
    layer("Lineart", 2),
  ];

  assert.equal(typeof render.allocateTimelapseLayerBudgets, "function");

  assert.deepEqual(render.allocateTimelapseLayerBudgets(layers, 2 / 17), [0, 0, 2]);
  assert.deepEqual(render.allocateTimelapseLayerBudgets(layers, 7 / 17), [0, 5, 2]);
  assert.deepEqual(render.allocateTimelapseLayerBudgets(layers, 1), [10, 5, 2]);
});
