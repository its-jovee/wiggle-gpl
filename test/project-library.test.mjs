import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const outDir = join(tmpdir(), "wigglestudio-project-library-test");

function compileProjectLibrary() {
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
    "src/core/autosave.ts",
    "src/core/projectLibrary.ts",
  ], { stdio: "inherit" });
}

compileProjectLibrary();
const autosave = await import(`${outDir}/autosave.js`);
const library = await import(`${outDir}/projectLibrary.js`);

test("autosave serialization is reused until a real edit", () => {
  let calls = 0;
  const cache = new autosave.AutosaveSerializationCache((value) => {
    calls++;
    return JSON.stringify(value);
  });
  const value = { panels: 1 };

  assert.equal(cache.reset(value).json, '{"panels":1}');
  assert.equal(calls, 1);
  assert.equal(cache.snapshot(value).reused, true);
  assert.equal(cache.snapshot(value).reused, true);
  assert.equal(calls, 1);

  cache.markChanged();
  value.panels = 2;
  assert.equal(cache.snapshot(value).json, '{"panels":2}');
  assert.equal(cache.snapshot(value).reused, true);
  assert.equal(calls, 2);
});

test("board positions projects on a stable four-column grid", () => {
  const records = Array.from({ length: 5 }, (_, i) => ({ x: i, y: i }));
  assert.deepEqual(library.nextProjectBoardPosition([]), { x: 0, y: 0 });
  assert.deepEqual(library.nextProjectBoardPosition(records), { x: 280, y: 420 });
});

test("board zoom preserves the world point under the pointer", () => {
  const camera = { scale: 1, tx: 80, ty: 40 };
  const before = { x: (300 - camera.tx) / camera.scale, y: (240 - camera.ty) / camera.scale };
  const zoomed = library.zoomBoardCamera(camera, 2, 300, 240);
  assert.equal((300 - zoomed.tx) / zoomed.scale, before.x);
  assert.equal((240 - zoomed.ty) / zoomed.scale, before.y);
  assert.equal(library.clampBoardScale(99), 3);
  assert.equal(library.clampBoardScale(0.01), 0.2);
});
