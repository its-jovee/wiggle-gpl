import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const outDir = join(tmpdir(), "wigo-studio-color-triangle-test");
rmSync(outDir, { recursive: true, force: true });
execFileSync("npx", [
  "tsc", "--ignoreConfig", "--outDir", outDir,
  "--module", "commonjs", "--target", "ES2020", "--lib", "ES2020,DOM",
  "--skipLibCheck", "--esModuleInterop", "--noEmit", "false",
  "src/core/colorTriangle.ts",
], { stdio: "inherit" });

const color = await import(`${outDir}/colorTriangle.js`);

test("color triangle helpers normalize and clamp color input", () => {
  assert.equal(color.normalizeHex(" #AbC "), "#aabbcc");
  assert.equal(color.normalizeHex("#12xz00"), null);
  assert.equal(color.rgbToHex(-4, 127.6, 300), "#0080ff");
});

test("RGB and HSV conversions round-trip representative colors", () => {
  for (const hex of ["#000000", "#ffffff", "#ff0000", "#39a0ed", "#e4572e"]) {
    const rgb = color.hexToRgb(hex);
    const hsv = color.rgbToHsv(rgb.r, rgb.g, rgb.b);
    const roundTrip = color.hsvToRgb(hsv.h, hsv.s, hsv.v);
    assert.equal(color.rgbToHex(roundTrip.r, roundTrip.g, roundTrip.b), hex);
  }
});
