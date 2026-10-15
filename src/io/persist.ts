import { createStore, del, get, set, type UseStore } from 'idb-keyval';
import type { Project } from '../engine';
import { deleteStoredHistory } from '../store/history';
import { flushHistorySave, useStore } from '../store/store';
import {
  activeFolder,
  cancelFolderSave,
  connectedFolder,
  diskReady,
  flushFolderSaves,
  folderFileMap,
  moveToDeleted,
  persistFileMap,
  readFolderProject,
  scanFolder,
  scheduleFolderSave,
  setUnreadable,
  useDisk,
  fileInfo,
  NEWER_MARGIN_MS,
} from './diskStore';
import { readProjectFile, toProjectFile } from './schema';
import { createVersion, deleteProjectVersions } from './versions';

export interface ProjectMeta {
  id: string;
  name: string;
  startDate: string;
  taskCount: number;
  updatedAt: string;
}

const INDEX_KEY = 'index';
let db: UseStore | null = null;
const store = () => (db ??= createStore('condo-gantt', 'projects'));

export async function listProjects(): Promise<ProjectMeta[]> {
  const list = (await get<ProjectMeta[]>(INDEX_KEY, store())) ?? [];
  return [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function loadProject(id: string): Promise<Project | null> {
  const data = await get(`project:${id}`, store());
  if (!data) return null;
  return readProjectFile(data);
}

// Writes are serialised so the index is never updated by two writers at once.
let chain: Promise<unknown> = Promise.resolve();
function queue<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.catch(() => undefined);
  return next;
}

// ------------------------------------------------------------------ cross-tab messages

const CHANNEL = 'condo-gantt';
let channel: BroadcastChannel | null = null;
const getChannel = () => {
  if (!channel && typeof BroadcastChannel !== 'undefined') channel = new BroadcastChannel(CHANNEL);
  return channel;
};

export interface SaveOptions {
  /** Stored as the project's "last saved" time (default: now). */
  updatedAt?: string;
  /** Do not write the folder copy (it came from the folder). */
  skipFolder?: boolean;
}

/** Save to IndexedDB now; the folder copy follows about two seconds later. */
export function saveProject(project: Project, opts: SaveOptions = {}): Promise<void> {
  return queue(async () => {
    // Plain JSON copy: drops Immer freezing and anything non-serialisable.
    const file = JSON.parse(JSON.stringify(toProjectFile(project)));
    await set(`project:${project.id}`, file, store());
    const list = (await get<ProjectMeta[]>(INDEX_KEY, store())) ?? [];
    const meta: ProjectMeta = {
      id: project.id,
      name: project.name,
      startDate: project.startDate,
      taskCount: project.tasks.length,
      updatedAt: opts.updatedAt ?? new Date().toISOString(),
    };
    await set(INDEX_KEY, [...list.filter((m) => m.id !== project.id), meta], store());
    try {
      getChannel()?.postMessage({ type: 'saved', projectId: project.id });
    } catch {
      /* channel closed */
    }
    if (!opts.skipFolder) scheduleFolderSave(project);
  });
}

/**
 * Delete a project from this browser. Its folder file is moved to `<folder>/Deleted/` first
 * (so a rescan does not bring it back), and its saved versions are removed from the browser.
 */
export async function deleteProject(id: string): Promise<void> {
  await diskReady();
  const dir = connectedFolder();
  if (dir) {
    if (!activeFolder()) {
      throw new Error('Reconnect the folder first, so the project’s file can be moved to Deleted.');
    }
    cancelFolderSave(id);
    await flushFolderSaves();
    const map = folderFileMap();
    let name: string | undefined = map[id]?.name;
    if (!name) {
      name = (await scanFolder(dir)).projects.find((p) => p.id === id)?.fileName;
    }
    if (name) await moveToDeleted(dir, name);
    delete map[id];
    persistFileMap();
  }
  await queue(async () => {
    await del(`project:${id}`, store());
    const list = (await get<ProjectMeta[]>(INDEX_KEY, store())) ?? [];
    await set(
      INDEX_KEY,
      list.filter((m) => m.id !== id),
      store(),
    );
  });
  await deleteProjectVersions(id).catch(() => undefined);
  await deleteStoredHistory(id).catch(() => undefined);
}

// ------------------------------------------------------------------ folder synchronisation

/**
 * Compare the connected folder with the browser's projects: projects found only in the folder
 * are imported, and projects the folder lacks are written to it. Files that exist in both are
 * left alone (opening the project decides which copy is newer).
 */
export async function syncFromFolder(): Promise<{ imported: string[] }> {
  await diskReady();
  const dir = activeFolder();
  if (!dir) return { imported: [] };
  const map = folderFileMap();
  const scan = await scanFolder(dir, (id) => map[id]?.name);
  setUnreadable(scan.unreadable);
  const known = new Map((await listProjects()).map((m) => [m.id, m]));
  const imported: string[] = [];
  const inFolder = new Set<string>();
  for (const fp of scan.projects) {
    inFolder.add(fp.id);
    if (known.has(fp.id)) {
      // Remember which file holds the project (kept if the mapped file still exists).
      const cur = map[fp.id];
      if (!cur || !(await fileInfo(dir, cur.name))) map[fp.id] = { name: fp.fileName };
      continue;
    }
    try {
      const { project, lastModified } = await readFolderProject(dir, fp.fileName);
      await saveProject(project, {
        updatedAt: new Date(lastModified).toISOString(),
        skipFolder: true,
      });
      map[project.id] = { name: fp.fileName, modified: lastModified };
      imported.push(project.name);
    } catch (e) {
      useStore
        .getState()
        .toast(
          `Could not import ${fp.fileName}: ${e instanceof Error ? e.message : String(e)}`,
          'error',
        );
    }
  }
  for (const m of known.values()) {
    if (inFolder.has(m.id)) continue;
    const p = await loadProject(m.id).catch(() => null);
    if (p) scheduleFolderSave(p);
  }
  persistFileMap();
  await flushFolderSaves();
  return { imported };
}

const sameProject = (a: Project, b: Project) => JSON.stringify(a) === JSON.stringify(b);

/**
 * When the project's file in the folder was changed outside the app (a newer copy), save the
 * browser copy as an automatic version and use the folder's copy instead.
 */
async function adoptNewerFolderFile(project: Project): Promise<Project> {
  await diskReady();
  const dir = activeFolder();
  if (!dir) return project;
  try {
    const map = folderFileMap();
    let name: string | undefined = map[project.id]?.name;
    if (!name || !(await fileInfo(dir, name))) {
      name = (await scanFolder(dir, () => undefined)).projects.find(
        (p) => p.id === project.id,
      )?.fileName;
    }
    if (!name) return project;
    const info = await fileInfo(dir, name);
    if (!info) return project;
    const meta = (await listProjects()).find((m) => m.id === project.id);
    const known = map[project.id]?.modified;
    const newer =
      (!meta || info.lastModified > Date.parse(meta.updatedAt) + NEWER_MARGIN_MS) &&
      (known === undefined || info.lastModified > known + 1000);
    if (!newer) return project;
    const { project: fromFolder, lastModified } = await readFolderProject(dir, name);
    if (fromFolder.id !== project.id || sameProject(fromFolder, project)) {
      map[project.id] = { name, modified: lastModified };
      persistFileMap();
      return project;
    }
    await createVersion(project, {
      name: 'Before loading a newer file from the folder',
      kind: 'auto',
      reason: `The file “${name}” in the folder was newer than the copy in this browser`,
    });
    await saveProject(fromFolder, { skipFolder: true });
    map[project.id] = { name, modified: lastModified };
    persistFileMap();
    useStore
      .getState()
      .toast(
        `Loaded a newer copy of “${fromFolder.name}” from the folder. The previous copy is in Versions.`,
      );
    return fromFolder;
  } catch (e) {
    useStore
      .getState()
      .toast(
        `Could not check the folder for a newer file: ${e instanceof Error ? e.message : String(e)}`,
        'error',
      );
    return project;
  }
}

// ------------------------------------------------------------------ one tab per project

const lockName = (id: string) => `condo-gantt:project:${id}`;

interface Held {
  id: string;
  result: Promise<boolean>;
  release: (() => void) | null;
  released: boolean;
}
let held: Held | null = null;

/**
 * Take the project's Web Lock and keep it until `releaseProjectLock()` (or the page closes).
 * Resolves false when another tab already holds it. Calling again for the same project reuses
 * the lock this tab holds.
 */
export function acquireProjectLock(id: string): Promise<boolean> {
  if (held && held.id === id) {
    const cur = held;
    return cur.result.then((ok) => {
      if (ok) return true;
      if (held === cur) held = null;
      return acquireProjectLock(id);
    });
  }
  releaseProjectLock();
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  const entry: Held = { id, result: Promise.resolve(true), release: null, released: false };
  if (locks) {
    entry.result = new Promise<boolean>((resolve) => {
      locks
        .request(lockName(id), { ifAvailable: true }, (lock) => {
          if (!lock) {
            resolve(false);
            return undefined;
          }
          if (entry.released) {
            resolve(true);
            return undefined;
          }
          return new Promise<void>((release) => {
            entry.release = release;
            resolve(true);
          });
        })
        .catch(() => resolve(true));
    });
  }
  held = entry;
  return entry.result;
}

/** Let go of the lock (only if it is for `id`, when given). */
export function releaseProjectLock(id?: string): void {
  if (!held || (id !== undefined && held.id !== id)) return;
  held.released = true;
  held.release?.();
  held = null;
}

/**
 * Open a project for use: takes its lock, loads it from the browser and adopts a newer folder
 * file if there is one. `locked` is false when another tab has the project open.
 */
export async function openProjectById(
  id: string,
): Promise<{ project: Project; locked: boolean } | null> {
  const locked = await acquireProjectLock(id);
  let project: Project | null;
  try {
    project = await loadProject(id);
  } catch (e) {
    releaseProjectLock();
    throw e;
  }
  if (!project) {
    releaseProjectLock();
    return null;
  }
  if (locked) project = await adoptNewerFolderFile(project);
  return { project, locked };
}

// ------------------------------------------------------------------ autosave

export const AUTOSAVE_MS = 500;
let timer: ReturnType<typeof setTimeout> | null = null;
let pending: Project | null = null;
let saving = Promise.resolve();

function flushBrowserSave(): Promise<void> {
  if (timer) clearTimeout(timer);
  timer = null;
  const p = pending;
  pending = null;
  // A project that is open in another tab is read-only here: never write it.
  if (p && !useStore.getState().readOnly) {
    saving = saveProject(p).catch((e) => {
      useStore.getState().toast(`Could not save: ${e instanceof Error ? e.message : e}`, 'error');
    });
  }
  return saving;
}

/** Save the pending change to IndexedDB and the folder right now. */
export async function flushAutosave(): Promise<void> {
  await flushBrowserSave();
  await flushFolderSaves();
  await flushHistorySave().catch(() => undefined);
}

/** Reload the open, read-only project after the tab that owns it saved a change. */
async function reloadReadOnly(projectId: string) {
  const s = useStore.getState();
  if (!s.readOnly || s.project?.id !== projectId) return;
  try {
    const p = await loadProject(projectId);
    const now = useStore.getState();
    if (!p || !now.readOnly || now.project?.id !== projectId) return;
    const { collapsed, filters, selectedId } = now;
    now.openProject(p);
    const next = useStore.getState();
    next.setReadOnly(true);
    for (const id of Object.keys(collapsed)) next.toggleCollapsed(id);
    next.setFilters(filters);
    if (selectedId) next.select(selectedId);
  } catch {
    /* keep showing what we have */
  }
}

/**
 * Save the open project to IndexedDB 500 ms after the last change (and to the connected folder
 * about 2 s after). Also listens for saves made by other tabs.
 */
export function startAutosave() {
  const unsub = useStore.subscribe((s, prev) => {
    if (!s.project || s.project === prev.project) return;
    // Opening a project is not a change; a read-only tab never saves.
    if (prev.project?.id !== s.project.id || s.readOnly) return;
    pending = s.project;
    if (timer) clearTimeout(timer);
    timer = setTimeout(flushBrowserSave, AUTOSAVE_MS);
  });
  const onHide = () => void flushAutosave();
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') onHide();
  };
  window.addEventListener('pagehide', onHide);
  document.addEventListener('visibilitychange', onVisibility);
  const ch = getChannel();
  const onMessage = (e: MessageEvent) => {
    const d = e.data as { type?: string; projectId?: string } | null;
    if (d?.type === 'saved' && d.projectId) void reloadReadOnly(d.projectId);
  };
  ch?.addEventListener('message', onMessage);
  // A folder that was reconnected may have writes waiting.
  const unsubDisk = useDisk.subscribe((s, prev) => {
    if (s.permission === 'granted' && prev.permission !== 'granted') void flushFolderSaves();
  });
  return () => {
    unsub();
    unsubDisk();
    window.removeEventListener('pagehide', onHide);
    document.removeEventListener('visibilitychange', onVisibility);
    ch?.removeEventListener('message', onMessage);
  };
}
