// electron/main.cjs — entry point for the desktop app.
//
// Responsibilities:
//   1. Apply the COOP+COEP headers that ffmpeg.wasm needs for
//      SharedArrayBuffer / MP4 export.
//   2. Open a window pointing at either the Vite dev server (dev mode) or
//      a loopback server for the built ./dist app (production / packaged app).
//      The local HTTP server matters: a raw file:// document cannot be cross-
//      origin isolated reliably, and MP4 export needs that isolation.
//
// CommonJS so Electron doesn't trip over our root `"type": "module"`.

const { app, BrowserWindow, Menu, dialog, ipcMain, session } = require("electron");
const { autoUpdater } = require("electron-updater");
const fs = require("fs");
const http = require("http");
const path = require("path");

const VITE_DEV_URL = process.env.VITE_DEV_URL; // set when running `electron:dev`
const DIST_DIR = path.join(__dirname, "..", "dist");
const PRELOAD_PATH = path.join(__dirname, "preload.cjs");
const ISOLATION_HEADERS = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
  // ffmpeg.wasm loads the bundled core through blob URLs, then fetches the
  // blob-backed WASM binary inside a worker. script-src and connect-src must
  // both allow blob: or the encoder fails with `TypeError: Failed to fetch`.
  "Content-Security-Policy": "default-src 'self'; script-src 'self' blob: 'wasm-unsafe-eval'; img-src 'self' data: blob:; media-src 'self' data: blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; connect-src 'self' blob: https://lospec.com; worker-src 'self' blob:;",
};
let productionAppUrl = null;
let assetServer = null;
let mainWindow = null;
const approvedAudioPaths = new Set();

function applyIsolationHeaders() {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Cross-Origin-Opener-Policy": [ISOLATION_HEADERS["Cross-Origin-Opener-Policy"]],
        "Cross-Origin-Embedder-Policy": [ISOLATION_HEADERS["Cross-Origin-Embedder-Policy"]],
        "Content-Security-Policy": [ISOLATION_HEADERS["Content-Security-Policy"]],
      },
    });
  });
}

function mimeTypeFor(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case ".html": return "text/html";
    case ".js": return "text/javascript";
    case ".css": return "text/css";
    case ".json": return "application/json";
    case ".wasm": return "application/wasm";
    case ".png": return "image/png";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".svg": return "image/svg+xml";
    case ".webp": return "image/webp";
    default: return "application/octet-stream";
  }
}

function filePathForRequest(urlPathname) {
  const decodedPath = decodeURIComponent(urlPathname);
  const relativePath = decodedPath === "/" ? "index.html" : decodedPath.slice(1);
  const filePath = path.normalize(path.join(DIST_DIR, relativePath));
  if (!filePath.startsWith(DIST_DIR + path.sep) && filePath !== DIST_DIR) return null;
  return filePath;
}

function startAssetServer() {
  return new Promise((resolve, reject) => {
    assetServer = http.createServer((req, res) => {
      const headers = { ...ISOLATION_HEADERS };
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405, headers);
        res.end("Method not allowed");
        return;
      }

      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const filePath = filePathForRequest(url.pathname);
      if (!filePath) {
        res.writeHead(404, headers);
        res.end("Not found");
        return;
      }

      fs.promises.readFile(filePath).then((data) => {
        res.writeHead(200, {
          ...headers,
          "Content-Type": mimeTypeFor(filePath),
        });
        if (req.method === "HEAD") res.end();
        else res.end(data);
      }).catch(() => {
        res.writeHead(404, headers);
        res.end("Not found");
      });
    });

    assetServer.once("error", reject);
    assetServer.listen(0, "127.0.0.1", () => {
      const address = assetServer.address();
      if (!address || typeof address === "string") {
        reject(new Error("failed to bind asset server"));
        return;
      }
      resolve(`http://127.0.0.1:${address.port}/index.html`);
    });
  });
}

/**
 * The default Electron menu's Edit > Undo/Redo use the native `undo`/`redo`
 * roles, which call `webContents.undo()` — text-field undo only. That does
 * nothing to the app's drawing history. Replace just those two items with
 * custom entries that ask the focused window's renderer to run the app's
 * own undo/redo; everything else keeps the standard role so text editing,
 * clipboard, etc. still behave normally.
 */
function buildAppMenu() {
  const isMac = process.platform === "darwin";
  const sendToFocused = (channel) => {
    const win = BrowserWindow.getFocusedWindow() || mainWindow;
    win?.webContents.send(channel);
  };

  const template = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    }] : []),
    {
      label: "File",
      submenu: [isMac ? { role: "close" } : { role: "quit" }],
    },
    {
      label: "Edit",
      submenu: [
        // registerAccelerator: false — the shortcut is still shown in the
        // menu label, but Electron won't fire `click` from the raw
        // keypress. The renderer's own keydown handler (main.ts) is the
        // single source of truth for Cmd+Z / Shift+Cmd+Z; without this flag
        // both it and this menu item would fire on every press, undoing
        // twice. The menu item stays reachable by actually clicking it.
        { label: "Undo", accelerator: "CmdOrCtrl+Z", registerAccelerator: false, click: () => sendToFocused("menu:undo") },
        { label: "Redo", accelerator: "Shift+CmdOrCtrl+Z", registerAccelerator: false, click: () => sendToFocused("menu:redo") },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        ...(isMac ? [{ type: "separator" }, { role: "front" }] : [{ role: "close" }]),
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 1000,
    minWidth: 900,
    minHeight: 700,
    title: "WiggleStudio",
    backgroundColor: "#0e0e16",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: PRELOAD_PATH,
      // ffmpeg.wasm + cross-origin isolation
      webSecurity: true,
    },
  });

  if (VITE_DEV_URL) {
    win.loadURL(VITE_DEV_URL);
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    win.loadURL(productionAppUrl);
  }

  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });
  mainWindow = win;
  return win;
}

/**
 * GitHub Releases are the update source. We intentionally require an explicit
 * download choice so an animation session is never interrupted by a large
 * package download; installation happens only after a second confirmation.
 */
function configureAutoUpdates() {
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.on("error", (error) => {
    // Update availability must never prevent the editor from opening.
    console.warn("update check failed:", error.message);
  });
  autoUpdater.on("update-available", async (info) => {
    const result = await dialog.showMessageBox(mainWindow, {
      type: "info",
      buttons: ["Download update", "Not now"],
      defaultId: 0,
      cancelId: 1,
      title: "Update available",
      message: `Wiggle GPL ${info.version} is ready.`,
      detail: "Download it now and choose when to restart the editor.",
    });
    if (result.response === 0) await autoUpdater.downloadUpdate();
  });
  autoUpdater.on("download-progress", (progress) => {
    mainWindow?.setProgressBar(progress.percent / 100);
  });
  autoUpdater.on("update-downloaded", async (info) => {
    mainWindow?.setProgressBar(-1);
    const result = await dialog.showMessageBox(mainWindow, {
      type: "info",
      buttons: ["Restart and install", "Later"],
      defaultId: 0,
      cancelId: 1,
      title: "Update downloaded",
      message: `Wiggle GPL ${info.version} is ready to install.`,
      detail: "Restarting now closes the editor and installs the update.",
    });
    if (result.response === 0) autoUpdater.quitAndInstall();
  });

  autoUpdater.checkForUpdates().catch((error) => {
    console.warn("update check failed:", error.message);
  });
}

function safeFileName(name) {
  return name.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "") || "audio";
}

async function defaultAudioDir() {
  const dir = path.join(app.getPath("userData"), "recordings");
  await fs.promises.mkdir(dir, { recursive: true });
  return dir;
}

function isApprovedAudioPath(filePath) {
  if (typeof filePath !== "string") return false;
  const resolved = path.resolve(filePath);
  for (const approved of approvedAudioPaths) {
    if (resolved === approved) return true;
  }
  return false;
}

function registerAudioIpc() {
  ipcMain.handle("audio:pick-files", async () => {
    const result = await dialog.showOpenDialog({
      title: "Import audio",
      properties: ["openFile", "multiSelections"],
      filters: [
        { name: "Audio", extensions: ["wav", "mp3", "m4a", "aac", "flac", "ogg", "opus", "webm"] },
        { name: "All Files", extensions: ["*"] },
      ],
    });
    if (result.canceled) return [];
    for (const filePath of result.filePaths) approvedAudioPaths.add(path.resolve(filePath));
    return result.filePaths.map((filePath) => ({
      path: filePath,
      name: path.basename(filePath),
    }));
  });

  ipcMain.handle("audio:read-file", async (_event, filePath) => {
    if (!isApprovedAudioPath(filePath)) throw new Error("audio path was not selected by the user");
    const data = await fs.promises.readFile(filePath);
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  });

  ipcMain.handle("audio:file-exists", async (_event, filePath) => {
    if (!isApprovedAudioPath(filePath)) return false;
    try {
      await fs.promises.access(filePath, fs.constants.R_OK);
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle("audio:save-recording", async (_event, payload) => {
    // The renderer may suggest a directory, but recordings always stay inside
    // the app-owned folder. This prevents a compromised renderer from writing
    // into arbitrary OS locations.
    const dir = await defaultAudioDir();
    await fs.promises.mkdir(dir, { recursive: true });
    const ext = /^(webm|wav|mp3|m4a|ogg|opus|aac|flac)$/i.test(payload?.extension ?? "")
      ? payload.extension.toLowerCase()
      : "webm";
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const base = safeFileName(payload?.name || `voice-${stamp}`);
    const filePath = path.join(dir, `${base}.${ext}`);
    if (!payload?.bytes) throw new Error("recording bytes are required");
    const bytes = Buffer.from(payload.bytes);
    await fs.promises.writeFile(filePath, bytes);
    approvedAudioPaths.add(path.resolve(filePath));
    return { path: filePath, name: path.basename(filePath) };
  });

  ipcMain.handle("audio:get-default-recording-dir", async () => defaultAudioDir());
}

app.whenReady().then(async () => {
  applyIsolationHeaders();
  buildAppMenu();
  registerAudioIpc();
  if (!VITE_DEV_URL) productionAppUrl = await startAssetServer();
  createWindow();
  configureAutoUpdates();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  assetServer?.close();
});
