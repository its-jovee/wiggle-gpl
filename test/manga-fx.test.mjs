import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const outDir = join(tmpdir(), "wigostudio-manga-fx-test");

function compile() {
  rmSync(outDir, { recursive: true, force: true });
  execFileSync("npx", [
    "tsc",
    "--ignoreConfig",
    "--outDir", outDir,
    "--module", "commonjs",
    "--target", "ES2020",
    "--lib", "ES2020,DOM",
    "--skipLibCheck",
    "--esModuleInterop",
    "--noEmit", "false",
    "src/brushes/mangaFx.ts",
    "src/brushes/registry.ts",
    "src/brushes/textures.ts",
    "src/brushes/kritaRaster.ts",
    "src/brushes/kritaTips.ts",
    "src/core/types.ts",
    "src/core/rng.ts",
  ], { stdio: "inherit" });
}

compile();
const { MANGA_FX_BRUSHES, isRadialMangaBrushKey } = await import(`${outDir}/brushes/mangaFx.js`);

test("manga FX brushes are grouped and registered", () => {
  assert.ok(MANGA_FX_BRUSHES.length >= 7);
  for (const brush of MANGA_FX_BRUSHES) {
    assert.equal(brush.group, "Manga FX");
    assert.equal(typeof brush.stamp, "function");
  }
  const keys = MANGA_FX_BRUSHES.map((b) => b.key);
  assert.ok(keys.includes("mangaSpeed"));
  assert.ok(keys.includes("mangaFocus"));
  assert.ok(keys.includes("mangaSweat"));
});

test("action, focus, and impact use radial tool mode; speed stays stroke-walked", () => {
  const radial = MANGA_FX_BRUSHES.filter((b) => b.radial === true).map((b) => b.key);
  assert.deepEqual(radial.sort(), ["mangaAction", "mangaFocus", "mangaImpact"].sort());
  assert.equal(isRadialMangaBrushKey("mangaSpeed"), false);
  assert.equal(isRadialMangaBrushKey("mangaFocus"), true);
  assert.equal(isRadialMangaBrushKey("mangaAction"), true);
  assert.equal(isRadialMangaBrushKey("mangaImpact"), true);
});

test("manga focus stamp is deterministic for identical tick/seed", () => {
  const brush = MANGA_FX_BRUSHES.find((b) => b.key === "mangaFocus");
  assert.ok(brush);
  const render = () => {
    const canvas = { width: 64, height: 64 };
    const ctx = {
      canvas,
      save() {},
      restore() {},
      beginPath() {},
      moveTo() {},
      lineTo() {},
      stroke() {},
      fill() {},
      arc() {},
      ellipse() {},
      quadraticCurveTo() {},
      translate() {},
      rotate() {},
      fillRect() {},
      globalAlpha: 1,
      strokeStyle: "",
      fillStyle: "",
      lineWidth: 1,
      lineCap: "butt",
    };
    let calls = 0;
    const proxy = new Proxy(ctx, {
      get(target, prop) {
        if (prop === "save" || prop === "restore" || prop === "beginPath"
          || prop === "moveTo" || prop === "lineTo" || prop === "stroke") {
          return () => { calls += 1; };
        }
        return target[prop];
      },
    });
    brush.stamp({
      ctx: proxy,
      pos: { x: 32, y: 32 },
      delta: { x: 10, y: 2 },
      color: "#000000",
      size: 2,
      tick: 4,
      seed: 99,
      bg: "#ffffff",
    });
    return calls;
  };
  assert.equal(render(), render());
});

test("radial radius scales burst deterministically", () => {
  const brush = MANGA_FX_BRUSHES.find((b) => b.key === "mangaImpact");
  assert.ok(brush);
  const render = (radius) => {
    const segments = [];
    const ctx = {
      save() {},
      restore() {},
      beginPath() {},
      moveTo(x, y) { segments.push(["m", x, y]); },
      lineTo(x, y) { segments.push(["l", x, y]); },
      stroke() {},
      globalAlpha: 1,
      strokeStyle: "",
      lineWidth: 1,
      lineCap: "round",
    };
    brush.stamp({
      ctx,
      pos: { x: 50, y: 50 },
      delta: { x: radius, y: 0 },
      color: "#000000",
      size: 2,
      tick: 2,
      seed: 42,
      bg: "#ffffff",
      radialRadius: radius,
    });
    return JSON.stringify(segments);
  };
  const a = render(40);
  const b = render(40);
  const c = render(80);
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test("action lines start dense at low radius and add rays as radius grows", () => {
  const brush = MANGA_FX_BRUSHES.find((b) => b.key === "mangaAction");
  const rayCount = (radius) => {
    let lines = 0;
    const ctx = {
      save() {}, restore() {}, beginPath() {}, moveTo() {},
      lineTo() { lines += 1; }, stroke() {}, globalAlpha: 1,
      strokeStyle: "", lineWidth: 1, lineCap: "round",
    };
    brush.stamp({ ctx, pos: { x: 20, y: 20 }, delta: { x: radius, y: 0 },
      color: "#000", size: 2, tick: 1, seed: 7, bg: "#fff", radialRadius: radius });
    return lines;
  };
  assert.ok(rayCount(3) >= 12);
  assert.ok(rayCount(80) > rayCount(3));
});
