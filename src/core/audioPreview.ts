// ============================================================================
// core/audioPreview.ts — Web Audio preview scheduler for project audio clips.
// ============================================================================

import { AudioProject } from "./audioTypes";
import { buildAudioExportPlan } from "./audioTimeline";
import { audioBridge } from "./electronAudio";

type LoadedBuffer = {
  path: string;
  buffer: AudioBuffer;
};

export class AudioPreview {
  private ctx: AudioContext | null = null;
  private cache = new Map<string, LoadedBuffer>();
  private sources: AudioBufferSourceNode[] = [];

  async play(audio: AudioProject | undefined, playheadMs: number, durationMs: number) {
    await this.stop();
    if (!audio) return;
    const bridge = audioBridge();
    if (!bridge) return;
    const ctx = this.ensureContext();
    const plan = buildAudioExportPlan(audio);
    const endMs = playheadMs + durationMs;
    for (const clip of plan) {
      const clipEnd = clip.startMs + clip.durationMs;
      if (clipEnd <= playheadMs || clip.startMs >= endMs) continue;
      const loaded = await this.loadBuffer(clip.assetPath, bridge);
      if (!loaded) continue;
      const relStartMs = Math.max(0, clip.startMs - playheadMs);
      const sourceOffsetMs = clip.offsetMs + Math.max(0, playheadMs - clip.startMs);
      const playableMs = Math.min(clipEnd, endMs) - Math.max(clip.startMs, playheadMs);
      if (playableMs <= 0) continue;

      const source = ctx.createBufferSource();
      source.buffer = loaded.buffer;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      source.connect(gain);
      gain.connect(ctx.destination);

      const startAt = ctx.currentTime + relStartMs / 1000;
      const durationSec = playableMs / 1000;
      const offsetSec = sourceOffsetMs / 1000;
      const baseGain = clip.volume;
      const fadeInSec = clip.fadeInMs / 1000;
      const fadeOutSec = clip.fadeOutMs / 1000;
      gain.gain.setValueAtTime(baseGain, startAt);
      if (fadeInSec > 0 && sourceOffsetMs - clip.offsetMs < clip.fadeInMs) {
        const fadeProgress = Math.max(0, (sourceOffsetMs - clip.offsetMs) / clip.fadeInMs);
        gain.gain.setValueAtTime(baseGain * fadeProgress, startAt);
        gain.gain.linearRampToValueAtTime(baseGain, Math.min(startAt + fadeInSec, startAt + durationSec));
      }
      if (fadeOutSec > 0) {
        const clipRemainingMs = clipEnd - Math.max(clip.startMs, playheadMs);
        if (clipRemainingMs <= clip.fadeOutMs + playableMs) {
          const fadeStart = Math.max(startAt, startAt + durationSec - fadeOutSec);
          gain.gain.setValueAtTime(baseGain, fadeStart);
          gain.gain.linearRampToValueAtTime(0, startAt + durationSec);
        }
      }
      source.start(startAt, offsetSec, durationSec);
      this.sources.push(source);
    }
  }

  async stop() {
    for (const source of this.sources) {
      try { source.stop(); } catch { /* already stopped */ }
    }
    this.sources = [];
  }

  private ensureContext() {
    if (!this.ctx) this.ctx = new AudioContext();
    return this.ctx;
  }

  private async loadBuffer(path: string, bridge: NonNullable<ReturnType<typeof audioBridge>>) {
    const cached = this.cache.get(path);
    if (cached) return cached;
    const exists = await bridge.fileExists(path);
    if (!exists) return null;
    const bytes = await bridge.readFile(path);
    const ctx = this.ensureContext();
    const buffer = await ctx.decodeAudioData(bytes.slice(0));
    const loaded = { path, buffer };
    this.cache.set(path, loaded);
    return loaded;
  }
}
