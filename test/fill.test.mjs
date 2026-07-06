import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const outDir = join(tmpdir(), "wigglestudio-fill-test");

function compileFill() {
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
    "src/core/fill.ts",
  ], { stdio: "inherit" });
}

compileFill();
const fill = await import(`${outDir}/fill.js`);

function image(width, height, colors) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < colors.length; i++) {
    const [r, g, b, a = 255] = colors[i];
    const p = i * 4;
    data[p] = r;
    data[p + 1] = g;
    data[p + 2] = b;
    data[p + 3] = a;
  }
  return { data };
}

test("floodFillImageData fills colors within tolerance", () => {
  const img = image(3, 1, [
    [100, 100, 100],
    [104, 100, 100],
    [130, 100, 100],
  ]);

  assert.equal(fill.floodFillImageData(img, 0, 0, "#ff0000", 3, 1, 5), true);

  assert.deepEqual([...img.data.slice(0, 4)], [255, 0, 0, 255]);
  assert.deepEqual([...img.data.slice(4, 8)], [255, 0, 0, 255]);
  assert.deepEqual([...img.data.slice(8, 12)], [130, 100, 100, 255]);
});
