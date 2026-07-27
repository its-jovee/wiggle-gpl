// ============================================================================
// core/electronAudio.ts — typed renderer access to the Electron audio bridge.
// ============================================================================

export type PickedAudioFile = { path: string; name: string };
export type SavedRecording = { path: string; name: string };

export type SaveRecordingPayload = {
  name?: string;
  extension: string;
  bytes: Uint8Array;
  directory?: string;
};

export type WigoAudioBridge = {
  pickFiles(): Promise<PickedAudioFile[]>;
  readFile(path: string): Promise<ArrayBuffer>;
  fileExists(path: string): Promise<boolean>;
  saveRecording(payload: SaveRecordingPayload): Promise<SavedRecording>;
  getDefaultRecordingDir(): Promise<string>;
};

declare global {
  interface Window {
    wigoAudio?: WigoAudioBridge;
  }
}

export function audioBridge(): WigoAudioBridge | null {
  return window.wigoAudio ?? null;
}
