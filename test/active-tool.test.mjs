import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const outDir = join(tmpdir(), "wigostudio-active-tool-test");

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
  "src/tools/activeTool.ts",
], { stdio: "inherit" });

const tools = await import(`${outDir}/activeTool.js`);
const knownBrush = (key) => ["round", "ink", "eraser"].includes(key);

test("brush and editor tools have disjoint typed identities", () => {
  const brush = tools.brushTool("ink");
  const marquee = tools.editorTool("marquee");

  assert.equal(tools.activeBrushKey(brush), "ink");
  assert.equal(tools.activeBrushKey(marquee), null);
  assert.equal(tools.isActiveEditorTool(brush, "marquee"), false);
  assert.equal(tools.isActiveEditorTool(marquee, "marquee"), true);
});

test("recent tool keys namespace editor tools and preserve brush keys", () => {
  assert.equal(tools.recentToolKey(tools.brushTool("round")), "round");
  assert.equal(tools.recentToolKey(tools.editorTool("move-layer")), "tool:move-layer");
});

test("recent tool decoding migrates legacy sentinel values", () => {
  assert.deepEqual(
    tools.activeToolFromRecentKey("__marquee__", knownBrush),
    { kind: "marquee" },
  );
  assert.deepEqual(
    tools.activeToolFromRecentKey("tool:cut-subpanel", knownBrush),
    { kind: "cut-subpanel" },
  );
  assert.deepEqual(
    tools.activeToolFromRecentKey("ink", knownBrush),
    { kind: "brush", brushKey: "ink" },
  );
  assert.equal(tools.activeToolFromRecentKey("not-a-tool", knownBrush), null);
  assert.equal(tools.activeToolFromRecentKey("tool:not-real", knownBrush), null);
});
