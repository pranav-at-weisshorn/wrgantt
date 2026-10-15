/**
 * Undo history as Immer patches. Pure functions over `{ past, future }` plus the (optional)
 * IndexedDB storage of a project's history.
 *
 * `past` holds the applied entries, oldest first. `future` holds the undone entries with the
 * next one to redo LAST (so undo/redo are a push/pop pair). Entries carry patches, not
 * snapshots, so thousands of steps stay small.
 */
import { applyPatches, enablePatches, type Patch } from 'immer';
import { createStore, del, get, set, type UseStore } from 'idb-keyval';
import type { Project } from '../engine';

enablePatches();

/** Effectively unlimited; the oldest entries are dropped beyond this. */
export const HISTORY_LIMIT = 5000;

export interface HistoryEntry {
  label: string;
  /** ISO time the change was made. */
  at: string;
  patches: Patch[];
  inversePatches: Patch[];
}

export interface HistoryState {
  past: HistoryEntry[];
  future: HistoryEntry[];
}

export const EMPTY_HISTORY: HistoryState = { past: [], future: [] };

export interface HistoryMove {
  history: HistoryState;
  project: Project;
}

/** Record a new change; clears redo and drops the oldest entries beyond the limit. */
export function pushEntry(
  h: HistoryState,
  entry: HistoryEntry,
  limit: number = HISTORY_LIMIT,
): HistoryState {
  let past = [...h.past, entry];
  if (past.length > limit) past = past.slice(past.length - limit);
  return { past, future: [] };
}

/** All entries in time order, oldest first (applied entries, then the redo entries). */
export function timeline(h: HistoryState): HistoryEntry[] {
  return [...h.past, ...[...h.future].reverse()];
}

/** Index in `timeline` of the last applied entry (-1 = nothing applied). */
export function cursorOf(h: HistoryState): number {
  return h.past.length - 1;
}

/**
 * Move the project to the state right after timeline entry `index` (-1 = before the first
 * entry). Returns null when nothing changes or the index is out of range.
 */
export function jumpTo(h: HistoryState, project: Project, index: number): HistoryMove | null {
  const all = timeline(h);
  const cursor = cursorOf(h);
  if (!Number.isInteger(index) || index < -1 || index >= all.length || index === cursor) {
    return null;
  }
  if (index < cursor) {
    // Undo: newest applied entry first.
    const undone = h.past.slice(index + 1).reverse();
    const patches = undone.flatMap((e) => e.inversePatches);
    return {
      project: applyPatches(project, patches),
      // The oldest undone entry ends up last: it is the next to redo.
      history: { past: h.past.slice(0, index + 1), future: [...h.future, ...undone] },
    };
  }
  // Redo: oldest undone entry first (the last element of `future`).
  const redone = [...h.future].reverse().slice(0, index - cursor);
  const patches = redone.flatMap((e) => e.patches);
  return {
    project: applyPatches(project, patches),
    history: {
      past: [...h.past, ...redone],
      future: h.future.slice(0, h.future.length - redone.length),
    },
  };
}

export function undoStep(h: HistoryState, project: Project): HistoryMove | null {
  return h.past.length ? jumpTo(h, project, h.past.length - 2) : null;
}

export function redoStep(h: HistoryState, project: Project): HistoryMove | null {
  return h.future.length ? jumpTo(h, project, h.past.length) : null;
}

// ------------------------------------------------------------------ fingerprint

/** JSON with object keys sorted and derived / undefined fields dropped, so it is stable. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (key, v: unknown) => {
    if (key === 'calc') return undefined;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const src = v as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(src).sort()) out[k] = src[k];
      return out;
    }
    return v;
  });
}

/** 53-bit string hash (cyrb53). Not cryptographic: it only detects "the file changed". */
function hash53(str: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** A fast hash of the project's content (key order and derived data do not matter). */
export function fingerprint(project: Project): string {
  const text = canonical(project);
  return `${hash53(text).toString(36)}-${text.length.toString(36)}`;
}

// ------------------------------------------------------------------ serialise

export interface StoredHistory {
  version: 1;
  projectId: string;
  /** Fingerprint of the project at the current position (after the last applied entry). */
  fingerprint: string;
  savedAt: string;
  past: HistoryEntry[];
  future: HistoryEntry[];
}

export function serialise(
  h: HistoryState,
  project: Project,
  savedAt: string = new Date().toISOString(),
): StoredHistory {
  return {
    version: 1,
    projectId: project.id,
    fingerprint: fingerprint(project),
    savedAt,
    past: h.past,
    future: h.future,
  };
}

function isPatch(p: unknown): p is Patch {
  if (!p || typeof p !== 'object') return false;
  const r = p as Record<string, unknown>;
  return (
    (r.op === 'add' || r.op === 'remove' || r.op === 'replace') &&
    Array.isArray(r.path) &&
    r.path.every((s) => typeof s === 'string' || typeof s === 'number')
  );
}

function isEntry(e: unknown): e is HistoryEntry {
  if (!e || typeof e !== 'object') return false;
  const r = e as Record<string, unknown>;
  return (
    typeof r.label === 'string' &&
    typeof r.at === 'string' &&
    Array.isArray(r.patches) &&
    r.patches.every(isPatch) &&
    Array.isArray(r.inversePatches) &&
    r.inversePatches.every(isPatch)
  );
}

/** Validate stored data; null if it is not a usable history. Applies the entry cap. */
export function deserialise(raw: unknown, limit: number = HISTORY_LIMIT): StoredHistory | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (
    r.version !== 1 ||
    typeof r.projectId !== 'string' ||
    typeof r.fingerprint !== 'string' ||
    !Array.isArray(r.past) ||
    !Array.isArray(r.future) ||
    !r.past.every(isEntry) ||
    !r.future.every(isEntry)
  ) {
    return null;
  }
  const past = (r.past as HistoryEntry[]).slice(-limit);
  const future = (r.future as HistoryEntry[]).slice(-Math.max(0, limit - past.length));
  return {
    version: 1,
    projectId: r.projectId,
    fingerprint: r.fingerprint,
    savedAt: typeof r.savedAt === 'string' ? r.savedAt : '',
    past,
    future,
  };
}

/** Stored history is only valid for the exact project content it was saved against. */
export function matchesProject(stored: StoredHistory, project: Project): boolean {
  return stored.projectId === project.id && stored.fingerprint === fingerprint(project);
}

/**
 * Combine stored history with entries made while it was loading. `stored` must match the
 * project as it was opened, so the newer entries simply continue it (and its redo is dropped).
 */
export function adoptStored(
  stored: Pick<StoredHistory, 'past' | 'future'>,
  current: HistoryState,
  limit: number = HISTORY_LIMIT,
): HistoryState {
  if (!current.past.length && !current.future.length) {
    return { past: stored.past.slice(-limit), future: stored.future };
  }
  return {
    past: [...stored.past, ...current.past].slice(-limit),
    future: current.future,
  };
}

// ------------------------------------------------------------------ IndexedDB

let db: UseStore | null = null;
/** idb-keyval stores cannot share a database, so history has its own. */
const store = () => (db ??= createStore('condo-gantt-history', 'history'));
const key = (projectId: string) => projectId;

/** False where there is no IndexedDB (unit tests, private modes that disable it). */
export const storageAvailable = () => typeof indexedDB !== 'undefined';

export async function loadStoredHistory(projectId: string): Promise<StoredHistory | null> {
  if (!storageAvailable()) return null;
  try {
    const stored = deserialise(await get(key(projectId), store()));
    return stored && stored.projectId === projectId ? stored : null;
  } catch {
    return null;
  }
}

export async function saveStoredHistory(stored: StoredHistory): Promise<void> {
  if (!storageAvailable()) return;
  // Nothing to keep: do not leave an empty record behind.
  if (!stored.past.length && !stored.future.length) return deleteStoredHistory(stored.projectId);
  await set(key(stored.projectId), stored, store());
}

/** Also call this when a project is deleted. */
export async function deleteStoredHistory(projectId: string): Promise<void> {
  if (!storageAvailable()) return;
  try {
    await del(key(projectId), store());
  } catch {
    /* storage unavailable */
  }
}
