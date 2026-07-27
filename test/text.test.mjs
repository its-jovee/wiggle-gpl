import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const outDir = join(tmpdir(), "wigo-studio-text-test");

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
  "src/core/text.ts",
], { stdio: "inherit" });

const text = await import(`${outDir}/text.js`);

function context() {
  const calls = [];
  return {
    calls,
    save() {},
    restore() {},
    translate() {},
    rotate() {},
    measureText(value) { return { width: value.length * 10 }; },
    fillText(value, x, y) { calls.push({ value, x, y }); },
  };
}

const element = {
  id: "text-1",
  x: 12,
  y: 20,
  content: "AB\nC",
  fontFamily: "Test Sans",
  fontSize: 20,
  color: "#000000",
  wiggleAmplitude: 0,
};

test("multiline text measures the widest line and every line's height", () => {
  const ctx = context();
  assert.deepEqual(text.measureText(ctx, element), { width: 20, height: 48 });
});

test("multiline text resets x and advances y after a newline", () => {
  const ctx = context();
  text.renderTextElement(ctx, element, 0, 0, true);
  assert.deepEqual(ctx.calls, [
    { value: "A", x: 12, y: 20 },
    { value: "B", x: 22, y: 20 },
    { value: "C", x: 12, y: 44 },
  ]);
});
