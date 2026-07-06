import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const outDir = join(tmpdir(), "wigglestudio-canvas-presets-test");

function compileCanvasPresets() {
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
    "src/core/audioTypes.ts",
    "src/core/types.ts",
    "src/core/canvasPresets.ts",
  ], { stdio: "inherit" });
}

compileCanvasPresets();
const types = await import(`${outDir}/types.js`);
const presets = await import(`${outDir}/canvasPresets.js`);

test("CANVAS_PRESETS includes four formats with TikTok default", () => {
  assert.equal(presets.CANVAS_PRESETS.length, 4);
  assert.equal(presets.DEFAULT_CANVAS_PRESET_KEY, "tiktok");

  const tiktok = presets.canvasPresetByKey("tiktok");
  assert.equal(tiktok.width, types.TIKTOK_WIDTH);
  assert.equal(tiktok.height, types.TIKTOK_HEIGHT);
  assert.deepEqual(presets.defaultCanvasPreset(), tiktok);
});

test("canvas presets expose expected dimensions", () => {
  assert.deepEqual(presets.canvasPresetByKey("youtube"), {
    key: "youtube",
    label: "YouTube",
    width: 1920,
    height: 1080,
    description: "16:9 landscape (1920×1080)",
  });
  assert.deepEqual(presets.canvasPresetByKey("instagram-square"), {
    key: "instagram-square",
    label: "Instagram Square",
    width: 1080,
    height: 1080,
    description: "1:1 square (1080×1080)",
  });
  assert.deepEqual(presets.canvasPresetByKey("instagram-portrait"), {
    key: "instagram-portrait",
    label: "Instagram Portrait",
    width: 1080,
    height: 1350,
    description: "4:5 portrait (1080×1350)",
  });
});

test("formatCanvasDimensions renders WxH label", () => {
  assert.equal(presets.formatCanvasDimensions(1080, 1920), "1080×1920");
});

test("newProject uses default TikTok dimensions", () => {
  const project = types.newProject();
  assert.equal(project.width, types.TIKTOK_WIDTH);
  assert.equal(project.height, types.TIKTOK_HEIGHT);
});

test("newProject accepts custom dimensions", () => {
  const project = types.newProject(1920, 1080);
  assert.equal(project.width, 1920);
  assert.equal(project.height, 1080);
});
