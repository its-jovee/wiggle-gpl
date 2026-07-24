import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const outDir = join(tmpdir(), "wigglegpl-stroke-smoothing-test");

function compileStrokeSmoothing() {
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
    "src/core/types.ts",
    "src/core/strokeSmoothing.ts",
  ], { stdio: "inherit" });
}

compileStrokeSmoothing();
const smoothing = await import(`${outDir}/strokeSmoothing.js`);

function sample(x, y, pressure = 1) {
  return { point: { x, y }, pressure };
}

test("off smoothing emits original samples", () => {
  const settings = smoothing.normalizeStrokeSmoothingSettings({ mode: "off" });
  const session = smoothing.createStrokeSmoothingSession(sample(0, 0), settings);

  const emitted = smoothing.appendStrokeSmoothingSample(session, sample(4, 6));

  assert.deepEqual(emitted, [sample(4, 6)]);
  assert.deepEqual(session.lastRaw, sample(4, 6));
  assert.deepEqual(session.lastOutput, sample(4, 6));
});

test("weighted smoothing damps sharp jitter while preserving the first emitted endpoint", () => {
  const settings = smoothing.normalizeStrokeSmoothingSettings({
    mode: "weighted",
    distance: 24,
  });
  const session = smoothing.createStrokeSmoothingSession(sample(0, 0), settings);

  const emitted = smoothing.appendStrokeSmoothingSample(session, sample(24, 12));

  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].point.x, 24);
  assert.ok(emitted[0].point.y > 0);
  assert.ok(emitted[0].point.y < 12);
});

test("stabilizer delays output until the pointer exceeds delay distance", () => {
  const settings = smoothing.normalizeStrokeSmoothingSettings({
    mode: "stabilizer",
    delayDistance: 12,
  });
  const session = smoothing.createStrokeSmoothingSession(sample(0, 0), settings);

  assert.deepEqual(smoothing.appendStrokeSmoothingSample(session, sample(6, 0)), []);
  assert.deepEqual(smoothing.appendStrokeSmoothingSample(session, sample(18, 0)), [sample(6, 0)]);
});

test("finish stabilized stroke flushes final raw point when enabled", () => {
  const settings = smoothing.normalizeStrokeSmoothingSettings({
    mode: "stabilizer",
    delayDistance: 12,
    finishStabilizedStroke: true,
  });
  const session = smoothing.createStrokeSmoothingSession(sample(0, 0), settings);
  smoothing.appendStrokeSmoothingSample(session, sample(6, 0));

  const emitted = smoothing.finishStrokeSmoothingSession(session);

  assert.deepEqual(emitted, [sample(6, 0)]);
});

test("smooth pressure damps pressure spikes without changing emitted point count", () => {
  const settings = smoothing.normalizeStrokeSmoothingSettings({
    mode: "weighted",
    distance: 24,
    smoothPressure: true,
  });
  const session = smoothing.createStrokeSmoothingSession(sample(0, 0, 0.2), settings);

  const emitted = smoothing.appendStrokeSmoothingSample(session, sample(12, 0, 1));

  assert.equal(emitted.length, 1);
  assert.ok(emitted[0].pressure > 0.2);
  assert.ok(emitted[0].pressure < 1);
});
