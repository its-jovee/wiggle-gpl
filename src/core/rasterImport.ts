// ============================================================================
// core/rasterImport.ts — PNG/JPEG validation and placement geometry.
//
// Pasted PNG/JPEG images become full-project raster canvases (drawing layers).
// Dropped images become board reference overlays (see main.ts). Images keep
// their aspect ratio; raster imports are centered and never enlarged.
// ============================================================================

const RASTER_IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
]);

export type RasterImageFile = Pick<File, "name" | "type">;

export type RasterImagePlacement = {
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
};

export function isSupportedRasterImageFile(file: RasterImageFile): boolean {
  const mime = file.type.trim().toLowerCase();
  if (RASTER_IMAGE_MIME_TYPES.has(mime)) return true;
  // Some desktop clipboard / Finder providers omit MIME but retain the filename.
  return mime === "" && /\.(?:png|jpe?g)$/i.test(file.name);
}

export function rasterLayerName(file: RasterImageFile): string {
  const stem = file.name.replace(/\.(?:png|jpe?g)$/i, "").trim();
  return stem && stem.toLowerCase() !== "image" ? stem : "Imported image";
}

/** Label for a board reference image — same stem rule, different default. */
export function referenceImageName(file: RasterImageFile): string {
  const stem = file.name.replace(/\.(?:png|jpe?g)$/i, "").trim();
  return stem && stem.toLowerCase() !== "image" ? stem : "Reference";
}

export function containRasterImage(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number
): RasterImagePlacement {
  if (
    !Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) ||
    !Number.isFinite(targetWidth) || !Number.isFinite(targetHeight) ||
    sourceWidth <= 0 || sourceHeight <= 0 || targetWidth <= 0 || targetHeight <= 0
  ) {
    throw new Error("image dimensions must be positive finite numbers");
  }

  const scale = Math.min(1, targetWidth / sourceWidth, targetHeight / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  return {
    x: (targetWidth - width) / 2,
    y: (targetHeight - height) / 2,
    width,
    height,
    scale,
  };
}
