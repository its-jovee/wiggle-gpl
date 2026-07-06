// ============================================================================
// core/text.ts — per-character text rendering with deterministic wiggle.
//
// Each glyph's render position gets a (tick, charIndex)-seeded jitter offset,
// so the same (tick, seed, content) always produces the same pixels. The
// display loop and export both call renderTextElement; no Math.random.
// ============================================================================

import { TextElement } from "./types";
import { jitter } from "./rng";

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
  const advances: number[] = new Array(t.content.length);
  for (let i = 0; i < t.content.length; i++) {
    advances[i] = ctx.measureText(t.content[i]).width;
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
  ctx.font = `${t.fontSize}px "${t.fontFamily}", sans-serif`;
  ctx.fillStyle = t.color;
  ctx.textBaseline = "top";
  if (t.rotation) {
    ctx.translate(t.x, t.y);
    ctx.rotate(t.rotation);
    ctx.translate(-t.x, -t.y);
  }
  const advances = glyphAdvances(ctx, t);
  const wiggleAmp = skipJitter ? 0 : t.wiggleAmplitude;
  let x = t.x;
  for (let i = 0; i < t.content.length; i++) {
    const ch = t.content[i];
    const j = jitter(tick, baseSeed + i, 0, wiggleAmp);
    ctx.fillText(ch, x + j.dx, t.y + j.dy);
    x += advances[i];
  }
  ctx.restore();
}

export function measureText(
  ctx: CanvasRenderingContext2D,
  t: TextElement
): { width: number; height: number } {
  ctx.save();
  ctx.font = `${t.fontSize}px "${t.fontFamily}", sans-serif`;
  const m = ctx.measureText(t.content);
  ctx.restore();
  return { width: m.width, height: t.fontSize * 1.2 };
}
