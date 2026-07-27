# SECURITY_FABLE_CRIT — Security & Robustness Critique

Threat-model context: this is a **local-first, single-user** app (no accounts, no
server, no multi-tenant data). That correctly deflates most classic web risks. The
real attack surface is: (a) the Electron desktop shell, (b) opening a malicious
`.wigo.json` (legacy `.wiggle.json`) project file, and (c) the one outbound network call (Lospec). Ranked
by that reality.

---

## 1. Electron IPC handlers read/write arbitrary paths — SEVERITY: HIGH (desktop)

`electron/main.cjs` exposes to the renderer via preload (`preload.cjs`):

```js
ipcMain.handle("audio:read-file", (_e, filePath) => fs.promises.readFile(filePath));
ipcMain.handle("audio:file-exists", (_e, filePath) => fs.access(filePath, R_OK));
ipcMain.handle("audio:save-recording", (_e, payload) => { /* writes payload.bytes to payload.directory */ });
```

- `audio:read-file` will read **any file the OS user can read** — `~/.ssh/id_rsa`,
  `/etc/passwd` — and hand the bytes back to renderer JS. There is no allow-list, no
  check that the path is an audio asset the app created.
- `audio:save-recording` takes a caller-supplied `payload.directory` and writes bytes
  there. `safeFileName()` sanitizes the *basename* but **not the directory** — the
  directory is used verbatim (`path.join(payload.directory, ...)`), so a chosen
  directory of `/Users/x/Library/LaunchAgents` writes an attacker-named file into a
  sensitive location.

Why it's HIGH-for-desktop and not "critical": `contextIsolation:true`,
`nodeIntegration:false`, `webSecurity:true` are all correctly set (good!), so
exploitation requires the renderer to already be running attacker JS. But the app
loads a Google Fonts stylesheet from the network (index.html:9) and fetches arbitrary
Lospec JSON, and there's no CSP (see §3) — so an injection in either path turns "read
any local file" into real exfiltration.

**Fix:** in the main process, resolve every incoming path and assert it's within the
app's known recordings/import roots (`path.resolve` + `startsWith(allowedRoot + sep)`,
exactly the pattern already used correctly in `filePathForRequest`, main.cjs:56–61 —
that guard is good; the audio handlers just don't use the equivalent). For
`save-recording`, ignore `payload.directory` entirely or validate it against
`defaultAudioDir()`.

## 2. No Content-Security-Policy anywhere — SEVERITY: MEDIUM

Neither `index.html` (no `<meta http-equiv="Content-Security-Policy">`) nor the
Electron `onHeadersReceived` (main.cjs:28, only sets COOP/COEP) defines a CSP. Combined
with heavy `innerHTML` use (21 sites) this is the classic setup for a stored-XSS-via-
document: a project file's text (layer names, text-element content, palette names) that
reaches an `innerHTML` sink executes as HTML.

I checked the `innerHTML` sites — the ones I read set static markup and build
user-content nodes via `textContent`/`createElement` (good discipline). So there is
**no confirmed injection today**. But:
- The invariant "no user string ever reaches innerHTML" is enforced by nothing. One
  future `host.innerHTML = \`<div>${layer.name}</div>\`` is game over, and the code
  already mixes `innerHTML` and `textContent` freely enough that this is plausible.
- A CSP (`default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src fonts.gstatic.com; connect-src 'self' lospec.com; script-src 'self'`) is defense-in-depth that makes the whole class non-exploitable. It's ~5 lines and should exist on the Electron side especially.

## 3. Malicious project-file DoS — SEVERITY: MEDIUM

`projectValidation.ts` is the right idea and catches the worst cases (dimensions
capped at 4096, ≤200 panels, ≤50k strokes/layer). Gaps:

- `MAX_POINTS_PER_STROKE = 500_000`. A project can have 200 panels × N layers ×
  50,000 strokes × 500,000 points and still "validate." The render walk and the
  `history.push` JSON.stringify will hang the tab long before any limit trips. The
  per-stroke point cap is 3–4 orders of magnitude beyond anything a human draws.
- **No cap on layers-per-panel, sub-panels-per-panel, or texts-per-layer.** A file
  with 100,000 empty layers passes validation and then OOMs the UI build loop
  (`buildLayers` creates a DOM node per layer).
- No validation that `timelapse.sourceId` references an existing panel (render handles
  the miss gracefully — "source missing" — so this is cosmetic, but worth noting).
- Numeric fields (`durationMs`, `opacity`, `fontSize`, animation transforms) are not
  range-checked; `NaN`/`Infinity`/negative durations flow into the clocks and canvas
  transforms. `durationMs` of `Infinity` makes `sequenceAtTime` and the playhead
  math undefined.

**Fix:** tighten `MAX_POINTS_PER_STROKE` to something human (e.g. 20,000), add
`MAX_LAYERS_PER_PANEL`, `MAX_SUBPANELS`, `MAX_TEXTS`, and coerce/clamp numeric fields
in the same pass that already caps fill tolerance (`capProjectFillLimits`).

## 4. Lospec fetch — SSRF-adjacent & trust — SEVERITY: LOW

`loadLospecPalette` (palette.ts:17) fetches `https://lospec.com/palette-list/${slug}.json`
with `slug` from a text input. `slug` is interpolated unescaped, so a value like
`../../something` or one containing a `@`/`#` could redirect the path — but it's a
fixed host over HTTPS and the response is only read as a color list (each entry
coerced to `#rrggbb`), so worst case is a failed fetch or garbage colors. Low risk.
Two hardening steps: `encodeURIComponent(slug)`, and validate each color matches
`/^#[0-9a-f]{6}$/i` before use (right now `#${anything}` becomes a CSS color string
that later hits canvas `fillStyle`).

## 5. `localStorage` recovery snapshot — SEVERITY: LOW

`writeRecoverySnapshot` (persistence.ts:161) stores the full serialized project in
`localStorage` under `wigostudio.recovery`. Two notes:
- On a **shared machine / shared browser profile**, unsaved creative work sits in
  localStorage in cleartext until the next save clears it. For a "local, private"
  tool this is a mild privacy surprise (the user thinks nothing is saved because they
  never picked a file).
- localStorage quota (~5–10MB) vs. a large project: `writeRecoverySnapshot` doesn't
  catch a `QuotaExceededError`, so autosave recovery silently fails to persist for
  exactly the large projects that most need it. Wrap it in try/catch and surface a
  "recovery disabled — project too large" status.

## 6. Supply chain / dependencies — SEVERITY: LOW (but note the WASM)

- Small, sane dependency set (vite, typescript, ffmpeg trio, electron, playwright).
- `@ffmpeg/core` is pinned exactly (`0.12.6` — good, WASM should be pinned) but
  `@ffmpeg/ffmpeg` and `@ffmpeg/util` use `^`. A caret bump of the loader that changes
  the core ABI expectation would break export silently. Pin all three.
- The bundled `ffmpeg-core.wasm` is a large third-party binary copied into `public/`
  at install time. No integrity check (`copy-ffmpeg.mjs` just copies from
  node_modules). If node_modules is ever poisoned, a trojaned wasm ships. A SHA
  compare against a committed hash would close this.
- `postinstall` runs `node scripts/copy-ffmpeg.mjs` — a postinstall script that does
  filesystem work. Benign here (you wrote it), but worth knowing it's there for
  anyone auditing.

## 7. Google Fonts hard dependency at load — SEVERITY: LOW (privacy/offline)

index.html:7–9 preconnects and loads 8 font families from `fonts.googleapis.com`.
- Every launch pings Google (privacy leak for a "local" tool; also an IP/timestamp to
  a third party on an app that markets itself as offline-capable).
- Under Electron's `require-corp` COEP, a cross-origin stylesheet without proper CORP
  can be blocked — the fonts silently fall back. Self-hosting the fonts (they're all
  OFL) removes the network dependency, the privacy leak, and the COEP fragility at
  once. This also matters for the offline claim in PRODUCT.md.

---

## What's done right (so the fixes above are proportionate)

- Electron `webPreferences` hardening is textbook: contextIsolation on, nodeIntegration
  off, a *narrow* preload bridge (5 methods, no raw `ipcRenderer` exposed).
- The production asset server's path-traversal guard (main.cjs:56–61) is correct.
- Project files are validated and migrated before use, not `eval`'d or trusted.
- Determinism/seeding means no `Math.random` reaching security-relevant paths.
- `roundCoords` serializer avoids float-precision bloat and there's no `eval`/`Function`
  constructor anywhere in `src/`.
