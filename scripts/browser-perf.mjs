/**
 * Headless browser perf smoke test.
 * Usage: node scripts/browser-perf.mjs [projectPath]
 */
import { chromium } from "playwright";

const projectPath = process.argv[2] ?? `${process.env.HOME}/Documents/acougue.json`;
const projectUrl = `/@fs${projectPath.startsWith("/") ? projectPath : `/${projectPath}`}`;
const appUrl = `http://localhost:5173/?perf=1&project=${encodeURIComponent(projectUrl)}`;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

const consoleErrors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
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
