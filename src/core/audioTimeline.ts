// ============================================================================
// core/audioTimeline.ts — pure helpers for project-level audio clip timing.
//
// These functions mutate only the clip/track objects passed to them and never
// touch visual panel timing. Audio is absolute project time in milliseconds.
// ============================================================================

import { AudioAsset, AudioClip, AudioProject, AudioTrack } from "./audioTypes";

export type AudioExportClip = {
  trackId: string;
  trackName: string;
  assetPath: string;
  clipId: string;
  startMs: number;
  offsetMs: number;
  durationMs: number;
  volume: number;
  fadeInMs: number;
  fadeOutMs: number;
};

export function clampClipToAsset(clip: AudioClip, asset: AudioAsset): AudioClip {
  const offsetMs = Math.max(0, Math.min(Math.round(clip.offsetMs), Math.max(0, asset.durationMs - 1)));
  const maxDuration = Math.max(1, asset.durationMs - offsetMs);
  const durationMs = Math.max(1, Math.min(Math.round(clip.durationMs), maxDuration));
  return {
    ...clip,
    startMs: Math.max(0, Math.round(clip.startMs)),
    offsetMs,
    durationMs,
    volume: Math.max(0, Math.min(2, clip.volume)),
    fadeInMs: clampFade(clip.fadeInMs, durationMs),
    fadeOutMs: clampFade(clip.fadeOutMs, durationMs),
  };
}

export function moveClip(clip: AudioClip, startMs: number): AudioClip {
  return { ...clip, startMs: Math.max(0, Math.round(startMs)) };
}

export function trimClipStart(clip: AudioClip, asset: AudioAsset, newStartMs: number): AudioClip {
  const oldEnd = clip.startMs + clip.durationMs;
  const startMs = Math.max(0, Math.min(Math.round(newStartMs), oldEnd - 1));
  const delta = startMs - clip.startMs;
  return clampClipToAsset({
    ...clip,
    startMs,
    offsetMs: clip.offsetMs + delta,
    durationMs: oldEnd - startMs,
  }, asset);
}

export function trimClipEnd(clip: AudioClip, asset: AudioAsset, newEndMs: number): AudioClip {
  const endMs = Math.max(clip.startMs + 1, Math.round(newEndMs));
  return clampClipToAsset({
    ...clip,
    durationMs: endMs - clip.startMs,
  }, asset);
}

export function splitClip(clip: AudioClip, asset: AudioAsset, playheadMs: number): [AudioClip, AudioClip] | null {
  const splitMs = Math.round(playheadMs);
  const rel = splitMs - clip.startMs;
  if (rel <= 0 || rel >= clip.durationMs) return null;
  const left = clampClipToAsset({
    ...clip,
    durationMs: rel,
    fadeOutMs: Math.min(clip.fadeOutMs, rel),
  }, asset);
  const right = clampClipToAsset({
    ...clip,
    id: crypto.randomUUID(),
    startMs: splitMs,
    offsetMs: clip.offsetMs + rel,
    durationMs: clip.durationMs - rel,
    fadeInMs: Math.min(clip.fadeInMs, clip.durationMs - rel),
  }, asset);
  return [left, right];
}

export function setClipFades(clip: AudioClip, fadeInMs: number, fadeOutMs: number): AudioClip {
  return {
    ...clip,
    fadeInMs: clampFade(fadeInMs, clip.durationMs),
    fadeOutMs: clampFade(fadeOutMs, clip.durationMs),
  };
}

export function totalAudioDuration(audio: AudioProject | undefined): number {
  if (!audio) return 0;
  let total = 0;
  for (const track of audio.tracks) {
    if (track.muted) continue;
    for (const clip of track.clips) {
      total = Math.max(total, clip.startMs + clip.durationMs);
    }
  }
  return total;
}

export function visualDurationMs(projectPanels: { durationMs: number }[]): number {
  return projectPanels.reduce((sum, p) => sum + p.durationMs, 0);
}

export function findAsset(audio: AudioProject | undefined, assetId: string): AudioAsset | undefined {
  return audio?.assets.find((a) => a.id === assetId);
}

export function findClipTrack(audio: AudioProject, clipId: string): AudioTrack | undefined {
  return audio.tracks.find((track) => track.clips.some((clip) => clip.id === clipId));
}

export function buildAudioExportPlan(audio: AudioProject | undefined): AudioExportClip[] {
  if (!audio) return [];
  const assets = new Map(audio.assets.map((asset) => [asset.id, asset]));
  const clips: AudioExportClip[] = [];
  for (const track of audio.tracks) {
    if (track.muted) continue;
    for (const clip of track.clips) {
      const asset = assets.get(clip.assetId);
      if (!asset) continue;
      const normalized = clampClipToAsset(clip, asset);
      clips.push({
        trackId: track.id,
        trackName: track.name,
        assetPath: asset.path,
        clipId: normalized.id,
        startMs: normalized.startMs,
        offsetMs: normalized.offsetMs,
        durationMs: normalized.durationMs,
        volume: normalized.volume,
        fadeInMs: normalized.fadeInMs,
        fadeOutMs: normalized.fadeOutMs,
      });
    }
  }
  return clips.sort((a, b) => a.startMs - b.startMs);
}

function clampFade(ms: number, durationMs: number) {
  return Math.max(0, Math.min(Math.round(ms), Math.floor(durationMs / 2)));
}
