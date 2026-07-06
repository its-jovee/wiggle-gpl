// ============================================================================
// core/fonts.ts — curated font list, loaded via Google Fonts in index.html.
//
// Keep this list in sync with the <link href="..."> at the top of index.html.
// If you change/add a font here, add it to the Google Fonts URL too.
// ============================================================================

export type FontOption = { id: string; family: string; label: string };

export const FONT_OPTIONS: FontOption[] = [
  { id: "comic",   family: "Comic Neue",       label: "Comic" },
  { id: "patrick", family: "Patrick Hand",     label: "Hand" },
  { id: "bangers", family: "Bangers",          label: "Bangers" },
  { id: "caveat",  family: "Caveat",           label: "Caveat" },
  { id: "marker",  family: "Permanent Marker", label: "Marker" },
  { id: "elite",   family: "Special Elite",    label: "Elite" },
  { id: "press",   family: "Press Start 2P",   label: "Press 2P" },
  { id: "plex",    family: "IBM Plex Mono",    label: "Plex Mono" },
];

export const DEFAULT_FONT = FONT_OPTIONS[2]; // Bangers — comic-y
