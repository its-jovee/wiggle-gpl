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

const { app, BrowserWindow, dialog, ipcMain, session } = require("electron");
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
};
let productionAppUrl = null;
let assetServer = null;
let mainWindow = null;

function applyIsolationHeaders() {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Cross-Origin-Opener-Policy": [ISOLATION_HEADERS["Cross-Origin-Opener-Policy"]],
        "Cross-Origin-Embedder-Policy": [ISOLATION_HEADERS["Cross-Origin-Embedder-Policy"]],
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
    return result.filePaths.map((filePath) => ({
      path: filePath,
      name: path.basename(filePath),
    }));
  });

  ipcMain.handle("audio:read-file", async (_event, filePath) => {
    const data = await fs.promises.readFile(filePath);
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  });

  ipcMain.handle("audio:file-exists", async (_event, filePath) => {
    try {
      await fs.promises.access(filePath, fs.constants.R_OK);
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle("audio:save-recording", async (_event, payload) => {
    const dir = payload?.directory || await defaultAudioDir();
    await fs.promises.mkdir(dir, { recursive: true });
    const ext = payload?.extension || "webm";
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const base = safeFileName(payload?.name || `voice-${stamp}`);
    const filePath = path.join(dir, `${base}.${ext}`);
    const bytes = Buffer.from(payload.bytes);
    await fs.promises.writeFile(filePath, bytes);
    return { path: filePath, name: path.basename(filePath) };
  });

  ipcMain.handle("audio:get-default-recording-dir", async () => defaultAudioDir());
}

app.whenReady().then(async () => {
  applyIsolationHeaders();
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
