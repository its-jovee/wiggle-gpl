// ============================================================================
// core/audioTypes.ts — serializable audio model for project-level clips.
//
// Audio files are external media. The project stores paths, clip timing, and
// waveform peaks, not binary audio data, so .wigo.json files stay small
// (legacy .wiggle.json remains supported for open/import).
// ============================================================================

export type AudioAssetKind = "recording" | "import";

export type AudioAsset = {
  id: string;
  kind: AudioAssetKind;
  name: string;
  path: string;
  durationMs: number;
  waveformPeaks?: number[];
  createdAt: number;
};

export type AudioClip = {
  id: string;
  assetId: string;
  startMs: number;
  offsetMs: number;
  durationMs: number;
  volume: number;
  fadeInMs: number;
  fadeOutMs: number;
};

export type AudioTrack = {
  id: string;
  name: string;
  muted: boolean;
  clips: AudioClip[];
};

export type AudioProject = {
  sampleRate: 48000;
  assets: AudioAsset[];
  tracks: AudioTrack[];
};

export const DEFAULT_AUDIO_TRACKS = ["Voice", "SFX", "Music"];

export function newAudioProject(): AudioProject {
  return {
    sampleRate: 48000,
    assets: [],
    tracks: DEFAULT_AUDIO_TRACKS.map((name) => newAudioTrack(name)),
  };
}

export function newAudioTrack(name = "Audio"): AudioTrack {
  return {
    id: crypto.randomUUID(),
    name,
    muted: false,
    clips: [],
  };
}

export function ensureAudioProject(audio: AudioProject | undefined): AudioProject {
  return audio ?? newAudioProject();
}

export function newAudioAsset(
  kind: AudioAssetKind,
  name: string,
  path: string,
  durationMs: number,
  waveformPeaks?: number[]
): AudioAsset {
  return {
    id: crypto.randomUUID(),
    kind,
    name,
    path,
    durationMs,
    waveformPeaks,
    createdAt: Date.now(),
  };
}

export function newAudioClip(asset: AudioAsset, startMs: number): AudioClip {
  return {
    id: crypto.randomUUID(),
    assetId: asset.id,
    startMs: Math.max(0, Math.round(startMs)),
    offsetMs: 0,
    durationMs: Math.max(1, Math.round(asset.durationMs)),
    volume: 1,
    fadeInMs: 0,
    fadeOutMs: 0,
  };
}
