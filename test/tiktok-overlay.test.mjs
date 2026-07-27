import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";

const outDir = join(tmpdir(), "wigo-studio-tiktok-overlay-test");
const outFile = join(outDir, "tiktok-overlay.mjs");

function compileOverlay() {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  execFileSync("npx", [
    "esbuild",
    "src/core/tiktokOverlay.ts",
    "--bundle",
    "--format=esm",
    "--platform=node",
    `--outfile=${outFile}`,
  ], { stdio: "inherit" });
}

compileOverlay();
const overlay = await import(pathToFileURL(outFile).href);

test("TikTok overlay uses the 1080x1920 organic-feed UI visibility guide", () => {
  assert.deepEqual(overlay.tiktokOverlayLayout(1080, 1920), {
    safeArea: { x: 60, y: 130, width: 880, height: 1450 },
    topRisk: { x: 0, y: 0, width: 1080, height: 130 },
    rightRisk: { x: 940, y: 130, width: 140, height: 1450 },
    bottomRisk: { x: 0, y: 1580, width: 1080, height: 340 },
  });
});

test("TikTok overlay layout scales proportionally with the project canvas", () => {
  assert.deepEqual(overlay.tiktokOverlayLayout(540, 960), {
    safeArea: { x: 30, y: 65, width: 440, height: 725 },
    topRisk: { x: 0, y: 0, width: 540, height: 65 },
    rightRisk: { x: 470, y: 65, width: 70, height: 725 },
    bottomRisk: { x: 0, y: 790, width: 540, height: 170 },
  });
});
