// vite.config.ts — enable cross-origin isolation so SharedArrayBuffer is
// available to ffmpeg.wasm during MP4 export. These headers must be present
// for both `vite dev` and `vite preview`; without them `new FFmpeg()` will
// throw "SharedArrayBuffer is not defined" the moment export runs.
//
// COEP=require-corp also forbids loading cross-origin sub-resources without
// CORP headers — ffmpeg core is bundled locally in public/ffmpeg/ and loaded
// same-origin via toBlobURL() in core/export.ts.

import { defineConfig } from "vite";
import { homedir } from "node:os";

const crossOriginIsolated = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

export default defineConfig({
  // Relative paths so the production bundle works from `file://` inside the
  // Electron app (and from any subpath if you ever serve it elsewhere).
  base: "./",
  server: {
    headers: crossOriginIsolated,
    fs: { allow: [".", `${homedir()}/Documents`] },
  },
  preview: { headers: crossOriginIsolated },
  optimizeDeps: {
    // ffmpeg ships its own worker; let Vite skip pre-bundling it so the
    // worker URL resolution stays correct.
    exclude: ["@ffmpeg/ffmpeg", "@ffmpeg/util"],
  },
});
