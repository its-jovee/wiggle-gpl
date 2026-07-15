// electron/preload.cjs — narrow desktop bridge for local audio media.

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("wiggleAudio", {
  pickFiles: () => ipcRenderer.invoke("audio:pick-files"),
  readFile: (filePath) => ipcRenderer.invoke("audio:read-file", filePath),
  fileExists: (filePath) => ipcRenderer.invoke("audio:file-exists", filePath),
  saveRecording: (payload) => ipcRenderer.invoke("audio:save-recording", payload),
  getDefaultRecordingDir: () => ipcRenderer.invoke("audio:get-default-recording-dir"),
});

contextBridge.exposeInMainWorld("wiggleMenu", {
  onMenuUndo: (cb) => ipcRenderer.on("menu:undo", () => cb()),
  onMenuRedo: (cb) => ipcRenderer.on("menu:redo", () => cb()),
});
