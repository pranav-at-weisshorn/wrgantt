import { createStore, del, get, set, type UseStore } from 'idb-keyval';
import type { Project } from '../engine';
import { useStore } from '../store/store';
import { readProjectFile, toProjectFile } from './schema';

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

export function saveProject(project: Project): Promise<void> {
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
      updatedAt: new Date().toISOString(),
    };
    await set(INDEX_KEY, [...list.filter((m) => m.id !== project.id), meta], store());
  });
}

export function deleteProject(id: string): Promise<void> {
  return queue(async () => {
    await del(`project:${id}`, store());
    const list = (await get<ProjectMeta[]>(INDEX_KEY, store())) ?? [];
    await set(
      INDEX_KEY,
      list.filter((m) => m.id !== id),
      store(),
    );
  });
}

// ------------------------------------------------------------------ autosave

export const AUTOSAVE_MS = 500;
let timer: ReturnType<typeof setTimeout> | null = null;
let pending: Project | null = null;
let saving = Promise.resolve();

export function flushAutosave(): Promise<void> {
  if (timer) clearTimeout(timer);
  timer = null;
  const p = pending;
  pending = null;
  if (p) {
    saving = saveProject(p).catch((e) => {
      useStore.getState().toast(`Could not save: ${e instanceof Error ? e.message : e}`, 'error');
    });
  }
  return saving;
}

/** Save the open project to IndexedDB 500 ms after the last change. */
export function startAutosave() {
  const unsub = useStore.subscribe((s, prev) => {
    if (!s.project || s.project === prev.project) return;
    // Opening a project is not a change.
    if (prev.project?.id !== s.project.id) return;
    pending = s.project;
    if (timer) clearTimeout(timer);
    timer = setTimeout(flushAutosave, AUTOSAVE_MS);
  });
  const onHide = () => void flushAutosave();
  window.addEventListener('pagehide', onHide);
  return () => {
    unsub();
    window.removeEventListener('pagehide', onHide);
  };
}
