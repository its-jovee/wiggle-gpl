// Copy @ffmpeg/core WASM assets into public/ffmpeg/ so MP4 export loads
// same-origin (required under COEP). Run via postinstall and before build.
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "node_modules/@ffmpeg/core/dist/esm");
const dest = join(root, "public/ffmpeg");

if (!existsSync(src)) {
  console.error("copy-ffmpeg: @ffmpeg/core not installed — run npm install");
  process.exit(1);
}

mkdirSync(dest, { recursive: true });
for (const file of ["ffmpeg-core.js", "ffmpeg-core.wasm"]) {
  cpSync(join(src, file), join(dest, file));
}
console.log("copy-ffmpeg: copied ffmpeg core to public/ffmpeg/");
