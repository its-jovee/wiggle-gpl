// ============================================================================
// core/canvasPresets.ts — named canvas sizes for new projects.
//
// The engine reads project.width/height everywhere; presets only seed those
// fields when the user picks a format at project creation.
// ============================================================================

import { TIKTOK_WIDTH, TIKTOK_HEIGHT } from "./types";

export type CanvasPreset = {
  key: string;
  label: string;
  width: number;
  height: number;
  description: string;
};

export const DEFAULT_CANVAS_PRESET_KEY = "tiktok";

export const CANVAS_PRESETS: CanvasPreset[] = [
  {
    key: "tiktok",
    label: "TikTok / Reels",
    width: TIKTOK_WIDTH,
    height: TIKTOK_HEIGHT,
    description: "9:16 vertical (1080×1920)",
  },
  {
    key: "youtube",
    label: "YouTube",
    width: 1920,
    height: 1080,
    description: "16:9 landscape (1920×1080)",
  },
  {
    key: "instagram-square",
    label: "Instagram Square",
    width: 1080,
    height: 1080,
    description: "1:1 square (1080×1080)",
  },
  {
    key: "instagram-portrait",
    label: "Instagram Portrait",
    width: 1080,
    height: 1350,
    description: "4:5 portrait (1080×1350)",
  },
];

export function canvasPresetByKey(key: string): CanvasPreset | undefined {
  return CANVAS_PRESETS.find((p) => p.key === key);
}

export function defaultCanvasPreset(): CanvasPreset {
  return canvasPresetByKey(DEFAULT_CANVAS_PRESET_KEY) ?? CANVAS_PRESETS[0];
}

export function formatCanvasDimensions(width: number, height: number): string {
  return `${width}×${height}`;
}
