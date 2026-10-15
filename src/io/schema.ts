import {
  defaultCalendars,
  isValidIso,
  newId,
  renumber,
  type Baseline,
  type Calendar,
  type ConstraintType,
  type Dependency,
  type DepType,
  type Project,
  type Task,
} from '../engine';

/** Version of the persisted / exported project format. Bump and add a migration on change. */
export const SCHEMA_VERSION = 1;

export interface ProjectFile {
  schemaVersion: number;
  app: 'condo-gantt';
  exportedAt?: string;
  project: Project;
}

/** Phase colours of the first template version, mapped to the Villa Felstead earth tones. */
const LEGACY_PHASE_COLORS: Record<string, string> = {
  '#3b82f6': '#8c7067',
  '#10b981': '#6f8a6a',
  '#8b5cf6': '#8a6f8f',
  '#06b6d4': '#5f8496',
  '#78716c': '#a0907c',
  '#ec4899': '#b8826b',
  '#6366f1': '#6b6f94',
  '#84cc16': '#9a9a5c',
  '#f59e0b': '#c8a46e',
  '#64748b': '#6f9c9a',
  '#14b8a6': '#4e7364',
};

const DEP_TYPES: DepType[] = ['FS', 'SS', 'FF', 'SF'];
const CONSTRAINTS: ConstraintType[] = ['ASAP', 'SNET', 'SNLT', 'FNET', 'FNLT', 'MSO', 'MFO'];

const str = (v: unknown, d = '') => (typeof v === 'string' ? v : d);
const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const isoOr = (v: unknown, d: string) => (typeof v === 'string' && isValidIso(v) ? v : d);
const isoOpt = (v: unknown) => (typeof v === 'string' && isValidIso(v) ? v : undefined);

/**
 * Validate and normalise a project from any source (IndexedDB, JSON file).
 * Unknown fields are dropped, missing ones defaulted, and the derived `calc` removed.
 */
export function normaliseProject(raw: unknown): Project {
  if (!raw || typeof raw !== 'object') throw new Error('Not a project');
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.tasks)) throw new Error('Project has no task list');
  const today = new Date().toISOString().slice(0, 10);
  const startDate = isoOr(r.startDate, today);

  let calendars: Calendar[] = Array.isArray(r.calendars)
    ? (r.calendars as Record<string, unknown>[])
        .filter((c) => c && typeof c.id === 'string')
        .map((c) => ({
          id: str(c.id),
          name: str(c.name, 'Calendar'),
          workingWeekdays: Array.isArray(c.workingWeekdays)
            ? (c.workingWeekdays as unknown[]).filter(
                (d): d is number => typeof d === 'number' && d >= 0 && d <= 6,
              )
            : [1, 2, 3, 4, 5],
          holidays: Array.isArray(c.holidays)
            ? (c.holidays as unknown[]).filter(
                (h): h is string => typeof h === 'string' && isValidIso(h),
              )
            : [],
        }))
    : [];
  if (!calendars.length) calendars = defaultCalendars();
  const calIds = new Set(calendars.map((c) => c.id));
  const projectCalendarId = calIds.has(str(r.projectCalendarId))
    ? str(r.projectCalendarId)
    : calendars[0].id;

  const tasks: Task[] = (r.tasks as Record<string, unknown>[]).map((t, i) => {
    const c = (t.constraint ?? {}) as Record<string, unknown>;
    const ctype = CONSTRAINTS.includes(c.type as ConstraintType)
      ? (c.type as ConstraintType)
      : 'ASAP';
    const cdate = isoOpt(c.date);
    const task: Task = {
      id: str(t.id) || newId(),
      rowId: num(t.rowId, i + 1),
      name: str(t.name, 'Untitled'),
      parentId: typeof t.parentId === 'string' ? t.parentId : null,
      order: num(t.order, i),
      duration: Math.max(0, Math.round(num(t.duration, 1))),
      calendarId: calIds.has(str(t.calendarId)) ? str(t.calendarId) : projectCalendarId,
      constraint: ctype === 'ASAP' || !cdate ? { type: 'ASAP' } : { type: ctype, date: cdate },
      responsible: str(t.responsible),
      notes: str(t.notes),
      percentComplete: Math.max(0, Math.min(100, num(t.percentComplete))),
    };
    if (typeof t.templateKey === 'string') task.templateKey = t.templateKey;
    if (typeof t.phaseColor === 'string') {
      task.phaseColor = LEGACY_PHASE_COLORS[t.phaseColor.toLowerCase()] ?? t.phaseColor;
    }
    const as = isoOpt(t.actualStart);
    const af = isoOpt(t.actualFinish);
    if (as) task.actualStart = as;
    if (af) task.actualFinish = af;
    return task;
  });
  const taskIds = new Set(tasks.map((t) => t.id));
  for (const t of tasks) if (t.parentId && !taskIds.has(t.parentId)) t.parentId = null;

  const seen = new Set<string>();
  const dependencies: Dependency[] = (
    Array.isArray(r.dependencies) ? (r.dependencies as Record<string, unknown>[]) : []
  )
    .filter((d) => d && taskIds.has(str(d.predecessorId)) && taskIds.has(str(d.successorId)))
    .filter((d) => d.predecessorId !== d.successorId)
    .filter((d) => {
      const k = `${d.predecessorId}>${d.successorId}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .map((d) => ({
      id: str(d.id) || newId(),
      predecessorId: str(d.predecessorId),
      successorId: str(d.successorId),
      type: DEP_TYPES.includes(d.type as DepType) ? (d.type as DepType) : 'FS',
      lag: Math.round(num(d.lag)),
      lagUnit: d.lagUnit === 'ed' ? 'ed' : 'wd',
    }));

  const baselines: Baseline[] = (
    Array.isArray(r.baselines) ? (r.baselines as Record<string, unknown>[]) : []
  )
    .filter((b) => b && typeof b.id === 'string' && b.tasks && typeof b.tasks === 'object')
    .map((b) => {
      const entries: Baseline['tasks'] = {};
      for (const [id, e] of Object.entries(b.tasks as Record<string, Record<string, unknown>>)) {
        if (!taskIds.has(id) || !isValidIso(str(e?.start)) || !isValidIso(str(e?.finish))) continue;
        entries[id] = { start: str(e.start), finish: str(e.finish), duration: num(e.duration) };
      }
      return {
        id: str(b.id),
        name: str(b.name, 'Baseline'),
        savedAt: str(b.savedAt),
        tasks: entries,
      };
    });
  const activeBaselineId = baselines.some((b) => b.id === r.activeBaselineId)
    ? str(r.activeBaselineId)
    : undefined;

  const project: Project = {
    id: str(r.id) || newId(),
    name: str(r.name, 'Imported project'),
    startDate,
    statusDate: isoOr(r.statusDate, startDate),
    projectCalendarId,
    calendars,
    tasks,
    dependencies,
    baselines,
    criticalFloatThreshold: num(r.criticalFloatThreshold, 0),
  };
  if (activeBaselineId) project.activeBaselineId = activeBaselineId;
  renumber(project.tasks);
  return project;
}

/** Read a versioned project file (or a bare project object) and migrate it to the current schema. */
export function readProjectFile(data: unknown): Project {
  if (!data || typeof data !== 'object') throw new Error('File is not a project');
  const d = data as Record<string, unknown>;
  const version = typeof d.schemaVersion === 'number' ? d.schemaVersion : 0;
  if (version > SCHEMA_VERSION) {
    throw new Error(
      `This file was made by a newer version (schema ${version}); please update the app`,
    );
  }
  // Version 0 = a bare project object; version 1 = { schemaVersion, project }.
  const raw = version === 0 && !d.project ? d : d.project;
  return normaliseProject(raw);
}

export function toProjectFile(project: Project): ProjectFile {
  return {
    schemaVersion: SCHEMA_VERSION,
    app: 'condo-gantt',
    exportedAt: new Date().toISOString(),
    project,
  };
}
