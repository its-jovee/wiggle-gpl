import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const outDir = join(tmpdir(), "wigostudio-audio-test");

function compileAudio() {
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
    "src/core/audioTimeline.ts",
    "src/core/types.ts",
  ], { stdio: "inherit" });
}

compileAudio();
const timeline = await import(`${outDir}/audioTimeline.js`);
const types = await import(`${outDir}/types.js`);

function asset(durationMs = 1000) {
  return {
    id: "asset-1",
    kind: "import",
    name: "sound.wav",
    path: "/tmp/sound.wav",
    durationMs,
    createdAt: 1,
  };
}

function clip() {
  return {
    id: "clip-1",
    assetId: "asset-1",
    startMs: 100,
    offsetMs: 50,
    durationMs: 600,
    volume: 1,
    fadeInMs: 0,
    fadeOutMs: 0,
  };
}

test("trim start moves source offset and preserves old end", () => {
  const next = timeline.trimClipStart(clip(), asset(), 250);
  assert.equal(next.startMs, 250);
  assert.equal(next.offsetMs, 200);
  assert.equal(next.durationMs, 450);
});

test("trim end clamps to asset duration", () => {
  const next = timeline.trimClipEnd(clip(), asset(500), 1000);
  assert.equal(next.durationMs, 450);
});

test("split creates two valid clips at playhead", () => {
  const parts = timeline.splitClip(clip(), asset(), 400);
  assert.equal(parts.length, 2);
  assert.equal(parts[0].durationMs, 300);
  assert.equal(parts[1].startMs, 400);
  assert.equal(parts[1].offsetMs, 350);
});

test("move clamps negative starts to zero", () => {
  assert.equal(timeline.moveClip(clip(), -200).startMs, 0);
});

test("fade durations clamp to half the clip duration", () => {
  const next = timeline.setClipFades({ ...clip(), durationMs: 500 }, 900, 900);
  assert.equal(next.fadeInMs, 250);
  assert.equal(next.fadeOutMs, 250);
});

test("total audio duration ignores muted tracks", () => {
  const audio = {
    sampleRate: 48000,
    assets: [asset()],
    tracks: [
      { id: "a", name: "Voice", muted: false, clips: [{ ...clip(), startMs: 1000 }] },
      { id: "b", name: "Muted", muted: true, clips: [{ ...clip(), startMs: 5000 }] },
    ],
  };
  assert.equal(timeline.totalAudioDuration(audio), 1600);
});

test("export plan excludes muted tracks and missing assets", () => {
  const audio = {
    sampleRate: 48000,
    assets: [asset()],
    tracks: [
      { id: "a", name: "Voice", muted: false, clips: [clip(), { ...clip(), id: "missing", assetId: "nope" }] },
      { id: "b", name: "Muted", muted: true, clips: [{ ...clip(), id: "muted" }] },
    ],
  };
  const plan = timeline.buildAudioExportPlan(audio);
  assert.equal(plan.length, 1);
  assert.equal(plan[0].assetPath, "/tmp/sound.wav");
});

test("v4 project migrates to current version with default audio tracks", () => {
  const migrated = types.migrateProject({
    version: 4,
    width: 1080,
    height: 1920,
    wiggleFps: 8,
    panels: [],
  });
  assert.equal(migrated.version, 13);
  assert.deepEqual(migrated.audio.tracks.map((t) => t.name), ["Voice", "SFX", "Music"]);
  assert.deepEqual(migrated.brushPresets, []);
});

test("v6 project migrates to current version with default drawing-power layer fields", () => {
  const migrated = types.migrateProject({
    version: 6,
    width: 1080,
    height: 1920,
    wiggleFps: 8,
    panels: [{
      id: "panel-1",
      durationMs: 1000,
      bg: "#000000",
      paletteId: null,
      layers: [{
        id: "layer-1",
        name: "Layer 1",
        visible: true,
        opacity: 1,
        kind: "draw",
        clipToBelow: false,
        strokes: [],
        fills: [],
      }],
      activeLayerIndex: 0,
      kind: "normal",
      subPanels: [{
        id: "sub-1",
        bounds: { x: 0, y: 0, w: 100, h: 100 },
        shape: "rect",
        border: { brush: "round", color: "#ffffff", thickness: 2, wiggleAmplitude: 2 },
        bg: null,
        layers: [{
          id: "sub-layer-1",
          name: "Layer 1",
          visible: true,
          opacity: 1,
          kind: "draw",
          clipToBelow: false,
          strokes: [],
          fills: [],
        }],
        activeLayerIndex: 0,
      }],
      guides: [],
    }],
    audio: { sampleRate: 48000, assets: [], tracks: [] },
  });

  assert.equal(migrated.version, 13);
  assert.equal(migrated.panels[0].layers[0].blendMode, "normal");
  assert.equal(migrated.panels[0].subPanels[0].layers[0].blendMode, "normal");
  assert.deepEqual(migrated.brushPresets, []);
});
