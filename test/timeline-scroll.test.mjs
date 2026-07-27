import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const outDir = join(tmpdir(), "wigostudio-timeline-scroll-test");

function compileTimelineScroll() {
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
    "src/core/timelineScroll.ts",
  ], { stdio: "inherit" });
}

compileTimelineScroll();
const { timelineScrollAfterRebuild } = await import(`${outDir}/timelineScroll.js`);

test("timeline rebuild preserves existing scroll when active panel remains visible", () => {
  const next = timelineScrollAfterRebuild({
    previousScrollLeft: 480,
    viewportWidth: 320,
    contentWidth: 1200,
    activeLeft: 520,
    activeRight: 590,
  });

  assert.equal(next, 480);
});

test("timeline rebuild reveals active panel instead of jumping to the start", () => {
  const next = timelineScrollAfterRebuild({
    previousScrollLeft: 0,
    viewportWidth: 320,
    contentWidth: 1200,
    activeLeft: 1080,
    activeRight: 1150,
  });

  assert.equal(next, 830);
});

test("timeline rebuild preserves vertical scroll when the active panel remains visible", () => {
  const next = timelineScrollAfterRebuild({
    previousScrollLeft: 640,
    viewportWidth: 360,
    contentWidth: 1600,
    activeLeft: 720,
    activeRight: 840,
  });

  assert.equal(next, 640);
});
