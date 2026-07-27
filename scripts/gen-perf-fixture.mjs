// Generates heavy project JSONs for perf baselines / ?perf=1&project=...
//
// Two fixtures, because they isolate different costs:
//   perf-heavy   — few layers, lots of points  → stroke/stamp cost
//   perf-layers8 — many layers, fewer points   → per-layer compositing cost
// perf-layers8 carries LESS total ink than perf-heavy; if it renders slower,
// the cost is per-layer compositing rather than drawing. Keep both.
//
// Ids are deterministic (not randomUUID) so regenerating a fixture doesn't
// show up as a spurious git diff.
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function stroke(points) {
  return { brush: "round", color: "#ff6b6b", size: 4, points };
}

function layer(id, name, strokeCount, pointsPerStroke) {
  const strokes = [];
  for (let s = 0; s < strokeCount; s++) {
    const pts = [];
    for (let p = 0; p < pointsPerStroke; p++) {
      pts.push({ x: 40 + s * 12 + p * 3, y: 80 + s * 5 + Math.sin(p * 0.4) * 30 });
    }
    strokes.push(stroke(pts));
  }
  return { id, name, visible: true, opacity: 1, strokes, fills: [], texts: [] };
}

function makeProject(panels) {
  return { version: 5, width: 1080, height: 1920, wiggleFps: 8, panels, audio: { tracks: [] } };
}

function write(name, data) {
  const out = join(root, `test/fixtures/${name}.json`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(data));
  console.log(`Wrote ${out}`);
}

// --- perf-heavy: 12 panels x 3 layers, ~2160 points/layer -------------------
const heavyPanels = [];
for (let i = 0; i < 12; i++) {
  heavyPanels.push({
    id: `perf-heavy-panel-${i}`,
    durationMs: 1000,
    bg: "#ffffff",
    paletteId: null,
    layers: [
      layer(`perf-heavy-${i}-l1`, `L1-${i}`, 8, 120),
      layer(`perf-heavy-${i}-l2`, `L2-${i}`, 6, 90),
      layer(`perf-heavy-${i}-l3`, `L3-${i}`, 4, 60),
    ],
    subPanels: [],
  });
}
write("perf-heavy", makeProject(heavyPanels));

// --- perf-layers8: 12 panels x 8 layers, ~480 points/layer ------------------
const layerPanels = [];
for (let i = 0; i < 12; i++) {
  const layers = [];
  for (let l = 0; l < 8; l++) {
    layers.push(layer(`perf-layers8-${i}-l${l}`, `L${l}-${i}`, 6, 80));
  }
  layerPanels.push({
    id: `perf-layers8-panel-${i}`,
    durationMs: 1000,
    bg: "#ffffff",
    paletteId: null,
    layers,
    subPanels: [],
  });
}
write("perf-layers8", makeProject(layerPanels));
