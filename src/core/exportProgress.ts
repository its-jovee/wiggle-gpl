// ============================================================================
// core/exportProgress.ts — lightweight status events for export UI.
//
// Export pixels and encoding arguments stay in export.ts. This module only
// normalizes progress reporting so callers can show phase-aware status text.
// ============================================================================

export type ExportFormat = "WebM" | "MP4" | "PNG" | "JPEG" | "GIF";
export type ExportProgressPhase = "render" | "encode" | "done" | "failed";

export type ExportProgress = {
  format: ExportFormat;
  phase: ExportProgressPhase;
  progress: number;
  frame?: number;
  totalFrames?: number;
  error?: string;
};

export type ExportProgressCallback = (progress: ExportProgress) => void;
export type LegacyExportProgressCallback = (progress: number) => void;

function clampProgress(progress: number): number {
  if (!Number.isFinite(progress)) return 0;
  return Math.max(0, Math.min(1, progress));
}

export function createExportProgressReporter(
  format: ExportFormat,
  legacyProgress?: LegacyExportProgressCallback,
  progressEvent?: ExportProgressCallback
) {
  return {
    render(progress: number, frame?: number, totalFrames?: number) {
      const clamped = clampProgress(progress);
      legacyProgress?.(clamped);
      progressEvent?.({
        format,
        phase: "render",
        progress: clamped,
        ...(frame !== undefined ? { frame } : {}),
        ...(totalFrames !== undefined ? { totalFrames } : {}),
      });
    },
    encode() {
      progressEvent?.({ format, phase: "encode", progress: 1 });
    },
    done() {
      legacyProgress?.(1);
      progressEvent?.({ format, phase: "done", progress: 1 });
    },
    failed(error: unknown) {
      progressEvent?.({
        format,
        phase: "failed",
        progress: 0,
        error: error instanceof Error ? error.message : String(error),
      });
    },
  };
}

export function exportProgressStatus(progress: ExportProgress): string {
  if (progress.phase === "render") {
    if (progress.frame !== undefined && progress.totalFrames !== undefined) {
      return `${progress.format} rendering frame ${progress.frame}/${progress.totalFrames}`;
    }
    return `${progress.format} rendering ${Math.round(progress.progress * 100)}%`;
  }
  if (progress.phase === "encode") return `${progress.format} encoding`;
  if (progress.phase === "done") return `${progress.format} done`;
  return `${progress.format} failed: ${progress.error ?? "unknown error"}`;
}

/** ffmpeg's worker reports some failures as plain strings, not Error objects. */
export function exportErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message) return message;
  }
  return "The encoder could not start. Please try again.";
}
