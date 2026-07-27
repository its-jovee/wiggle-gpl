import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const outDir = join(tmpdir(), "wigostudio-raster-store-test");

function compileRasterStore() {
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
    "src/core/audioTypes.ts",
    "src/core/types.ts",
    "src/core/rasterStore.ts",
  ], { stdio: "inherit" });
}

compileRasterStore();
const store = await import(`${outDir}/rasterStore.js`);

function fakeCanvas() {
  let toDataURLCalls = 0;
  return {
    width: 0,
    height: 0,
    getContext: () => ({ clearRect() {}, drawImage() {} }),
    toDataURL: () => `data:image/png;base64,STUB${++toDataURLCalls}`,
  };
}

function stubDecoder(decodeCalls) {
  return (dataUrl) => {
    decodeCalls.push(dataUrl);
    return Promise.resolve({ width: 10, height: 10 });
  };
}

function rasterLayer(id, data = "data:image/png;base64,AAA") {
  return {
    id,
    name: id,
    visible: true,
    opacity: 1,
    kind: "raster",
    raster: { data, width: 10, height: 10 },
    strokes: [],
    fills: [],
  };
}

test("getRasterCanvas decodes lazily and returns null until ready", async () => {
  const decodeCalls = [];
  store.setRasterTestBackends({ decodeImage: stubDecoder(decodeCalls), makeCanvas: fakeCanvas });
  const layer = rasterLayer("layer-decode-1");

  const first = store.getRasterCanvas(layer);
  assert.equal(first, null, "should be null while decoding");
  assert.equal(decodeCalls.length, 1);

  await Promise.resolve().then(() => Promise.resolve());
  const second = store.getRasterCanvas(layer);
  assert.ok(second, "should return the canvas once decoded");
  assert.equal(store.rasterPixelVersion(layer), 1);
});

test("re-decodes only when layer.raster.data changes", async () => {
  const decodeCalls = [];
  store.setRasterTestBackends({ decodeImage: stubDecoder(decodeCalls), makeCanvas: fakeCanvas });
  const layer = rasterLayer("layer-decode-2");

  store.getRasterCanvas(layer);
  await Promise.resolve().then(() => Promise.resolve());
  store.getRasterCanvas(layer);
  assert.equal(decodeCalls.length, 1, "same data string should not re-decode");
  const versionBeforeReload = store.rasterPixelVersion(layer);

  layer.raster.data = "data:image/png;base64,BBB";
  const afterEdit = store.getRasterCanvas(layer);
  assert.equal(afterEdit, null, "changed data should re-trigger decode");
  assert.equal(decodeCalls.length, 2);
  assert.ok(store.rasterPixelVersion(layer) > versionBeforeReload, "invalidation must change the render version");
  await Promise.resolve().then(() => Promise.resolve());
  assert.ok(store.getRasterCanvas(layer));
});

test("markRasterEdited bumps pixelVersion without touching layer.raster.data", async () => {
  const decodeCalls = [];
  store.setRasterTestBackends({ decodeImage: stubDecoder(decodeCalls), makeCanvas: fakeCanvas });
  const layer = rasterLayer("layer-edit-1");
  store.getRasterCanvas(layer);
  await Promise.resolve().then(() => Promise.resolve());
  store.getRasterCanvas(layer);
  const versionAfterDecode = store.rasterPixelVersion(layer);

  store.markRasterEdited(layer);
  assert.equal(store.rasterPixelVersion(layer), versionAfterDecode + 1);
});

test("syncRasterToLayer writes the canvas back without triggering a re-decode", async () => {
  const decodeCalls = [];
  store.setRasterTestBackends({ decodeImage: stubDecoder(decodeCalls), makeCanvas: fakeCanvas });
  const layer = rasterLayer("layer-sync-1");
  store.getRasterCanvas(layer);
  await Promise.resolve().then(() => Promise.resolve());
  store.getRasterCanvas(layer);

  store.markRasterEdited(layer);
  store.syncRasterToLayer(layer);
  assert.match(layer.raster.data, /^data:image\/png;base64,STUB/);

  const afterSync = store.getRasterCanvas(layer);
  assert.ok(afterSync, "syncing should not invalidate the just-synced canvas");
  assert.equal(decodeCalls.length, 1, "sync must not trigger a re-decode");
});

test("pruneRasterStore drops entries for layers that no longer exist", async () => {
  const decodeCalls = [];
  store.setRasterTestBackends({ decodeImage: stubDecoder(decodeCalls), makeCanvas: fakeCanvas });
  const layer = rasterLayer("layer-prune-1");
  store.getRasterCanvas(layer);
  await Promise.resolve().then(() => Promise.resolve());
  assert.ok(store.getRasterCanvas(layer));

  store.pruneRasterStore(new Set());
  assert.equal(store.rasterPixelVersion(layer), 0, "pruned entry should read as fresh/undecoded");
  const afterPrune = store.getRasterCanvas(layer);
  assert.equal(afterPrune, null, "pruned entry should re-decode from scratch");
  assert.equal(decodeCalls.length, 2);
});

test("raster preparation decodes a target without replacing the live canvas", async () => {
  const decodeCalls = [];
  store.setRasterTestBackends({ decodeImage: stubDecoder(decodeCalls), makeCanvas: fakeCanvas });
  const currentLayer = rasterLayer("layer-prepare-1", "data:image/png;base64,CURRENT");
  store.getRasterCanvas(currentLayer);
  await Promise.resolve().then(() => Promise.resolve());
  const currentCanvas = store.getRasterCanvas(currentLayer);

  const targetLayer = rasterLayer("layer-prepare-1", "data:image/png;base64,TARGET");
  const targetProject = { panels: [{ id: "panel", layers: [targetLayer], subPanels: [] }] };
  const preparation = await store.prepareRasterCanvases(targetProject, ["panel"]);
  assert.equal(preparation.entries.length, 1);
  assert.equal(store.getRasterCanvas(currentLayer), currentCanvas, "live pixels stay visible while target decodes");

  store.commitRasterPreparation(preparation);
  assert.equal(store.getRasterCanvas(targetLayer), preparation.entries[0].canvas);
  assert.deepEqual(decodeCalls, ["data:image/png;base64,CURRENT", "data:image/png;base64,TARGET"]);
});
