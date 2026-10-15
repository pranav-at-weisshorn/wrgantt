/**
 * Project edit operations. Every operation goes through `commit`, which validates (cycles),
 * recalculates and records an undo step.
 */
import type { Draft } from 'immer';
import {
  dayToIso,
  getWorkCalendar,
  displayFinishDay,
  isoToDay,
  makeBaseline,
  newId,
  resolvePredecessorText,
  type Calendar,
  type Constraint,
  type Dependency,
  type Project,
  type Task,
} from '../engine';
import { blankTask } from '../template/load';
import { derive } from './derive';
import { useStore, type CommitResult } from './store';

const st = () => useStore.getState();

function findTask(d: Draft<Project>, id: string): Draft<Task> {
  const t = d.tasks.find((x) => x.id === id);
  if (!t) throw new Error('Task not found');
  return t;
}

function siblingsOf(d: Draft<Project>, parentId: string | null) {
  return d.tasks.filter((t) => (t.parentId ?? null) === parentId).sort((a, b) => a.order - b.order);
}

function descendantIds(d: Draft<Project> | Project, id: string): Set<string> {
  const out = new Set<string>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const t of d.tasks) {
      if (t.parentId && out.has(t.parentId) && !out.has(t.id)) {
        out.add(t.id);
        grew = true;
      }
    }
  }
  return out;
}

// ------------------------------------------------------------------ task fields

export function updateTask(id: string, patch: Partial<Task>, label = 'Edit task'): CommitResult {
  return st().commit(label, (d) => {
    Object.assign(findTask(d, id), patch);
  });
}

export function renameTask(id: string, name: string) {
  return updateTask(id, { name: name.trim() || 'Untitled' }, 'Rename task');
}

export function setDuration(id: string, duration: number) {
  return updateTask(id, { duration: Math.max(0, Math.round(duration)) }, 'Change duration');
}

/** Typing a start date sets a Start No Earlier Than constraint (as MS Project does). */
export function setStartDate(id: string, iso: string) {
  return updateTask(id, { constraint: { type: 'SNET', date: iso } }, 'Set start date');
}

/** Typing a finish date sets a Finish No Earlier Than constraint. */
export function setFinishDate(id: string, iso: string) {
  return updateTask(id, { constraint: { type: 'FNET', date: iso } }, 'Set finish date');
}

export function setConstraint(id: string, constraint: Constraint) {
  return updateTask(id, { constraint }, 'Set constraint');
}

/**
 * Set % complete. Actual dates are filled from the current schedule (clamped to the status
 * date) the way MS Project does when progress is entered.
 */
export function setPercentComplete(id: string, pct: number) {
  const p = st().project;
  if (!p) return { ok: false };
  const { schedule } = derive(p);
  const c = schedule.calc.get(id);
  const value = Math.max(0, Math.min(100, Math.round(pct)));
  return st().commit('Update progress', (d) => {
    const t = findTask(d, id);
    t.percentComplete = value;
    if (value === 0) {
      delete t.actualStart;
      delete t.actualFinish;
      return;
    }
    if (!t.actualStart && c) t.actualStart = dayToIso(c.es);
    if (value === 100) {
      if (!t.actualFinish && c) t.actualFinish = dayToIso(displayFinishDay(c));
    } else delete t.actualFinish;
  });
}

export function setPredecessorsText(id: string, text: string): CommitResult {
  const p = st().project;
  if (!p) return { ok: false };
  const r = resolvePredecessorText(p, id, text, newId);
  if (!r.ok) return { ok: false, error: r.error };
  return st().commit(
    'Edit predecessors',
    (d) => {
      d.dependencies = r.dependencies as Draft<Dependency>[];
    },
    { quiet: true },
  );
}

// ------------------------------------------------------------------ structure

/** Insert a new task above `beforeId` (same level), or at the end. Returns the new id. */
export function insertTask(beforeId: string | null, init: Partial<Task> = {}): string | null {
  const p = st().project;
  if (!p) return null;
  const task = blankTask({ calendarId: p.projectCalendarId, ...init });
  const r = st().commit(
    'Insert task',
    (d) => {
      if (beforeId) {
        const ref = findTask(d, beforeId);
        task.parentId = ref.parentId;
        task.order = ref.order - 0.5; // renumber() normalises the sibling order
      } else {
        const top = siblingsOf(d, null);
        task.order = top.length ? top[top.length - 1].order + 1 : 0;
      }
      d.tasks.push(task as Draft<Task>);
    },
    { structural: true },
  );
  return r.ok ? task.id : null;
}

export function deleteTasks(ids: string[]) {
  return st().commit(
    ids.length > 1 ? 'Delete tasks' : 'Delete task',
    (d) => {
      const doomed = new Set<string>();
      for (const id of ids) for (const x of descendantIds(d, id)) doomed.add(x);
      d.tasks = d.tasks.filter((t) => !doomed.has(t.id));
      d.dependencies = d.dependencies.filter(
        (x) => !doomed.has(x.predecessorId) && !doomed.has(x.successorId),
      );
      for (const b of d.baselines) for (const id of doomed) delete b.tasks[id];
    },
    { structural: true },
  );
}

/** Make the task a child of its previous sibling. */
export function indentTask(id: string) {
  return st().commit(
    'Indent',
    (d) => {
      const t = findTask(d, id);
      const sibs = siblingsOf(d, t.parentId);
      const i = sibs.findIndex((s) => s.id === id);
      if (i <= 0) return;
      const newParent = sibs[i - 1];
      const kids = siblingsOf(d, newParent.id);
      t.parentId = newParent.id;
      t.order = kids.length ? kids[kids.length - 1].order + 1 : 0;
      // A task that becomes a summary keeps its links but no longer has its own constraint.
      newParent.constraint = { type: 'ASAP' };
    },
    { structural: true },
  );
}

/** Move the task up one level, keeping its place in the outline (later siblings become its children). */
export function outdentTask(id: string) {
  return st().commit(
    'Outdent',
    (d) => {
      const t = findTask(d, id);
      if (!t.parentId) return;
      const parent = findTask(d, t.parentId);
      const sibs = siblingsOf(d, t.parentId);
      const i = sibs.findIndex((s) => s.id === id);
      const later = sibs.slice(i + 1);
      const ownKids = siblingsOf(d, t.id);
      let o = ownKids.length ? ownKids[ownKids.length - 1].order + 1 : 0;
      for (const s of later) {
        s.parentId = t.id;
        s.order = o++;
      }
      if (later.length) t.constraint = { type: 'ASAP' };
      t.parentId = parent.parentId;
      t.order = parent.order + 0.5;
    },
    { structural: true },
  );
}

/** Drag-and-drop move: place `id` before/after `targetId`, or inside it as the last child. */
export function moveTask(id: string, targetId: string, position: 'before' | 'after' | 'inside') {
  if (id === targetId) return { ok: true };
  const p = st().project;
  if (!p) return { ok: false };
  if (descendantIds(p, id).has(targetId)) {
    st().toast('A task cannot be moved into itself', 'error');
    return { ok: false };
  }
  return st().commit(
    'Move task',
    (d) => {
      const t = findTask(d, id);
      const target = findTask(d, targetId);
      if (position === 'inside') {
        const kids = siblingsOf(d, target.id);
        t.parentId = target.id;
        t.order = kids.length ? kids[kids.length - 1].order + 1 : 0;
        target.constraint = { type: 'ASAP' };
      } else {
        t.parentId = target.parentId;
        t.order = target.order + (position === 'before' ? -0.5 : 0.5);
      }
    },
    { structural: true },
  );
}

// ------------------------------------------------------------------ links

export function addLink(
  predecessorId: string,
  successorId: string,
  type: Dependency['type'] = 'FS',
  lag = 0,
  lagUnit: Dependency['lagUnit'] = 'wd',
) {
  const p = st().project;
  if (!p) return { ok: false };
  if (predecessorId === successorId) return { ok: false, error: 'A task cannot depend on itself' };
  if (
    p.dependencies.some((x) => x.predecessorId === predecessorId && x.successorId === successorId)
  ) {
    st().toast('These tasks are already linked', 'info');
    return { ok: false };
  }
  return st().commit('Add link', (d) => {
    d.dependencies.push({ id: newId(), predecessorId, successorId, type, lag, lagUnit });
  });
}

export function updateLink(depId: string, patch: Partial<Dependency>) {
  return st().commit('Edit link', (d) => {
    const dep = d.dependencies.find((x) => x.id === depId);
    if (dep) Object.assign(dep, patch);
  });
}

export function deleteLink(depId: string) {
  return st().commit('Delete link', (d) => {
    d.dependencies = d.dependencies.filter((x) => x.id !== depId);
  });
}

/** Replace all links of a task in one undoable step (task dialog). */
export function replaceTaskLinks(taskId: string, links: Dependency[]) {
  return st().commit('Edit links', (d) => {
    d.dependencies = [
      ...d.dependencies.filter((x) => x.predecessorId !== taskId && x.successorId !== taskId),
      ...(links as Draft<Dependency>[]),
    ];
  });
}

// ------------------------------------------------------------------ project-level

export function updateProject(
  patch: Partial<
    Pick<
      Project,
      'name' | 'startDate' | 'statusDate' | 'projectCalendarId' | 'criticalFloatThreshold'
    >
  >,
  label = 'Project settings',
) {
  return st().commit(label, (d) => {
    Object.assign(d, patch);
  });
}

export function setCalendars(calendars: Calendar[]) {
  return st().commit('Edit calendars', (d) => {
    d.calendars = calendars as Draft<Calendar>[];
    const ids = new Set(calendars.map((c) => c.id));
    if (!ids.has(d.projectCalendarId)) d.projectCalendarId = calendars[0].id;
    for (const t of d.tasks) if (!ids.has(t.calendarId)) t.calendarId = d.projectCalendarId;
  });
}

export function setStatusDate(iso: string) {
  return updateProject({ statusDate: iso }, 'Set status date');
}

export function saveBaseline(name: string) {
  const p = st().project;
  if (!p) return { ok: false };
  const { schedule } = derive(p);
  const bl = makeBaseline(p, schedule, newId(), name, new Date().toISOString());
  return st().commit('Save baseline', (d) => {
    d.baselines.push(bl as Draft<typeof bl>);
    d.activeBaselineId = bl.id;
  });
}

export function setActiveBaseline(id: string | undefined) {
  return st().commit('Set active baseline', (d) => {
    d.activeBaselineId = id;
  });
}

export function renameBaseline(id: string, name: string) {
  return st().commit('Rename baseline', (d) => {
    const b = d.baselines.find((x) => x.id === id);
    if (b) b.name = name;
  });
}

export function deleteBaseline(id: string) {
  return st().commit('Delete baseline', (d) => {
    d.baselines = d.baselines.filter((b) => b.id !== id);
    if (d.activeBaselineId === id) d.activeBaselineId = d.baselines[0]?.id;
  });
}

/** Progress entries for the update-progress dialog, applied as one undo step. */
export interface ProgressEntry {
  id: string;
  percentComplete: number;
  actualStart?: string;
  actualFinish?: string;
}

export function applyProgress(entries: ProgressEntry[]) {
  return st().commit('Update progress', (d) => {
    for (const e of entries) {
      const t = d.tasks.find((x) => x.id === e.id);
      if (!t) continue;
      t.percentComplete = e.percentComplete;
      if (e.actualStart) t.actualStart = e.actualStart;
      else delete t.actualStart;
      if (e.actualFinish) t.actualFinish = e.actualFinish;
      else delete t.actualFinish;
    }
  });
}

/**
 * "On schedule" progress for a task as of the status date: the share of its working days
 * scheduled before the status date.
 */
export function onSchedulePercent(project: Project, id: string): ProgressEntry | null {
  const { schedule } = derive(project);
  const c = schedule.calc.get(id);
  if (!c) return null;
  const status = isoToDay(project.statusDate);
  if (c.es >= status) return { id, percentComplete: 0 };
  if (c.ef <= status) {
    return {
      id,
      percentComplete: 100,
      actualStart: dayToIso(c.es),
      actualFinish: dayToIso(displayFinishDay(c)),
    };
  }
  const t = project.tasks.find((x) => x.id === id)!;
  const calDef = project.calendars.find((x) => x.id === t.calendarId) ?? project.calendars[0];
  const cal = getWorkCalendar(calDef);
  const total = Math.max(1, c.duration);
  const done = Math.max(1, Math.min(total - 1, cal.between(c.es, status)));
  return { id, percentComplete: Math.round((done / total) * 100), actualStart: dayToIso(c.es) };
}
