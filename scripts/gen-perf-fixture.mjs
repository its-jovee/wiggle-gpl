// Generates a heavy project JSON for perf baseline / ?perf=1&project=...
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "test/fixtures/perf-heavy.json");

function stroke(points) {
  return { brush: "round", color: "#ff6b6b", size: 4, points };
}

function layer(name, strokeCount, pointsPerStroke) {
  const strokes = [];
  for (let s = 0; s < strokeCount; s++) {
    const pts = [];
    for (let p = 0; p < pointsPerStroke; p++) {
      pts.push({ x: 40 + s * 12 + p * 3, y: 80 + s * 5 + Math.sin(p * 0.4) * 30 });
    }
    strokes.push(stroke(pts));
  }
  return {
    id: crypto.randomUUID(),
    name,
    visible: true,
    opacity: 1,
    strokes,
    fills: [],
    texts: [],
  };
}

const panels = [];
for (let i = 0; i < 12; i++) {
  panels.push({
    id: crypto.randomUUID(),
    durationMs: 1000,
    bg: "#ffffff",
    paletteId: null,
    layers: [
      layer(`L1-${i}`, 8, 120),
      layer(`L2-${i}`, 6, 90),
      layer(`L3-${i}`, 4, 60),
    ],
    subPanels: [],
  });
}

const project = {
  version: 5,
  width: 1080,
  height: 1920,
  wiggleFps: 8,
  panels,
  audio: { tracks: [] },
};

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(project));
console.log(`Wrote ${out}`);
