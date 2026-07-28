import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const outDir = join(tmpdir(), "wigostudio-render-schedule-test");

function compileSchedule() {
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
    "src/core/types.ts",
    "src/core/audioTypes.ts",
    "src/core/renderSchedule.ts",
  ], { stdio: "inherit" });
}

compileSchedule();
const schedule = await import(`${outDir}/renderSchedule.js`);

test("idle canvas renders only on tick changes or live editor interaction", () => {
  assert.equal(schedule.shouldRenderIdleFrame({ tickChanged: false, interacting: false }), false);
  assert.equal(schedule.shouldRenderIdleFrame({ tickChanged: true, interacting: false }), true);
  assert.equal(schedule.shouldRenderIdleFrame({ tickChanged: false, interacting: true }), true);
});

test("discrete clock catches up when preview redraws are throttled", () => {
  assert.deepEqual(
    schedule.advanceDiscreteClock(10, 1000, 1250, 8),
    { tick: 12, lastMs: 1250, changed: true }
  );
  assert.deepEqual(
    schedule.advanceDiscreteClock(12, 1250, 1300, 8),
    { tick: 12, lastMs: 1250, changed: false }
  );
});

test("discrete clock preserves fractional remainder instead of accumulating drift", () => {
  const first = schedule.advanceDiscreteClock(0, 0, 260, 8);
  assert.deepEqual(first, { tick: 2, lastMs: 250, changed: true });
  assert.deepEqual(
    schedule.advanceDiscreteClock(first.tick, first.lastMs, 375, 8),
    { tick: 3, lastMs: 375, changed: true }
  );
});

test("editor onion passes render behind active preview and stay out of playback", () => {
  assert.deepEqual(
    schedule.editorPreviewPasses({
      onionEnabled: true,
      prevAvailable: 3,
      nextAvailable: 2,
      prevCount: 3,
      nextCount: 2,
      opacity: 0.3,
    }),
    [
      { kind: "onion-prev", offset: -3, alpha: 0.1, tint: "#73eff7" },
      { kind: "onion-prev", offset: -2, alpha: 0.15, tint: "#73eff7" },
      { kind: "onion-prev", offset: -1, alpha: 0.3, tint: "#73eff7" },
      { kind: "onion-next", offset: 2, alpha: 0.15, tint: "#ff8f5a" },
      { kind: "onion-next", offset: 1, alpha: 0.3, tint: "#ff8f5a" },
      { kind: "active", offset: 0, alpha: 1 },
    ]
  );
  assert.deepEqual(
    schedule.editorPreviewPasses({
      onionEnabled: false,
      prevAvailable: 3,
      nextAvailable: 2,
      prevCount: 3,
      nextCount: 2,
      opacity: 0.3,
    }),
    [{ kind: "active", offset: 0, alpha: 1 }]
  );
  assert.deepEqual(schedule.playbackPreviewPasses(), [{ kind: "active", offset: 0, alpha: 1 }]);
});

test("thumbnails refresh only after panel content changes", () => {
  assert.equal(schedule.shouldRefreshThumbnail("panel-a", new Set()), false);
  assert.equal(schedule.shouldRefreshThumbnail("panel-a", new Set(["panel-a"])), true);
  assert.equal(schedule.shouldRefreshThumbnail("panel-a", new Set(["panel-b"])), false);
});

test("base frame cache key changes when deterministic render inputs change", () => {
  const base = {
    panelId: "panel-a",
    contentVersion: 1,
    tick: 4,
    width: 1080,
    height: 1920,
    overscanX: 0,
    overscanY: 0,
    jitterEnabled: true,
    keyframeArm: null,
  };

  assert.equal(schedule.baseFrameCacheKey(base), schedule.baseFrameCacheKey({ ...base }));
  assert.notEqual(schedule.baseFrameCacheKey(base), schedule.baseFrameCacheKey({ ...base, tick: 5 }));
  assert.notEqual(schedule.baseFrameCacheKey(base), schedule.baseFrameCacheKey({ ...base, contentVersion: 2 }));
  assert.notEqual(schedule.baseFrameCacheKey(base), schedule.baseFrameCacheKey({ ...base, jitterEnabled: false }));
});

test("raw layer cache key changes when layer render inputs change", () => {
  const base = {
    layerSig: "layer-content",
    layerIndex: 1,
    tick: 3,
    width: 1080,
    height: 1920,
    skipFills: false,
    skipJitter: false,
    localMs: 0,
    containerDurMs: 1000,
    wiggleFps: 8,
    skipAnim: true,
  };

  assert.equal(schedule.rawLayerCacheKey(base), schedule.rawLayerCacheKey({ ...base }));
  assert.notEqual(schedule.rawLayerCacheKey(base), schedule.rawLayerCacheKey({ ...base, layerSig: "changed" }));
  assert.notEqual(schedule.rawLayerCacheKey(base), schedule.rawLayerCacheKey({ ...base, tick: 4 }));
  assert.notEqual(schedule.rawLayerCacheKey(base), schedule.rawLayerCacheKey({ ...base, skipJitter: true }));
});

test("time-independent layers canonicalize localMs in cache keys", () => {
  const layer = { texts: [] };
  assert.equal(
    schedule.canonicalRawLayerLocalMs(layer, true, 500),
    0
  );
  assert.equal(
    schedule.canonicalRawLayerLocalMs(layer, false, 500),
    0
  );
  const animated = { texts: [{ enter: { kind: "fade", durationTicks: 4 } }] };
  assert.equal(
    schedule.canonicalRawLayerLocalMs(animated, false, 500),
    500
  );
  assert.equal(
    schedule.canonicalRawLayerLocalMs(animated, true, 500),
    0
  );

  const base = {
    layerSig: "layer-content",
    layerIndex: 0,
    tick: 1,
    width: 1080,
    height: 1920,
    skipFills: false,
    skipJitter: false,
    localMs: schedule.canonicalRawLayerLocalMs(layer, true, 0),
    containerDurMs: schedule.canonicalRawLayerContainerDurMs(layer, true, 1000),
    wiggleFps: 8,
    skipAnim: true,
  };
  const withMs = {
    ...base,
    localMs: schedule.canonicalRawLayerLocalMs(layer, true, 500),
    containerDurMs: schedule.canonicalRawLayerContainerDurMs(layer, true, 1000),
  };
  assert.equal(schedule.rawLayerCacheKey(base), schedule.rawLayerCacheKey(withMs));

  const animBase = { ...base, skipAnim: false, localMs: 0, containerDurMs: 1000 };
  const animWithMs = {
    ...animBase,
    localMs: schedule.canonicalRawLayerLocalMs(animated, false, 500),
    containerDurMs: schedule.canonicalRawLayerContainerDurMs(animated, false, 1000),
  };
  const animOtherMs = {
    ...animBase,
    localMs: schedule.canonicalRawLayerLocalMs(animated, false, 750),
    containerDurMs: schedule.canonicalRawLayerContainerDurMs(animated, false, 1000),
  };
  assert.notEqual(schedule.rawLayerCacheKey(animWithMs), schedule.rawLayerCacheKey(animOtherMs));
});

test("timelapse progress is wiggle-quantized for consistent playback cadence", () => {
  assert.equal(schedule.timelapseProgressQuantized(0, 1000, 8), 0);
  assert.equal(schedule.timelapseProgressQuantized(125, 1000, 8), 1 / 7);
  assert.equal(schedule.timelapseProgressQuantized(875, 1000, 8), 1);
  assert.equal(schedule.timelapseProgressQuantized(999, 1000, 8), 1);
  assert.equal(schedule.timelapseProgressQuantized(0, 200, 8), 0);
  assert.equal(schedule.timelapseProgressQuantized(125, 200, 8), 1);
});

test("playback renders only on panel/tick changes unless panel is time-continuous", () => {
  const staticPanel = {
    durationMs: 1000,
    bg: "#fff",
    paletteId: null,
    layers: [{ id: "l1", name: "L1", visible: true, opacity: 1, strokes: [], fills: [] }],
  };
  const timelapsePanel = { ...staticPanel, kind: "timelapse", timelapse: { sourceId: "src" } };

  assert.equal(
    schedule.shouldRenderPlaybackFrame({
      panelIndex: 0,
      seqTick: 3,
      lastPanelIndex: 0,
      lastSeqTick: 3,
      continuous: false,
    }),
    false
  );
  assert.equal(
    schedule.shouldRenderPlaybackFrame({
      panelIndex: 0,
      seqTick: 4,
      lastPanelIndex: 0,
      lastSeqTick: 3,
      continuous: false,
    }),
    true
  );
  assert.equal(
    schedule.shouldRenderPlaybackFrame({
      panelIndex: 1,
      seqTick: 3,
      lastPanelIndex: 0,
      lastSeqTick: 3,
      continuous: false,
    }),
    true
  );
  assert.equal(
    schedule.shouldRenderPlaybackFrame({
      panelIndex: 0,
      seqTick: 3,
      lastPanelIndex: 0,
      lastSeqTick: 3,
      continuous: true,
    }),
    true
  );
  assert.equal(schedule.panelHasPlaybackContinuity(staticPanel), false);
  assert.equal(schedule.panelHasPlaybackContinuity(timelapsePanel), false);
  assert.equal(schedule.panelHasPlaybackContinuity({
    ...timelapsePanel,
    timelapse: {
      sourceId: "src",
      camera: [
        { progress: 0, centerX: 50, centerY: 50, zoom: 1, easing: "linear" },
        { progress: 1, centerX: 75, centerY: 75, zoom: 2, easing: "easeInOut" },
      ],
    },
  }), true);
  assert.equal(
    schedule.panelHasPlaybackContinuity({
      ...staticPanel,
      enter: { kind: "fade", durationTicks: 4 },
    }),
    true
  );
});

test("layer animation does not affect raw-layer localMs cache key", () => {
  const animatedLayer = {
    texts: [],
    animation: { enabled: true, startTick: 0, durationTicks: 8, from: {}, to: {}, easing: "linear" },
  };
  assert.equal(schedule.layerDependsOnLocalMs(animatedLayer, false), false);
  assert.equal(
    schedule.canonicalRawLayerLocalMs(animatedLayer, false, 500),
    0
  );
  assert.equal(schedule.panelHasPlaybackContinuity({
    durationMs: 1000,
    bg: "#fff",
    paletteId: null,
    layers: [animatedLayer],
  }), true);
});

test("group animation requests continuous playback", () => {
  const group = {
    group: true,
    layers: [],
    subPanels: [],
    animation: { enabled: true, startTick: 0, durationTicks: 8, from: {}, to: {}, easing: "linear" },
  };
  assert.equal(schedule.panelHasPlaybackContinuity({
    durationMs: 1000,
    bg: "#fff",
    paletteId: null,
    layers: [],
    subPanels: [group],
  }), true);
});

test("layer fades request continuous playback without invalidating raw pixels", () => {
  const fadedLayer = {
    texts: [],
    fadeIn: { durationTicks: 4 },
    fadeOut: { durationTicks: 2 },
  };
  assert.equal(schedule.layerDependsOnLocalMs(fadedLayer, false), false);
  assert.equal(schedule.canonicalRawLayerLocalMs(fadedLayer, false, 500), 0);
  assert.equal(schedule.panelHasPlaybackContinuity({
    durationMs: 1000,
    bg: "#fff",
    paletteId: null,
    layers: [fadedLayer],
  }), true);
});
