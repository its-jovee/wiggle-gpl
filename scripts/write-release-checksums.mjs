// Write deterministic SHA-256 checksums for release artifacts after packaging.

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const releaseDir = join(root, "release");
const files = readdirSync(releaseDir, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name !== "SHA256SUMS.txt")
  .map((entry) => entry.name)
  .sort();

if (!files.length) throw new Error("no release artifacts found");

const lines = files.map((name) => {
  const digest = createHash("sha256").update(readFileSync(join(releaseDir, name))).digest("hex");
  return `${digest}  ${name}`;
});
writeFileSync(join(releaseDir, "SHA256SUMS.txt"), `${lines.join("\n")}\n`);
console.log(`wrote checksums for ${files.length} release artifacts`);
