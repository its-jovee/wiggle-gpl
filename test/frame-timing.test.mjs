import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const outDir = join(tmpdir(), "wigglestudio-frame-timing-test");

function compileFrameTiming() {
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
    "src/core/frameTiming.ts",
  ], { stdio: "inherit" });
}

compileFrameTiming();
const timing = await import(`${outDir}/frameTiming.js`);

test("exposure ticks convert to rounded milliseconds from wiggle fps", () => {
  assert.equal(timing.exposureTicksToMs(1, 8), 125);
  assert.equal(timing.exposureTicksToMs(2, 8), 250);
  assert.equal(timing.exposureTicksToMs(1, 12), 83);
  assert.equal(timing.exposureTicksToMs(0, 8), 125);
});

test("milliseconds display as nearest whole exposure tick", () => {
  assert.equal(timing.durationMsToExposureTicks(1000, 8), 8);
  assert.equal(timing.durationMsToExposureTicks(249, 8), 2);
  assert.equal(timing.durationMsToExposureTicks(1, 8), 1);
});

test("quick exposure commands clamp to one exposure tick", () => {
  const panel = { durationMs: 250 };
  assert.equal(timing.setPanelExposureTicks(panel, 4, 8), 500);
  assert.equal(panel.durationMs, 500);
  assert.equal(timing.adjustPanelExposureTicks(panel, -8, 8), 125);
  assert.equal(panel.durationMs, 125);
});
