// ============================================================================
// core/projectLibrary.ts — local project records for the spatial Project Board.
//
// The board is application state above a Project, never part of project JSON.
// Each IndexedDB record is overwritten in place on autosave and carries only a
// cached preview plus the session state needed to return to that document.
// ============================================================================

export type BoardViewport = {
  scale: number;
  tx: number;
  ty: number;
};

export type ProjectLibraryRecord = {
  id: string;
  name: string;
  json: string;
  previewDataUrl: string | null;
  x: number;
  y: number;
  updatedAt: number;
  activePanelIndex: number;
  viewport: BoardViewport;
};

export type ProjectBoardMeta = {
  key: "board";
  activeProjectId: string | null;
  camera: BoardViewport;
  // Set once records have been migrated from the old display-size grid to
  // full-resolution world coordinates (see boardCamera.migrateLegacyPosition).
  worldMigrated?: boolean;
};

const DB_NAME = "wiggle-gpl-project-library";
const DB_VERSION = 1;
const PROJECT_STORE = "projects";
const META_STORE = "meta";

const DEFAULT_CAMERA: BoardViewport = { scale: 1, tx: 80, ty: 80 };

export function defaultProjectBoardMeta(): ProjectBoardMeta {
  return {
    key: "board",
    activeProjectId: null,
    camera: { ...DEFAULT_CAMERA },
  };
}

export function nextProjectBoardPosition(
  records: Pick<ProjectLibraryRecord, "x" | "y">[]
): { x: number; y: number } {
  const index = records.length;
  const columns = 3;
  return {
    x: (index % columns) * 560,
    y: Math.floor(index / columns) * 560,
  };
}

export function projectBoardCanvasSize(
  width: number,
  height: number
): { width: number; height: number } {
  const sourceWidth = Number.isFinite(width) && width > 0 ? width : 1080;
  const sourceHeight = Number.isFinite(height) && height > 0 ? height : 1080;
  const scale = Math.min(0.24, 520 / Math.max(sourceWidth, sourceHeight));
  return {
    width: Math.max(24, Math.round(sourceWidth * scale)),
    height: Math.max(24, Math.round(sourceHeight * scale)),
  };
}

export function clampBoardScale(scale: number): number {
  return Math.max(0.2, Math.min(3, Number.isFinite(scale) ? scale : 1));
}

export function zoomBoardCamera(
  camera: BoardViewport,
  nextScale: number,
  clientX: number,
  clientY: number
): BoardViewport {
  const scale = clampBoardScale(nextScale);
  const worldX = (clientX - camera.tx) / camera.scale;
  const worldY = (clientY - camera.ty) / camera.scale;
  return {
    scale,
    tx: clientX - worldX * scale,
    ty: clientY - worldY * scale,
  };
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
  });
}

let databasePromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PROJECT_STORE)) {
        db.createObjectStore(PROJECT_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      databasePromise = null;
      reject(request.error ?? new Error("Could not open the project library"));
    };
  });
  return databasePromise;
}

export function projectLibraryAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

export async function listProjectLibraryRecords(): Promise<ProjectLibraryRecord[]> {
  const db = await openDatabase();
  const transaction = db.transaction(PROJECT_STORE, "readonly");
  const records = await requestResult(transaction.objectStore(PROJECT_STORE).getAll()) as ProjectLibraryRecord[];
  await transactionDone(transaction);
  return records.sort((a, b) => a.updatedAt - b.updatedAt);
}

export async function getProjectLibraryRecord(id: string): Promise<ProjectLibraryRecord | null> {
  const db = await openDatabase();
  const transaction = db.transaction(PROJECT_STORE, "readonly");
  const record = await requestResult(transaction.objectStore(PROJECT_STORE).get(id)) as ProjectLibraryRecord | undefined;
  await transactionDone(transaction);
  return record ?? null;
}

export async function putProjectLibraryRecord(record: ProjectLibraryRecord): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction(PROJECT_STORE, "readwrite");
  transaction.objectStore(PROJECT_STORE).put(record);
  await transactionDone(transaction);
}

export async function deleteProjectLibraryRecord(id: string): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction(PROJECT_STORE, "readwrite");
  transaction.objectStore(PROJECT_STORE).delete(id);
  await transactionDone(transaction);
}

export async function readProjectBoardMeta(): Promise<ProjectBoardMeta> {
  const db = await openDatabase();
  const transaction = db.transaction(META_STORE, "readonly");
  const meta = await requestResult(transaction.objectStore(META_STORE).get("board")) as ProjectBoardMeta | undefined;
  await transactionDone(transaction);
  return meta ?? defaultProjectBoardMeta();
}

export async function writeProjectBoardMeta(meta: ProjectBoardMeta): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction(META_STORE, "readwrite");
  transaction.objectStore(META_STORE).put(meta);
  await transactionDone(transaction);
}
