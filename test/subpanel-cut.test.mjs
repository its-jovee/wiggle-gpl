import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const outDir = join(tmpdir(), "wigostudio-subpanel-cut-test");

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
    "src/core/rng.ts",
    "src/core/subpanel.ts",
    "src/brushes/registry.ts",
    "src/brushes/textures.ts",
    "src/brushes/kritaRaster.ts",
    "src/brushes/kritaTips.ts",
    "src/brushes/mangaFx.ts",
  ], { stdio: "inherit" });
}

compile();
const sub = await import(`${outDir}/core/subpanel.js`);

const rect = { x: 0, y: 0, w: 100, h: 100 };

test("splitPolygonByLine cuts a rectangle into two polygons", () => {
  const outline = sub.shapePoints("rect", rect);
  const pieces = sub.splitPolygonByLine(outline, { x: 50, y: -10 }, { x: 50, y: 110 });
  assert.ok(pieces);
  const [a, b] = pieces;
  assert.ok(a.length >= 3);
  assert.ok(b.length >= 3);
  assert.ok(Math.abs(sub.polygonArea(a) + sub.polygonArea(b) - 10000) < 1);
});

test("splitPolygonByLine rejects a miss", () => {
  const outline = sub.shapePoints("rect", rect);
  assert.equal(sub.splitPolygonByLine(outline, { x: -10, y: -10 }, { x: -10, y: 110 }), null);
});

test("cutSubPanelGeometry converts outline into two custom pieces", () => {
  const sp = {
    id: "a",
    bounds: { ...rect },
    shape: "rect",
    border: { brush: "round", color: "#000", thickness: 2, wiggleAmplitude: 0 },
    bg: null,
    layers: [],
  };
  const cut = sub.cutSubPanelGeometry(sp, { x: -10, y: 40 }, { x: 110, y: 40 });
  assert.ok(cut);
  sub.applyCustomOutline(sp, cut.first);
  assert.equal(sp.shape, "custom");
  assert.ok(sp.points.length >= 3);
  assert.ok(sp.bounds.w > 0 && sp.bounds.h > 0);
  assert.ok(sub.lineCrossesSubPanel(sp, { x: 50, y: -10 }, { x: 50, y: 110 }));
});

test("isInsideSubPanel uses polygon for custom shapes", () => {
  const sp = {
    bounds: { x: 0, y: 0, w: 100, h: 100 },
    shape: "custom",
    points: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 0, y: 100 },
    ],
  };
  assert.equal(sub.isInsideSubPanel(20, 20, sp), true);
  assert.equal(sub.isInsideSubPanel(80, 80, sp), false);
  assert.equal(sub.isInsideBounds(80, 80, sp.bounds), true);
});

test("translateSubPanel moves custom points with bounds", () => {
  const sp = {
    bounds: { x: 10, y: 20, w: 30, h: 40 },
    points: [{ x: 10, y: 20 }, { x: 40, y: 20 }, { x: 10, y: 60 }],
    tail: { x: 5, y: 5 },
  };
  sub.translateSubPanel(sp, 7, -3);
  assert.deepEqual(sp.bounds, { x: 17, y: 17, w: 30, h: 40 });
  assert.deepEqual(sp.points[0], { x: 17, y: 17 });
  assert.deepEqual(sp.tail, { x: 12, y: 2 });
});
