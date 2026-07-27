// electron/preload.cjs — narrow desktop bridge for local audio media.

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("wigoDesktop", {
  platform: process.platform,
});

contextBridge.exposeInMainWorld("wigoAudio", {
  pickFiles: () => ipcRenderer.invoke("audio:pick-files"),
  readFile: (filePath) => ipcRenderer.invoke("audio:read-file", filePath),
  fileExists: (filePath) => ipcRenderer.invoke("audio:file-exists", filePath),
  saveRecording: (payload) => ipcRenderer.invoke("audio:save-recording", payload),
  getDefaultRecordingDir: () => ipcRenderer.invoke("audio:get-default-recording-dir"),
});

contextBridge.exposeInMainWorld("wigoMenu", {
  onMenuUndo: (cb) => ipcRenderer.on("menu:undo", () => cb()),
  onMenuRedo: (cb) => ipcRenderer.on("menu:redo", () => cb()),
});

// Mark Electron-mac early so CSS can clear the traffic-light inset before paint.
if (process.platform === "darwin") {
  const mark = () => document.documentElement.classList.add("electron-mac");
  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", mark, { once: true });
  } else {
    mark();
  }
}
