// ============================================================================
// core/persistence.ts — project file persistence and local recovery.
//
// File System Access API handles the app-like path when available. Browser-only
// fallback keeps the existing download/open-file flow and writes local recovery
// snapshots so unsaved work can be restored after a restart.
// ============================================================================

import { Project, migrateProject } from "./types";
import { applySanitizedGroups } from "./sequence";
import { downloadBlob } from "./export";
import { assertValidProject } from "./projectValidation";

function roundCoords(_key: string, value: unknown): unknown {
  return typeof value === "number" ? Math.round(value * 10000) / 10000 : value;
}

function loadProject(raw: unknown): Project {
  const project = migrateProject(raw);
  assertValidProject(project);
  applySanitizedGroups(project);
  return project;
}

function serialize(project: Project, indent?: number): string {
  return JSON.stringify(project, roundCoords, indent);
}

/** Canonical project serialization — used for saved files, the fingerprint
 *  hash, and recovery snapshots, so callers that already have the string can
 *  reuse it instead of re-stringifying (see `projectHashFromString`,
 *  `writeHandleString`, `writeRecoverySnapshotString`). */
export function serializeProject(project: Project, indent = 2): string {
  return serialize(project, indent);
}

type PickerAccept = { description: string; accept: Record<string, string[]> };
type SavePickerOptions = { suggestedName?: string; types?: PickerAccept[] };
type OpenPickerOptions = { types?: PickerAccept[]; multiple?: boolean };
type FilePickerWindow = Window & {
  showSaveFilePicker?: (options?: SavePickerOptions) => Promise<FileSystemFileHandle>;
  showOpenFilePicker?: (options?: OpenPickerOptions) => Promise<FileSystemFileHandle[]>;
};

export type RecentFile = { name: string; timestamp: number };
export type RecoverySnapshot = { savedAt: number; json: string };

const RECENTS_KEY = "wigglestudio.recents";
const RECOVERY_KEY = "wigglestudio.recovery";

const PROJECT_TYPES: PickerAccept[] = [{
  description: "Wiggle GPL project",
  accept: { "application/json": [".wiggle.json", ".json"] },
}];

export const persistenceState: {
  currentFileHandle: FileSystemFileHandle | null;
  currentFileName: string | null;
  lastSavedHash: string;
} = {
  currentFileHandle: null,
  currentFileName: null,
  lastSavedHash: "",
};

export function canUseFileSystemAccess(): boolean {
  const w = window as FilePickerWindow;
  return typeof w.showSaveFilePicker === "function" && typeof w.showOpenFilePicker === "function";
}

export function projectHashFromString(json: string): string {
  let hash = 2166136261;
  for (let i = 0; i < json.length; i++) {
    hash ^= json.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${json.length}:${hash >>> 0}`;
}

export function projectHash(project: Project): string {
  return projectHashFromString(serializeProject(project));
}

export async function writeHandleString(handle: FileSystemFileHandle, json: string) {
  const writable = await handle.createWritable();
  await writable.write(json);
  await writable.close();
}

export async function writeHandle(handle: FileSystemFileHandle, project: Project) {
  await writeHandleString(handle, serializeProject(project));
}

export async function saveAsProject(
  project: Project,
  suggestedName = "wigglestudio-project.wiggle.json",
  serialized?: string
) {
  const json = serialized ?? serializeProject(project);
  if (!canUseFileSystemAccess()) {
    downloadProjectString(json, suggestedName);
    persistenceState.currentFileHandle = null;
    persistenceState.currentFileName = suggestedName;
    persistenceState.lastSavedHash = projectHashFromString(json);
    pushRecent(suggestedName);
    return { fileName: suggestedName, mode: "download" as const };
  }

  const handle = await (window as FilePickerWindow).showSaveFilePicker!({
    suggestedName,
    types: PROJECT_TYPES,
  });
  await writeHandleString(handle, json);
  persistenceState.currentFileHandle = handle;
  persistenceState.currentFileName = handle.name;
  persistenceState.lastSavedHash = projectHashFromString(json);
  pushRecent(handle.name);
  return { fileName: handle.name, mode: "file" as const };
}

export async function saveProject(project: Project, serialized?: string) {
  const json = serialized ?? serializeProject(project);
  if (!persistenceState.currentFileHandle) {
    return saveAsProject(project, persistenceState.currentFileName ?? undefined, json);
  }
  await writeHandleString(persistenceState.currentFileHandle, json);
  persistenceState.lastSavedHash = projectHashFromString(json);
  pushRecent(persistenceState.currentFileName ?? persistenceState.currentFileHandle.name);
  return { fileName: persistenceState.currentFileName ?? persistenceState.currentFileHandle.name, mode: "file" as const };
}

export async function openProjectFromPicker() {
  if (!canUseFileSystemAccess()) return null;
  const [handle] = await (window as FilePickerWindow).showOpenFilePicker!({
    types: PROJECT_TYPES,
    multiple: false,
  });
  if (!handle) return null;
  const file = await handle.getFile();
  const project = loadProject(JSON.parse(await file.text()));
  persistenceState.currentFileHandle = handle;
  persistenceState.currentFileName = handle.name;
  persistenceState.lastSavedHash = projectHash(project);
  pushRecent(handle.name);
  clearRecoverySnapshot();
  return { project, fileName: handle.name };
}

export async function readFallbackFile(file: File) {
  const project = loadProject(JSON.parse(await file.text()));
  persistenceState.currentFileHandle = null;
  persistenceState.currentFileName = file.name;
  persistenceState.lastSavedHash = projectHash(project);
  pushRecent(file.name);
  clearRecoverySnapshot();
  return project;
}

export function resetCurrentFile(project: Project, serialized?: string) {
  persistenceState.currentFileHandle = null;
  persistenceState.currentFileName = null;
  persistenceState.lastSavedHash = serialized
    ? projectHashFromString(serialized)
    : projectHash(project);
}

export function downloadProject(project: Project, filename: string) {
  downloadProjectString(serializeProject(project), filename);
}

export function downloadProjectString(json: string, filename: string) {
  const blob = new Blob([json], { type: "application/json" });
  downloadBlob(blob, filename);
}

export function readRecents(): RecentFile[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENTS_KEY) ?? "[]") as RecentFile[];
    return raw.filter((r) => r && typeof r.name === "string" && typeof r.timestamp === "number").slice(0, 5);
  } catch {
    return [];
  }
}

export function pushRecent(name: string) {
  const next = [{ name, timestamp: Date.now() }, ...readRecents().filter((r) => r.name !== name)].slice(0, 5);
  localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
}

export function writeRecoverySnapshotString(json: string): RecoverySnapshot | null {
  const snapshot: RecoverySnapshot = { savedAt: Date.now(), json };
  try {
    localStorage.setItem(RECOVERY_KEY, JSON.stringify(snapshot));
    return snapshot;
  } catch {
    // Quota errors are expected for large raster-heavy projects. The caller
    // surfaces the condition, while save-to-file remains fully available.
    return null;
  }
}

export function writeRecoverySnapshot(project: Project) {
  return writeRecoverySnapshotString(serializeProject(project));
}

export function readRecoverySnapshot(): RecoverySnapshot | null {
  try {
    const raw = JSON.parse(localStorage.getItem(RECOVERY_KEY) ?? "null") as RecoverySnapshot | null;
    if (!raw || typeof raw.savedAt !== "number" || typeof raw.json !== "string") return null;
    return raw;
  } catch {
    return null;
  }
}

export function recoverProject(snapshot: RecoverySnapshot): Project {
  return loadProject(JSON.parse(snapshot.json));
}

export function clearRecoverySnapshot() {
  localStorage.removeItem(RECOVERY_KEY);
}
