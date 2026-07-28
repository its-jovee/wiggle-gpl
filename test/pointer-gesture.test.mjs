import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const outDir = join(tmpdir(), "wigostudio-pointer-gesture-test");

rmSync(outDir, { recursive: true, force: true });
execFileSync("npx", [
  "tsc",
  "--ignoreConfig",
  "--outDir", outDir,
  "--module", "commonjs",
  "--target", "ES2020",
  "--skipLibCheck",
  "--noEmit", "false",
  "src/tools/pointerGesture.ts",
], { stdio: "inherit" });

const { PointerGestureSession } = await import(`${outDir}/pointerGesture.js`);

test("gesture session accepts events only from the owning pointer", () => {
  const session = new PointerGestureSession();
  const gesture = { kind: "paint", pointerId: 7 };
  assert.equal(session.begin(gesture), null);
  assert.equal(session.ownedBy(8), null);
  assert.equal(session.finish(8), null);
  assert.equal(session.current, gesture);
  assert.equal(session.ownedBy(7), gesture);
});

test("finish and cancel atomically detach the active gesture", () => {
  const session = new PointerGestureSession();
  const paint = { kind: "paint", pointerId: 7 };
  session.begin(paint);
  assert.equal(session.finish(7), paint);
  assert.equal(session.current, null);

  const pan = { kind: "pan", pointerId: 9 };
  session.begin(pan);
  assert.equal(session.cancel(9), pan);
  assert.equal(session.current, null);
});

test("begin reports a replaced gesture and clear removes any owner", () => {
  const session = new PointerGestureSession();
  const first = { kind: "selection", pointerId: 1 };
  const second = { kind: "gradient", pointerId: 2 };
  assert.equal(session.begin(first), null);
  assert.equal(session.begin(second), first);
  assert.equal(session.clear(), second);
  assert.equal(session.clear(), null);
});
