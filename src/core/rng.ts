// ============================================================================
// core/rng.ts — deterministic pseudo-random.
//
// CRITICAL for export: the same (tick, stroke, point) must always produce the
// same jitter, or MediaRecorder and ffmpeg paths will disagree and you'll chase
// ghosts. This mirrors how Decker's functional brushes feel "alive" via
// random[...] — but we make the randomness reproducible by seeding it.
// ============================================================================

/** Hash-based pseudo-random in [-1, 1], stable for identical inputs. */
export function noise(a: number, b: number = 0, c: number = 0): number {
  let s = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
}

const SMOOTH_JITTER_RESOLUTION = 5;

export type SmoothJitterSamples = {
  dx: number[];
  dy: number[];
};

/** Precompute smooth jitter control samples for one stroke/tick pair. */
export function smoothJitterSamples(tick: number, strokeIndex: number): SmoothJitterSamples {
  const dx: number[] = [];
  const dy: number[] = [];
  for (let i = 0; i <= SMOOTH_JITTER_RESOLUTION; i++) {
    dx[i] = noise(tick, strokeIndex * 13.13 + i);
    dy[i] = noise(tick + 99.9, strokeIndex * 7.77 + i);
  }
  return { dx, dy };
}

/** Interpolated jitter offset from precomputed smooth samples. */
export function smoothJitterFromSamples(
  samples: SmoothJitterSamples,
  pointIndex: number,
  amplitude: number,
  numPoints: number
): Vec2Offset {
  const t = pointIndex / (numPoints - 1);
  const lt = t * SMOOTH_JITTER_RESOLUTION;
  const i0 = Math.min(Math.floor(lt), SMOOTH_JITTER_RESOLUTION - 1);
  const i1 = Math.min(i0 + 1, SMOOTH_JITTER_RESOLUTION);
  const f = lt - i0;
  const sf = f * f * (3 - 2 * f);
  return {
    dx: (samples.dx[i0] + (samples.dx[i1] - samples.dx[i0]) * sf) * amplitude,
    dy: (samples.dy[i0] + (samples.dy[i1] - samples.dy[i0]) * sf) * amplitude,
  };
}

/** Jitter offset for a point, given the current wiggle tick.
 *  When numPoints > 1, jitter is smoothly interpolated along the stroke so
 *  adjacent points move together — preventing segment collapse that can make
 *  short strokes vanish. Pass numPoints (the total point count in the stroke)
 *  to enable smooth mode; omit (or pass 0/1) for discrete per-point hash. */
export function jitter(
  tick: number,
  strokeIndex: number,
  pointIndex: number,
  amplitude: number,
  numPoints?: number
): Vec2Offset {
  if (numPoints !== undefined && numPoints > 1) {
    return smoothJitterFromSamples(
      smoothJitterSamples(tick, strokeIndex),
      pointIndex,
      amplitude,
      numPoints
    );
  }
  return {
    dx: noise(tick, strokeIndex * 13.13 + pointIndex) * amplitude,
    dy: noise(tick + 99.9, strokeIndex * 7.77 + pointIndex) * amplitude,
  };
}

export type Vec2Offset = { dx: number; dy: number };

/** Pick a deterministic index into a list of length n for a given tick/seed. */
export function pickIndex(tick: number, seed: number, n: number): number {
  const r = (noise(tick, seed) + 1) / 2; // -> [0,1)
  return Math.min(n - 1, Math.floor(r * n));
}
