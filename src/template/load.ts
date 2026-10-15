import {
  defaultCalendars,
  dayToIso,
  newId,
  nextMonday,
  renumber,
  SEVEN_DAY_CALENDAR_ID,
  STANDARD_CALENDAR_ID,
  todayDay,
  type Dependency,
  type DepType,
  type Project,
  type Task,
} from '../engine';
import { CONDO_TEMPLATE, type TemplatePhase } from './condo';

const PRED = /^([A-Z]\d{2})(?:\s*(FS|SS|FF|SF))?(?:\s*([+-]\d+)\s*(ed|d)?)?$/;

export function defaultStartDate(): string {
  return dayToIso(nextMonday(todayDay()));
}

export function emptyProject(name: string, startDate = defaultStartDate()): Project {
  return {
    id: newId(),
    name,
    startDate,
    statusDate: startDate,
    projectCalendarId: STANDARD_CALENDAR_ID,
    calendars: defaultCalendars(),
    tasks: [],
    dependencies: [],
    baselines: [],
    criticalFloatThreshold: 0,
  };
}

export function blankTask(partial: Partial<Task> & { calendarId: string }): Task {
  return {
    id: newId(),
    rowId: 0,
    name: 'New task',
    parentId: null,
    order: 0,
    duration: 1,
    constraint: { type: 'ASAP' },
    responsible: '',
    notes: '',
    percentComplete: 0,
    ...partial,
  };
}

export function projectFromTemplate(
  name: string,
  startDate = defaultStartDate(),
  phases: TemplatePhase[] = CONDO_TEMPLATE,
): Project {
  const project = emptyProject(name, startDate);
  const byKey = new Map<string, string>();
  phases.forEach((phase, pi) => {
    const summary = blankTask({
      calendarId: STANDARD_CALENDAR_ID,
      name: phase.name,
      order: pi,
      duration: 0,
      phaseColor: phase.color,
      templateKey: phase.key,
    });
    project.tasks.push(summary);
    phase.tasks.forEach((tt, i) => {
      const task = blankTask({
        calendarId: tt.calendar === '7day' ? SEVEN_DAY_CALENDAR_ID : STANDARD_CALENDAR_ID,
        name: tt.name,
        parentId: summary.id,
        order: i,
        duration: tt.dur,
        responsible: tt.resp,
        templateKey: tt.key,
      });
      byKey.set(tt.key, task.id);
      project.tasks.push(task);
    });
  });

  for (const phase of phases) {
    for (const tt of phase.tasks) {
      if (!tt.preds.trim()) continue;
      for (const raw of tt.preds.split(',')) {
        const m = PRED.exec(raw.trim());
        if (!m) throw new Error(`Template: cannot parse predecessor "${raw}" of ${tt.key}`);
        const pred = byKey.get(m[1]);
        if (!pred) throw new Error(`Template: unknown key ${m[1]} in ${tt.key}`);
        const dep: Dependency = {
          id: newId(),
          predecessorId: pred,
          successorId: byKey.get(tt.key)!,
          type: (m[2] as DepType) ?? 'FS',
          lag: m[3] ? parseInt(m[3], 10) : 0,
          lagUnit: m[4] === 'ed' ? 'ed' : 'wd',
        };
        project.dependencies.push(dep);
      }
    }
  }
  renumber(project.tasks);
  return project;
}
