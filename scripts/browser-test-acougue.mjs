/**
 * Browser smoke test: load acougue.json and exercise marquee selection.
 * Run: node scripts/browser-test-acougue.mjs [path-to-json]
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const projectPath = resolve(process.argv[2] ?? `${process.env.HOME}/Documents/acougue.json`);
const url = process.env.VITE_DEV_URL ?? "http://localhost:5173/";

async function main() {
  const raw = readFileSync(projectPath);
  console.log(`Project file: ${projectPath} (${(raw.length / 1024 / 1024).toFixed(1)} MB)`);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console: ${msg.text()}`);
  });

  await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });

  // Load project via hidden file input (same path as File > Open fallback).
  await page.setInputFiles("#load-project-file", projectPath);

  // Wait for load — large file may take a while.
  await page.waitForFunction(
    () => document.getElementById("status")?.textContent?.includes("opened acougue.json"),
    { timeout: 120000 }
  );
  const statusAfterLoad = await page.locator("#status").textContent();
  console.log("Load status:", statusAfterLoad);

  await page.waitForSelector("#stage", { state: "visible", timeout: 60000 });
  await page.waitForSelector(".panel-cell", { timeout: 60000 });

  // Switch to a normal draw panel (panel 2 — first is timelapse).
  await page.locator(".panel-cell").nth(1).click();
  await page.waitForTimeout(500);

  // Activate Marquee tool.
  await page.locator("#tools-edit button[aria-label='Marquee']").click();

  const canvas = page.locator("#stage");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("canvas not found");

  const cx = box.x + box.width * 0.5;
  const cy = box.y + box.height * 0.45;

  // Drag a rectangular marquee.
  await page.mouse.move(cx - 80, cy - 60);
  await page.mouse.down();
  await page.mouse.move(cx + 80, cy + 60, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);

  const statusAfterMarquee = await page.locator("#status").textContent();
  console.log("After marquee:", statusAfterMarquee);

  // Switch to brush and verify selection persists (status hint).
  await page.locator("#tools-draw button[aria-label='Brush']").click();
  await page.waitForTimeout(200);
  const statusBrush = await page.locator("#status").textContent();
  console.log("After brush switch:", statusBrush);

  // Paint inside selection.
  await page.mouse.move(cx - 20, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 20, cy, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(300);

  // Extract with Enter.
  await page.locator("#tools-edit button[aria-label='Marquee']").click();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(500);
  const statusExtract = await page.locator("#status").textContent();
  console.log("After extract:", statusExtract);

  const editInspector = await page.locator("#edit-context-inspector").textContent();
  console.log("Edit inspector snippet:", editInspector?.slice(0, 120));

  if (errors.length) {
    console.error("Browser errors:", errors);
    process.exitCode = 1;
  } else {
    console.log("Browser smoke test passed.");
  }

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
