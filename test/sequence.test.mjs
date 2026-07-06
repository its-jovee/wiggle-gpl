import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const outDir = join(tmpdir(), "wigglestudio-sequence-test");

function compileSequence() {
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
    "src/core/audioTypes.ts",
    "src/core/sequence.ts",
  ], { stdio: "inherit" });
}

compileSequence();
const sequence = await import(`${outDir}/sequence.js`);

function makeProject(panels, groups) {
  return {
    version: 5,
    width: 1080,
    height: 1920,
    wiggleFps: 8,
    panels: panels.map((durationMs, i) => ({
      id: `p${i}`,
      durationMs,
      bg: "#000",
      paletteId: null,
      layers: [],
    })),
    groups,
  };
}

test("expandTimeline repeats a group N times", () => {
  const project = makeProject([100, 200, 300, 400, 500], [{
    id: "g1",
    panelIds: ["p0", "p1", "p2", "p3", "p4"],
    repeat: 5,
  }]);
  const entries = sequence.expandTimeline(project);
  assert.equal(entries.length, 25);
  assert.equal(sequence.expandedDurationMs(project), 5 * (100 + 200 + 300 + 400 + 500));
  assert.equal(entries[0].panelIndex, 0);
  assert.equal(entries[0].iteration, 0);
  assert.equal(entries[5].iteration, 1);
  assert.equal(entries[5].panelIndex, 0);
});

test("sequenceAtTime maps boundaries within expanded timeline", () => {
  const project = makeProject([1000, 1000], [{
    id: "g1",
    panelIds: ["p0", "p1"],
    repeat: 2,
  }]);
  assert.deepEqual(sequence.sequenceAtTime(project, 0), {
    index: 0, localMs: 0, groupId: "g1", iteration: 0, entryIndex: 0,
  });
  assert.deepEqual(sequence.sequenceAtTime(project, 999), {
    index: 0, localMs: 999, groupId: "g1", iteration: 0, entryIndex: 0,
  });
  assert.deepEqual(sequence.sequenceAtTime(project, 1000), {
    index: 1, localMs: 0, groupId: "g1", iteration: 0, entryIndex: 1,
  });
  assert.deepEqual(sequence.sequenceAtTime(project, 2000), {
    index: 0, localMs: 0, groupId: "g1", iteration: 1, entryIndex: 2,
  });
  assert.deepEqual(sequence.sequenceAtTime(project, 3999), {
    index: 1, localMs: 999, groupId: "g1", iteration: 1, entryIndex: 3,
  });
});

test("mixed grouped and ungrouped panels expand correctly", () => {
  const project = makeProject([500, 500, 500], [{
    id: "g1",
    panelIds: ["p1"],
    repeat: 3,
  }]);
  const entries = sequence.expandTimeline(project);
  assert.equal(entries.length, 5);
  assert.equal(entries[0].panelIndex, 0);
  assert.equal(entries[1].panelIndex, 1);
  assert.equal(entries[1].iteration, 0);
  assert.equal(entries[2].panelIndex, 1);
  assert.equal(entries[2].iteration, 1);
  assert.equal(entries[3].panelIndex, 1);
  assert.equal(entries[3].iteration, 2);
  assert.equal(entries[4].panelIndex, 2);
});

test("sanitizeGroups drops dangling ids and enforces contiguity", () => {
  const project = makeProject([100, 100, 100], [{
    id: "g1",
    panelIds: ["p0", "missing", "p2"],
    repeat: 0,
  }]);
  sequence.applySanitizedGroups(project);
  assert.equal(project.groups.length, 1);
  assert.deepEqual(project.groups[0].panelIds, ["p0"]);
  assert.equal(project.groups[0].repeat, 1);

  project.groups = [{ id: "g2", panelIds: ["p0", "p2"], repeat: 2 }];
  sequence.applySanitizedGroups(project);
  assert.equal(project.groups.length, 1);
  assert.deepEqual(project.groups[0].panelIds, ["p0"]);
});

test("createFrameGroup removes overlapping membership", () => {
  const project = makeProject([100, 100, 100], [{
    id: "g1",
    panelIds: ["p1"],
    repeat: 2,
  }]);
  sequence.createFrameGroup(project, 0, 2, 4);
  assert.equal(project.groups.length, 1);
  assert.deepEqual(project.groups[0].panelIds, ["p0", "p1", "p2"]);
  assert.equal(project.groups[0].repeat, 4);
});

test("sequenceAtTime wraps elapsed time", () => {
  const project = makeProject([1000], []);
  const pos = sequence.sequenceAtTime(project, 2500);
  assert.equal(pos.index, 0);
  assert.equal(pos.localMs, 500);
});
