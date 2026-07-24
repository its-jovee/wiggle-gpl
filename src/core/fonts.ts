// ============================================================================
// core/fonts.ts — bundled fonts plus opt-in discovery of installed fonts.
//
// The bundled list stays in sync with the Google Fonts link in index.html so
// the web build always has useful choices. Chromium's Local Font Access API
// augments it in the desktop app and supported browsers after a user gesture.
// ============================================================================

export type FontOption = { id: string; family: string; label: string };
type LocalFontData = { family: string };

type LocalFontWindow = Window & {
  queryLocalFonts?: () => Promise<LocalFontData[]>;
};

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

/** Quote a font family safely for CSS and CanvasRenderingContext2D.font. */
export function fontFamilyCss(family: string): string {
  return `${JSON.stringify(family)}, sans-serif`;
}

export function supportsInstalledFontAccess(): boolean {
  return typeof window !== "undefined"
    && typeof (window as LocalFontWindow).queryLocalFonts === "function";
}

/** Discover every local family exposed by Chromium, de-duplicated by name. */
export async function queryInstalledFontOptions(): Promise<FontOption[]> {
  const queryLocalFonts = typeof window === "undefined"
    ? undefined
    : (window as LocalFontWindow).queryLocalFonts;
  if (!queryLocalFonts) return [];

  const faces = await queryLocalFonts.call(window);
  const families = new Map<string, string>();
  for (const face of faces) {
    const family = face.family.trim();
    if (family && !families.has(family.toLocaleLowerCase())) {
      families.set(family.toLocaleLowerCase(), family);
    }
  }
  return [...families.values()]
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
    .map((family) => ({
      id: `local:${family}`,
      family,
      label: family,
    }));
}
