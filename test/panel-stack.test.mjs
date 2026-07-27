import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const outDir = join(tmpdir(), "wigostudio-panel-stack-test");

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
    "src/core/types.ts",
    "src/core/audioTypes.ts",
    "src/core/panelStack.ts",
    "src/core/panelOps.ts",
  ], { stdio: "inherit" });
}

compile();
const stack = await import(`${outDir}/panelStack.js`);
const types = await import(`${outDir}/types.js`);
const ops = await import(`${outDir}/panelOps.js`);

test("default stack is layers then subpanels", () => {
  const panel = {
    layers: [{ id: "l1" }, { id: "l2" }],
    subPanels: [{ id: "s1" }],
  };
  assert.deepEqual(stack.defaultPanelStack(panel), [
    { kind: "layer", id: "l1" },
    { kind: "layer", id: "l2" },
    { kind: "subpanel", id: "s1" },
  ]);
});

test("moveStackItem can place a layer above a subpanel", () => {
  const panel = {
    layers: [
      { id: "l1", name: "A", visible: true, opacity: 1, strokes: [], fills: [] },
      { id: "l2", name: "B", visible: true, opacity: 1, strokes: [], fills: [] },
    ],
    subPanels: [{
      id: "s1",
      bounds: { x: 0, y: 0, w: 10, h: 10 },
      shape: "rect",
      border: { brush: "round", color: "#000", thickness: 2, wiggleAmplitude: 1 },
      bg: null,
      layers: [],
    }],
    stack: [
      { kind: "layer", id: "l1" },
      { kind: "layer", id: "l2" },
      { kind: "subpanel", id: "s1" },
    ],
    activeLayerIndex: 1,
  };
  // Move l2 (index 1) above s1 → after s1 in bottom→top order: l1, s1, l2
  assert.equal(stack.moveStackItem(panel, 1, 2), true);
  assert.deepEqual(panel.stack, [
    { kind: "layer", id: "l1" },
    { kind: "subpanel", id: "s1" },
    { kind: "layer", id: "l2" },
  ]);
  assert.deepEqual(panel.layers.map((l) => l.id), ["l1", "l2"]);
  assert.deepEqual(panel.subPanels.map((s) => s.id), ["s1"]);
});

test("migrateProject v10 fills stack with legacy order and nests through to current", () => {
  const migrated = types.migrateProject({
    version: 10,
    width: 100,
    height: 100,
    wiggleFps: 8,
    panels: [{
      id: "p1",
      durationMs: 1000,
      bg: "#fff",
      paletteId: null,
      layers: [{
        id: "l1", name: "Layer 1", visible: true, opacity: 1,
        strokes: [], fills: [],
      }],
      subPanels: [{
        id: "s1",
        bounds: { x: 0, y: 0, w: 10, h: 10 },
        shape: "rect",
        border: { brush: "round", color: "#000", thickness: 2, wiggleAmplitude: 1 },
        bg: null,
        layers: [{
          id: "sl1", name: "Layer 1", visible: true, opacity: 1,
          strokes: [], fills: [],
        }],
      }],
    }],
    brushPresets: [],
    drawingSettings: { smoothing: { enabled: true, strength: 0.5, window: 1, cornerPreserve: 0.5 } },
  });
  assert.equal(migrated.version, 13);
  assert.deepEqual(migrated.panels[0].stack, [
    { kind: "layer", id: "l1" },
    { kind: "subpanel", id: "s1" },
  ]);
  const sp = migrated.panels[0].subPanels[0];
  assert.deepEqual(sp.subPanels, []);
  assert.deepEqual(sp.stack, [{ kind: "layer", id: "sl1" }]);
});

test("stack helpers work on a nested SubPanel container", () => {
  const child = {
    id: "child",
    bounds: { x: 5, y: 5, w: 20, h: 20 },
    shape: "rect",
    border: { brush: "round", color: "#000", thickness: 1, wiggleAmplitude: 0 },
    bg: null,
    layers: [{ id: "cl", name: "C", visible: true, opacity: 1, strokes: [], fills: [] }],
    subPanels: [],
    stack: [{ kind: "layer", id: "cl" }],
  };
  const parent = {
    id: "parent",
    bounds: { x: 0, y: 0, w: 40, h: 40 },
    shape: "rect",
    border: { brush: "round", color: "#000", thickness: 1, wiggleAmplitude: 0 },
    bg: null,
    layers: [{ id: "pl", name: "P", visible: true, opacity: 1, strokes: [], fills: [] }],
    subPanels: [child],
    stack: [
      { kind: "layer", id: "pl" },
      { kind: "subpanel", id: "child" },
    ],
  };
  assert.deepEqual(stack.resolvedPanelStack(parent), parent.stack);
  assert.equal(stack.moveStackItem(parent, 0, 1), true);
  assert.deepEqual(parent.stack, [
    { kind: "subpanel", id: "child" },
    { kind: "layer", id: "pl" },
  ]);
});

test("walkSubPanels / findSubPanelPath / sanitizeSubPanelPath", () => {
  const panel = {
    subPanels: [{
      id: "a",
      subPanels: [{ id: "b", subPanels: [{ id: "c", subPanels: [] }] }],
    }],
  };
  const ids = [];
  stack.walkSubPanels(panel, (sp, path, depth) => {
    ids.push([sp.id, path.join("/"), depth]);
  });
  assert.deepEqual(ids, [
    ["a", "a", 0],
    ["b", "a/b", 1],
    ["c", "a/b/c", 2],
  ]);
  assert.deepEqual(stack.findSubPanelPath(panel, "c"), ["a", "b", "c"]);
  assert.equal(stack.subPanelAtPath(panel, ["a", "b"]).id, "b");
  assert.deepEqual(stack.sanitizeSubPanelPath(panel, ["a", "missing", "c"]), ["a"]);
  assert.equal(stack.countSubPanels(panel), 3);
  assert.equal(stack.maxSubPanelDepth(panel), 3);
});

test("panel duplicate remaps stack ids", () => {
  const source = {
    id: "panel-a",
    durationMs: 750,
    bg: "#111",
    paletteId: null,
    activeLayerIndex: 0,
    layers: [{
      id: "layer-a",
      name: "Ink",
      visible: true,
      opacity: 1,
      strokes: [],
      fills: [],
    }],
    subPanels: [{
      id: "sub-a",
      bounds: { x: 1, y: 1, w: 10, h: 10 },
      shape: "rect",
      border: { brush: "pen", color: "#fff", thickness: 1, wiggleAmplitude: 1 },
      bg: null,
      layers: [{
        id: "sub-layer-a",
        name: "Sub",
        visible: true,
        opacity: 1,
        strokes: [],
        fills: [],
      }],
    }],
    stack: [
      { kind: "layer", id: "layer-a" },
      { kind: "subpanel", id: "sub-a" },
    ],
  };
  let n = 0;
  const copy = ops.clonePanelForDuplicate(source, () => `new-${++n}`);
  assert.equal(copy.stack[0].kind, "layer");
  assert.equal(copy.stack[0].id, copy.layers[0].id);
  assert.equal(copy.stack[1].kind, "subpanel");
  assert.equal(copy.stack[1].id, copy.subPanels[0].id);
  assert.notEqual(copy.stack[0].id, "layer-a");
  assert.notEqual(copy.stack[1].id, "sub-a");
});

test("subPanelLabel distinguishes manga frames from speech balloons", () => {
  const frame = {
    id: "f1",
    bounds: { x: 0, y: 0, w: 100, h: 100 },
    shape: "rect",
    border: { brush: "round", color: "#000", thickness: 2, wiggleAmplitude: 1 },
    bg: null,
    layers: [],
  };
  const balloon = { ...frame, id: "b1", shape: "balloon" };
  assert.equal(stack.subPanelLabel(frame), "Sub-Panel (Rect)");
  assert.equal(stack.subPanelLabel(balloon), "Balloon (Balloon)");
});
