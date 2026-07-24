import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const outDir = join(tmpdir(), "wigglestudio-panel-ops-test");

function compilePanelOps() {
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
    "src/core/panelOps.ts",
  ], { stdio: "inherit" });
}

compilePanelOps();
const ops = await import(`${outDir}/panelOps.js`);

function ids() {
  let n = 0;
  return () => `new-${++n}`;
}

function panel() {
  return {
    id: "panel-a",
    durationMs: 750,
    annotation: "Hero: We go at dawn.",
    bg: "#123456",
    paletteId: "pal",
    kind: "normal",
    enter: { kind: "fade", durationTicks: 2 },
    exit: { kind: "pop", durationTicks: 2 },
    activeLayerIndex: 0,
    layers: [{
      id: "layer-a",
      name: "Layer A",
      visible: true,
      opacity: 1,
      kind: "draw",
      strokes: [{ brush: "pen", color: "#fff", size: 4, points: [{ x: 1, y: 2 }] }],
      fills: [],
      texts: [{ id: "text-a", x: 1, y: 2, content: "Hi", fontFamily: "sans", fontSize: 12, color: "#fff", wiggleAmplitude: 1 }],
    }],
    subPanels: [{
      id: "sub-a",
      bounds: { x: 1, y: 1, w: 10, h: 10 },
      shape: "rect",
      border: { brush: "pen", color: "#fff", thickness: 1, wiggleAmplitude: 1 },
      bg: null,
      activeLayerIndex: 0,
      layers: [{
        id: "sub-layer-a",
        name: "Sub Layer",
        visible: true,
        opacity: 1,
        kind: "draw",
        strokes: [],
        fills: [],
      }],
    }],
    guides: [{
      id: "guide-a",
      kind: "1p",
      horizonY: 10,
      vps: [{ x: 5, y: 10 }],
      enabled: true,
      snapEnabled: false,
      opacity: 0.5,
    }],
  };
}

test("blank panels inherit timing and background without drawable content", () => {
  const blank = ops.createBlankPanelFrom(panel(), ids());
  assert.equal(blank.id, "new-1");
  assert.equal(blank.durationMs, 750);
  assert.equal(blank.bg, "#123456");
  assert.equal(blank.paletteId, "pal");
  assert.equal(blank.kind, "normal");
  assert.deepEqual(blank.layers, []);
  assert.deepEqual(blank.subPanels, []);
  assert.equal(blank.annotation, undefined);
  assert.equal(blank.enter, undefined);
});

test("panel duplicate regenerates panel and nested ids", () => {
  const copy = ops.clonePanelForDuplicate(panel(), ids());
  assert.equal(copy.id, "new-1");
  assert.equal(copy.layers[0].id, "new-2");
  assert.equal(copy.layers[0].texts[0].id, "new-3");
  assert.equal(copy.subPanels[0].id, "new-4");
  assert.equal(copy.subPanels[0].layers[0].id, "new-5");
  assert.equal(copy.guides[0].id, "new-6");
  assert.equal(copy.durationMs, 750);
  assert.equal(copy.annotation, "Hero: We go at dawn.");
  assert.equal(copy.enter.kind, "fade");
});

test("panel content paste replaces drawable content but preserves target timing and animations", () => {
  const target = {
    ...panel(),
    id: "target",
    durationMs: 2000,
    annotation: "Keep this target note.",
    bg: "#000000",
    paletteId: null,
    enter: { kind: "jump", durationTicks: 3 },
    exit: undefined,
    layers: [],
    subPanels: [],
    guides: [],
  };

  const clipboard = ops.copyPanelContents(panel());
  ops.pastePanelContents(target, clipboard, ids());

  assert.equal(target.id, "target");
  assert.equal(target.durationMs, 2000);
  assert.equal(target.annotation, "Keep this target note.");
  assert.equal(target.enter.kind, "jump");
  assert.equal(target.bg, "#123456");
  assert.equal(target.paletteId, "pal");
  assert.equal(target.layers[0].id, "new-1");
  assert.equal(target.layers[0].texts[0].id, "new-2");
  assert.equal(target.subPanels[0].id, "new-3");
  assert.equal(target.subPanels[0].layers[0].id, "new-4");
  assert.equal(target.guides[0].id, "new-5");
});

test("panel content paste preserves existing guides when clipboard has none", () => {
  const existingGuides = [{
    id: "guide-keep",
    kind: "1p",
    horizonY: 10,
    vps: [{ x: 5, y: 10 }],
    enabled: true,
    snapEnabled: false,
    opacity: 0.5,
  }];
  const target = {
    ...panel(),
    id: "target",
    guides: existingGuides,
  };
  const source = panel();
  delete source.guides;
  const clipboard = ops.copyPanelContents(source);
  ops.pastePanelContents(target, clipboard, ids());
  assert.deepEqual(target.guides, existingGuides);
});

test("subpanel duplicate regenerates nested text ids", () => {
  const sub = {
    id: "sub-a",
    bounds: { x: 1, y: 1, w: 10, h: 10 },
    shape: "rect",
    border: { brush: "pen", color: "#fff", thickness: 1, wiggleAmplitude: 1 },
    bg: null,
    activeLayerIndex: 0,
    layers: [{
      id: "sub-layer-a",
      name: "Sub Layer",
      visible: true,
      opacity: 1,
      kind: "draw",
      strokes: [],
      fills: [],
      texts: [{ id: "text-nested", x: 1, y: 2, content: "Hi", fontFamily: "sans", fontSize: 12, color: "#fff", wiggleAmplitude: 1 }],
    }],
  };
  const copy = ops.regenerateSubPanelIds(sub, ids());
  assert.equal(copy.id, "new-1");
  assert.equal(copy.layers[0].id, "new-2");
  assert.equal(copy.layers[0].texts[0].id, "new-3");
  assert.notEqual(copy.layers[0].texts[0].id, "text-nested");
});
