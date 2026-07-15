import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const outDir = join(tmpdir(), "wigglestudio-studio-icons-test");

function compileIcons() {
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
    "src/icons/studio.ts",
  ], { stdio: "inherit" });
}

compileIcons();
const icons = await import(`${outDir}/studio.js`);

const expectedIcons = [
  "BrushClassic",
  "BrushTexture",
  "BrushScatter",
  "Bucket",
  "ClipboardCheck",
  "ClipboardPaste",
  "Clip",
  "Copy",
  "CopyCheck",
  "Eraser",
  "FrameInsertAfter",
  "FrameInsertBefore",
  "Layers",
  "Move",
  "Perspective",
  "Pointer",
  "Scale",
  "Selection",
  "SubPanel",
  "Text",
  "Tone",
  "Timer",
  "Timelapse",
  "Trash",
];

test("studio icon catalog exposes every app toolbar icon", () => {
  assert.deepEqual(Object.keys(icons.StudioIcons).sort(), expectedIcons.sort());
});

test("studio icons use the local IconNode tuple shape", () => {
  for (const [name, node] of Object.entries(icons.StudioIcons)) {
    assert.ok(Array.isArray(node), `${name} is an array`);
    assert.ok(node.length > 0, `${name} has shapes`);
    for (const shape of node) {
      assert.ok(Array.isArray(shape), `${name} shape is tuple`);
      assert.equal(shape.length, 2, `${name} shape tuple has tag and attrs`);
      assert.equal(typeof shape[0], "string", `${name} tag is string`);
      assert.equal(typeof shape[1], "object", `${name} attrs is object`);
    }
  }
});
