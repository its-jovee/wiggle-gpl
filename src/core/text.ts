// ============================================================================
// core/text.ts — per-character text rendering with deterministic wiggle.
//
// Each glyph's render position gets a (tick, charIndex)-seeded jitter offset,
// so the same (tick, seed, content) always produces the same pixels. The
// display loop and export both call renderTextElement; no Math.random.
// ============================================================================

import { TextElement } from "./types";
import { jitter } from "./rng";
import { fontFamilyCss } from "./fonts";

// Per-glyph advances depend only on (font, size, content), never on tick —
// cache them so the render loop only pays fillText per glyph, not measureText.
const _advanceCache = new Map<string, number[]>();
const ADVANCE_CACHE_MAX = 128;

if (typeof document !== "undefined" && document.fonts?.addEventListener) {
  // Webfonts arriving late change glyph metrics — drop stale measurements.
  document.fonts.addEventListener("loadingdone", () => _advanceCache.clear());
}

function glyphAdvances(ctx: CanvasRenderingContext2D, t: TextElement): number[] {
  const key = `${t.fontFamily}:${t.fontSize}:${t.content}`;
  const cached = _advanceCache.get(key);
  if (cached) return cached;
  const glyphs = Array.from(t.content);
  const advances: number[] = new Array(glyphs.length);
  for (let i = 0; i < glyphs.length; i++) {
    advances[i] = glyphs[i] === "\n" ? 0 : ctx.measureText(glyphs[i]).width;
  }
  if (_advanceCache.size >= ADVANCE_CACHE_MAX) {
    _advanceCache.delete(_advanceCache.keys().next().value!);
  }
  _advanceCache.set(key, advances);
  return advances;
}

export function renderTextElement(
  ctx: CanvasRenderingContext2D,
  t: TextElement,
  tick: number,
  baseSeed: number,
  skipJitter = false
) {
  if (!t.content) return;
  ctx.save();
  ctx.font = `${t.fontSize}px ${fontFamilyCss(t.fontFamily)}`;
  ctx.fillStyle = t.color;
  ctx.textBaseline = "top";
  if (t.rotation) {
    ctx.translate(t.x, t.y);
    ctx.rotate(t.rotation);
    ctx.translate(-t.x, -t.y);
  }
  const advances = glyphAdvances(ctx, t);
  const wiggleAmp = skipJitter ? 0 : t.wiggleAmplitude;
  const glyphs = Array.from(t.content);
  const lineHeight = t.fontSize * 1.2;
  let x = t.x;
  let y = t.y;
  for (let i = 0; i < glyphs.length; i++) {
    const ch = glyphs[i];
    if (ch === "\n") {
      x = t.x;
      y += lineHeight;
      continue;
    }
    const j = jitter(tick, baseSeed + i, 0, wiggleAmp);
    ctx.fillText(ch, x + j.dx, y + j.dy);
    x += advances[i];
  }
  ctx.restore();
}

export function measureText(
  ctx: CanvasRenderingContext2D,
  t: TextElement
): { width: number; height: number } {
  ctx.save();
  ctx.font = `${t.fontSize}px ${fontFamilyCss(t.fontFamily)}`;
  const lines = t.content.split("\n");
  let width = 0;
  for (const line of lines) width = Math.max(width, ctx.measureText(line || " ").width);
  ctx.restore();
  return { width, height: Math.max(1, lines.length) * t.fontSize * 1.2 };
}
