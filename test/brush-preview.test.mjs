import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const outDir = join(tmpdir(), "wigglestudio-brush-preview-test");

function compilePreview() {
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
    "src/brushes/preview.ts",
  ], { stdio: "inherit" });
}

compilePreview();
const preview = await import(`${outDir}/brushes/preview.js`);

function fakeCtx() {
  return {
    calls: [],
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
    save() { this.calls.push(["save"]); },
    restore() { this.calls.push(["restore"]); },
    clearRect(...args) { this.calls.push(["clearRect", ...args]); },
    fillRect(...args) { this.calls.push(["fillRect", ...args]); },
    beginPath() { this.calls.push(["beginPath"]); },
    moveTo(...args) { this.calls.push(["moveTo", ...args]); },
    lineTo(...args) { this.calls.push(["lineTo", ...args]); },
    arc(...args) { this.calls.push(["arc", ...args]); },
    stroke() { this.calls.push(["stroke"]); },
    fill() { this.calls.push(["fill"]); },
  };
}

test("drawBrushPreview stamps deterministic samples across the preview", () => {
  const ctx = fakeCtx();
  const samples = [];
  const brush = {
    key: "sample",
    label: "Sample",
    spacing: 3,
    stamp(b) {
      samples.push({
        pos: b.pos,
        delta: b.delta,
        color: b.color,
        size: b.size,
        tick: b.tick,
        seed: b.seed,
        bg: b.bg,
        pressure: b.pressure,
        dist: b.dist,
      });
    },
  };

  preview.drawBrushPreview(ctx, brush, {
    width: 48,
    height: 28,
    color: "#fedc7a",
    bg: "#171720",
    size: 2,
  });

  assert.equal(samples.length, 9);
  assert.deepEqual(samples[0], {
    pos: { x: 12, y: 14 },
    delta: { x: 1, y: 0.12 },
    color: "#fedc7a",
    size: 1.8,
    tick: 0,
    seed: 1049,
    bg: "#171720",
    pressure: 1,
    dist: 0,
  });
  assert.deepEqual(samples.at(-1), {
    pos: { x: 36, y: 14 },
    delta: { x: 1, y: 0.12 },
    color: "#fedc7a",
    size: 1.8,
    tick: 0,
    seed: 1057,
    bg: "#171720",
    pressure: 1,
    dist: 24,
  });
  assert.deepEqual(ctx.calls[0], ["clearRect", 0, 0, 48, 28]);
  assert.deepEqual(ctx.calls[1], ["save"]);
  assert.deepEqual(ctx.calls.at(-1), ["restore"]);
});
