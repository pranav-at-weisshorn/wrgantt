import { defaultCalendars, SEVEN_DAY_CALENDAR_ID, STANDARD_CALENDAR_ID } from './calendar';
import { isoToDay } from './dates';
import { renumber } from './outline';
import type { ConstraintType, DepType, LagUnit, Project, Task } from './types';

/** Small fluent builder for engine tests. Task ids are the given names. */
export class ProjectBuilder {
  project: Project;

  constructor(opts: { start?: string; calendar?: 'standard' | '7day'; holidays?: string[] } = {}) {
    const calendars = defaultCalendars();
    if (opts.holidays) calendars[0].holidays = opts.holidays;
    const cal = opts.calendar === 'standard' ? STANDARD_CALENDAR_ID : SEVEN_DAY_CALENDAR_ID;
    const start = opts.start ?? '2027-01-04';
    this.project = {
      id: 'p',
      name: 'Test',
      startDate: start,
      statusDate: start,
      projectCalendarId: cal,
      calendars,
      tasks: [],
      dependencies: [],
      baselines: [],
      criticalFloatThreshold: 0,
    };
  }

  task(id: string, duration: number, extra: Partial<Task> = {}): this {
    const t: Task = {
      id,
      rowId: this.project.tasks.length + 1,
      name: id,
      parentId: null,
      order: this.project.tasks.length,
      duration,
      calendarId: this.project.projectCalendarId,
      constraint: { type: 'ASAP' },
      responsible: '',
      notes: '',
      percentComplete: 0,
      ...extra,
    };
    this.project.tasks.push(t);
    renumber(this.project.tasks);
    return this;
  }

  link(pred: string, succ: string, type: DepType = 'FS', lag = 0, lagUnit: LagUnit = 'wd'): this {
    this.project.dependencies.push({
      id: `${pred}-${succ}-${type}`,
      predecessorId: pred,
      successorId: succ,
      type,
      lag,
      lagUnit,
    });
    return this;
  }

  constrain(id: string, type: ConstraintType, date: string): this {
    this.project.tasks.find((t) => t.id === id)!.constraint = { type, date };
    return this;
  }

  /** ISO date `days` after the project start. */
  day(days: number): string {
    const d = isoToDay(this.project.startDate) + days;
    return new Date(d * 86_400_000).toISOString().slice(0, 10);
  }
}
