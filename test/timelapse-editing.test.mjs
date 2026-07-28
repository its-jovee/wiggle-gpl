import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const outDir = join(tmpdir(), "wigostudio-timelapse-editing-test");

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
  "src/core/timelapseCamera.ts",
  "src/core/rasterTimelapse.ts",
  "src/core/types.ts",
], { stdio: "inherit" });

const camera = await import(`${outDir}/timelapseCamera.js`);
const raster = await import(`${outDir}/rasterTimelapse.js`);
const types = await import(`${outDir}/types.js`);
const validation = await import(`${outDir}/projectValidation.js`);

const stroke = (length, color = "#000000") => ({
  brush: "pencil",
  color,
  size: 4,
  points: [{ x: 0, y: 0 }, { x: length, y: 0 }],
});

test("timelapse camera interpolates deterministically and clamps the visible frame", () => {
  const frames = [
    { progress: 0, centerX: 50, centerY: 50, zoom: 2, easing: "linear" },
    { progress: 1, centerX: 150, centerY: 150, zoom: 4, easing: "easeInOut" },
  ];
  assert.deepEqual(camera.timelapseCameraAtProgress(frames, 0.5, 200, 200), {
    centerX: 100,
    centerY: 100,
    zoom: 3,
  });
  const clamped = camera.normalizeTimelapseCameraKeyframe(
    { progress: 2, centerX: -100, centerY: 500, zoom: 20, easing: "wat" },
    200,
    100,
  );
  assert.equal(clamped.progress, 1);
  assert.equal(clamped.zoom, 8);
  assert.equal(clamped.centerX, 12.5);
  assert.equal(clamped.centerY, 93.75);
  assert.equal(clamped.easing, "easeInOut");
});

test("camera upsert replaces a keyframe at the same edit time", () => {
  const first = camera.upsertTimelapseCameraKeyframe([], {
    progress: 0.25, centerX: 50, centerY: 50, zoom: 2, easing: "linear",
  }, 200, 100);
  const replaced = camera.upsertTimelapseCameraKeyframe(first, {
    progress: 0.251, centerX: 80, centerY: 40, zoom: 3, easing: "easeOut",
  }, 200, 100);
  assert.equal(replaced.length, 1);
  assert.equal(replaced[0].centerX, 80);
  assert.equal(replaced[0].zoom, 3);
});

test("camera upsert stays within the persisted keyframe limit", () => {
  const frames = Array.from(
    { length: validation.MAX_TIMELAPSE_CAMERA_KEYFRAMES },
    (_, index) => ({
      progress: index / (validation.MAX_TIMELAPSE_CAMERA_KEYFRAMES - 1),
      centerX: 100,
      centerY: 50,
      zoom: 1,
      easing: "linear",
    }),
  );
  const capped = camera.upsertTimelapseCameraKeyframe(frames, {
    progress: 0.12345,
    centerX: 100,
    centerY: 50,
    zoom: 2,
    easing: "easeInOut",
  }, 200, 100, 0);
  assert.equal(capped.length, validation.MAX_TIMELAPSE_CAMERA_KEYFRAMES);
  assert.equal(capped.some((frame) => frame.progress === 0.12345), false);
});

test("legacy raster pixels become a baseline and later edits append in order", () => {
  const layer = {
    id: "r1", name: "Raster", visible: true, opacity: 1, kind: "raster",
    strokes: [], fills: [],
    raster: { data: "data:image/png;base64,OLD", width: 100, height: 100 },
  };
  raster.appendRasterTimelapseStroke(layer, stroke(10), 7, layer.raster.data);
  assert.equal(layer.raster.timelapse.baseline, "data:image/png;base64,OLD");
  assert.equal(layer.raster.timelapse.events[0].kind, "stroke");
  assert.equal(layer.raster.timelapse.events[0].strokeIndex, 7);

  raster.appendRasterTimelapseCheckpoint(
    layer,
    "data:image/png;base64,AFTER_STROKE",
    "data:image/png;base64,AFTER_FILL",
  );
  raster.appendRasterTimelapseStroke(layer, stroke(5, "#ffffff"), 8, layer.raster.data);
  assert.deepEqual(layer.raster.timelapse.events.map((event) => event.kind), [
    "stroke", "checkpoint", "stroke",
  ]);
  assert.equal(raster.rasterTimelapseTotalWeight(layer, (item) => item.points[1].x), 16);
});

test("raster journals roll their baseline before exceeding the persisted event limit", () => {
  const layer = {
    id: "r-limit", name: "Raster", visible: true, opacity: 1, kind: "raster",
    strokes: [], fills: [],
    raster: {
      data: "data:image/png;base64,CURRENT",
      width: 100,
      height: 100,
      timelapse: {
        baseline: "data:image/png;base64,OLD",
        events: Array.from(
          { length: validation.MAX_RASTER_TIMELAPSE_EVENTS },
          () => ({ kind: "checkpoint", data: "data:image/png;base64,STEP" }),
        ),
      },
    },
  };
  const baselineChanged = raster.appendRasterTimelapseStroke(
    layer,
    stroke(4),
    22,
    "data:image/png;base64,CURRENT",
  );
  assert.equal(baselineChanged, true);
  assert.equal(layer.raster.timelapse.baseline, "data:image/png;base64,CURRENT");
  assert.equal(layer.raster.timelapse.events.length, 1);
  assert.equal(layer.raster.timelapse.events[0].kind, "stroke");
});

test("camera tracks and raster journals survive project migration", () => {
  const project = types.newProject(200, 100);
  const layer = types.newLayer("Raster", "raster", { width: 200, height: 100 });
  raster.appendRasterTimelapseStroke(layer, stroke(10), 4, layer.raster.data);
  project.panels[0].layers = [layer];
  project.panels[0].stack = [{ kind: "layer", id: layer.id }];
  const sourceId = project.panels[0].id;
  project.panels.push({
    ...types.newPanel(),
    kind: "timelapse",
    layers: [],
    stack: [],
    timelapse: {
      sourceId,
      camera: [
        { progress: 0, centerX: 100, centerY: 50, zoom: 1, easing: "linear" },
        { progress: 1, centerX: 125, centerY: 50, zoom: 2, easing: "easeInOut" },
      ],
    },
  });
  const migrated = types.migrateProject(JSON.parse(JSON.stringify(project)));
  assert.equal(migrated.panels[0].layers[0].raster.timelapse.events.length, 1);
  assert.equal(migrated.panels[1].timelapse.camera.length, 2);
});
