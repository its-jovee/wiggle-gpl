import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const outDir = join(tmpdir(), "wigglestudio-input-test");

function compileInput() {
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
    "src/core/input.ts",
  ], { stdio: "inherit" });
}

compileInput();
const input = await import(`${outDir}/input.js`);

test("mouse input ignores browser default half-pressure", () => {
  assert.deepEqual(
    input.readPointerPressure({ pointerType: "mouse", pressure: 0.5, buttons: 1 }, true),
    { pressure: 1, real: true }
  );
});

test("pen input keeps positive pressure as real user intent", () => {
  assert.deepEqual(
    input.readPointerPressure({ pointerType: "pen", pressure: 0.08, buttons: 1 }, true),
    { pressure: 0.08, real: true }
  );
});

test("pen input uses temporary fallback only for missing startup pressure", () => {
  assert.deepEqual(
    input.readPointerPressure({ pointerType: "pen", pressure: 0, buttons: 1 }, true),
    { pressure: input.PEN_STARTUP_FALLBACK_PRESSURE, real: false }
  );
});

test("startup backfill replaces only synthetic leading pressure samples", () => {
  const pressures = [
    input.PEN_STARTUP_FALLBACK_PRESSURE,
    input.PEN_STARTUP_FALLBACK_PRESSURE,
    0.12,
    input.PEN_STARTUP_FALLBACK_PRESSURE,
  ];

  input.backfillSyntheticStartupPressures(pressures, 0.64);

  assert.deepEqual(pressures, [0.64, 0.64, 0.12, input.PEN_STARTUP_FALLBACK_PRESSURE]);
});

test("stroke simplification preserves pressure-only shape changes", () => {
  const stroke = {
    points: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }],
    pressures: [0.2, 0.9, 0.2],
  };

  input.simplifyStroke(stroke);

  assert.deepEqual(stroke.points, [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }]);
  assert.deepEqual(stroke.pressures, [0.2, 0.9, 0.2]);
});
