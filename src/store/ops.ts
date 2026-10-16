/**
 * Project edit operations. Every operation goes through `commit`, which validates (cycles),
 * recalculates and records an undo step.
 */
import { produce, type Draft } from 'immer';
import {
  CONSTRAINT_LABEL,
  dayToIso,
  days,
  getWorkCalendar,
  displayFinishDay,
  isoToDay,
  makeBaseline,
  newId,
  renumber,
  resolvePredecessorText,
  STATUS_LABEL,
  type Calendar,
  type Constraint,
  type Dependency,
  type Project,
  type Task,
  type TaskCalc,
  type TaskStatus,
} from '../engine';
import { blankTask } from '../template/load';
import { calFor } from '../ui/cal';
import { fmtIso } from '../ui/format';
import { derive } from './derive';
import { useStore, type CommitResult } from './store';

const st = () => useStore.getState();

// ------------------------------------------------------------------ labels

/** A task name in curly quotes, shortened if long, for history labels. */
export function quoted(name: string): string {
  const n = name.length > 40 ? `${name.slice(0, 39)}…` : name;
  return `“${n}”`;
}

/** Quoted name of a task in the open project. */
function nameOf(id: string): string {
  return quoted(st().project?.tasks.find((t) => t.id === id)?.name ?? 'task');
}

function rowIdOf(id: string): string {
  return String(st().project?.tasks.find((t) => t.id === id)?.rowId ?? '?');
}

function linkText(depId: string): string | null {
  const dep = st().project?.dependencies.find((d) => d.id === depId);
  return dep ? `Link from ${rowIdOf(dep.predecessorId)} to ${rowIdOf(dep.successorId)}` : null;
}

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
  const next = name.trim() || 'Untitled';
  return updateTask(id, { name: next }, `Renamed ${nameOf(id)} to ${quoted(next)}`);
}

export function setDuration(id: string, duration: number) {
  const value = Math.max(0, Math.round(duration));
  return updateTask(
    id,
    { duration: value },
    `Duration of ${nameOf(id)}: ${value === 0 ? 'milestone' : days(value)}`,
  );
}

/** Typing a start date sets a Start No Earlier Than constraint (as MS Project does). */
export function setStartDate(id: string, iso: string) {
  return updateTask(
    id,
    { constraint: { type: 'SNET', date: iso } },
    `Start of ${nameOf(id)}: ${fmtIso(iso)}`,
  );
}

/** Typing a finish date sets a Finish No Earlier Than constraint. */
export function setFinishDate(id: string, iso: string) {
  return updateTask(
    id,
    { constraint: { type: 'FNET', date: iso } },
    `Finish of ${nameOf(id)}: ${fmtIso(iso)}`,
  );
}

export function setConstraint(id: string, constraint: Constraint) {
  return updateTask(
    id,
    { constraint },
    `Constraint of ${nameOf(id)}: ${CONSTRAINT_LABEL[constraint.type]}`,
  );
}

/** Drop a stored status that progress has made meaningless (complete, or back to 0 %). */
export function normaliseStatus(t: Draft<Task>) {
  if (t.percentComplete >= 100 || t.actualFinish) delete t.status;
  else if (t.status === 'inProgress' && t.percentComplete === 0 && !t.actualStart) delete t.status;
}

/**
 * Write % complete onto a task. Actual dates are filled from the current schedule (clamped to
 * the status date) the way MS Project does when progress is entered. On hold and Blocked are
 * kept unless the task reaches 100 %.
 */
function applyPercent(t: Draft<Task>, value: number, c: TaskCalc | undefined) {
  t.percentComplete = value;
  if (value === 0) {
    delete t.actualStart;
    delete t.actualFinish;
    normaliseStatus(t);
    return;
  }
  if (!t.actualStart && c) t.actualStart = dayToIso(c.es);
  if (value === 100) {
    if (!t.actualFinish && c) t.actualFinish = dayToIso(displayFinishDay(c));
  } else delete t.actualFinish;
  normaliseStatus(t);
}

/** Set % complete as one undoable step (see `applyPercent`). */
export function setPercentComplete(id: string, pct: number) {
  const p = st().project;
  if (!p) return { ok: false };
  const { schedule } = derive(p);
  const c = schedule.calc.get(id);
  const value = Math.max(0, Math.min(100, Math.round(pct)));
  return st().commit(`Progress of ${nameOf(id)}: ${value}%`, (d) => {
    applyPercent(findTask(d, id), value, c);
  });
}

/** The progress fields a task gets when its status is set (see `setStatus`). */
export interface StatusFields {
  percentComplete: number;
  actualStart?: string;
  actualFinish?: string;
  status?: TaskStatus;
}

/** % complete given to a completed task that is reopened (In progress, On hold, Blocked). */
export const REOPENED_PERCENT = 99;

/**
 * What changes when a task is set to `status`. `scheduled` holds the task's scheduled start
 * and finish (ISO), used to fill actual dates that are missing.
 */
export function statusFields(
  current: Pick<Task, 'percentComplete' | 'actualStart' | 'actualFinish'>,
  status: TaskStatus,
  scheduled?: { start: string; finish: string },
): StatusFields {
  const wasComplete = current.percentComplete >= 100 || !!current.actualFinish;
  const reopened = wasComplete ? Math.min(current.percentComplete, REOPENED_PERCENT) : null;
  switch (status) {
    case 'complete':
      return {
        percentComplete: 100,
        actualStart: current.actualStart ?? scheduled?.start,
        actualFinish: current.actualFinish ?? scheduled?.finish,
      };
    case 'notStarted':
      return { percentComplete: 0 };
    case 'inProgress':
      return {
        percentComplete: reopened ?? current.percentComplete,
        actualStart: current.actualStart ?? scheduled?.start,
        status,
      };
    default:
      // On hold / Blocked: only the status, unless the task was complete and is reopened.
      return {
        percentComplete: reopened ?? current.percentComplete,
        actualStart: current.actualStart,
        actualFinish: wasComplete ? undefined : current.actualFinish,
        status,
      };
  }
}

/** Write `StatusFields` onto a task, removing the fields that are undefined. */
export function applyStatusFields(t: Draft<Task>, f: StatusFields) {
  t.percentComplete = f.percentComplete;
  if (f.actualStart === undefined) delete t.actualStart;
  else t.actualStart = f.actualStart;
  if (f.actualFinish === undefined) delete t.actualFinish;
  else t.actualFinish = f.actualFinish;
  if (f.status === undefined) delete t.status;
  else t.status = f.status;
}

/** Scheduled start / finish of a task as ISO dates, for `statusFields`. */
export function scheduledDates(project: Project, id: string) {
  const c = derive(project).schedule.calc.get(id);
  return c ? { start: dayToIso(c.es), finish: dayToIso(displayFinishDay(c)) } : undefined;
}

/**
 * Set the status of a task as one undoable step.
 * Complete: 100 % with actual dates filled from the schedule. Not started: 0 %, actuals and
 * stored status cleared. In progress: started (actual start = scheduled start if not yet
 * started). On hold / Blocked: the status only.
 */
export function setStatus(id: string, status: TaskStatus) {
  const p = st().project;
  if (!p) return { ok: false };
  const task = p.tasks.find((t) => t.id === id);
  if (!task) return { ok: false };
  const fields = statusFields(task, status, scheduledDates(p, id));
  return st().commit(`Status of ${nameOf(id)}: ${STATUS_LABEL[status]}`, (d) => {
    applyStatusFields(findTask(d, id), fields);
  });
}

export function setPredecessorsText(id: string, text: string): CommitResult {
  const p = st().project;
  if (!p) return { ok: false };
  const r = resolvePredecessorText(p, id, text, newId);
  if (!r.ok) return { ok: false, error: r.error };
  return st().commit(
    `Predecessors of ${nameOf(id)} changed`,
    (d) => {
      d.dependencies = r.dependencies as Draft<Dependency>[];
    },
    { quiet: true },
  );
}

// ------------------------------------------------------------------ structure

export type InsertPosition = 'above' | 'below' | 'inside';

/**
 * Insert a new task next to `refId`: above or below it at the same level, or as its last
 * subtask. With no reference the task goes at the end. Returns the new id.
 */
export function insertTaskAt(
  refId: string | null,
  position: InsertPosition = 'above',
  init: Partial<Task> = {},
): string | null {
  const p = st().project;
  if (!p) return null;
  const task = blankTask({ calendarId: p.projectCalendarId, ...init });
  const label = !refId
    ? 'Inserted task'
    : position === 'inside'
      ? `Inserted subtask under ${nameOf(refId)}`
      : `Inserted task ${position === 'above' ? 'above' : 'below'} ${nameOf(refId)}`;
  const r = st().commit(
    label,
    (d) => {
      if (refId) {
        const ref = findTask(d, refId);
        if (position === 'inside') {
          const kids = siblingsOf(d, ref.id);
          task.parentId = ref.id;
          task.order = kids.length ? kids[kids.length - 1].order + 1 : 0;
          // A task that becomes a summary no longer has its own constraint.
          ref.constraint = { type: 'ASAP' };
        } else {
          task.parentId = ref.parentId;
          // renumber() normalises the sibling order.
          task.order = ref.order + (position === 'above' ? -0.5 : 0.5);
        }
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

/** Insert a new task above `beforeId` (same level), or at the end. Returns the new id. */
export function insertTask(beforeId: string | null, init: Partial<Task> = {}): string | null {
  return insertTaskAt(beforeId, 'above', init);
}

/** Whether a task can move one place up (-1) or down (+1) among its siblings. */
export function canMoveTask(project: Project, id: string, dir: -1 | 1): boolean {
  const t = project.tasks.find((x) => x.id === id);
  if (!t) return false;
  const sibs = project.tasks
    .filter((x) => (x.parentId ?? null) === (t.parentId ?? null))
    .sort((a, b) => a.order - b.order);
  const i = sibs.findIndex((x) => x.id === id);
  return i + dir >= 0 && i + dir < sibs.length;
}

/**
 * Move a task (with its subtasks) one place up or down within its parent. Row IDs renumber;
 * links are kept because they refer to tasks, not row numbers.
 */
export function moveTaskBy(id: string, dir: -1 | 1): CommitResult {
  const p = st().project;
  if (!p || !canMoveTask(p, id, dir)) return { ok: false };
  return st().commit(
    `Moved ${nameOf(id)} ${dir < 0 ? 'up' : 'down'}`,
    (d) => {
      const t = findTask(d, id);
      const sibs = siblingsOf(d, t.parentId);
      const other = sibs[sibs.findIndex((x) => x.id === id) + dir];
      const o = other.order;
      other.order = t.order;
      t.order = o;
    },
    { structural: true },
  );
}

/** Delete tasks and their subtasks (and every link to them) as one undoable step. */
export function deleteTasks(ids: string[]) {
  const p = st().project;
  if (!p) return { ok: false };
  const chosen = inOutlineOrder(p, ids);
  if (!chosen.length) return { ok: false };
  const roots = selectionRoots(p, chosen);
  const doomedCount = new Set(roots.flatMap((id) => [...descendantIds(p, id)])).size;
  const subs = doomedCount - roots.length;
  const subText = subs ? ` and ${subs} subtask${subs === 1 ? '' : 's'}` : '';
  const label =
    roots.length === 1
      ? `Deleted ${nameOf(roots[0])}${subText}`
      : `Deleted ${roots.length} tasks${subText}`;
  return st().commit(
    label,
    (d) => {
      const doomed = new Set<string>();
      for (const id of roots) for (const x of descendantIds(d, id)) doomed.add(x);
      d.tasks = d.tasks.filter((t) => !doomed.has(t.id));
      d.dependencies = d.dependencies.filter(
        (x) => !doomed.has(x.predecessorId) && !doomed.has(x.successorId),
      );
      for (const b of d.baselines) for (const id of doomed) delete b.tasks[id];
    },
    { structural: true },
  );
}

/** Make the task a child of its previous sibling. Returns false when it has none. */
function indentInDraft(d: Draft<Project>, id: string): boolean {
  const t = findTask(d, id);
  const sibs = siblingsOf(d, t.parentId);
  const i = sibs.findIndex((s) => s.id === id);
  if (i <= 0) return false;
  const newParent = sibs[i - 1];
  const kids = siblingsOf(d, newParent.id);
  t.parentId = newParent.id;
  t.order = kids.length ? kids[kids.length - 1].order + 1 : 0;
  // A task that becomes a summary keeps its links but no longer has its own constraint.
  newParent.constraint = { type: 'ASAP' };
  return true;
}

/**
 * Move the task up one level, keeping its place in the outline (later siblings become its
 * children). Returns false for a top-level task.
 */
function outdentInDraft(d: Draft<Project>, id: string): boolean {
  const t = findTask(d, id);
  if (!t.parentId) return false;
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
  return true;
}

/** Make the task a child of its previous sibling. */
export function indentTask(id: string) {
  return st().commit(`Indented ${nameOf(id)}`, (d) => void indentInDraft(d, id), {
    structural: true,
  });
}

/** Move the task up one level, keeping its place in the outline (later siblings become its children). */
export function outdentTask(id: string) {
  return st().commit(`Outdented ${nameOf(id)}`, (d) => void outdentInDraft(d, id), {
    structural: true,
  });
}

// ------------------------------------------------------------------ selections

/** Distinct existing task ids, in outline order. */
export function inOutlineOrder(project: Project, ids: Iterable<string>): string[] {
  const want = new Set(ids);
  return derive(project).outline.flat.filter((id) => want.has(id));
}

/** The chosen tasks that are not inside another chosen task (their subtasks move with them). */
export function selectionRoots(project: Project, ids: Iterable<string>): string[] {
  const { outline } = derive(project);
  const chosen = new Set(ids);
  return inOutlineOrder(project, chosen).filter(
    (id) => !outline.ancestorsOf(id).some((a) => chosen.has(a)),
  );
}

/**
 * Plan moving the roots one place up (-1) or down (+1) among their siblings. Adjacent chosen
 * siblings move as a block; chosen tasks that are already at the end of their parent stay put.
 * Returns the new sibling order of every parent that changes, and the chosen tasks that move.
 */
function planMoves(project: Project, roots: string[], dir: -1 | 1) {
  const chosen = new Set(roots);
  const orders = new Map<string | null, string[]>();
  const moved: string[] = [];
  const parents = new Set(
    roots.map((id) => project.tasks.find((t) => t.id === id)?.parentId ?? null),
  );
  for (const parent of parents) {
    const before = project.tasks
      .filter((t) => (t.parentId ?? null) === parent)
      .sort((a, b) => a.order - b.order)
      .map((t) => t.id);
    const after = [...before];
    if (dir < 0) {
      for (let i = 1; i < after.length; i++) {
        if (chosen.has(after[i]) && !chosen.has(after[i - 1])) {
          [after[i - 1], after[i]] = [after[i], after[i - 1]];
        }
      }
    } else {
      for (let i = after.length - 2; i >= 0; i--) {
        if (chosen.has(after[i]) && !chosen.has(after[i + 1])) {
          [after[i + 1], after[i]] = [after[i], after[i + 1]];
        }
      }
    }
    if (after.some((id, i) => id !== before[i])) {
      orders.set(parent, after);
      for (const id of after)
        if (chosen.has(id) && before.indexOf(id) !== after.indexOf(id)) moved.push(id);
    }
  }
  return { orders, moved };
}

/** Whether at least one of the tasks can move one place up (-1) or down (+1). */
export function canMoveTasks(project: Project, ids: string[], dir: -1 | 1): boolean {
  return planMoves(project, selectionRoots(project, ids), dir).orders.size > 0;
}

/** Move several tasks (with their subtasks) one place up or down, as one undoable step. */
export function moveTasksBy(ids: string[], dir: -1 | 1): CommitResult {
  const p = st().project;
  if (!p) return { ok: false };
  const { orders, moved } = planMoves(p, selectionRoots(p, ids), dir);
  if (!moved.length) return { ok: false };
  if (moved.length === 1) return moveTaskBy(moved[0], dir);
  return st().commit(
    `Moved ${moved.length} tasks ${dir < 0 ? 'up' : 'down'}`,
    (d) => {
      for (const order of orders.values()) order.forEach((id, i) => (findTask(d, id).order = i));
    },
    { structural: true },
  );
}

/** Apply an indent or outdent step to each root in turn; returns the ones that moved. */
function applyToRoots(
  project: Project,
  roots: string[],
  step: (d: Draft<Project>, id: string) => boolean,
): string[] {
  const applied: string[] = [];
  produce(project, (d) => {
    for (const id of roots) {
      if (step(d, id)) {
        applied.push(id);
        renumber(d.tasks); // keeps sibling orders distinct for the next step
      }
    }
  });
  return applied;
}

function structureSteps(ids: string[], verb: 'Indented' | 'Outdented') {
  const p = st().project;
  if (!p) return { ok: false };
  const step = verb === 'Indented' ? indentInDraft : outdentInDraft;
  const applied = applyToRoots(p, selectionRoots(p, ids), step);
  if (!applied.length) return { ok: false };
  if (applied.length === 1) return (verb === 'Indented' ? indentTask : outdentTask)(applied[0]);
  return st().commit(
    `${verb} ${applied.length} tasks`,
    (d) => {
      for (const id of applied) {
        step(d, id);
        renumber(d.tasks);
      }
    },
    { structural: true },
  );
}

/**
 * Indent several tasks as one undoable step, top to bottom: each becomes the last child of its
 * previous sibling, so a block of adjacent siblings moves together. Tasks without a previous
 * sibling are skipped.
 */
export function indentTasks(ids: string[]) {
  return structureSteps(ids, 'Indented');
}

/** Outdent several tasks as one undoable step, top to bottom; top-level tasks are skipped. */
export function outdentTasks(ids: string[]) {
  return structureSteps(ids, 'Outdented');
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
  const where = position === 'inside' ? 'into' : position;
  return st().commit(
    `Moved ${nameOf(id)} ${where} ${nameOf(targetId)}`,
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
  const label = `Link from ${rowIdOf(predecessorId)} to ${rowIdOf(successorId)} added`;
  return st().commit(label, (d) => {
    d.dependencies.push({ id: newId(), predecessorId, successorId, type, lag, lagUnit });
  });
}

export function updateLink(depId: string, patch: Partial<Dependency>) {
  return st().commit(`${linkText(depId) ?? 'Link'} changed`, (d) => {
    const dep = d.dependencies.find((x) => x.id === depId);
    if (dep) Object.assign(dep, patch);
  });
}

export function deleteLink(depId: string) {
  return st().commit(`${linkText(depId) ?? 'Link'} removed`, (d) => {
    d.dependencies = d.dependencies.filter((x) => x.id !== depId);
  });
}

/** Replace all links of a task in one undoable step (task dialog). */
export function replaceTaskLinks(taskId: string, links: Dependency[]) {
  return st().commit(`Links of ${nameOf(taskId)} changed`, (d) => {
    d.dependencies = [
      ...d.dependencies.filter((x) => x.predecessorId !== taskId && x.successorId !== taskId),
      ...(links as Draft<Dependency>[]),
    ];
  });
}

/**
 * Link the selected work tasks Finish-to-Start in outline order (A to B, B to C, …), skipping
 * pairs that are already linked. One undoable step; refused as a whole if it makes a cycle.
 */
export function linkInSequence(ids: string[]): CommitResult {
  const p = st().project;
  if (!p) return { ok: false, error: 'No project open' };
  const { outline } = derive(p);
  const tasks = inOutlineOrder(p, ids).filter((id) => !outline.isSummary(id));
  if (tasks.length < 2) {
    const error = 'Select at least two work tasks to link';
    st().toast(error, 'error');
    return { ok: false, error };
  }
  const linked = new Set(p.dependencies.map((x) => `${x.predecessorId}>${x.successorId}`));
  const pairs: [string, string][] = [];
  for (let i = 1; i < tasks.length; i++) {
    if (!linked.has(`${tasks[i - 1]}>${tasks[i]}`)) pairs.push([tasks[i - 1], tasks[i]]);
  }
  if (!pairs.length) {
    st().toast('These tasks are already linked in sequence', 'info');
    return { ok: false };
  }
  return st().commit(`Linked ${tasks.length} tasks in sequence`, (d) => {
    for (const [predecessorId, successorId] of pairs) {
      d.dependencies.push({
        id: newId(),
        predecessorId,
        successorId,
        type: 'FS',
        lag: 0,
        lagUnit: 'wd',
      });
    }
  });
}

/** Remove every link whose two ends are both in the selection, as one undoable step. */
export function unlinkTasks(ids: string[]): CommitResult {
  const p = st().project;
  if (!p) return { ok: false, error: 'No project open' };
  const chosen = new Set(ids);
  const count = p.dependencies.filter(
    (x) => chosen.has(x.predecessorId) && chosen.has(x.successorId),
  ).length;
  if (!count) {
    st().toast('There are no links between the selected tasks', 'info');
    return { ok: false };
  }
  return st().commit(
    `Removed ${count} link${count === 1 ? '' : 's'} between ${chosen.size} tasks`,
    (d) => {
      d.dependencies = d.dependencies.filter(
        (x) => !(chosen.has(x.predecessorId) && chosen.has(x.successorId)),
      );
    },
  );
}

// ------------------------------------------------------------------ bulk edit

/** Properties to set on many tasks at once. Every field is optional (omitted = unchanged). */
export interface BulkChanges {
  status?: TaskStatus;
  percentComplete?: number;
  responsible?: string;
  /** Working days; 0 makes the tasks milestones. */
  duration?: number;
  calendarId?: string;
  /** A constraint of type ASAP removes the constraint. */
  constraint?: Constraint;
  /** Move the start by this many working days (+ later, - earlier) with a Start no earlier than constraint. */
  shiftStartBy?: number;
  /** Text added on a new line at the end of each task's notes. */
  appendNotes?: string;
}

/**
 * What a bulk edit touches: `all` are the selected tasks (responsible and notes apply to
 * these), `work` the work tasks among them plus the work tasks inside selected summaries
 * (everything else applies to these), `summaries` the selected summary tasks.
 */
export function bulkTargets(project: Project, ids: Iterable<string>) {
  const { outline } = derive(project);
  const all = inOutlineOrder(project, ids);
  const summaries = all.filter((id) => outline.isSummary(id));
  const work = inOutlineOrder(
    project,
    all.flatMap((id) => (outline.isSummary(id) ? outline.leavesOf(id) : [id])),
  );
  return { all, summaries, work };
}

/**
 * Edit several tasks as one undoable step. Duration, calendar, constraint, progress, status and
 * the start shift apply to work tasks only (a selected summary stands for its work tasks);
 * responsible and notes apply to every selected task. Progress is applied before status, and a
 * start shift replaces any constraint given in the same edit.
 */
export function bulkUpdate(
  ids: string[],
  changes: BulkChanges,
  opts: { quiet?: boolean } = {},
): CommitResult {
  const p = st().project;
  if (!p) return { ok: false, error: 'No project open' };
  const fail = (error: string): CommitResult => {
    if (!opts.quiet) st().toast(error, 'error');
    return { ok: false, error };
  };
  const { all, work } = bulkTargets(p, ids);
  if (!all.length) return fail('No tasks selected');

  const { status, constraint } = changes;
  const pct =
    changes.percentComplete === undefined
      ? undefined
      : Math.max(0, Math.min(100, Math.round(changes.percentComplete)));
  const duration =
    changes.duration === undefined ? undefined : Math.max(0, Math.round(changes.duration));
  const shift = Math.round(changes.shiftStartBy ?? 0);
  const responsible = changes.responsible?.trim();
  const note = changes.appendNotes?.trim();
  if (pct !== undefined && !Number.isFinite(pct)) return fail('% complete must be a number');
  if (duration !== undefined && !Number.isFinite(duration)) {
    return fail('Duration must be a number of working days');
  }
  if (!Number.isFinite(shift)) return fail('The start shift must be a number of working days');
  if (constraint && constraint.type !== 'ASAP' && !constraint.date) {
    return fail('Choose a date for the constraint');
  }
  const calendar = changes.calendarId
    ? p.calendars.find((c) => c.id === changes.calendarId)
    : undefined;
  if (changes.calendarId && !calendar) return fail('That calendar no longer exists');

  const parts: string[] = [];
  if (status) parts.push(`status ${STATUS_LABEL[status]}`);
  if (pct !== undefined) parts.push(`${pct}% complete`);
  if (responsible !== undefined) {
    parts.push(responsible ? `responsible ${quoted(responsible)}` : 'responsible cleared');
  }
  if (duration !== undefined) {
    parts.push(`duration ${duration === 0 ? 'milestone' : days(duration, 'working day')}`);
  }
  if (calendar) parts.push(`calendar ${quoted(calendar.name)}`);
  if (constraint) {
    parts.push(
      constraint.type === 'ASAP'
        ? 'constraint removed'
        : `${CONSTRAINT_LABEL[constraint.type].toLowerCase()} ${fmtIso(constraint.date!)}`,
    );
  }
  if (shift) {
    parts.push(
      `start moved ${shift > 0 ? 'later' : 'earlier'} by ${days(Math.abs(shift), 'working day')}`,
    );
  }
  if (note) parts.push('notes added');
  if (!parts.length) return fail('Choose at least one thing to change');

  const { schedule } = derive(p);
  const who = all.length === 1 ? nameOf(all[0]) : `${all.length} tasks`;
  return st().commit(
    `Edited ${who}: ${parts.join(', ')}`,
    (d) => {
      for (const id of work) {
        const t = findTask(d, id);
        const c = schedule.calc.get(id);
        if (duration !== undefined) t.duration = duration;
        if (calendar) t.calendarId = calendar.id;
        if (pct !== undefined) applyPercent(t, pct, c);
        if (status) applyStatusFields(t, statusFields(t, status, scheduledDates(p, id)));
        if (constraint) {
          t.constraint =
            constraint.type === 'ASAP'
              ? { type: 'ASAP' }
              : { type: constraint.type, date: constraint.date };
        }
        if (shift && c) {
          const cal = calFor(p, t.calendarId);
          t.constraint = { type: 'SNET', date: dayToIso(cal.shift(cal.snap(c.es), shift)) };
        }
      }
      for (const id of all) {
        const t = findTask(d, id);
        if (responsible !== undefined) t.responsible = responsible;
        if (note) t.notes = t.notes.trim() ? `${t.notes.trimEnd()}\n${note}` : note;
      }
    },
    { quiet: opts.quiet },
  );
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
  return st().commit('Edited calendars', (d) => {
    d.calendars = calendars as Draft<Calendar>[];
    const ids = new Set(calendars.map((c) => c.id));
    if (!ids.has(d.projectCalendarId)) d.projectCalendarId = calendars[0].id;
    for (const t of d.tasks) if (!ids.has(t.calendarId)) t.calendarId = d.projectCalendarId;
  });
}

export function setStatusDate(iso: string) {
  return updateProject({ statusDate: iso }, `Status date: ${fmtIso(iso)}`);
}

export function saveBaseline(name: string) {
  const p = st().project;
  if (!p) return { ok: false };
  const { schedule } = derive(p);
  const bl = makeBaseline(p, schedule, newId(), name, new Date().toISOString());
  return st().commit(`Saved baseline ${quoted(name)}`, (d) => {
    d.baselines.push(bl as Draft<typeof bl>);
    d.activeBaselineId = bl.id;
  });
}

export function setActiveBaseline(id: string | undefined) {
  const name = st().project?.baselines.find((b) => b.id === id)?.name;
  return st().commit(name ? `Active baseline: ${quoted(name)}` : 'No active baseline', (d) => {
    d.activeBaselineId = id;
  });
}

export function renameBaseline(id: string, name: string) {
  const old = st().project?.baselines.find((b) => b.id === id)?.name ?? 'baseline';
  return st().commit(`Renamed baseline ${quoted(old)} to ${quoted(name)}`, (d) => {
    const b = d.baselines.find((x) => x.id === id);
    if (b) b.name = name;
  });
}

export function deleteBaseline(id: string) {
  const name = st().project?.baselines.find((b) => b.id === id)?.name ?? 'baseline';
  return st().commit(`Deleted baseline ${quoted(name)}`, (d) => {
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

export function applyProgress(entries: ProgressEntry[], statusDate?: string) {
  const what = entries.length === 1 ? nameOf(entries[0].id) : `${entries.length} tasks`;
  const label = entries.length
    ? `Progress of ${what}${statusDate ? `, status date ${fmtIso(statusDate)}` : ''}`
    : `Status date: ${fmtIso(statusDate)}`;
  return st().commit(label, (d) => {
    if (statusDate) d.statusDate = statusDate;
    for (const e of entries) {
      const t = d.tasks.find((x) => x.id === e.id);
      if (!t) continue;
      t.percentComplete = e.percentComplete;
      if (e.actualStart) t.actualStart = e.actualStart;
      else delete t.actualStart;
      if (e.actualFinish) t.actualFinish = e.actualFinish;
      else delete t.actualFinish;
      normaliseStatus(t);
    }
  });
}

/**
 * "On schedule" progress for a task as of the status date: the share of its working days
 * scheduled before the status date.
 */
export function onSchedulePercent(
  project: Project,
  id: string,
  status = isoToDay(project.statusDate),
): ProgressEntry | null {
  // Uses the current schedule; `status` is the cut-off (e.g. a new status date being entered).
  const { schedule } = derive(project);
  const c = schedule.calc.get(id);
  if (!c) return null;
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
