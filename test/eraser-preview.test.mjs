import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const outDir = join(tmpdir(), "wigglestudio-eraser-preview-test");

function compileEraserPreview() {
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
    "src/core/eraserPreview.ts",
    "src/core/types.ts",
  ], { stdio: "inherit" });
}

compileEraserPreview();
const eraserPreview = await import(`${outDir}/eraserPreview.js`);

function fakeCtx() {
  return {
    calls: [],
    strokeStyle: "",
    fillStyle: "",
    lineWidth: 0,
    globalAlpha: 1,
    lineCap: "butt",
    lineJoin: "miter",
    save() { this.calls.push(["save"]); },
    restore() { this.calls.push(["restore"]); },
    beginPath() { this.calls.push(["beginPath"]); },
    moveTo(...args) { this.calls.push(["moveTo", ...args]); },
    lineTo(...args) { this.calls.push(["lineTo", ...args]); },
    arc(...args) { this.calls.push(["arc", ...args]); },
    stroke() { this.calls.push(["stroke"]); },
    fill() { this.calls.push(["fill"]); },
  };
}

test("erase preview applies to both eraser brushes only", () => {
  assert.equal(eraserPreview.isErasePreviewBrush({ erase: true }), true);
  assert.equal(eraserPreview.isErasePreviewBrush({ key: "round" }), false);
});

test("drawEraserTracePreview draws outline path and cursor without fill", () => {
  const ctx = fakeCtx();
  eraserPreview.drawEraserTracePreview(ctx, {
    brushSize: 2,
    points: [{ x: 10, y: 12 }, { x: 16, y: 18 }, { x: 22, y: 18 }],
  });

  assert.equal(ctx.calls.filter(([name]) => name === "fill").length, 0);
  assert.deepEqual(ctx.calls[0], ["save"]);
  assert.deepEqual(ctx.calls[1], ["beginPath"]);
  assert.deepEqual(ctx.calls[2], ["moveTo", 10, 12]);
  assert.deepEqual(ctx.calls[3], ["lineTo", 16, 18]);
  assert.deepEqual(ctx.calls[4], ["lineTo", 22, 18]);
  assert.deepEqual(ctx.calls[5], ["stroke"]);
  assert.deepEqual(ctx.calls[6], ["beginPath"]);
  assert.deepEqual(ctx.calls[7], ["arc", 22, 18, 12, 0, Math.PI * 2]);
  assert.deepEqual(ctx.calls[8], ["stroke"]);
  assert.deepEqual(ctx.calls.at(-1), ["restore"]);
});
