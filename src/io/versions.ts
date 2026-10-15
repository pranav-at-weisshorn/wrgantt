/**
 * Version history: named snapshots of a project, kept in IndexedDB (and, when a folder is
 * connected, as `.gantt.json` files under `<folder>/Versions/<project>/`).
 *
 * The pure helpers (`diffProjects`, `versionFileName`, `versionsToPrune`, `summarise`) have no
 * side effects and are unit-tested.
 */
import { createStore, del, delMany, get, set, type UseStore } from 'idb-keyval';
import { format } from 'date-fns';
import { dayToIso, displayFinishDay, newId, projectCalendarOf, type Project } from '../engine';
import { derive } from '../store/derive';
import { removeVersionFromFolder, writeVersionToFolder, FILE_EXT, fileBase } from './diskStore';
import { readProjectFile, toProjectFile, type ProjectFile } from './schema';

export type VersionKind = 'manual' | 'auto';

export interface VersionSummary {
  taskCount: number;
  /** Latest displayed finish (ISO date); null for a project without tasks. */
  finish: string | null;
  /** Duration-weighted % complete over all work tasks, 0–100. */
  percentComplete: number;
}

export interface VersionMeta {
  id: string;
  projectId: string;
  name: string;
  /** ISO timestamp. */
  createdAt: string;
  kind: VersionKind;
  reason?: string;
  summary: VersionSummary;
  /** Where the snapshot was also written in the connected folder (relative to `Versions/`). */
  file?: { dir: string; name: string };
}

// ------------------------------------------------------------------ pure helpers

export function summarise(project: Project): VersionSummary {
  const { schedule, outline } = derive(project);
  let finish: number | null = null;
  let weight = 0;
  let done = 0;
  let plain = 0;
  let count = 0;
  for (const id of outline.flat) {
    const c = schedule.calc.get(id);
    if (!c) continue;
    finish = Math.max(finish ?? -Infinity, displayFinishDay(c));
    if (outline.isSummary(id)) continue;
    weight += c.duration;
    done += c.duration * c.percentComplete;
    plain += c.percentComplete;
    count++;
  }
  const percent = weight > 0 ? done / weight : count > 0 ? plain / count : 0;
  return {
    taskCount: project.tasks.length,
    finish: finish === null ? null : dayToIso(finish),
    percentComplete: Math.round(percent),
  };
}

const p2 = (n: number) => String(n).padStart(2, '0');

/** `2026-10-15 1642 Name.gantt.json` (local time). */
export function versionFileName(createdAt: Date, name: string): string {
  const stamp = `${createdAt.getFullYear()}-${p2(createdAt.getMonth() + 1)}-${p2(createdAt.getDate())} ${p2(createdAt.getHours())}${p2(createdAt.getMinutes())}`;
  return `${stamp} ${fileBase(name).slice(0, 80).trim() || 'Version'}${FILE_EXT}`;
}

export function defaultVersionName(now: Date): string {
  return `Version ${format(now, 'd MMM yyyy')}`;
}

const DAY_MS = 86_400_000;
export const KEEP_AUTO_DAYS = 30;

/**
 * Which versions to delete. Every manual version is kept. Automatic versions are kept for 30
 * days; older ones are thinned to the newest one per calendar month (local time).
 */
export function versionsToPrune(
  versions: Pick<VersionMeta, 'id' | 'kind' | 'createdAt'>[],
  now: Date,
): string[] {
  const cutoff = now.getTime() - KEEP_AUTO_DAYS * DAY_MS;
  const newestPerMonth = new Map<string, { id: string; t: number }>();
  const old: { id: string; month: string }[] = [];
  for (const v of versions) {
    if (v.kind !== 'auto') continue;
    const t = Date.parse(v.createdAt);
    if (!Number.isFinite(t) || t >= cutoff) continue;
    const d = new Date(t);
    const month = `${d.getFullYear()}-${p2(d.getMonth() + 1)}`;
    old.push({ id: v.id, month });
    const best = newestPerMonth.get(month);
    if (!best || t > best.t) newestPerMonth.set(month, { id: v.id, t });
  }
  return old.filter((o) => newestPerMonth.get(o.month)?.id !== o.id).map((o) => o.id);
}

export interface TaskChange {
  id: string;
  name: string;
  startOld: string;
  startNew: string;
  finishOld: string;
  finishNew: string;
  durationOld: number;
  durationNew: number;
}

export interface LinkRef {
  id: string;
  predecessorId: string;
  successorId: string;
  predecessorName: string;
  successorName: string;
  type: string;
  lag: number;
  lagUnit: string;
}

export interface ProjectDiff {
  finishOld: string | null;
  finishNew: string | null;
  /**
   * Change of the project finish in working days of the newer project's calendar
   * (positive = later). Null when either project has no tasks.
   */
  finishChange: number | null;
  /** The same change in calendar days. */
  finishChangeCalendarDays: number | null;
  added: { id: string; name: string }[];
  removed: { id: string; name: string }[];
  renamed: { id: string; oldName: string; newName: string }[];
  /** Work tasks (not summaries) whose start, finish or duration differs. */
  changed: TaskChange[];
  linksAdded: LinkRef[];
  linksRemoved: LinkRef[];
}

const linkKey = (d: Project['dependencies'][number]) =>
  `${d.predecessorId}>${d.successorId}|${d.type}|${d.lag}|${d.lagUnit}`;

/** What changed between two states of a project. Dates come from the scheduling engine. */
export function diffProjects(older: Project, newer: Project): ProjectDiff {
  const a = derive(older);
  const b = derive(newer);
  const oldTasks = new Map(older.tasks.map((t) => [t.id, t]));
  const newTasks = new Map(newer.tasks.map((t) => [t.id, t]));

  const added = newer.tasks
    .filter((t) => !oldTasks.has(t.id))
    .map((t) => ({ id: t.id, name: t.name }));
  const removed = older.tasks
    .filter((t) => !newTasks.has(t.id))
    .map((t) => ({ id: t.id, name: t.name }));
  const renamed = newer.tasks
    .filter((t) => oldTasks.has(t.id) && oldTasks.get(t.id)!.name !== t.name)
    .map((t) => ({ id: t.id, oldName: oldTasks.get(t.id)!.name, newName: t.name }));

  const changed: TaskChange[] = [];
  for (const id of b.outline.flat) {
    const before = a.schedule.calc.get(id);
    const after = b.schedule.calc.get(id);
    if (!before || !after || b.outline.isSummary(id) || a.outline.isSummary(id)) continue;
    const startOld = dayToIso(before.es);
    const startNew = dayToIso(after.es);
    const finishOld = dayToIso(displayFinishDay(before));
    const finishNew = dayToIso(displayFinishDay(after));
    if (startOld !== startNew || finishOld !== finishNew || before.duration !== after.duration) {
      changed.push({
        id,
        name: newTasks.get(id)!.name,
        startOld,
        startNew,
        finishOld,
        finishNew,
        durationOld: before.duration,
        durationNew: after.duration,
      });
    }
  }

  const projectFinish = (d: ReturnType<typeof derive>) => {
    let f: number | null = null;
    for (const id of d.outline.flat) {
      const c = d.schedule.calc.get(id);
      if (c) f = Math.max(f ?? -Infinity, displayFinishDay(c));
    }
    return f;
  };
  const fOld = projectFinish(a);
  const fNew = projectFinish(b);
  let finishChange: number | null = null;
  let finishChangeCalendarDays: number | null = null;
  if (fOld !== null && fNew !== null) {
    const cal = projectCalendarOf(newer);
    finishChange = cal.cum(fNew + 1) - cal.cum(fOld + 1);
    finishChangeCalendarDays = fNew - fOld;
  }

  const ref = (d: Project['dependencies'][number], names: Map<string, { name: string }>) => ({
    id: d.id,
    predecessorId: d.predecessorId,
    successorId: d.successorId,
    predecessorName: names.get(d.predecessorId)?.name ?? '',
    successorName: names.get(d.successorId)?.name ?? '',
    type: d.type,
    lag: d.lag,
    lagUnit: d.lagUnit,
  });
  const oldKeys = new Set(older.dependencies.map(linkKey));
  const newKeys = new Set(newer.dependencies.map(linkKey));
  return {
    finishOld: fOld === null ? null : dayToIso(fOld),
    finishNew: fNew === null ? null : dayToIso(fNew),
    finishChange,
    finishChangeCalendarDays,
    added,
    removed,
    renamed,
    changed,
    linksAdded: newer.dependencies
      .filter((d) => !oldKeys.has(linkKey(d)))
      .map((d) => ref(d, newTasks)),
    linksRemoved: older.dependencies
      .filter((d) => !newKeys.has(linkKey(d)))
      .map((d) => ref(d, oldTasks)),
  };
}

// ------------------------------------------------------------------ storage

let db: UseStore | null = null;
const store = () => (db ??= createStore('condo-gantt-versions', 'versions'));
const indexKey = (projectId: string) => `index:${projectId}`;
const snapKey = (id: string) => `snap:${id}`;

let chain: Promise<unknown> = Promise.resolve();
function queue<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.catch(() => undefined);
  return next;
}

const byNewest = (a: VersionMeta, b: VersionMeta) => b.createdAt.localeCompare(a.createdAt);

async function readIndex(projectId: string): Promise<VersionMeta[]> {
  return (await get<VersionMeta[]>(indexKey(projectId), store())) ?? [];
}

/** All versions of a project, newest first. */
export async function listVersions(projectId: string): Promise<VersionMeta[]> {
  return (await readIndex(projectId)).sort(byNewest);
}

export interface NewVersion {
  name: string;
  kind: VersionKind;
  reason?: string;
  now?: Date;
}

/** Save a snapshot of `project`. Automatic versions also trigger pruning. */
export function createVersion(project: Project, opts: NewVersion): Promise<VersionMeta> {
  return queue(async () => {
    const now = opts.now ?? new Date();
    const file: ProjectFile = JSON.parse(JSON.stringify(toProjectFile(project)));
    file.exportedAt = now.toISOString();
    const meta: VersionMeta = {
      id: newId(),
      projectId: project.id,
      name: opts.name.trim() || defaultVersionName(now),
      createdAt: now.toISOString(),
      kind: opts.kind,
      summary: summarise(project),
    };
    if (opts.reason) meta.reason = opts.reason;
    try {
      const written = await writeVersionToFolder(
        project.name,
        versionFileName(now, meta.name),
        JSON.stringify(file, null, 2),
      );
      if (written) meta.file = written;
    } catch {
      /* the browser copy is what counts; the folder copy is a bonus */
    }
    await set(snapKey(meta.id), file, store());
    const list = await readIndex(project.id);
    list.push(meta);
    await set(indexKey(project.id), list, store());
    if (opts.kind === 'auto') await pruneInner(project.id, now);
    return meta;
  });
}

async function pruneInner(projectId: string, now: Date) {
  const list = await readIndex(projectId);
  const drop = new Set(versionsToPrune(list, now));
  if (!drop.size) return;
  for (const v of list) {
    if (drop.has(v.id) && v.file) {
      await removeVersionFromFolder(v.file.dir, v.file.name).catch(() => undefined);
    }
  }
  await delMany([...drop].map(snapKey), store());
  await set(
    indexKey(projectId),
    list.filter((v) => !drop.has(v.id)),
    store(),
  );
}

/** Raw snapshot (`.gantt.json` content) of a version. */
export async function loadVersionFile(id: string): Promise<ProjectFile | null> {
  return (await get<ProjectFile>(snapKey(id), store())) ?? null;
}

/** A version's project, validated and migrated like any imported file. */
export async function loadVersionProject(id: string): Promise<Project | null> {
  const file = await loadVersionFile(id);
  return file ? readProjectFile(file) : null;
}

export function renameVersion(projectId: string, id: string, name: string): Promise<void> {
  return queue(async () => {
    const list = await readIndex(projectId);
    const v = list.find((x) => x.id === id);
    const clean = name.trim();
    if (!v || !clean || clean === v.name) return;
    v.name = clean;
    // Keep the folder copy's name in step (best effort).
    if (v.file) {
      try {
        const file = await loadVersionFile(id);
        const written = file
          ? await writeVersionToFolder(
              v.file.dir,
              versionFileName(new Date(v.createdAt), clean),
              JSON.stringify(file, null, 2),
            )
          : null;
        if (written) {
          await removeVersionFromFolder(v.file.dir, v.file.name).catch(() => undefined);
          v.file = written;
        }
      } catch {
        /* keep the old file */
      }
    }
    await set(indexKey(projectId), list, store());
  });
}

export function deleteVersion(projectId: string, id: string): Promise<void> {
  return queue(async () => {
    const list = await readIndex(projectId);
    const v = list.find((x) => x.id === id);
    if (v?.file) await removeVersionFromFolder(v.file.dir, v.file.name).catch(() => undefined);
    await del(snapKey(id), store());
    await set(
      indexKey(projectId),
      list.filter((x) => x.id !== id),
      store(),
    );
  });
}

/** Remove every version of a project from the browser (folder copies are left alone). */
export function deleteProjectVersions(projectId: string): Promise<void> {
  return queue(async () => {
    const list = await readIndex(projectId);
    await delMany(
      list.map((v) => snapKey(v.id)),
      store(),
    );
    await del(indexKey(projectId), store());
  });
}

const sameLocalDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

/** Create the "Daily snapshot" unless an automatic version from today exists. */
export async function ensureDailySnapshot(
  project: Project,
  now = new Date(),
): Promise<VersionMeta | null> {
  const list = await listVersions(project.id);
  if (list.some((v) => v.kind === 'auto' && sameLocalDay(new Date(v.createdAt), now))) return null;
  return createVersion(project, {
    name: 'Daily snapshot',
    kind: 'auto',
    reason: 'Created automatically the first time the project was opened today',
    now,
  });
}
