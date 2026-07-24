// ============================================================================
// core/appMeta.ts — single source for app identity shown by the web and
// Electron shells. The package version also drives signed release artifacts,
// so UI copy must never carry a second hand-maintained version string.
// ============================================================================

import packageJson from "../../package.json";

export const APP_NAME = "Wiggle GPL";
export const APP_VERSION = packageJson.version;
export const SOURCE_URL = "https://github.com/its-jovee/wiggle-gpl";
export const LICENSE_LABEL = "GPL-3.0-only";
