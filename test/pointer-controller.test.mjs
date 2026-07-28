import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const outDir = join(tmpdir(), "wigostudio-pointer-controller-test");

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
  "src/tools/activeTool.ts",
  "src/tools/pointerController.ts",
], { stdio: "inherit" });

const activeTools = await import(`${outDir}/tools/activeTool.js`);
const pointerTools = await import(`${outDir}/tools/pointerController.js`);

function registry(calls) {
  return pointerTools.createToolPointerControllers(Object.fromEntries(
    activeTools.EDITOR_TOOL_KINDS.map((kind) => [
      kind,
      (input) => calls.push({ kind, input }),
    ]),
  ));
}

test("brush input stays in the shared paint pipeline", () => {
  const calls = [];
  const handled = pointerTools.dispatchToolPointerDown(
    activeTools.brushTool("ink"),
    { event: {}, point: { x: 3, y: 4 } },
    registry(calls),
  );
  assert.equal(handled, false);
  assert.deepEqual(calls, []);
});

test("every editor tool dispatches only its matching controller", () => {
  for (const kind of activeTools.EDITOR_TOOL_KINDS) {
    const calls = [];
    const input = { event: { pointerId: 7 }, point: { x: 12, y: 18 } };
    const handled = pointerTools.dispatchToolPointerDown(
      activeTools.editorTool(kind),
      input,
      registry(calls),
    );
    assert.equal(handled, true, kind);
    assert.deepEqual(calls, [{ kind, input }], kind);
  }
});
