import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";

const outDir = join(tmpdir(), "wigostudio-studio-icons-test");
const outFile = join(outDir, "studio.mjs");

function compileIcons() {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  execFileSync("npx", [
    "esbuild",
    "src/icons/studio.ts",
    "--bundle",
    "--format=esm",
    "--platform=node",
    `--outfile=${outFile}`,
  ], { stdio: "inherit" });
}

compileIcons();
const icons = await import(pathToFileURL(outFile).href);

const expectedIcons = [
  "Add",
  "Balloon",
  "BrushClassic",
  "BrushTexture",
  "BrushScatter",
  "Bucket",
  "Clip",
  "ClipboardCheck",
  "ClipboardPaste",
  "Copy",
  "CopyCheck",
  "CutSubPanel",
  "DragGrip",
  "Eraser",
  "Eye",
  "EyeOff",
  "FrameInsertAfter",
  "FrameInsertBefore",
  "Gradient",
  "LayerAdd",
  "Layers",
  "Move",
  "Note",
  "Pause",
  "Perspective",
  "Play",
  "Pointer",
  "Raster",
  "Redo",
  "Repeat",
  "Scale",
  "Selection",
  "Sparkle",
  "SubPanel",
  "Text",
  "Timelapse",
  "Timer",
  "Tone",
  "Trash",
  "Undo",
];

test("studio icon catalog exposes every app toolbar icon", () => {
  assert.deepEqual(Object.keys(icons.StudioIcons).sort(), expectedIcons.sort());
});

test("studio icons expose Reicon functions with server-renderable SVG", () => {
  for (const [name, icon] of Object.entries(icons.StudioIcons)) {
    assert.equal(typeof icon, "function", `${name} is an icon function`);
    assert.equal(typeof icon.toSvg, "function", `${name} supports toSvg`);
    const markup = icon.toSvg({ size: 16, color: "currentColor", weight: "Outline" });
    assert.match(markup, /^<svg\b/, `${name} renders an SVG`);
    assert.match(markup, /width="16"/, `${name} honors icon size`);
  }
});
