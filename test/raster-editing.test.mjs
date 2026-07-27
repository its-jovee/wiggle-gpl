import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const outDir = join(tmpdir(), "wigostudio-raster-editing-test");

function compileRasterEditing() {
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
    "src/core/brushSettings.ts",
    "src/core/rasterEditing.ts",
  ], { stdio: "inherit" });
}

compileRasterEditing();
const raster = await import(`${outDir}/core/rasterEditing.js`);

function fakeContext() {
  const stack = [];
  return {
    globalCompositeOperation: "source-over",
    save() {
      stack.push(this.globalCompositeOperation);
    },
    restore() {
      this.globalCompositeOperation = stack.pop() ?? "source-over";
    },
  };
}

const settings = {
  spacingScale: 1,
  flow: 1,
  pressureSize: true,
  pressureFlow: false,
};

test("RasterStrokeSession stamps continuously across appended segments", () => {
  const stamps = [];
  const brush = {
    key: "test",
    label: "Test",
    spacing: 2,
    stamp: (brushContext) => stamps.push({
      x: brushContext.pos.x,
      y: brushContext.pos.y,
      dist: brushContext.dist,
      seed: brushContext.seed,
    }),
  };
  const session = new raster.RasterStrokeSession(
    fakeContext(),
    brush,
    { color: "#fff", size: 1, brushSettings: settings },
    1,
    3,
    "#000",
    { x: 0, y: 0 },
    1
  );

  session.append({ x: 5, y: 0 }, 1);
  session.append({ x: 9, y: 0 }, 1);

  assert.deepEqual(stamps.map((stamp) => stamp.x), [0, 2, 4, 6, 8]);
  assert.deepEqual(stamps.map((stamp) => stamp.dist), [0, 2, 4, 6, 8]);
  assert.equal(session.touched, true);
  assert.equal(stamps[0].seed, 1000300);
  assert.equal(stamps.at(-1).seed, 1000301);
});

test("RasterStrokeSession applies pressure at each direct pixel dab", () => {
  const sizes = [];
  const brush = {
    key: "pressure",
    label: "Pressure",
    spacing: 0.2,
    stamp: (brushContext) => sizes.push(brushContext.size),
  };
  const session = new raster.RasterStrokeSession(
    fakeContext(),
    brush,
    { color: "#fff", size: 10, brushSettings: settings },
    0,
    0,
    "#000",
    { x: 0, y: 0 },
    0.2
  );

  session.append({ x: 5, y: 0 }, 1);

  assert.equal(sizes[0], 2);
  assert.ok(Math.abs(sizes[1] - 5.2) < 1e-9);
  assert.ok(Math.abs(sizes[2] - 8.4) < 1e-9);
});

test("RasterStrokeSession erases with destination-out only while stamping", () => {
  const composites = [];
  const ctx = fakeContext();
  const brush = {
    key: "eraser",
    label: "Eraser",
    spacing: 2,
    erase: true,
    stamp: (brushContext) => composites.push(brushContext.ctx.globalCompositeOperation),
  };

  new raster.RasterStrokeSession(
    ctx,
    brush,
    { color: "#fff", size: 1, brushSettings: settings },
    0,
    0,
    "#000",
    { x: 0, y: 0 },
    1
  );

  assert.deepEqual(composites, ["destination-out"]);
  assert.equal(ctx.globalCompositeOperation, "source-over");
});

test("RasterStrokeSession lets a normal paint brush erase via stroke intent", () => {
  const composites = [];
  const ctx = fakeContext();
  const brush = {
    key: "textured-paint",
    label: "Textured Paint",
    spacing: 2,
    stamp: (brushContext) => composites.push(brushContext.ctx.globalCompositeOperation),
  };

  new raster.RasterStrokeSession(
    ctx,
    brush,
    { color: "#ff00aa", erase: true, size: 1, brushSettings: settings },
    0,
    0,
    "#000",
    { x: 0, y: 0 },
    1
  );

  assert.deepEqual(composites, ["destination-out"]);
  assert.equal(ctx.globalCompositeOperation, "source-over");
});
