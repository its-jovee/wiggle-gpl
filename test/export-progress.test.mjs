import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const outDir = join(tmpdir(), "wigostudio-export-progress-test");

function compileExportProgress() {
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
    "src/core/exportProgress.ts",
  ], { stdio: "inherit" });
}

compileExportProgress();
const progress = await import(`${outDir}/exportProgress.js`);

test("export progress reporter preserves legacy percentage callbacks and emits phases", () => {
  const legacy = [];
  const events = [];
  const reporter = progress.createExportProgressReporter("MP4", (p) => legacy.push(p), (event) => events.push(event));

  reporter.render(0.25, 3, 12);
  reporter.encode();
  reporter.done();

  assert.deepEqual(legacy, [0.25, 1]);
  assert.deepEqual(events, [
    { format: "MP4", phase: "render", progress: 0.25, frame: 3, totalFrames: 12 },
    { format: "MP4", phase: "encode", progress: 1 },
    { format: "MP4", phase: "done", progress: 1 },
  ]);
});

test("export progress status text names render, encode, done, and failed phases", () => {
  assert.equal(
    progress.exportProgressStatus({ format: "MP4", phase: "render", progress: 0.5, frame: 4, totalFrames: 8 }),
    "MP4 rendering frame 4/8"
  );
  assert.equal(
    progress.exportProgressStatus({ format: "WebM", phase: "render", progress: 0.42 }),
    "WebM rendering 42%"
  );
  assert.equal(progress.exportProgressStatus({ format: "MP4", phase: "encode", progress: 1 }), "MP4 encoding");
  assert.equal(progress.exportProgressStatus({ format: "WebM", phase: "done", progress: 1 }), "WebM done");
  assert.equal(
    progress.exportProgressStatus({ format: "GIF", phase: "encode", progress: 1 }),
    "GIF encoding"
  );
  assert.equal(
    progress.exportProgressStatus({ format: "PNG", phase: "done", progress: 1 }),
    "PNG done"
  );
  assert.equal(
    progress.exportProgressStatus({ format: "MP4", phase: "failed", progress: 0, error: "no core" }),
    "MP4 failed: no core"
  );
});

test("export errors retain ffmpeg worker messages instead of rendering undefined", () => {
  assert.equal(progress.exportErrorMessage("failed to import ffmpeg-core.js"), "failed to import ffmpeg-core.js");
  assert.equal(progress.exportErrorMessage(new Error("core failed")), "core failed");
  assert.equal(progress.exportErrorMessage(undefined), "The encoder could not start. Please try again.");
});
