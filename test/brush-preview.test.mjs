import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const outDir = join(tmpdir(), "wigostudio-brush-preview-test");

function compilePreview() {
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
        flow: b.flow,
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

  assert.equal(samples.length, 15);
  assert.equal(samples[0].seed, 1049);
  assert.equal(samples.at(-1)?.seed, 1063);
  assert.ok(samples[0].pressure >= 0.9);
  assert.ok(samples[samples.length - 1].pressure < samples[0].pressure);
  assert.deepEqual(ctx.calls[0], ["clearRect", 0, 0, 48, 28]);
  assert.deepEqual(ctx.calls[1], ["save"]);
  assert.deepEqual(ctx.calls.at(-1), ["restore"]);
});

test("drawBrushPreview renders radial brushes as a single burst", () => {
  const ctx = fakeCtx();
  const samples = [];
  const brush = {
    key: "radial",
    label: "Radial",
    spacing: 10,
    radial: true,
    stamp(b) {
      samples.push({
        pos: b.pos,
        radialRadius: b.radialRadius,
        seed: b.seed,
      });
    },
  };

  preview.drawBrushPreview(ctx, brush, {
    width: 48,
    height: 28,
    color: "#fedc7a",
    bg: "transparent",
    size: 2,
  });

  assert.equal(samples.length, 1);
  assert.equal(samples[0].radialRadius, 28 * 0.38);
  assert.equal(samples[0].seed, 1049);
});

test("drawBrushPreview can preview any paint brush as an eraser", () => {
  const ctx = fakeCtx();
  const composites = [];
  const brush = {
    key: "paint",
    label: "Paint",
    spacing: 4,
    stamp(b) {
      composites.push(b.ctx.globalCompositeOperation);
      assert.equal(b.color, "#ffffff");
    },
  };

  preview.drawBrushPreview(ctx, brush, {
    width: 32,
    height: 20,
    color: "#fedc7a",
    bg: "#171720",
    size: 2,
    erase: true,
  });

  assert.ok(composites.length > 0);
  assert.ok(composites.every((mode) => mode === "destination-out"));
});
