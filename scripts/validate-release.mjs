// Fail closed before a signed release if its version or required credentials
// are missing. Secret values are never printed.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
const tag = process.argv[2] ?? process.env.GITHUB_REF_NAME ?? "";
const expectedTag = `v${pkg.version}`;

if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(tag)) {
  throw new Error(`release tag ${JSON.stringify(tag)} is not semantic version syntax`);
}
if (tag !== expectedTag) {
  throw new Error(`release tag ${tag} does not match package version ${pkg.version}`);
}
if (lock.packages?.[""]?.version !== pkg.version) {
  throw new Error("package-lock.json root version does not match package.json");
}

const requiredSecrets = [
  "CSC_LINK",
  "CSC_KEY_PASSWORD",
  "APPLE_ID",
  "APPLE_APP_SPECIFIC_PASSWORD",
  "APPLE_TEAM_ID",
];
const missing = requiredSecrets.filter((name) => !process.env[name]);
if (missing.length) throw new Error(`missing release credentials: ${missing.join(", ")}`);

console.log(`release inputs validated for ${tag}`);
