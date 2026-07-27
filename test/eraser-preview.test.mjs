import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const outDir = join(tmpdir(), "wigostudio-eraser-preview-test");

function compileEraserPreview() {
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
    "src/core/eraserPreview.ts",
    "src/core/types.ts",
  ], { stdio: "inherit" });
}

compileEraserPreview();
const eraserPreview = await import(`${outDir}/eraserPreview.js`);

test("erase preview applies to both eraser brushes only", () => {
  assert.equal(eraserPreview.isErasePreviewBrush({ erase: true }), true);
  assert.equal(eraserPreview.isErasePreviewBrush({ key: "round" }), false);
});

test("eraserPreviewRadius scales with brush size and never drops below 1", () => {
  assert.equal(eraserPreview.eraserPreviewRadius(2), 12);
  assert.equal(eraserPreview.eraserPreviewRadius(0), 1);
});
