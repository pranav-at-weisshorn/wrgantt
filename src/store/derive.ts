import {
  buildOutline,
  checkHealth,
  hasWorstCase,
  scheduleProject,
  worstCaseProject,
  type Outline,
} from '../engine';
import type { HealthIssue, Project, ScheduleResult } from '../engine';

export interface Derived {
  outline: Outline;
  schedule: ScheduleResult;
  health: HealthIssue[];
  /** Schedule with every task's worst-case extra time added (null when no task has any). */
  worst: ScheduleResult | null;
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
    let worst: ScheduleResult | null = null;
    if (hasWorstCase(project)) {
      const wp = worstCaseProject(project, o);
      worst = scheduleProject(wp, buildOutline(wp.tasks));
    }
    d = { outline: o, schedule, health: checkHealth(project, schedule, o), worst };
    cache.set(project, d);
  }
  return d;
}
