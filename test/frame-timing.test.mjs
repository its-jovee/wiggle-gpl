import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const outDir = join(tmpdir(), "wigostudio-frame-timing-test");

function compileFrameTiming() {
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

test("seconds convert to milliseconds with a 100ms floor", () => {
  assert.equal(timing.secondsToDurationMs(1), 1000);
  assert.equal(timing.secondsToDurationMs(0.25), 250);
  assert.equal(timing.secondsToDurationMs(0), 100);
  assert.equal(timing.durationMsToSeconds(1250), 1.25);
});

test("setPanelDurationSeconds writes durationMs", () => {
  const panel = { durationMs: 1000 };
  assert.equal(timing.setPanelDurationSeconds(panel, 2.5), 2500);
  assert.equal(panel.durationMs, 2500);
});

test("timeline time formats for frames and seconds", () => {
  assert.equal(timing.formatTimelineTime(1000, "frames", 8), "8f");
  assert.equal(timing.formatTimelineTime(65000, "seconds", 8), "1:05");
  assert.equal(timing.formatHoldDuration(500, "frames", 8), "4fr");
  assert.equal(timing.formatHoldDuration(500, "seconds", 8), "0.5s");
  assert.equal(timing.formatSecondsValue(1), "1");
  assert.equal(timing.formatSecondsValue(0.125), "0.125");
});
