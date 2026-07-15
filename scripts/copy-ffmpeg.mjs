// Copy @ffmpeg/core WASM assets into public/ffmpeg/ so MP4 export loads
// same-origin (required under COEP). Run via postinstall and before build.
import { cpSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "node_modules/@ffmpeg/core/dist/esm");
const dest = join(root, "public/ffmpeg");
const EXPECTED_WASM_SHA256 = "2390efa7fb66e7e42dbae15427571a5ffc96b829480904c30f471f0a78967f61";

if (!existsSync(src)) {
  console.error("copy-ffmpeg: @ffmpeg/core not installed — run npm install");
  process.exit(1);
}

mkdirSync(dest, { recursive: true });
for (const file of ["ffmpeg-core.js", "ffmpeg-core.wasm"]) {
  cpSync(join(src, file), join(dest, file));
}
const wasm = readFileSync(join(dest, "ffmpeg-core.wasm"));
const actualWasmSha256 = createHash("sha256").update(wasm).digest("hex");
if (actualWasmSha256 !== EXPECTED_WASM_SHA256) {
  console.error(`copy-ffmpeg: unexpected ffmpeg-core.wasm SHA-256 ${actualWasmSha256}`);
  process.exit(1);
}
console.log("copy-ffmpeg: copied ffmpeg core to public/ffmpeg/");
