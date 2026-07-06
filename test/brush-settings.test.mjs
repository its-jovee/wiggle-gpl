import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const outDir = join(tmpdir(), "wigglestudio-brush-settings-test");

function compileBrushSettings() {
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
    "src/core/types.ts",
    "src/core/brushSettings.ts",
  ], { stdio: "inherit" });
}

compileBrushSettings();
const settings = await import(`${outDir}/brushSettings.js`);

test("brush settings normalize defaults and clamp ranges", () => {
  assert.deepEqual(settings.normalizeBrushSettings(undefined), {
    spacingScale: 1,
    flow: 1,
    pressureSize: true,
    pressureFlow: false,
  });
  assert.deepEqual(settings.normalizeBrushSettings({
    spacingScale: 9,
    flow: -1,
    pressureSize: false,
    pressureFlow: true,
  }), {
    spacingScale: 3,
    flow: 0.1,
    pressureSize: false,
    pressureFlow: true,
  });
});

test("brush settings compute spacing size and flow from pressure", () => {
  const s = settings.normalizeBrushSettings({
    spacingScale: 2,
    flow: 0.5,
    pressureSize: false,
    pressureFlow: true,
  });
  assert.equal(settings.brushSpacing(4, 3, s), 24);
  assert.equal(settings.brushStampSize(10, 0.25, s), 10);
  assert.equal(settings.brushStampFlow(0.25, s), 0.125);
});
