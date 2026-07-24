import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const outDir = join(tmpdir(), "wigglestudio-board-camera-test");

function compileBoardCamera() {
  rmSync(outDir, { recursive: true, force: true });
  execFileSync("npx", [
    "tsc",
    "--ignoreConfig",
    "--outDir", outDir,
    "--module", "commonjs",
    "--target", "ES2020",
    "--lib", "ES2020",
    "--skipLibCheck",
    "--esModuleInterop",
    "--noEmit", "false",
    "src/core/boardCamera.ts",
  ], { stdio: "inherit" });
}

compileBoardCamera();
const cam = await import(`${outDir}/boardCamera.js`);

test("clampCameraScale keeps scale within the shared range", () => {
  assert.equal(cam.clampCameraScale(0), cam.MIN_CAMERA_SCALE);
  assert.equal(cam.clampCameraScale(1000), cam.MAX_CAMERA_SCALE);
  assert.equal(cam.clampCameraScale(1), 1);
  assert.equal(cam.clampCameraScale(NaN), 1);
});

test("screenToWorld and worldToScreen are inverses", () => {
  const camera = { scale: 1.5, tx: 40, ty: -20 };
  const world = cam.screenToWorld(camera, 310, 205);
  const screen = cam.worldToScreen(camera, world.x, world.y);
  assert.ok(Math.abs(screen.x - 310) < 1e-9);
  assert.ok(Math.abs(screen.y - 205) < 1e-9);
});

test("zoomAbout pins the world point under the cursor", () => {
  const camera = { scale: 1, tx: 0, ty: 0 };
  const before = cam.screenToWorld(camera, 200, 150);
  const zoomed = cam.zoomAbout(camera, 2, 200, 150);
  assert.equal(zoomed.scale, 2);
  const after = cam.screenToWorld(zoomed, 200, 150);
  assert.ok(Math.abs(after.x - before.x) < 1e-9);
  assert.ok(Math.abs(after.y - before.y) < 1e-9);
});

test("zoomAbout clamps the requested scale", () => {
  const camera = { scale: 1, tx: 0, ty: 0 };
  assert.equal(cam.zoomAbout(camera, 999, 0, 0).scale, cam.MAX_CAMERA_SCALE);
});

test("fitCamera centres a rect within the surface with margin", () => {
  const surface = { width: 800, height: 600 };
  const rect = { x: 0, y: 0, width: 400, height: 400 };
  const camera = cam.fitCamera(surface, rect, 0);
  // height is the tighter axis: 600/400 = 1.5
  assert.equal(camera.scale, 1.5);
  // rect centre should map to surface centre
  const centre = cam.worldToScreen(camera, 200, 200);
  assert.ok(Math.abs(centre.x - 400) < 1e-9);
  assert.ok(Math.abs(centre.y - 300) < 1e-9);
});

test("fitCamera honours padding", () => {
  const surface = { width: 800, height: 600 };
  const rect = { x: 0, y: 0, width: 800, height: 600 };
  const camera = cam.fitCamera(surface, rect, 50);
  // available 700x500 over 800x600 -> min(0.875, 0.833) = 0.8333...
  assert.ok(Math.abs(camera.scale - 500 / 600) < 1e-9);
});

test("boundingRect encloses every rect", () => {
  const rect = cam.boundingRect([
    { x: 0, y: 0, width: 100, height: 100 },
    { x: 300, y: 50, width: 100, height: 200 },
  ]);
  assert.deepEqual(rect, { x: 0, y: 0, width: 400, height: 250 });
  assert.equal(cam.boundingRect([]), null);
});

test("activeCoverage reports the dominant-axis screen fill", () => {
  const surface = { width: 800, height: 600 };
  // portrait frame fit to height: 600 tall on screen -> coverH = 1
  const camera = { scale: 1, tx: 0, ty: 0 };
  const coverage = cam.activeCoverage(camera, { width: 300, height: 600 }, surface);
  assert.ok(Math.abs(coverage - 1) < 1e-9);
  // zoomed out to a tenth: dominant axis now 0.1
  const zoomedOut = cam.activeCoverage({ scale: 0.1, tx: 0, ty: 0 }, { width: 300, height: 600 }, surface);
  assert.ok(Math.abs(zoomedOut - 0.1) < 1e-9);
});

test("chromeOpacity fades linearly between the hidden and full thresholds", () => {
  assert.equal(cam.chromeOpacity(0.6), 1);
  assert.equal(cam.chromeOpacity(0.3), 0);
  assert.equal(cam.chromeOpacity(0.2), 0);
  // midpoint of default range [0.3, 0.55] is 0.425 -> 0.5
  assert.ok(Math.abs(cam.chromeOpacity(0.425) - 0.5) < 1e-9);
});

test("organizeGrid lays frames out in rows without overlap", () => {
  const positions = cam.organizeGrid(5, { width: 100, height: 200 }, 2, 40);
  assert.deepEqual(positions[0], { x: 0, y: 0 });
  assert.deepEqual(positions[1], { x: 140, y: 0 });
  assert.deepEqual(positions[2], { x: 0, y: 240 });
  assert.deepEqual(positions[4], { x: 0, y: 480 });
});

test("migrateLegacyPosition spreads old display-grid coordinates out", () => {
  assert.deepEqual(cam.migrateLegacyPosition({ x: 560, y: 0 }), { x: 2240, y: 0 });
});
