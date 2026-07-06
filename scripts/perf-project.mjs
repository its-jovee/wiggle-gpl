import { readFileSync } from "node:fs";

const file = process.argv[2];

if (!file) {
  console.error("Usage: npm run perf:project -- /path/to/project.json");
  process.exit(1);
}

const project = JSON.parse(readFileSync(file, "utf8"));

let layers = 0;
let strokes = 0;
let points = 0;
let fills = 0;
let texts = 0;
let subPanels = 0;

function countLayer(layer) {
  layers++;
  strokes += layer.strokes?.length ?? 0;
  fills += layer.fills?.length ?? 0;
  texts += layer.texts?.length ?? 0;
  for (const stroke of layer.strokes ?? []) {
    points += stroke.points?.length ?? 0;
  }
}

for (const panel of project.panels ?? []) {
  for (const layer of panel.layers ?? []) countLayer(layer);
  for (const sp of panel.subPanels ?? []) {
    subPanels++;
    for (const layer of sp.layers ?? []) countLayer(layer);
  }
}

console.log(JSON.stringify({
  file,
  version: project.version,
  size: { width: project.width, height: project.height },
  panels: project.panels?.length ?? 0,
  subPanels,
  layers,
  strokes,
  points,
  fills,
  texts,
}, null, 2));
