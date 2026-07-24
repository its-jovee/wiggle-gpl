import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const outDir = join(tmpdir(), "wiggle-gpl-fonts-test");

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
  "src/core/fonts.ts",
], { stdio: "inherit" });

const fonts = await import(`${outDir}/fonts.js`);

test("font family values are safely quoted for CSS and canvas", () => {
  assert.equal(fonts.fontFamilyCss("Helvetica Neue"), "\"Helvetica Neue\", sans-serif");
  assert.equal(fonts.fontFamilyCss("A \"Quoted\" Font"), "\"A \\\"Quoted\\\" Font\", sans-serif");
});

test("installed font discovery de-duplicates and sorts families", async () => {
  globalThis.window = {
    queryLocalFonts: async () => [
      { family: "Zeta Sans" },
      { family: " alpha Serif " },
      { family: "Alpha Serif" },
      { family: "" },
    ],
  };

  assert.equal(fonts.supportsInstalledFontAccess(), true);
  const options = await fonts.queryInstalledFontOptions();
  assert.deepEqual(options.map(option => option.family), ["alpha Serif", "Zeta Sans"]);
});
