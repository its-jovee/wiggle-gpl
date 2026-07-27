/**
 * Runs the perf harness across every fixture and compares against a committed
 * baseline, so a compositing regression fails loudly instead of quietly making
 * the app worse.
 *
 * Usage:
 *   node scripts/perf-bench.mjs            # compare against baseline
 *   node scripts/perf-bench.mjs --update   # rewrite the baseline
 *   node scripts/perf-bench.mjs --gpu      # headed/GPU numbers
 *
 * Requires the dev server on :5173 (npm run dev).
 *
 * Baselines are renderer-specific: SwiftShader (headless) and GPU (headed)
 * produce very different absolute numbers, so they are stored under separate
 * keys and only ever compared like-for-like.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const baselinePath = join(root, "test/fixtures/perf-baseline.json");

const args = process.argv.slice(2);
const update = args.includes("--update");
const gpu = args.includes("--gpu");
const renderer = gpu ? "gpu" : "swiftshader";

// Regression tolerance. Browser perf is noisy; anything under this is drift.
const TOLERANCE = 1.25;

const FIXTURES = ["perf-heavy", "perf-layers8"];

const results = {};
let hadConsoleErrors = false;
for (const name of FIXTURES) {
  const fixture = join(root, `test/fixtures/${name}.json`);
  // browser-perf exits nonzero when the page logged a console error. We still
  // want its measurements, so read stdout either way and report the errors.
  let out;
  try {
    out = execFileSync(
      process.execPath,
      [join(root, "scripts/browser-perf.mjs"), fixture, ...(gpu ? ["--gpu"] : [])],
      { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }
    );
  } catch (err) {
    if (!err.stdout) throw err;
    out = err.stdout;
  }
  const report = JSON.parse(out);
  if (report.consoleErrors?.length) {
    hadConsoleErrors = true;
    console.error(`[${name}] console errors:`);
    for (const e of report.consoleErrors) console.error(`  ${e}`);
  }
  results[name] = {
    idleMainAvgMs: report.idle?.buckets?.["idle-main"]?.avgMs ?? null,
    idleMainMaxMs: report.idle?.buckets?.["idle-main"]?.maxMs ?? null,
    playbackAvgMs: report.playback?.buckets?.["playback-main"]?.avgMs ?? null,
    rawLayerHits: report.idle?.cache?.rawLayerHits ?? 0,
    rawLayerMisses: report.idle?.cache?.rawLayerMisses ?? 0,
    cacheMB: Math.round((report.playback?.cache?.rawLayerBytes ?? 0) / 1048576),
  };
}

// Frame maxima are useful diagnostics but too sensitive to one-off GC/OS
// scheduling spikes for a repeatable pass/fail gate. Compare stable averages;
// continue printing max values above so real hitch investigations still see them.
const METRICS = ["idleMainAvgMs", "playbackAvgMs"];

if (update) {
  const existing = existsSync(baselinePath)
    ? JSON.parse(readFileSync(baselinePath, "utf8"))
    : {};
  existing[renderer] = results;
  writeFileSync(baselinePath, `${JSON.stringify(existing, null, 2)}\n`);
  console.log(`Updated baseline (${renderer}):\n${JSON.stringify(results, null, 2)}`);
  process.exit(0);
}

console.log(`renderer: ${renderer}\n`);
for (const [name, r] of Object.entries(results)) {
  const hitRate = r.rawLayerHits + r.rawLayerMisses > 0
    ? ((r.rawLayerHits / (r.rawLayerHits + r.rawLayerMisses)) * 100).toFixed(0)
    : "n/a";
  console.log(
    `${name.padEnd(14)} idle ${String(r.idleMainAvgMs).padStart(7)}ms avg  ` +
    `${String(r.idleMainMaxMs).padStart(7)}ms max  ` +
    `playback ${String(r.playbackAvgMs).padStart(7)}ms  ` +
    `cache ${hitRate}% hit  ${String(r.cacheMB).padStart(4)}MB`
  );
}

if (!existsSync(baselinePath)) {
  console.log("\nNo baseline yet — run with --update to record one.");
  process.exit(0);
}

const baseline = JSON.parse(readFileSync(baselinePath, "utf8"))[renderer];
if (!baseline) {
  console.log(`\nNo baseline for renderer "${renderer}" — run with --update.`);
  process.exit(0);
}

const regressions = [];
for (const name of FIXTURES) {
  for (const metric of METRICS) {
    const now = results[name]?.[metric];
    const then = baseline[name]?.[metric];
    if (typeof now !== "number" || typeof then !== "number" || then <= 0) continue;
    if (now > then * TOLERANCE) {
      regressions.push(
        `${name}.${metric}: ${then}ms -> ${now}ms (+${(((now / then) - 1) * 100).toFixed(0)}%)`
      );
    }
  }
}

if (regressions.length > 0) {
  console.error(`\nPERF REGRESSION (tolerance ${TOLERANCE}x):`);
  for (const r of regressions) console.error(`  ${r}`);
  process.exit(1);
}
if (hadConsoleErrors) {
  console.error("\nPerformance run logged browser errors.");
  process.exit(1);
}
console.log("\nNo regression against baseline.");
