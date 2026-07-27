import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { chromium } from "playwright";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(tmpdir(), "wigostudio-krita-raster-test");

function bundleHarness() {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  execFileSync("npx", [
    "esbuild",
    join(root, "test/harness/krita-raster-equiv.ts"),
    "--bundle",
    "--format=esm",
    `--outfile=${join(outDir, "harness.js")}`,
    "--platform=browser",
  ], { stdio: "inherit", cwd: root });
  writeFileSync(
    join(outDir, "index.html"),
    "<!DOCTYPE html><script type=\"module\" src=\"./harness.js\"></script>"
  );
}

function startStaticServer(dir) {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const pathname = new URL(req.url || "/", "http://127.0.0.1").pathname;
      let rel;
      if (pathname === "/" || pathname === "/index.html") rel = "index.html";
      else if (pathname === "/harness.js") rel = "harness.js";
      else {
        res.writeHead(404);
        res.end();
        return;
      }
      try {
        const body = readFileSync(join(dir, rel));
        res.writeHead(200, {
          "Content-Type": rel.endsWith(".js") ? "text/javascript" : "text/html",
        });
        res.end(body);
      } catch {
        res.writeHead(404);
        res.end();
      }
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

test("krita raster phase-2 brushes are deterministic and raster-gated", async () => {
  bundleHarness();
  const server = await startStaticServer(outDir);
  const port = server.address().port;
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.waitForFunction(() => window.__kritaRasterReady === true);
    assert.deepEqual(await page.evaluate(() => window.runKritaRasterTests()), []);
  } finally {
    await browser.close();
    server.close();
  }
});
