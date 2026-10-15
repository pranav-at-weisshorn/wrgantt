import { getWorkCalendar } from './calendar';
import { dayToIso, isoToDay } from './dates';
import type { Outline } from './outline';
import type { Baseline, BaselineEntry, Project, ScheduleResult, TaskCalc } from './types';

/** Inclusive finish day shown to the user: last working day, or the date of a milestone. */
export function displayFinishDay(c: Pick<TaskCalc, 'es' | 'ef'> & { finishDay?: number }): number {
  if (c.finishDay !== undefined) return c.finishDay;
  return c.ef > c.es ? c.ef - 1 : c.es;
}

export function activeBaseline(project: Project): Baseline | undefined {
  return project.baselines.find((b) => b.id === project.activeBaselineId);
}

export function makeBaseline(
  project: Project,
  schedule: ScheduleResult,
  id: string,
  name: string,
  savedAt: string,
): Baseline {
  const tasks: Record<string, BaselineEntry> = {};
  for (const t of project.tasks) {
    const c = schedule.calc.get(t.id);
    if (!c) continue;
    tasks[t.id] = {
      start: dayToIso(c.es),
      finish: dayToIso(displayFinishDay(c)),
      duration: c.duration,
    };
  }
  return { id, name, savedAt, tasks };
}

export function projectCalendarOf(project: Project) {
  const cal =
    project.calendars.find((c) => c.id === project.projectCalendarId) ?? project.calendars[0];
  return getWorkCalendar(
    cal ?? { id: '_', name: '_', workingWeekdays: [1, 2, 3, 4, 5], holidays: [] },
  );
}

/** Finish variance in working days (project calendar); positive = later than baseline. */
export function finishVariance(
  project: Project,
  c: TaskCalc | undefined,
  b: BaselineEntry | undefined,
): number | null {
  if (!c || !b) return null;
  const cal = projectCalendarOf(project);
  const cur = displayFinishDay(c);
  const base = isoToDay(b.finish);
  return cal.cum(cur + 1) - cal.cum(base + 1);
}

export interface VarianceSummary {
  baselineName: string;
  projectFinish: number;
  baselineFinish: number | null;
  finishVariance: number | null;
  slippedCount: number;
  topSlippingCritical: { id: string; variance: number }[];
}

export function varianceSummary(
  project: Project,
  schedule: ScheduleResult,
  outline: Outline,
): VarianceSummary | null {
  const bl = activeBaseline(project);
  if (!bl) return null;
  const cal = projectCalendarOf(project);
  let baseFinish: number | null = null;
  for (const e of Object.values(bl.tasks)) {
    const f = isoToDay(e.finish);
    if (baseFinish === null || f > baseFinish) baseFinish = f;
  }
  let projFinish = schedule.projectStart;
  for (const c of schedule.calc.values()) projFinish = Math.max(projFinish, displayFinishDay(c));
  let slipped = 0;
  const crit: { id: string; variance: number }[] = [];
  for (const id of outline.flat) {
    if (outline.isSummary(id)) continue;
    const c = schedule.calc.get(id);
    const v = finishVariance(project, c, bl.tasks[id]);
    if (v === null || v <= 0) continue;
    slipped++;
    if (c?.critical) crit.push({ id, variance: v });
  }
  crit.sort((a, b) => b.variance - a.variance);
  return {
    baselineName: bl.name,
    projectFinish: projFinish,
    baselineFinish: baseFinish,
    finishVariance: baseFinish === null ? null : cal.cum(projFinish + 1) - cal.cum(baseFinish + 1),
    slippedCount: slipped,
    topSlippingCritical: crit.slice(0, 10),
  };
}
