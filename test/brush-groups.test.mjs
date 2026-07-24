import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const outDir = join(tmpdir(), "wigglestudio-brush-groups-test");

function compileGroups() {
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
    "src/brushes/groups.ts",
  ], { stdio: "inherit" });
}

compileGroups();
const groups = await import(`${outDir}/brushes/groups.js`);
const registry = await import(`${outDir}/brushes/registry.js`);

test("brush tools split classic texture scatter and eraser brushes", () => {
  assert.deepEqual(groups.BRUSH_TOOLS.map((tool) => tool.key), [
    "classic",
    "texture",
    "scatter",
    "eraser",
  ]);

  assert.equal(groups.brushToolForKey("round"), "classic");
  assert.equal(groups.brushToolForKey("watercolor"), "texture");
  assert.equal(groups.brushToolForKey("spray"), "scatter");
  assert.equal(groups.brushToolForKey("eraser"), "eraser");
  assert.equal(groups.brushToolForKey("eraser_grain"), "eraser");
});

test("scatter tool excludes erasers and eraser tool includes both erasers", () => {
  assert.deepEqual(
    groups.brushesForTool("scatter").map((brush) => brush.key),
    ["spray", "glitter", "cloud", "foliage"]
  );
  assert.deepEqual(
    groups.brushesForTool("eraser").map((brush) => brush.key),
    ["eraser", "eraser_grain"]
  );
});

test("tool defaults choose the first brush from each tool", () => {
  assert.equal(groups.defaultBrushForTool("classic").key, "round");
  assert.equal(groups.defaultBrushForTool("texture").key, "watercolor");
  assert.equal(groups.defaultBrushForTool("scatter").key, "spray");
  assert.equal(groups.defaultBrushForTool("eraser").key, "eraser");
});

test("raster-only brushes are hidden on draw layers and available on raster", () => {
  const probe = {
    key: "krita.testProbe",
    label: "Probe",
    spacing: 2,
    rasterOnly: true,
    group: "Krita Pixel",
    stamp() {},
  };
  assert.equal(groups.isBrushAvailable(probe, "draw"), false);
  assert.equal(groups.isBrushAvailable(probe, "raster"), true);
  assert.equal(groups.brushToolForBrush(probe), "classic");

  // Inject temporarily into the compiled registry array for resolve tests.
  registry.BRUSHES.push(probe);
  try {
    assert.equal(groups.isBrushKeyAvailable("krita.testProbe", "draw"), false);
    assert.equal(groups.isBrushKeyAvailable("krita.testProbe", "raster"), true);
    const onDraw = groups.resolveBrushForLayer("krita.testProbe", "draw");
    assert.equal(onDraw.changed, true);
    assert.equal(onDraw.brush.rasterOnly, undefined);
    assert.match(onDraw.reason, /raster-only/i);
    const onRaster = groups.resolveBrushForLayer("krita.testProbe", "raster");
    assert.equal(onRaster.changed, false);
    assert.equal(onRaster.brush.key, "krita.testProbe");
  } finally {
    registry.BRUSHES.pop();
  }
});

test("missing brush keys fall back safely for saved-project compatibility", () => {
  const resolved = groups.resolveBrushForLayer("missing_legacy_brush", "draw");
  assert.equal(resolved.changed, true);
  assert.equal(resolved.brush.key, "round");
});

test("phase-2 krita brushes stay raster-gated and map into tool chrome", () => {
  assert.equal(groups.brushToolForKey("krita.quick"), "classic");
  assert.equal(groups.brushToolForKey("krita.paintTextured"), "texture");
  assert.equal(groups.brushToolForKey("krita.eraserHard"), "eraser");
  assert.equal(groups.isBrushKeyAvailable("krita.pixelHard", "draw"), false);
  assert.equal(groups.isBrushKeyAvailable("krita.pixelHard", "raster"), true);
  assert.ok(
    groups.brushesForTool("classic", "raster").some((b) => b.key === "krita.quick")
  );
  assert.ok(
    !groups.brushesForTool("classic", "draw").some((b) => b.key.startsWith("krita."))
  );
});
