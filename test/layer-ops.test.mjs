import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const outDir = join(tmpdir(), "wigglestudio-layer-ops-test");

function compileLayerOps() {
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
    "src/core/layerOps.ts",
  ], { stdio: "inherit" });
}

compileLayerOps();
const ops = await import(`${outDir}/layerOps.js`);

function layer(id, extra = {}) {
  return {
    id,
    name: id,
    visible: true,
    opacity: 1,
    blendMode: "normal",
    kind: "draw",
    strokes: [],
    fills: [],
    ...extra,
  };
}

test("duplicateLayer inserts a renamed copy above the active layer", () => {
  const layers = [layer("base"), layer("active", {
    strokes: [{ brush: "round", color: "#fff", size: 2, points: [{ x: 1, y: 2 }] }],
    texts: [{ id: "t1", x: 1, y: 2, content: "hi", fontFamily: "sans", fontSize: 12, color: "#fff", wiggleAmplitude: 0 }],
  })];

  const nextIndex = ops.duplicateLayer(layers, 1, () => "new-id");

  assert.equal(nextIndex, 2);
  assert.equal(layers.length, 3);
  assert.equal(layers[2].id, "new-id");
  assert.equal(layers[2].name, "active copy");
  assert.notEqual(layers[2].strokes[0], layers[1].strokes[0]);
  assert.equal(layers[2].texts[0].id, "new-id");
});

test("pasteLayerAbove inserts a deep copy and regenerates nested ids", () => {
  const layers = [layer("target")];
  const source = layer("source", {
    strokes: [{ brush: "round", color: "#fff", size: 2, points: [{ x: 1, y: 2 }] }],
    texts: [{ id: "text-source", x: 1, y: 2, content: "hi", fontFamily: "sans", fontSize: 12, color: "#fff", wiggleAmplitude: 0 }],
  });
  const generated = ["layer-copy", "text-copy"];

  const nextIndex = ops.pasteLayerAbove(layers, 0, source, () => generated.shift());

  assert.equal(nextIndex, 1);
  assert.equal(layers[1].id, "layer-copy");
  assert.equal(layers[1].name, "source copy");
  assert.equal(layers[1].texts[0].id, "text-copy");
  assert.notEqual(layers[1].strokes[0], source.strokes[0]);
});

test("pasteLayerAbove can seed an empty layer stack", () => {
  const layers = [];

  const nextIndex = ops.pasteLayerAbove(layers, 0, layer("source"), () => "layer-copy");

  assert.equal(nextIndex, 0);
  assert.equal(layers[0].id, "layer-copy");
});

test("clearLayerContents removes drawable items but preserves layer settings", () => {
  const l = layer("active", {
    opacity: 0.5,
    blendMode: "multiply",
    mask: { enabled: true, mode: "reveal", shape: { kind: "rect", x: 0, y: 0, w: 10, h: 10 } },
    strokes: [{ brush: "round", color: "#fff", size: 2, points: [{ x: 1, y: 2 }] }],
    fills: [{ point: { x: 3, y: 4 }, color: "#fff", seed: 1, afterStrokeIndex: 0 }],
    texts: [{ id: "t1", x: 1, y: 2, content: "hi", fontFamily: "sans", fontSize: 12, color: "#fff", wiggleAmplitude: 0 }],
  });

  ops.clearLayerContents(l);

  assert.equal(l.opacity, 0.5);
  assert.equal(l.blendMode, "multiply");
  assert.equal(l.mask.enabled, true);
  assert.deepEqual(l.strokes, []);
  assert.deepEqual(l.fills, []);
  assert.deepEqual(l.texts, []);
});

test("mergeLayerDown concatenates active draw contents into the layer below", () => {
  const layers = [
    layer("below", { strokes: [{ brush: "round", color: "#111", size: 1, points: [{ x: 0, y: 0 }] }] }),
    layer("active", {
      strokes: [{ brush: "round", color: "#fff", size: 2, points: [{ x: 1, y: 2 }] }],
      fills: [{ point: { x: 3, y: 4 }, color: "#fff", seed: 1, afterStrokeIndex: 0 }],
    }),
  ];

  const result = ops.mergeLayerDown(layers, 1);

  assert.deepEqual(result, { merged: true, activeIndex: 0 });
  assert.equal(layers.length, 1);
  assert.equal(layers[0].strokes.length, 2);
  assert.equal(layers[0].fills.length, 1);
});

test("mergeLayerDown refuses unsafe active layers", () => {
  const layers = [
    layer("below"),
    layer("active", { opacity: 0.5 }),
  ];

  const result = ops.mergeLayerDown(layers, 1);

  assert.equal(result.merged, false);
  assert.equal(result.reason, "unsafe");
  assert.equal(layers.length, 2);
});
