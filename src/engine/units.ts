import type { Project } from './types';

/** Working days in a week of the project calendar (5 for Monday to Friday, 7 for every day). */
export function workingDaysPerWeek(
  project: Pick<Project, 'calendars' | 'projectCalendarId'>,
): number {
  const cal =
    project.calendars.find((c) => c.id === project.projectCalendarId) ?? project.calendars[0];
  const n = cal ? new Set(cal.workingWeekdays).size : 5;
  return n >= 1 && n <= 7 ? n : 5;
}

/**
 * Working days in a week and in a month: a week is one calendar week of the project calendar,
 * a month is 30 calendar days (30 working days on a seven-day calendar, 21 on a five-day one).
 */
export function durationUnits(perWeek = 5) {
  return { week: perWeek, month: Math.round((30 * perWeek) / 7) };
}
