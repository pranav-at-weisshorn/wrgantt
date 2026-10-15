import { buildOutline, checkHealth, scheduleProject, type Outline } from '../engine';
import type { HealthIssue, Project, ScheduleResult } from '../engine';

export interface Derived {
  outline: Outline;
  schedule: ScheduleResult;
  health: HealthIssue[];
}

/**
 * Outline + schedule are derived from the (immutable) project object and cached per object,
 * so they never enter the undo history or IndexedDB.
 */
const cache = new WeakMap<Project, Derived>();

export function derive(project: Project, outline?: Outline): Derived {
  let d = cache.get(project);
  if (!d) {
    const o = outline ?? buildOutline(project.tasks);
    const schedule = scheduleProject(project, o);
    d = { outline: o, schedule, health: checkHealth(project, schedule, o) };
    cache.set(project, d);
  }
  return d;
}
