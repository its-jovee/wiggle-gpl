/** Longer steady-state playback sample for acougue.json */
import { chromium } from "playwright";

const projectUrl = encodeURIComponent("/@fs/Users/jovidepinedaluz/Documents/acougue.json");
const appUrl = `http://localhost:5173/?perf=1&project=${projectUrl}`;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto(appUrl, { waitUntil: "networkidle", timeout: 120_000 });
await page.waitForFunction(() => document.documentElement.dataset.wigglePerf, { timeout: 120_000 });

// Warm cache on panel 1
await page.waitForTimeout(2000);

// Reset perf counters via reload of dataset by evaluating reset - actually we can't reset easily.
// Instead: start playback from beginning after warm idle period.
await page.evaluate(() => {
  document.documentElement.dataset.wigglePerf = "";
});
await page.click("#play");
await page.waitForTimeout(8000);
await page.click("#play");

const perf = JSON.parse(await page.evaluate(() => document.documentElement.dataset.wigglePerf ?? "{}"));
const playback = perf.buckets?.["playback-main"];
const cache = perf.cache ?? {};
const hitRate = cache.rawLayerHits + cache.rawLayerMisses > 0
  ? (100 * cache.rawLayerHits / (cache.rawLayerHits + cache.rawLayerMisses)).toFixed(1)
  : "n/a";

console.log(JSON.stringify({
  playbackSeconds: 8,
  frames: perf.frames,
  wiggleTicks: perf.wiggleTicks,
  playbackRenders: playback?.count ?? 0,
  playbackRendersPerSec: playback ? (playback.count / 8).toFixed(1) : "n/a",
  playbackAvgMs: playback?.avgMs?.toFixed?.(2) ?? playback?.avgMs,
  playbackMaxMs: playback?.maxMs?.toFixed?.(2) ?? playback?.maxMs,
  cacheHitRatePct: hitRate,
  cache,
}, null, 2));

await browser.close();
