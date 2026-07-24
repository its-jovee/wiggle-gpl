// Generate the license inventory shipped with desktop releases.
// Production dependencies come from package-lock.json; Electron is included
// explicitly because its runtime is distributed even though it is a dev tool.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = join(root, "THIRD_PARTY_NOTICES.md");
const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
const includeDevPackages = new Set(["electron"]);
const electronChromiumNotices = {
  version: "43.2.0",
  path: join(root, "docs/licenses/LICENSES.chromium.html"),
  sha256: "4fc0507a046b9ecd0738b2dd64119b5ec8bc29ac0221b63edb693fd5fd497c87",
};

const exactNotices = new Map([
  ["@ffmpeg/core", `MIT License

Copyright (c) 2019 Jerome Wu

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`],
  ["@ffmpeg/ffmpeg", null],
  ["@ffmpeg/types", null],
  ["@ffmpeg/util", null],
  ["reicon", `MIT License

Copyright (c) 2025 REICON

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`],
]);

for (const name of ["@ffmpeg/ffmpeg", "@ffmpeg/types", "@ffmpeg/util"]) {
  exactNotices.set(name, exactNotices.get("@ffmpeg/core"));
}

function packageName(path, metadata) {
  return metadata.name ?? path.slice("node_modules/".length);
}

function repositoryUrl(pkg) {
  const value = typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url;
  const normalized = value?.replace(/^git\+/, "").replace(/\.git$/, "");
  if (normalized && /^[\w.-]+\/[\w.-]+$/.test(normalized)) return `https://github.com/${normalized}`;
  return normalized ?? pkg.homepage ?? "";
}

function licenseText(packagePath, name) {
  const exact = exactNotices.get(name);
  if (exact) return exact;
  if (!existsSync(packagePath)) return "";
  const candidate = readdirSync(packagePath)
    .filter((file) => /^licen[cs]e(?:\.|$)/i.test(file) && !file.endsWith(".html"))
    .sort()[0];
  if (!candidate) return "";
  const text = readFileSync(join(packagePath, candidate), "utf8").trim();
  return text.length <= 100_000 ? text : "";
}

const packages = Object.entries(lock.packages ?? {})
  .filter(([path, metadata]) => {
    if (!path.startsWith("node_modules/")) return false;
    const name = packageName(path, metadata);
    return metadata.dev !== true || includeDevPackages.has(name);
  })
  .map(([path, metadata]) => {
    const packagePath = join(root, path);
    let pkg = metadata;
    const manifestPath = join(packagePath, "package.json");
    if (existsSync(manifestPath)) pkg = JSON.parse(readFileSync(manifestPath, "utf8"));
    const name = packageName(path, pkg);
    return {
      name,
      version: pkg.version ?? metadata.version ?? "unknown",
      license: pkg.license ?? metadata.license ?? "not declared",
      repository: repositoryUrl(pkg),
      notice: licenseText(packagePath, name),
    };
  })
  .sort((a, b) => a.name.localeCompare(b.name));

const electron = packages.find((pkg) => pkg.name === "electron");
if (electron?.version !== electronChromiumNotices.version) {
  throw new Error(
    `Electron is ${electron?.version ?? "missing"}; refresh LICENSES.chromium.html and its pinned checksum`,
  );
}
if (!existsSync(electronChromiumNotices.path)) {
  throw new Error("docs/licenses/LICENSES.chromium.html is missing");
}
const electronNoticeHash = createHash("sha256")
  .update(readFileSync(electronChromiumNotices.path))
  .digest("hex");
if (electronNoticeHash !== electronChromiumNotices.sha256) {
  throw new Error("docs/licenses/LICENSES.chromium.html does not match Electron 43.2.0");
}

const deckerNotice = `Copyright (c) 2022 John Earnest

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

const sections = packages.map((pkg) => {
  const source = pkg.repository ? `\n- Source: ${pkg.repository}` : "";
  const notice = pkg.notice
    ? `\n\n\`\`\`text\n${pkg.notice}\n\`\`\``
    : "\n\nThe installed package does not include a standalone license file; consult the pinned source above and its declared license before redistribution.";
  return `## ${pkg.name} ${pkg.version}\n\n- Declared license: ${pkg.license}${source}${notice}`;
});

const generated = `# Third-Party Notices

Generated from \`package-lock.json\` by \`npm run notices\`. Do not edit this file manually.

Wiggle GPL itself is licensed under GPL-3.0-only. This document preserves
notices for incorporated techniques, libraries, and the Electron runtime.
FFmpeg WebAssembly has additional copyleft source information in
\`docs/licenses/FFMPEG_WASM_SOURCE.md\`.

## Decker brush techniques

- Project: https://github.com/JohnEarnest/Decker
- License: MIT (brush code) and CC0 (identified frame-image assets)

\`\`\`text
${deckerNotice}
\`\`\`

${sections.join("\n\n")}
`;

if (process.argv.includes("--check")) {
  if (!existsSync(outputPath) || readFileSync(outputPath, "utf8") !== generated) {
    console.error("THIRD_PARTY_NOTICES.md is stale; run npm run notices");
    process.exit(1);
  }
  console.log("third-party notices are current");
} else {
  writeFileSync(outputPath, generated);
  console.log(`wrote ${outputPath}`);
}
