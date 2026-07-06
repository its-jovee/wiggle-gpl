// ============================================================================
// core/waveform.ts — audio metadata and compact waveform peak generation.
// ============================================================================

export async function decodeAudioBytes(bytes: ArrayBuffer): Promise<AudioBuffer> {
  const ctx = new AudioContext();
  try {
    return await ctx.decodeAudioData(bytes.slice(0));
  } finally {
    await ctx.close();
  }
}

export async function audioDurationMs(bytes: ArrayBuffer): Promise<number> {
  const buffer = await decodeAudioBytes(bytes);
  return Math.round(buffer.duration * 1000);
}

export async function waveformPeaks(bytes: ArrayBuffer, peakCount = 160): Promise<number[]> {
  const buffer = await decodeAudioBytes(bytes);
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
  const samplesPerPeak = Math.max(1, Math.floor(buffer.length / peakCount));
  const peaks: number[] = [];
  for (let i = 0; i < peakCount; i++) {
    const start = i * samplesPerPeak;
    const end = Math.min(buffer.length, start + samplesPerPeak);
    let peak = 0;
    for (let s = start; s < end; s++) {
      for (const channel of channels) {
        peak = Math.max(peak, Math.abs(channel[s] ?? 0));
      }
    }
    peaks.push(Math.round(Math.min(1, peak) * 1000) / 1000);
  }
  return peaks;
}

export function drawWaveform(
  ctx: CanvasRenderingContext2D,
  peaks: number[] | undefined,
  x: number,
  y: number,
  width: number,
  height: number,
  color = "rgba(255,255,255,.72)"
) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  const mid = y + height / 2;
  if (!peaks || peaks.length === 0) {
    ctx.globalAlpha = 0.4;
    ctx.beginPath();
    ctx.moveTo(x, mid);
    ctx.lineTo(x + width, mid);
    ctx.stroke();
    ctx.restore();
    return;
  }
  const step = width / peaks.length;
  ctx.beginPath();
  peaks.forEach((peak, i) => {
    const px = x + i * step;
    const h = Math.max(1, peak * height * 0.46);
    ctx.moveTo(px, mid - h);
    ctx.lineTo(px, mid + h);
  });
  ctx.stroke();
  ctx.restore();
}
