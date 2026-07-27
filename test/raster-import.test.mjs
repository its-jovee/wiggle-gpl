import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const outDir = join(tmpdir(), "wigostudio-raster-import-test");

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
  "src/core/rasterImport.ts",
], { stdio: "inherit" });

const rasterImport = await import(`${outDir}/rasterImport.js`);

test("accepts PNG and JPEG clipboard files", () => {
  assert.equal(rasterImport.isSupportedRasterImageFile({ name: "art.png", type: "image/png" }), true);
  assert.equal(rasterImport.isSupportedRasterImageFile({ name: "photo.jpg", type: "image/jpeg" }), true);
  assert.equal(rasterImport.isSupportedRasterImageFile({ name: "photo.jpeg", type: "" }), true);
  assert.equal(rasterImport.isSupportedRasterImageFile({ name: "loop.gif", type: "image/gif" }), false);
});

test("derives a useful raster layer name", () => {
  assert.equal(rasterImport.rasterLayerName({ name: "character.JPG", type: "image/jpeg" }), "character");
  assert.equal(rasterImport.rasterLayerName({ name: "image.png", type: "image/png" }), "Imported image");
  assert.equal(rasterImport.rasterLayerName({ name: "", type: "image/png" }), "Imported image");
});

test("centers small images without upscaling", () => {
  assert.deepEqual(
    rasterImport.containRasterImage(200, 100, 1000, 800),
    { x: 400, y: 350, width: 200, height: 100, scale: 1 }
  );
});

test("contains oversized images while preserving aspect ratio", () => {
  assert.deepEqual(
    rasterImport.containRasterImage(2000, 1000, 1000, 800),
    { x: 0, y: 150, width: 1000, height: 500, scale: 0.5 }
  );
});
