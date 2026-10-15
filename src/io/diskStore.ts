/**
 * Saving projects to a folder on disk with the File System Access API (Edge / Chrome).
 *
 * The low-level functions take any `FileSystemDirectoryHandle` (a folder picked by the user, or
 * an origin-private folder from `navigator.storage.getDirectory()` in tests). The module-level
 * part keeps the one connected folder, its permission state and the debounced writer, and
 * publishes its state through the `useDisk` store for the interface.
 */
import { createStore, del, get, set, type UseStore } from 'idb-keyval';
import { create } from 'zustand';
import type { Project } from '../engine';
import { safeFileName } from './files';
import { readProjectFile, toProjectFile } from './schema';

export const FILE_EXT = '.gantt.json';
export const DELETED_DIR = 'Deleted';
export const VERSIONS_DIR = 'Versions';
/** Folder writes are debounced; IndexedDB saves (500 ms) are not. */
export const FOLDER_SAVE_MS = 2000;
/** A folder file counts as newer than the browser copy only beyond this margin. */
export const NEWER_MARGIN_MS = 2000;

// ------------------------------------------------------------------ API typing

type PermissionResult = 'granted' | 'denied' | 'prompt';
type DirPicker = (options?: {
  id?: string;
  mode?: 'read' | 'readwrite';
}) => Promise<FileSystemDirectoryHandle>;
interface Permissioned {
  queryPermission(d: { mode: 'read' | 'readwrite' }): Promise<PermissionResult>;
  requestPermission(d: { mode: 'read' | 'readwrite' }): Promise<PermissionResult>;
}
interface HasEntries {
  entries(): AsyncIterable<[string, FileSystemHandle]>;
}
const asPermissioned = (h: FileSystemDirectoryHandle) => h as unknown as Permissioned;
const entriesOf = (d: FileSystemDirectoryHandle) => (d as unknown as HasEntries).entries();

/** True in browsers that can show a folder picker (Edge, Chrome). */
export function folderSavingSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker ===
      'function'
  );
}

const errName = (e: unknown) => (e && typeof e === 'object' && 'name' in e ? String(e.name) : '');
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ------------------------------------------------------------------ low-level file operations

export function projectFileText(project: Project): string {
  return JSON.stringify(toProjectFile(project), null, 2);
}

/** A name that is valid on Windows, macOS and Linux and not absurdly long. */
export function fileBase(name: string): string {
  return (
    safeFileName(name)
      .slice(0, 120)
      .replace(/[. ]+$/, '') || 'project'
  );
}

export interface FolderFileInfo {
  name: string;
  lastModified: number;
  size: number;
}

export async function fileInfo(
  dir: FileSystemDirectoryHandle,
  name: string,
): Promise<FolderFileInfo | null> {
  try {
    const f = await (await dir.getFileHandle(name)).getFile();
    return { name, lastModified: f.lastModified, size: f.size };
  } catch (e) {
    if (errName(e) === 'NotFoundError') return null;
    // A folder with this name: treat as "something is there" with no usable file.
    if (errName(e) === 'TypeMismatchError') return { name, lastModified: 0, size: 0 };
    throw e;
  }
}

/** Write a text file atomically. Resolves with the new `lastModified`. */
export async function writeTextFile(
  dir: FileSystemDirectoryHandle,
  name: string,
  text: string,
): Promise<number> {
  const fh = await dir.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  try {
    await w.write(text);
    await w.close();
  } catch (e) {
    try {
      await w.abort();
    } catch {
      /* already closed */
    }
    throw e;
  }
  return (await fh.getFile()).lastModified;
}

export async function readTextFile(
  dir: FileSystemDirectoryHandle,
  name: string,
): Promise<{ text: string; lastModified: number }> {
  const f = await (await dir.getFileHandle(name)).getFile();
  return { text: await f.text(), lastModified: f.lastModified };
}

export async function removeFile(dir: FileSystemDirectoryHandle, name: string): Promise<void> {
  try {
    await dir.removeEntry(name);
  } catch (e) {
    if (errName(e) !== 'NotFoundError') throw e;
  }
}

/** Free file name in `dir`: `base.ext`, then `base (2).ext`, `base (3).ext` … */
export async function freeFileName(
  dir: FileSystemDirectoryHandle,
  base: string,
  ext: string,
): Promise<string> {
  for (let n = 1; ; n++) {
    const name = `${base}${n === 1 ? '' : ` (${n})`}${ext}`;
    if (!(await fileInfo(dir, name))) return name;
  }
}

async function subDir(
  dir: FileSystemDirectoryHandle,
  path: string[],
  create: boolean,
): Promise<FileSystemDirectoryHandle | null> {
  let cur = dir;
  for (const part of path) {
    try {
      cur = await cur.getDirectoryHandle(part, { create });
    } catch (e) {
      if (!create && errName(e) === 'NotFoundError') return null;
      throw e;
    }
  }
  return cur;
}

/** Move a project file into `<dir>/Deleted/` so a rescan does not import it again. */
export async function moveToDeleted(
  dir: FileSystemDirectoryHandle,
  name: string,
): Promise<string | null> {
  if (!(await fileInfo(dir, name))) return null;
  const { text } = await readTextFile(dir, name);
  const target = (await subDir(dir, [DELETED_DIR], true))!;
  const base = name.slice(0, -FILE_EXT.length);
  const dest = await freeFileName(target, base, FILE_EXT);
  await writeTextFile(target, dest, text);
  await removeFile(dir, name);
  return dest;
}

/** Write a version snapshot to `<dir>/Versions/<project>/<fileName>`; returns the final name. */
export async function writeVersionFile(
  dir: FileSystemDirectoryHandle,
  projectName: string,
  fileName: string,
  text: string,
): Promise<{ dir: string; name: string }> {
  const folder = fileBase(projectName);
  const target = (await subDir(dir, [VERSIONS_DIR, folder], true))!;
  const base = fileName.endsWith(FILE_EXT) ? fileName.slice(0, -FILE_EXT.length) : fileName;
  const name = await freeFileName(target, base, FILE_EXT);
  await writeTextFile(target, name, text);
  return { dir: folder, name };
}

export async function removeVersionFile(
  dir: FileSystemDirectoryHandle,
  folder: string,
  name: string,
): Promise<void> {
  const target = await subDir(dir, [VERSIONS_DIR, folder], false);
  if (target) await removeFile(target, name);
}

// ------------------------------------------------------------------ file names per project

/** Project id → the file it is saved as in the connected folder. */
export type FileMap = Record<string, { name: string; modified?: number }>;

const isProjectFile = (name: string) => name.toLowerCase().endsWith(FILE_EXT);

/** Does `name` have the form `<base>.gantt.json` or `<base> (n).gantt.json`? */
export function matchesBase(name: string, base: string): boolean {
  const n = name.toLowerCase();
  const b = base.toLowerCase();
  if (n === `${b}${FILE_EXT}`) return true;
  return n.startsWith(`${b} (`) && /^ \(\d+\)\.gantt\.json$/.test(n.slice(b.length));
}

async function fileProjectId(dir: FileSystemDirectoryHandle, name: string): Promise<string | null> {
  try {
    const { text } = await readTextFile(dir, name);
    const id = (JSON.parse(text) as { project?: { id?: unknown } })?.project?.id;
    return typeof id === 'string' ? id : null;
  } catch {
    return null;
  }
}

/**
 * The file name a project should be saved under. Keeps its current name while it still matches
 * the project name; otherwise picks `<name>.gantt.json`, adding " (2)", " (3)" … when another
 * project (or an unknown file) already uses the name.
 */
export async function resolveFileName(
  dir: FileSystemDirectoryHandle,
  project: Pick<Project, 'id' | 'name'>,
  map: FileMap,
): Promise<string> {
  const base = fileBase(project.name);
  const current = map[project.id]?.name;
  if (current && matchesBase(current, base)) return current;
  const takenByOthers = new Set(
    Object.entries(map)
      .filter(([id]) => id !== project.id)
      .map(([, v]) => v.name.toLowerCase()),
  );
  for (let n = 1; ; n++) {
    const name = `${base}${n === 1 ? '' : ` (${n})`}${FILE_EXT}`;
    if (takenByOthers.has(name.toLowerCase())) continue;
    const info = await fileInfo(dir, name);
    if (!info) return name;
    if ((await fileProjectId(dir, name)) === project.id) return name;
  }
}

/** Write a project into the folder, renaming (new file, old one removed) when its name changed. */
export async function saveProjectFile(
  dir: FileSystemDirectoryHandle,
  project: Project,
  map: FileMap,
): Promise<{ name: string; modified: number }> {
  const name = await resolveFileName(dir, project, map);
  const modified = await writeTextFile(dir, name, projectFileText(project));
  const old = map[project.id]?.name;
  map[project.id] = { name, modified };
  if (old && old.toLowerCase() !== name.toLowerCase()) {
    await removeFile(dir, old).catch(() => undefined);
  }
  return { name, modified };
}

// ------------------------------------------------------------------ scanning

export interface FolderProject {
  fileName: string;
  lastModified: number;
  size: number;
  id: string;
  name: string;
  startDate: string;
  taskCount: number;
}

export interface FolderScan {
  projects: FolderProject[];
  /** Files that could not be read as projects. */
  unreadable: string[];
}

type ScanEntry = { lastModified: number; size: number; info: FolderProject | null };
const scanCache = new WeakMap<object, Map<string, ScanEntry>>();

/**
 * Read the `*.gantt.json` files at the top level of `dir`. When two files hold the same project
 * the one in `preferred(id)` wins, otherwise the newest.
 */
export async function scanFolder(
  dir: FileSystemDirectoryHandle,
  preferred: (id: string) => string | undefined = () => undefined,
): Promise<FolderScan> {
  let cache = scanCache.get(dir);
  if (!cache) scanCache.set(dir, (cache = new Map()));
  const found: FolderProject[] = [];
  const unreadable: string[] = [];
  const seen = new Set<string>();
  for await (const [name, h] of entriesOf(dir)) {
    if (h.kind !== 'file' || !isProjectFile(name)) continue;
    seen.add(name);
    const f = await (h as FileSystemFileHandle).getFile();
    let entry = cache.get(name);
    if (!entry || entry.lastModified !== f.lastModified || entry.size !== f.size) {
      let info: FolderProject | null;
      try {
        const p = readProjectFile(JSON.parse(await f.text()));
        info = {
          fileName: name,
          lastModified: f.lastModified,
          size: f.size,
          id: p.id,
          name: p.name,
          startDate: p.startDate,
          taskCount: p.tasks.length,
        };
      } catch {
        info = null;
      }
      entry = { lastModified: f.lastModified, size: f.size, info };
      cache.set(name, entry);
    }
    if (entry.info) found.push(entry.info);
    else unreadable.push(name);
  }
  for (const k of [...cache.keys()]) if (!seen.has(k)) cache.delete(k);

  const byId = new Map<string, FolderProject>();
  for (const fp of found) {
    const cur = byId.get(fp.id);
    if (!cur) byId.set(fp.id, fp);
    else {
      const want = preferred(fp.id)?.toLowerCase();
      if (want && cur.fileName.toLowerCase() === want) continue;
      if ((want && fp.fileName.toLowerCase() === want) || fp.lastModified > cur.lastModified) {
        byId.set(fp.id, fp);
      }
    }
  }
  return { projects: [...byId.values()], unreadable };
}

/** Read one project file from the folder. */
export async function readFolderProject(
  dir: FileSystemDirectoryHandle,
  name: string,
): Promise<{ project: Project; lastModified: number }> {
  const { text, lastModified } = await readTextFile(dir, name);
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`“${name}” is not valid JSON`);
  }
  return { project: readProjectFile(data), lastModified };
}

// ------------------------------------------------------------------ connected folder state

export type DiskPermission = 'granted' | 'prompt' | 'denied';

export interface DiskState {
  supported: boolean;
  /** Startup check finished. */
  ready: boolean;
  connected: boolean;
  folderName: string;
  permission: DiskPermission;
  /** Epoch ms of the last successful folder write in this session. */
  lastSavedAt: number | null;
  saving: boolean;
  error: string | null;
  /** Files in the folder that are not valid projects (from the last scan). */
  unreadable: string[];
}

export const useDisk = create<DiskState>(() => ({
  supported: folderSavingSupported(),
  ready: false,
  connected: false,
  folderName: '',
  permission: 'prompt',
  lastSavedAt: null,
  saving: false,
  error: null,
  unreadable: [],
}));

const patch = (p: Partial<DiskState>) => useDisk.setState(p);

let handle: FileSystemDirectoryHandle | null = null;
let fileMap: FileMap = {};
let hdb: UseStore | null = null;
const handleStore = () => (hdb ??= createStore('condo-gantt-fs', 'handles'));

/** The connected folder when it may be written to right now. */
export function activeFolder(): FileSystemDirectoryHandle | null {
  return handle && useDisk.getState().permission === 'granted' ? handle : null;
}

/** The connected folder, whether or not permission is currently granted. */
export function connectedFolder(): FileSystemDirectoryHandle | null {
  return handle;
}

export function folderFileMap(): FileMap {
  return fileMap;
}

export function persistFileMap(): void {
  void set('filemap', JSON.parse(JSON.stringify(fileMap)), handleStore()).catch(() => undefined);
}

async function queryPermission(h: FileSystemDirectoryHandle): Promise<DiskPermission> {
  try {
    return await asPermissioned(h).queryPermission({ mode: 'readwrite' });
  } catch {
    return 'prompt';
  }
}

let initPromise: Promise<void> | null = null;

/** Load the remembered folder and check its permission. Safe to call repeatedly. */
export function initDisk(): Promise<void> {
  return (initPromise ??= (async () => {
    if (!folderSavingSupported()) {
      patch({ ready: true });
      return;
    }
    try {
      const saved = await get<FileSystemDirectoryHandle>('handle', handleStore());
      if (saved) {
        handle = saved;
        fileMap = (await get<FileMap>('filemap', handleStore())) ?? {};
        patch({
          connected: true,
          folderName: saved.name,
          permission: await queryPermission(saved),
        });
      }
    } catch (e) {
      patch({ error: `Could not read the saved folder: ${errText(e)}` });
    }
    patch({ ready: true });
  })());
}

/** Resolves when the startup check has finished. */
export const diskReady = initDisk;

/** Let the user pick a folder. Resolves false if they cancel. */
export async function chooseFolder(): Promise<boolean> {
  const picker = (window as unknown as { showDirectoryPicker?: DirPicker }).showDirectoryPicker;
  if (!picker)
    throw new Error('This browser cannot save to a folder. Use Microsoft Edge or Chrome.');
  let picked: FileSystemDirectoryHandle;
  try {
    picked = await picker.call(window, { id: 'condo-gantt', mode: 'readwrite' });
  } catch (e) {
    if (errName(e) === 'AbortError') return false;
    throw e;
  }
  await flushFolderSaves();
  const same = handle ? await handle.isSameEntry(picked).catch(() => false) : false;
  handle = picked;
  if (!same) {
    fileMap = {};
    persistFileMap();
  }
  await set('handle', picked, handleStore());
  patch({
    connected: true,
    folderName: picked.name,
    permission: await queryPermission(picked),
    error: null,
    unreadable: [],
  });
  return true;
}

/** Ask for permission again (needs a click). Resolves true when granted. */
export async function reconnectFolder(): Promise<boolean> {
  if (!handle) return false;
  try {
    const result = await asPermissioned(handle).requestPermission({ mode: 'readwrite' });
    patch({
      permission: result,
      error: result === 'granted' ? null : 'Permission to use the folder was not given.',
    });
    return result === 'granted';
  } catch (e) {
    patch({ error: `Could not reconnect the folder: ${errText(e)}` });
    return false;
  }
}

/** Forget the folder. Files already written stay where they are. */
export async function disconnectFolder(): Promise<void> {
  await flushFolderSaves();
  handle = null;
  fileMap = {};
  queued.clear();
  await del('handle', handleStore()).catch(() => undefined);
  await del('filemap', handleStore()).catch(() => undefined);
  patch({
    connected: false,
    folderName: '',
    permission: 'prompt',
    saving: false,
    error: null,
    unreadable: [],
  });
}

export function setUnreadable(names: string[]) {
  patch({ unreadable: names });
}

// ------------------------------------------------------------------ debounced writer

const queued = new Map<string, Project>();
let timer: ReturnType<typeof setTimeout> | null = null;
let chain: Promise<void> = Promise.resolve();
let writing = 0;

const refreshSaving = () => patch({ saving: queued.size > 0 || writing > 0 });

/** Write the project to the folder about two seconds after the last call. */
export function scheduleFolderSave(project: Project): void {
  if (!activeFolder()) return;
  queued.set(project.id, project);
  refreshSaving();
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void flushFolderSaves(), FOLDER_SAVE_MS);
}

/** Forget a queued write (the project was deleted). */
export function cancelFolderSave(id: string): void {
  queued.delete(id);
  refreshSaving();
}

/** Write everything that is waiting. Resolves when the writes have finished. */
export function flushFolderSaves(): Promise<void> {
  if (timer) clearTimeout(timer);
  timer = null;
  const dir = activeFolder();
  const batch = [...queued.values()];
  if (!dir || !batch.length) {
    refreshSaving();
    return chain;
  }
  queued.clear();
  writing++;
  chain = chain.then(async () => {
    let done = 0;
    try {
      for (const p of batch) {
        await saveProjectFile(dir, p, fileMap);
        done++;
      }
      persistFileMap();
      patch({ lastSavedAt: Date.now(), error: null });
    } catch (e) {
      // Keep what was not written for a retry (reconnect, or leaving the project).
      for (const p of batch.slice(done)) if (!queued.has(p.id)) queued.set(p.id, p);
      persistFileMap();
      const permission = handle ? await queryPermission(handle) : 'prompt';
      patch({
        permission,
        error:
          permission === 'granted'
            ? `Could not save to the folder: ${errText(e)}`
            : 'Permission to use the folder was lost. Reconnect the folder to keep saving.',
      });
    } finally {
      writing--;
      refreshSaving();
    }
  });
  return chain;
}

// ------------------------------------------------------------------ versions in the folder

/** Write a version snapshot into the connected folder; null when no folder can be written. */
export async function writeVersionToFolder(
  projectName: string,
  fileName: string,
  text: string,
): Promise<{ dir: string; name: string } | null> {
  const dir = activeFolder();
  if (!dir) return null;
  return writeVersionFile(dir, projectName, fileName, text);
}

export async function removeVersionFromFolder(folder: string, name: string): Promise<void> {
  const dir = activeFolder();
  if (dir) await removeVersionFile(dir, folder, name);
}
