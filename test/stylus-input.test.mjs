import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const outDir = join(tmpdir(), "wigostudio-input-test");

function compileInput() {
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

test("mouse input during recovery uses synthetic pen fallback", () => {
  assert.deepEqual(
    input.readPointerPressure(
      { pointerType: "mouse", pressure: 0.5, buttons: 1 },
      true,
      { recovery: true, fallbackPressure: 0.42 }
    ),
    { pressure: 0.42, real: false }
  );
});

test("pen input keeps positive pressure as real user intent", () => {
  assert.deepEqual(
    input.readPointerPressure({ pointerType: "pen", pressure: 0.08, buttons: 1 }, true),
    { pressure: 0.08, real: true }
  );
});

test("pen default half-pressure is trusted outside recovery", () => {
  assert.deepEqual(
    input.readPointerPressure(
      { pointerType: "pen", pressure: 0.5, buttons: 1, tiltX: 0, tiltY: 0 },
      true
    ),
    { pressure: 0.5, real: true }
  );
});

test("pen default half-pressure without tilt is synthetic during recovery", () => {
  assert.deepEqual(
    input.readPointerPressure(
      { pointerType: "pen", pressure: 0.5, buttons: 1, tiltX: 0, tiltY: 0 },
      true,
      { recovery: true, fallbackPressure: 0.7 }
    ),
    { pressure: 0.7, real: false }
  );
});

test("pen half-pressure with tilt stays real during recovery", () => {
  assert.deepEqual(
    input.readPointerPressure(
      { pointerType: "pen", pressure: 0.5, buttons: 1, tiltX: 12, tiltY: -4 },
      true,
      { recovery: true, fallbackPressure: 0.7 }
    ),
    { pressure: 0.5, real: true }
  );
});

test("pen input uses temporary fallback only for missing startup pressure", () => {
  assert.deepEqual(
    input.readPointerPressure({ pointerType: "pen", pressure: 0, buttons: 1 }, true),
    { pressure: input.PEN_STARTUP_FALLBACK_PRESSURE, real: false }
  );
});

test("isBrowserDefaultPressure detects spec half-pressure", () => {
  assert.equal(input.isBrowserDefaultPressure({ pointerType: "mouse", pressure: 0.5, buttons: 1 }), true);
  assert.equal(input.isBrowserDefaultPressure({ pointerType: "pen", pressure: 0.51, buttons: 1 }), false);
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

test("leading backfill rewrites a counted synthetic prefix", () => {
  const pressures = [0.55, 0.55, 0.55, 0.2];
  input.backfillLeadingPressures(pressures, 3, 0.81);
  assert.deepEqual(pressures, [0.81, 0.81, 0.81, 0.2]);
});

test("leading backfill clamps count to the pressures array length", () => {
  const pressures = [0.4, 0.4];
  input.backfillLeadingPressures(pressures, 9, 0.9);
  assert.deepEqual(pressures, [0.9, 0.9]);
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
