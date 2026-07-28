// ============================================================================
// core/timelapseCamera.ts — deterministic editable camera tracks for timelapse.
//
// Keyframes store normalized clip time plus a source-canvas focus and zoom.
// Evaluation is pure, so editor playback and every export path use the exact
// same camera position for the same timelapse progress.
// ============================================================================

import { easeProgress } from "./anim";
import { MAX_TIMELAPSE_CAMERA_KEYFRAMES } from "./projectValidation";
import type { EasingKind, TimelapseCameraKeyframe } from "./types";

export type TimelapseCameraState = {
  centerX: number;
  centerY: number;
  zoom: number;
};

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

export function defaultTimelapseCamera(width: number, height: number): TimelapseCameraState {
  return { centerX: width / 2, centerY: height / 2, zoom: 1 };
}

export function normalizeTimelapseCameraKeyframe(
  keyframe: TimelapseCameraKeyframe,
  width: number,
  height: number,
): TimelapseCameraKeyframe {
  const zoom = clamp(Number.isFinite(keyframe.zoom) ? keyframe.zoom : 1, 1, 8);
  const halfW = width / (2 * zoom);
  const halfH = height / (2 * zoom);
  return {
    progress: clamp(Number.isFinite(keyframe.progress) ? keyframe.progress : 0, 0, 1),
    centerX: clamp(Number.isFinite(keyframe.centerX) ? keyframe.centerX : width / 2, halfW, width - halfW),
    centerY: clamp(Number.isFinite(keyframe.centerY) ? keyframe.centerY : height / 2, halfH, height - halfH),
    zoom,
    easing: isEasing(keyframe.easing) ? keyframe.easing : "easeInOut",
  };
}

function isEasing(value: unknown): value is EasingKind {
  return value === "linear" || value === "easeIn" || value === "easeOut" || value === "easeInOut";
}

export function sortedTimelapseCameraKeyframes(
  keyframes: readonly TimelapseCameraKeyframe[] | undefined,
  width: number,
  height: number,
): TimelapseCameraKeyframe[] {
  return (keyframes ?? [])
    .map((keyframe) => normalizeTimelapseCameraKeyframe(keyframe, width, height))
    .sort((a, b) => a.progress - b.progress);
}

export function timelapseCameraAtProgress(
  keyframes: readonly TimelapseCameraKeyframe[] | undefined,
  progress: number,
  width: number,
  height: number,
): TimelapseCameraState {
  const frames = sortedTimelapseCameraKeyframes(keyframes, width, height);
  if (frames.length === 0) return defaultTimelapseCamera(width, height);
  const p = clamp(progress, 0, 1);
  if (p <= frames[0].progress) return cameraState(frames[0]);
  const last = frames[frames.length - 1];
  if (p >= last.progress) return cameraState(last);

  for (let i = 0; i < frames.length - 1; i++) {
    const from = frames[i];
    const to = frames[i + 1];
    if (p > to.progress) continue;
    const span = Math.max(1e-9, to.progress - from.progress);
    const t = easeProgress(from.easing, (p - from.progress) / span);
    return {
      centerX: from.centerX + (to.centerX - from.centerX) * t,
      centerY: from.centerY + (to.centerY - from.centerY) * t,
      zoom: from.zoom + (to.zoom - from.zoom) * t,
    };
  }
  return cameraState(last);
}

function cameraState(keyframe: TimelapseCameraKeyframe): TimelapseCameraState {
  return {
    centerX: keyframe.centerX,
    centerY: keyframe.centerY,
    zoom: keyframe.zoom,
  };
}

export function upsertTimelapseCameraKeyframe(
  keyframes: readonly TimelapseCameraKeyframe[] | undefined,
  keyframe: TimelapseCameraKeyframe,
  width: number,
  height: number,
  epsilon = 0.005,
): TimelapseCameraKeyframe[] {
  const next = sortedTimelapseCameraKeyframes(keyframes, width, height);
  const normalized = normalizeTimelapseCameraKeyframe(keyframe, width, height);
  const index = next.findIndex((existing) => Math.abs(existing.progress - normalized.progress) <= epsilon);
  if (index >= 0) next[index] = normalized;
  else if (next.length < MAX_TIMELAPSE_CAMERA_KEYFRAMES) next.push(normalized);
  return next.sort((a, b) => a.progress - b.progress);
}

export function removeTimelapseCameraKeyframe(
  keyframes: readonly TimelapseCameraKeyframe[] | undefined,
  progress: number,
  width: number,
  height: number,
  epsilon = 0.005,
): TimelapseCameraKeyframe[] {
  return sortedTimelapseCameraKeyframes(keyframes, width, height)
    .filter((keyframe) => Math.abs(keyframe.progress - progress) > epsilon);
}
