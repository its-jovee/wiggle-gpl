// ============================================================================
// core/palette.ts — Lospec palettes are just lists of hex colors.
//
// Their public JSON API: https://lospec.com/palette-list/<slug>.json
// returns { name, colors: ["aabbcc", ...] } (no leading '#'). For a local tool
// importing the occasional palette this is fine; if you ship something that
// hammers their endpoint, check their terms / cache aggressively first.
//
// "Every frame unique in look" falls out for free: palette is a PER-PANEL
// property (Panel.paletteId), so different panels can pull different palettes.
// ============================================================================

export type Palette = { id: string; name: string; colors: string[] };

const cache = new Map<string, Palette>();

export async function loadLospecPalette(slug: string): Promise<Palette> {
  const cached = cache.get(slug);
  if (cached) return cached;

  let res: Response;
  try {
    res = await fetch(`https://lospec.com/palette-list/${slug}.json`);
  } catch {
    throw new Error("Could not reach Lospec — check your connection and try again.");
  }
  if (res.status === 404) throw new Error(`Palette "${slug}" not found on Lospec.`);
  if (!res.ok) throw new Error(`Lospec returned an error (${res.status}). Try again later.`);

  let data: { name?: string; colors?: string[] };
  try {
    data = await res.json();
  } catch {
    throw new Error(`Lospec returned invalid data for "${slug}".`);
  }
  if (!Array.isArray(data.colors) || data.colors.length === 0) {
    throw new Error(`Palette "${slug}" has no colors.`);
  }
  const pal: Palette = {
    id: slug,
    name: data.name ?? slug,
    colors: (data.colors as string[]).map((c) => (c.startsWith("#") ? c : `#${c}`)),
  };
  cache.set(slug, pal);
  return pal;
}

// A handful of built-ins so the app works offline / before any fetch.
export const BUILTIN_PALETTES: Palette[] = [
  { id: "sweetie-16", name: "Sweetie 16", colors:
    ["#1a1c2c","#5d275d","#b13e53","#ef7d57","#ffcd75","#a7f070","#38b764","#257179",
     "#29366f","#3b5dc9","#41a6f6","#73eff7","#f4f4f4","#94b0c2","#566c86","#333c57"] },
  { id: "pico-8", name: "PICO-8", colors:
    ["#000000","#1d2b53","#7e2553","#008751","#ab5236","#5f574f","#c2c3c7","#fff1e8",
     "#ff004d","#ffa300","#ffec27","#00e436","#29adff","#83769c","#ff77a8","#ffccaa"] },
  { id: "endesga-16", name: "Endesga 16", colors:
    ["#e4a672","#b86f50","#743f39","#3f2832","#9e2835","#e53b44","#fb922b","#ffe762",
     "#63c64d","#327345","#193d3f","#4f6781","#afbfd2","#ffffff","#2ce8f4","#0484d1"] },
  { id: "gameboy", name: "Game Boy", colors:
    ["#0f380f","#306230","#8bac0f","#9bbc0f"] },
  { id: "vinik24", name: "Vinik 24", colors:
    ["#000000","#6f6776","#9a9a97","#c5ccb8","#8b5580","#c38890","#a593a5","#666092",
     "#9a4f50","#c28d75","#7ca1c0","#416aa3","#8d6268","#be955c","#68aca9","#387080",
     "#6e6962","#93a167","#6eaa78","#557064","#9d9f7f","#7e9e99","#5d6872","#433455"] },
  { id: "mono-ink", name: "Mono Ink", colors:
    ["#0e0e16","#2a2a3a","#566c86","#94b0c2","#e8e8f0","#ffffff"] },
];
