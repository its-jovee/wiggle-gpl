/**
 * Browser perf smoke test.
 * Usage: node scripts/browser-perf.mjs <projectPath> [--gpu]
 *
 * Default is headless, which software-rasterizes canvas (SwiftShader). That is
 * fine for regression comparisons — the deltas are real — but the absolute
 * milliseconds are much worse than a GPU-composited build. Pass --gpu to run
 * headed with hardware acceleration when you need honest absolute numbers to
 * set a budget against.
 */
import { chromium } from "playwright";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const gpu = args.includes("--gpu");
const target = args.find((a) => !a.startsWith("--"));
if (!target) throw new Error("usage: node scripts/browser-perf.mjs <projectPath> [--gpu]");
const projectPath = resolve(target);
const projectUrl = `/@fs${projectPath.startsWith("/") ? projectPath : `/${projectPath}`}`;
const appUrl = `http://localhost:5173/?perf=1&project=${encodeURIComponent(projectUrl)}`;

const browser = await chromium.launch(
  gpu
    ? {
        headless: false,
        args: ["--ignore-gpu-blocklist", "--enable-gpu-rasterization", "--enable-zero-copy"],
      }
    : { headless: true }
);
const page = await browser.newPage();

const consoleErrors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") {
    const source = msg.location().url;
    consoleErrors.push(source ? `${msg.text()} (${source})` : msg.text());
  }
});
page.on("pageerror", (err) => consoleErrors.push(String(err)));

await page.goto(appUrl, { waitUntil: "networkidle", timeout: 120_000 });
await page.waitForFunction(
  () => document.documentElement.dataset.wigglePerf,
  { timeout: 120_000 }
);

// Let a few idle frames settle.
await page.waitForTimeout(1500);
const idlePerf = JSON.parse(
  await page.evaluate(() => document.documentElement.dataset.wigglePerf ?? "{}")
);

// Start playback and sample perf during playback.
await page.click("#play");
await page.waitForTimeout(4000);
await page.click("#play");
await page.waitForTimeout(500);

const playbackPerf = JSON.parse(
  await page.evaluate(() => document.documentElement.dataset.wigglePerf ?? "{}")
);

const status = await page.evaluate(() => {
  const el = document.getElementById("status");
  return el?.textContent ?? "";
});

await browser.close();

const report = {
  projectPath,
  appUrl,
  renderer: gpu ? "gpu (headed)" : "swiftshader (headless)",
  status,
  consoleErrors,
  idle: summarize(idlePerf),
  playback: summarize(playbackPerf),
};

console.log(JSON.stringify(report, null, 2));

function summarize(perf) {
  if (!perf?.buckets) return perf;
  const buckets = {};
  for (const [key, b] of Object.entries(perf.buckets)) {
    buckets[key] = {
      count: b.count,
      avgMs: round(b.avgMs),
      maxMs: round(b.maxMs),
    };
  }
  return {
    frames: perf.frames,
    wiggleTicks: perf.wiggleTicks,
    cache: perf.cache,
    buckets,
  };
}

function round(n) {
  return Math.round((n ?? 0) * 100) / 100;
}

if (consoleErrors.length > 0) process.exitCode = 1;
