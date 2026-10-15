import { getWorkCalendar, type Project, type WorkCalendar } from '../engine';

export function calFor(project: Project, calendarId?: string): WorkCalendar {
  const def =
    project.calendars.find((c) => c.id === (calendarId ?? project.projectCalendarId)) ??
    project.calendars.find((c) => c.id === project.projectCalendarId) ??
    project.calendars[0];
  return getWorkCalendar(def);
}
