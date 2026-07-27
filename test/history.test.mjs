import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const outDir = join(tmpdir(), "wigostudio-history-test");

function compileHistory() {
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
    "src/core/audioTypes.ts",
    "src/core/history.ts",
  ], { stdio: "inherit" });
}

compileHistory();
const history = await import(`${outDir}/history.js`);

function makeProject(marker) {
  return {
    version: 5,
    width: 1080,
    height: 1920,
    wiggleFps: 8,
    panels: [{ id: "p0", durationMs: 100, bg: "#000", paletteId: null, layers: [], marker }],
    groups: [],
  };
}

function makeMultiPanelProject(markers) {
  return {
    version: 5,
    width: 1080,
    height: 1920,
    wiggleFps: 8,
    panels: markers.map((marker, i) => ({
      id: `p${i}`, durationMs: 100, bg: "#000", paletteId: null, layers: [], marker,
    })),
    groups: [],
  };
}

test("push/undo/redo round-trips project state", () => {
  history.init(makeProject(0), { activePanelIndex: 0 });
  history.push(makeProject(1), { activePanelIndex: 0 });
  history.push(makeProject(2), { activePanelIndex: 0 });

  assert.equal(history.canUndo(), true);
  assert.equal(history.canRedo(), false);

  const u1 = history.undo();
  assert.equal(u1.project.panels[0].marker, 1);
  assert.equal(history.canRedo(), true);

  const u2 = history.undo();
  assert.equal(u2.project.panels[0].marker, 0);
  assert.equal(history.undo(), null);

  const r1 = history.redo();
  assert.equal(r1.project.panels[0].marker, 1);
});

test("push truncates redo stack", () => {
  history.init(makeProject(0), { activePanelIndex: 0 });
  history.push(makeProject(1), { activePanelIndex: 0 });
  history.push(makeProject(2), { activePanelIndex: 0 });
  history.undo();
  assert.equal(history.canRedo(), true);
  history.push(makeProject(3), { activePanelIndex: 0 });
  assert.equal(history.canRedo(), false);
  const u = history.undo();
  assert.equal(u.project.panels[0].marker, 1);
});

test("stack is capped at 50 entries", () => {
  history.init(makeProject(0), { activePanelIndex: 0 });
  for (let i = 1; i <= 60; i++) history.push(makeProject(i), { activePanelIndex: 0 });
  let undos = 0;
  while (history.canUndo()) { history.undo(); undos++; }
  assert.equal(undos, 49);
});

test("ctx round-trips through undo/redo", () => {
  history.init(makeProject(0), { activePanelIndex: 0 });
  history.push(makeProject(1), { activePanelIndex: 3 });
  history.push(makeProject(2), { activePanelIndex: 7 });

  const u1 = history.undo();
  assert.equal(u1.ctx.activePanelIndex, 3);
  const u2 = history.undo();
  assert.equal(u2.ctx.activePanelIndex, 0);
  const r1 = history.redo();
  assert.equal(r1.ctx.activePanelIndex, 3);
});

// JS strings compare by value, not identity, so "same reference" isn't
// observable via ===. Verify the actual performance claim instead: pushing
// with `changedPanelIds` must not call JSON.stringify on panels outside
// that set.
function countStringifyCalls(fn) {
  const original = JSON.stringify;
  let calls = 0;
  JSON.stringify = (...args) => { calls++; return original(...args); };
  try {
    fn();
  } finally {
    JSON.stringify = original;
  }
  return calls;
}

test("changedPanelIds skips serialization of untouched panels", () => {
  history.init(makeMultiPanelProject([0, 0, 0]), { activePanelIndex: 0 });
  const p1 = makeMultiPanelProject([1, 0, 0]);
  const calls = countStringifyCalls(() => {
    history.push(p1, { activePanelIndex: 0 }, new Set(["p0"]));
  });
  // 1 call for meta + 1 call for the one changed panel (p0). p1/p2 reuse
  // their cached strings and are never re-stringified.
  assert.equal(calls, 2);

  const stack = history.debugStack();
  const last = stack[stack.length - 1];
  assert.equal(JSON.parse(last.panels[0]).marker, 1);
  assert.equal(JSON.parse(last.panels[1]).marker, 0);
  assert.equal(JSON.parse(last.panels[2]).marker, 0);
});

test("omitting changedPanelIds re-serializes every panel (full fallback)", () => {
  history.init(makeMultiPanelProject([0, 0]), { activePanelIndex: 0 });
  const p1 = makeMultiPanelProject([0, 0]);
  const calls = countStringifyCalls(() => {
    history.push(p1, { activePanelIndex: 0 }); // no changedPanelIds
  });
  // 1 call for meta + 1 call per panel (2) = 3, even though content is
  // unchanged — the fallback path always re-serializes everything.
  assert.equal(calls, 3);
});

test("undo/redo refreshes the panel cache so the next push diffs correctly", () => {
  history.init(makeMultiPanelProject([0, 0]), { activePanelIndex: 0 });
  history.push(makeMultiPanelProject([1, 0]), { activePanelIndex: 0 }, new Set(["p0"]));
  history.push(makeMultiPanelProject([2, 0]), { activePanelIndex: 0 }, new Set(["p0"]));

  const back = history.undo(); // now viewing marker [1, 0]
  assert.equal(back.project.panels[0].marker, 1);

  // A push after undo should diff against the entry the pointer now sits on
  // (marker 1), not the discarded redo entry (marker 2).
  history.push(makeMultiPanelProject([1, 5]), { activePanelIndex: 0 }, new Set(["p1"]));
  const cur = history.undo();
  assert.equal(cur.project.panels[0].marker, 1);
  assert.equal(cur.project.panels[1].marker, 0);
});

test("prepared navigation reports only the panels that changed", () => {
  history.init(makeMultiPanelProject([0, 0, 0]), { activePanelIndex: 0 });
  history.push(makeMultiPanelProject([1, 0, 0]), { activePanelIndex: 0 }, new Set(["p0"]));

  const prepared = history.prepareUndo();
  assert.ok(prepared);
  assert.equal(history.canUndo(), true, "preparing must not move the pointer");
  assert.deepEqual(prepared.result.change.changedPanelIds, ["p0"]);
  assert.equal(prepared.result.change.panelOrderChanged, false);
  assert.equal(prepared.result.change.metaChanged, false);

  const applied = history.commitPrepared(prepared);
  assert.equal(applied.project.panels[0].marker, 0);
  assert.equal(history.canUndo(), false);
  assert.equal(history.canRedo(), true);
});

test("prepared navigation detects panel order changes", () => {
  const first = makeMultiPanelProject([0, 1]);
  const second = { ...first, panels: [first.panels[1], first.panels[0]] };
  history.init(first, { activePanelIndex: 0 });
  history.push(second, { activePanelIndex: 0 });
  const prepared = history.prepareUndo();
  assert.equal(prepared.result.change.panelOrderChanged, true);
  assert.deepEqual(prepared.result.change.changedPanelIds, []);
});

test("prepared navigation reuses unchanged live panels", () => {
  const current = makeMultiPanelProject([1, 2]);
  const previous = makeMultiPanelProject([0, 2]);
  history.init(previous, { activePanelIndex: 0 });
  history.push(current, { activePanelIndex: 0 }, new Set(["p0"]));
  const prepared = history.prepareUndo(current);
  assert.equal(prepared.result.project.panels[1], current.panels[1]);
  assert.notEqual(prepared.result.project.panels[0], current.panels[0]);
});
