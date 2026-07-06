import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const outDir = join(tmpdir(), "wigglestudio-mask-controls-test");

function compileMaskControls() {
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
    "src/core/audioTypes.ts",
    "src/core/types.ts",
    "src/core/maskControls.ts",
  ], { stdio: "inherit" });
}

compileMaskControls();
const masks = await import(`${outDir}/maskControls.js`);

function maskedLayer() {
  return {
    id: "layer-1",
    name: "Layer 1",
    visible: true,
    opacity: 1,
    blendMode: "normal",
    kind: "draw",
    strokes: [],
    fills: [],
    mask: {
      enabled: true,
      mode: "reveal",
      shape: { kind: "rect", x: 0, y: 0, w: 10, h: 10 },
    },
  };
}

test("mask controls expose badges and preserve mask shape while toggling state", () => {
  const layer = maskedLayer();

  assert.equal(masks.layerMaskBadge(layer), "Mask");
  masks.setMaskEnabled(layer, false);
  assert.equal(layer.mask.enabled, false);
  masks.invertMask(layer);
  assert.equal(layer.mask.mode, "hide");
  assert.deepEqual(layer.mask.shape, { kind: "rect", x: 0, y: 0, w: 10, h: 10 });
  masks.deleteMask(layer);
  assert.equal(layer.mask, undefined);
  assert.equal(masks.layerMaskBadge(layer), null);
});

test("mask overlay state is transient and layer-scoped", () => {
  let state = masks.setMaskOverlayLayer(null, "layer-1", true);
  assert.equal(state, "layer-1");
  state = masks.setMaskOverlayLayer(state, "layer-2", true);
  assert.equal(state, "layer-2");
  state = masks.setMaskOverlayLayer(state, "layer-2", false);
  assert.equal(state, null);
});
