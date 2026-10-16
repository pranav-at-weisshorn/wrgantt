import type { WorkCalendar } from './calendar';
import type { Outline } from './outline';
import type { Project, Task } from './types';

/** True when any task carries worst-case extra time. */
export function hasWorstCase(project: Project): boolean {
  return project.tasks.some((t) => (t.worstCaseDays ?? 0) > 0);
}

/**
 * The project as it would run if every task took its worst-case extra time: unfinished work
 * tasks get `duration + worstCaseDays`. For a task in progress the % complete is rescaled so the
 * work already done stays the same and the extra time lands on the remaining work.
 */
export function worstCaseProject(project: Project, outline: Outline): Project {
  const tasks: Task[] = project.tasks.map((t) => {
    const extra = Math.max(0, Math.round(t.worstCaseDays ?? 0));
    if (!extra || outline.isSummary(t.id) || (t.percentComplete ?? 0) >= 100 || t.actualFinish) {
      return t;
    }
    const duration = t.duration + extra;
    const pct = t.percentComplete
      ? Math.floor((t.percentComplete * t.duration) / duration)
      : t.percentComplete;
    return { ...t, duration, percentComplete: pct };
  });
  return { ...project, tasks };
}

/**
 * Exclusive end point of a task's own worst-case extension: its finish moved out by `extra`
 * working days in its calendar (a milestone extends from its date).
 */
export function worstCaseEnd(cal: WorkCalendar, es: number, ef: number, extra: number): number {
  if (extra <= 0) return ef;
  return cal.addDuration(ef > es ? ef : es, extra);
}
