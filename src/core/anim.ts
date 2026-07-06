// ============================================================================
// core/anim.ts — entrance & exit animations on the wiggle clock.
//
// Each AnimationSpec evaluates to an AnimState (scale, translate, alpha) at
// progress p ∈ [0, 1]. Progress derives from (localMs / durationMs), so the
// curves are deterministic and identical between display and export.
// ============================================================================

import { AnimationSpec, EasingKind, LayerAnimation } from "./types";

export type AnimState = {
  scaleX: number;
  scaleY: number;
  tx: number;
  ty: number;
  alpha: number;
};

export const IDENTITY: AnimState = { scaleX: 1, scaleY: 1, tx: 0, ty: 0, alpha: 1 };

export type LayerAnimState = {
  x: number;
  y: number;
  opacity: number;
  scale: number;
  rotation: number;
};

export const IDENTITY_LAYER_ANIM: LayerAnimState = {
  x: 0,
  y: 0,
  opacity: 1,
  scale: 1,
  rotation: 0,
};

export const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/** Animation that starts "out" at p=0 and lands on identity at p=1. */
export function evalEnter(spec: AnimationSpec | undefined, progress: number): AnimState {
  if (!spec || spec.kind === "none") return IDENTITY;
  if (progress >= 1) return IDENTITY;
  const p = clamp01(progress);
  switch (spec.kind) {
    case "pop": {
      const e = 1 - Math.pow(1 - p, 3);
      const s = e + 0.15 * Math.sin(e * Math.PI);
      return { scaleX: s, scaleY: s, tx: 0, ty: 0, alpha: p };
    }
    case "fade":
      return { ...IDENTITY, alpha: p };
    case "jump": {
      const e = 1 - Math.pow(1 - p, 2);
      const bounce = p > 0.85 ? 8 * Math.sin(((p - 0.85) / 0.15) * Math.PI) : 0;
      return { ...IDENTITY, ty: -150 * (1 - e) + bounce, alpha: p };
    }
    case "squeeze": {
      const w = 0.4 * Math.sin(p * Math.PI * 3) * (1 - p);
      return { scaleX: 1 + w, scaleY: 1 - w, tx: 0, ty: 0, alpha: p };
    }
  }
  return IDENTITY;
}

/** Animation that starts at identity (p=0) and lands "out" at p=1. */
export function evalExit(spec: AnimationSpec | undefined, progress: number): AnimState {
  if (!spec || spec.kind === "none") return IDENTITY;
  if (progress <= 0) return IDENTITY;
  const p = clamp01(progress);
  switch (spec.kind) {
    case "pop": {
      const s = 1 - Math.pow(p, 3);
      return { scaleX: s, scaleY: s, tx: 0, ty: 0, alpha: 1 - p };
    }
    case "fade":
      return { ...IDENTITY, alpha: 1 - p };
    case "jump":
      return { ...IDENTITY, ty: 150 * p * p, alpha: 1 - p };
    case "squeeze": {
      const w = 0.4 * Math.sin(p * Math.PI * 3) * p;
      return { scaleX: 1 + w, scaleY: 1 - w, tx: 0, ty: 0, alpha: 1 - p };
    }
  }
  return IDENTITY;
}

export function composeAnim(a: AnimState, b: AnimState): AnimState {
  return {
    scaleX: a.scaleX * b.scaleX,
    scaleY: a.scaleY * b.scaleY,
    tx: a.tx + b.tx,
    ty: a.ty + b.ty,
    alpha: a.alpha * b.alpha,
  };
}

/** Apply transform around the pivot (cx, cy). Caller wraps in save/restore. */
export function applyAnimTransform(
  ctx: CanvasRenderingContext2D,
  anim: AnimState,
  cx: number,
  cy: number
) {
  ctx.translate(cx + anim.tx, cy + anim.ty);
  ctx.scale(anim.scaleX, anim.scaleY);
  ctx.translate(-cx, -cy);
  ctx.globalAlpha *= anim.alpha;
}

/**
 * Compute the combined enter/exit anim state for the given local time, where
 * durationTicks is interpreted in wiggleFps ticks.
 */
export function computeAnim(
  enter: AnimationSpec | undefined,
  exit: AnimationSpec | undefined,
  localMs: number,
  containerDurMs: number,
  wiggleFps: number
): AnimState {
  const ticksToMs = (t: number) => (t * 1000) / wiggleFps;
  let a = IDENTITY;
  if (enter && enter.kind !== "none") {
    const D = ticksToMs(enter.durationTicks);
    if (D > 0) {
      const startMs = ticksToMs(enter.startTick ?? 0);
      a = composeAnim(a, evalEnter(enter, clamp01((localMs - startMs) / D)));
    }
  }
  if (exit && exit.kind !== "none") {
    const D = ticksToMs(exit.durationTicks);
    if (D > 0) {
      const defaultStartTicks = (containerDurMs / 1000) * wiggleFps - exit.durationTicks;
      const startMs = ticksToMs(exit.startTick ?? defaultStartTicks);
      a = composeAnim(a, evalExit(exit, clamp01((localMs - startMs) / D)));
    }
  }
  return a;
}

export function isIdentity(a: AnimState): boolean {
  return a.scaleX === 1 && a.scaleY === 1 && a.tx === 0 && a.ty === 0 && a.alpha === 1;
}

export function easeProgress(kind: EasingKind, progress: number): number {
  const p = clamp01(progress);
  switch (kind) {
    case "linear":
      return p;
    case "easeIn":
      return p * p;
    case "easeOut":
      return 1 - Math.pow(1 - p, 2);
    case "easeInOut":
      return p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
  }
}

function loopProgress(raw: number, loop: LayerAnimation["loop"]): number {
  if (loop === "repeat") {
    return raw - Math.floor(raw);
  }
  if (loop === "pingpong") {
    const cycle = raw - Math.floor(raw);
    return Math.floor(raw) % 2 === 0 ? cycle : 1 - cycle;
  }
  return clamp01(raw);
}

function lerp(a: number, b: number, p: number): number {
  return a + (b - a) * p;
}

export function computeLayerAnim(
  anim: LayerAnimation | undefined,
  localMs: number,
  wiggleFps: number
): LayerAnimState {
  if (!anim || !anim.enabled || anim.durationTicks <= 0) return IDENTITY_LAYER_ANIM;
  const currentTick = (localMs / 1000) * wiggleFps;
  const raw = (currentTick - anim.startTick) / anim.durationTicks;
  const p = easeProgress(anim.easing, loopProgress(raw, anim.loop ?? "none"));
  return {
    x: lerp(anim.from.x, anim.to.x, p),
    y: lerp(anim.from.y, anim.to.y, p),
    opacity: lerp(anim.from.opacity, anim.to.opacity, p),
    scale: lerp(anim.from.scale, anim.to.scale, p),
    rotation: lerp(anim.from.rotation, anim.to.rotation, p),
  };
}

export function composeLayerAnim(base: LayerAnimState, child: LayerAnimState): LayerAnimState {
  return {
    x: base.x + child.x,
    y: base.y + child.y,
    opacity: base.opacity * child.opacity,
    scale: base.scale * child.scale,
    rotation: base.rotation + child.rotation,
  };
}

export function isIdentityLayerAnim(a: LayerAnimState): boolean {
  return a.x === 0 && a.y === 0 && a.opacity === 1 && a.scale === 1 && a.rotation === 0;
}

export function applyLayerAnimTransform(
  ctx: CanvasRenderingContext2D,
  anim: LayerAnimState,
  cx: number,
  cy: number
) {
  ctx.translate(cx + anim.x, cy + anim.y);
  ctx.rotate((anim.rotation * Math.PI) / 180);
  ctx.scale(anim.scale, anim.scale);
  ctx.translate(-cx, -cy);
  ctx.globalAlpha *= anim.opacity;
}
