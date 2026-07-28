import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { chromium } from "playwright";
import { createServer as createViteServer } from "vite";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("actual app supports tool switching, drawing, undo, and redo", async () => {
  const vite = await createViteServer({
    root,
    logLevel: "silent",
    server: { host: "127.0.0.1", port: 0 },
  });
  await vite.listen();
  const address = vite.httpServer?.address();
  assert.ok(address && typeof address !== "string");

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  try {
    await page.addInitScript(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: "domcontentloaded" });
    await page.locator("#stage").waitFor({ state: "visible" });
    await page.locator('#tools-edit button[aria-label="Marquee"]').waitFor();

    const marquee = page.locator('#tools-edit button[aria-label="Marquee"]');
    await marquee.click();
    await marquee.evaluate((button) => {
      if (!button.classList.contains("active")) throw new Error("Marquee did not become active");
    });

    const classic = page.locator('#tools-draw button[aria-label="Classic"]');
    await classic.click();
    await classic.evaluate((button) => {
      if (!button.classList.contains("active")) throw new Error("Classic brush did not become active");
    });

    const box = await page.locator("#stage").boundingBox();
    assert.ok(box);
    const start = { x: box.x + box.width * 0.48, y: box.y + box.height * 0.48 };
    const end = { x: start.x + Math.min(36, box.width * 0.08), y: start.y + Math.min(24, box.height * 0.05) };
    const pen = {
      pointerId: 41,
      pointerType: "pen",
      isPrimary: true,
      button: 0,
      pressure: 0.72,
    };

    await page.dispatchEvent("#stage", "pointerdown", {
      ...pen,
      buttons: 1,
      clientX: start.x,
      clientY: start.y,
    });
    await page.dispatchEvent("#stage", "pointermove", {
      ...pen,
      button: -1,
      buttons: 1,
      clientX: end.x,
      clientY: end.y,
    });
    await page.dispatchEvent("body", "pointerup", {
      ...pen,
      buttons: 0,
      clientX: end.x,
      clientY: end.y,
    });

    const undo = page.locator("#undo-btn");
    const redo = page.locator("#redo-btn");
    await page.waitForFunction(() => !(document.querySelector("#undo-btn"))?.disabled);
    assert.equal(await redo.isDisabled(), true);

    await undo.click();
    await page.waitForFunction(() => !(document.querySelector("#redo-btn"))?.disabled);
    assert.equal(await undo.isDisabled(), true);

    await redo.click();
    await page.waitForFunction(() => !(document.querySelector("#undo-btn"))?.disabled);
    assert.equal(await redo.isDisabled(), true);
    assert.deepEqual(pageErrors, []);
  } finally {
    await page.close();
    await browser.close();
    await vite.close();
  }
});
