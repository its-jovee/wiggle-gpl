import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const outDir = join(tmpdir(), "wigostudio-selection-test");

function compileSelection() {
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
    "src/core/input.ts",
    "src/core/selection.ts",
  ], { stdio: "inherit" });
}

compileSelection();
const sel = await import(`${outDir}/selection.js`);

test("pointInShape rect", () => {
  const shape = { kind: "rect", x: 10, y: 20, w: 100, h: 50 };
  assert.equal(sel.pointInShape({ x: 50, y: 40 }, shape), true);
  assert.equal(sel.pointInShape({ x: 5, y: 40 }, shape), false);
});

test("pointInShape ellipse", () => {
  const shape = { kind: "ellipse", cx: 50, cy: 50, rx: 40, ry: 20 };
  assert.equal(sel.pointInShape({ x: 50, y: 50 }, shape), true);
  assert.equal(sel.pointInShape({ x: 91, y: 50 }, shape), false);
});

test("pointInLayerMask follows reveal and hide modes", () => {
  const shape = { kind: "rect", x: 10, y: 20, w: 100, h: 50 };
  const reveal = { enabled: true, mode: "reveal", shape };
  const hide = { enabled: true, mode: "hide", shape };

  assert.equal(sel.pointInLayerMask({ x: 50, y: 40 }, reveal), true);
  assert.equal(sel.pointInLayerMask({ x: 5, y: 40 }, reveal), false);
  assert.equal(sel.pointInLayerMask({ x: 50, y: 40 }, hide), false);
  assert.equal(sel.pointInLayerMask({ x: 5, y: 40 }, hide), true);
  assert.equal(sel.pointInLayerMask({ x: 50, y: 40 }, { ...reveal, enabled: false }), true);
});

test("activeRegionContains honors inverted region selections", () => {
  const state = {
    mode: "region",
    phase: "idle",
    tool: "rect",
    shape: { kind: "rect", x: 10, y: 20, w: 100, h: 50 },
    inverted: true,
    featherPx: 0,
  };

  assert.equal(sel.activeRegionContains(state, { x: 50, y: 40 }), false);
  assert.equal(sel.activeRegionContains(state, { x: 5, y: 40 }), true);
});

test("growSelectionShape expands rect and ellipse exactly", () => {
  assert.deepEqual(
    sel.growSelectionShape({ kind: "rect", x: 10, y: 20, w: 100, h: 50 }, 8),
    { kind: "rect", x: 2, y: 12, w: 116, h: 66 }
  );
  assert.deepEqual(
    sel.growSelectionShape({ kind: "ellipse", cx: 50, cy: 50, rx: 20, ry: 10 }, -4),
    { kind: "ellipse", cx: 50, cy: 50, rx: 16, ry: 6 }
  );
});

test("splitStrokeAtShape keeps inside segments", () => {
  const stroke = {
    brush: "pen", color: "#fff", size: 2,
    points: [
      { x: 0, y: 50 },
      { x: 100, y: 50 },
    ],
  };
  const shape = { kind: "rect", x: 40, y: 0, w: 20, h: 100 };
  const { inside, outside } = sel.splitStrokeAtShape(stroke, shape);
  assert.equal(inside.length, 1);
  assert.equal(outside.length, 2);
  assert.ok(inside[0].points.length >= 2);
});

test("splitStrokeAtShape copies brushSettings to split segments", () => {
  const settings = { spacingScale: 1.2, flow: 0.8, pressureSize: true, pressureFlow: false };
  const stroke = {
    brush: "pen", color: "#fff", size: 2,
    erase: true,
    brushSettings: settings,
    points: [{ x: 0, y: 50 }, { x: 100, y: 50 }],
  };
  const shape = { kind: "rect", x: 40, y: 0, w: 20, h: 100 };
  const { inside, outside } = sel.splitStrokeAtShape(stroke, shape);
  assert.deepEqual(inside[0].brushSettings, settings);
  assert.deepEqual(outside[0].brushSettings, settings);
  assert.deepEqual(outside[1].brushSettings, settings);
  assert.equal(inside[0].erase, true);
  assert.equal(outside[0].erase, true);
  assert.equal(outside[1].erase, true);
});

test("shapeMeetsMinSize", () => {
  assert.equal(sel.shapeMeetsMinSize({ kind: "rect", x: 0, y: 0, w: 5, h: 5 }), false);
  assert.equal(sel.shapeMeetsMinSize({ kind: "rect", x: 0, y: 0, w: 20, h: 20 }), true);
});

test("marquee drag modifiers constrain shape and draw from center", () => {
  assert.deepEqual(
    sel.rectFromDrag({ x: 50, y: 50 }, { x: 70, y: 60 }, true, false),
    { kind: "rect", x: 50, y: 50, w: 20, h: 20 }
  );
  assert.deepEqual(
    sel.rectFromDrag({ x: 50, y: 50 }, { x: 70, y: 60 }, false, true),
    { kind: "rect", x: 30, y: 40, w: 40, h: 20 }
  );
  assert.deepEqual(
    sel.ellipseFromDrag({ x: 50, y: 50 }, { x: 30, y: 60 }, true, true),
    { kind: "ellipse", cx: 50, cy: 50, rx: 20, ry: 20 }
  );
});

test("marquee ants use a stable time-based phase", () => {
  assert.equal(sel.marqueeAntsOffset(0), 0);
  assert.equal(sel.marqueeAntsOffset(250), 6);
  assert.equal(sel.marqueeAntsOffset(500), 0);
});

test("transformPoint scales around pivot", () => {
  const p = sel.transformPoint({ x: 20, y: 10 }, { x: 10, y: 10 }, 0.5, 0.5, 0);
  assert.equal(p.x, 15);
  assert.equal(p.y, 10);
});

test("transformCursorForHandle maps handles to Photoshop-like cursors", () => {
  assert.equal(sel.transformCursorForHandle("nw"), "nwse-resize");
  assert.equal(sel.transformCursorForHandle("se"), "nwse-resize");
  assert.equal(sel.transformCursorForHandle("ne"), "nesw-resize");
  assert.equal(sel.transformCursorForHandle("sw"), "nesw-resize");
  assert.equal(sel.transformCursorForHandle("n"), "ns-resize");
  assert.equal(sel.transformCursorForHandle("s"), "ns-resize");
  assert.equal(sel.transformCursorForHandle("e"), "ew-resize");
  assert.equal(sel.transformCursorForHandle("w"), "ew-resize");
  assert.match(sel.transformCursorForHandle("rotate"), /^url\("data:image\/svg\+xml,/);
  assert.match(sel.transformCursorForHandle("rotate"), /, grab$/);
});

test("transform handle geometry stays aligned across zoom levels", () => {
  assert.equal(sel.transformHandleVisualHalfSize(1), 6);
  assert.equal(sel.transformHandleVisualHalfSize(0.5), 12);
  assert.deepEqual(
    sel.transformRotateHandleCenter({ x: 50, y: 100, w: 40, h: 20 }, 1),
    { x: 70, y: 64 }
  );
  assert.deepEqual(
    sel.transformRotateHandleCenter({ x: 50, y: 100, w: 40, h: 20 }, 0.5),
    { x: 70, y: 28 }
  );
});

test("rotate knob and stem hit; north edge handle still scales", () => {
  const bounds = { x: 100, y: 200, w: 200, h: 100 };
  for (const scale of [0.5, 1, 2]) {
    const rot = sel.transformRotateHandleCenter(bounds, scale);
    assert.equal(sel.hitTestTransformHandle(rot, bounds, scale), "rotate");
    // Midpoint of the stem between the top edge and the knob.
    const stem = { x: rot.x, y: (bounds.y + rot.y) / 2 };
    assert.equal(sel.hitTestTransformHandle(stem, bounds, scale), "rotate");
    // Exact top-center still scales via the north edge handle.
    assert.equal(
      sel.hitTestTransformHandle({ x: bounds.x + bounds.w / 2, y: bounds.y }, bounds, scale),
      "n"
    );
  }
});

test("rotate handle hit sits outside the selection bounds", () => {
  const bounds = { x: 100, y: 200, w: 200, h: 80 };
  const rot = sel.transformRotateHandleCenter(bounds, 1);
  assert.ok(rot.y < bounds.y);
  assert.equal(sel.hitTestTransformHandle(rot, bounds, 1), "rotate");
  // A point above the box but off the stem/knob is outside transform chrome.
  assert.equal(
    sel.hitTestTransformHandle({ x: bounds.x - 40, y: rot.y }, bounds, 1),
    null
  );
});

test("transform round-trip halves bounds", () => {
  const snap = {
    ref: {
      kind: "stroke",
      layer: { strokes: [] },
      stroke: {
        brush: "pen", color: "#fff", size: 4,
        points: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
      },
    },
    strokePoints: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
    strokeSize: 4,
  };
  const pivot = { x: 50, y: 0 };
  sel.applyTransformToSnapshot(snap, pivot, 0.5, 0.5, 0, false);
  assert.equal(snap.ref.stroke.points[1].x, 75);
  assert.equal(snap.ref.stroke.size, 2);
});

test("raster selection snapshots move, scale, and rotate pixel frames", () => {
  const selection = {
    layer: { id: "raster", kind: "raster", strokes: [], fills: [] },
    pixels: {},
    base: {},
    frame: { x: 10, y: 20, w: 40, h: 20 },
    rotation: 0,
  };
  const ref = { kind: "raster", layer: selection.layer, selection };
  const [snap] = sel.snapshotItems([ref]);

  sel.applyTransformToSnapshot(snap, { x: 30, y: 30 }, 2, 0.5, Math.PI / 2, true);

  assert.deepEqual(selection.frame, { x: -10, y: 25, w: 80, h: 10 });
  assert.equal(selection.rotation, Math.PI / 2);
  const rotatedBounds = sel.boundsFromItems([ref]);
  assert.ok(Math.abs(rotatedBounds.x - 25) < 1e-9);
  assert.equal(rotatedBounds.y, -10);
  assert.ok(Math.abs(rotatedBounds.w - 10) < 1e-9);
  assert.equal(rotatedBounds.h, 80);

  sel.restoreFromSnapshot(snap);
  sel.moveMarqueeItems([ref], 7, -3);
  assert.deepEqual(selection.frame, { x: 17, y: 17, w: 40, h: 20 });
  assert.equal(selection.rotation, 0);
});

test("simplifyLassoPath reduces noisy path", () => {
  const pts = [
    { x: 0, y: 0 },
    { x: 1, y: 0.2 },
    { x: 2, y: 0 },
    { x: 0, y: 10 },
    { x: 10, y: 10 },
    { x: 10, y: 0 },
  ];
  const out = sel.simplifyLassoPath(pts, 2);
  assert.ok(out.length < pts.length);
  assert.ok(out.length >= 3);
});
