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
    "--outDir", outDir,
    "--module", "commonjs",
    "--moduleResolution", "node",
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
