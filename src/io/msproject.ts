import { dayToIso, displayFinishDay, isoToDay, type Project } from '../engine';
import type { Derived } from '../store/derive';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const CONSTRAINT_CODE = { ASAP: 0, MSO: 2, MFO: 3, SNET: 4, SNLT: 5, FNET: 6, FNLT: 7 } as const;
const LINK_CODE = { FF: 0, FS: 1, SF: 2, SS: 3 } as const;

/** Working days as an MS Project duration (8-hour days). */
const dur = (days: number) => `PT${Math.max(0, days) * 8}H0M0S`;
const start = (day: number) => `${dayToIso(day)}T08:00:00`;
const finish = (day: number) => `${dayToIso(day)}T17:00:00`;

/**
 * Microsoft Project XML (MSPDI) export. Tasks are exported with their links, constraints,
 * progress and the project calendars, so MS Project reproduces the schedule on import.
 */
export function projectToMsProjectXml(project: Project, derived: Derived): string {
  const { outline, schedule } = derived;
  const uid = new Map<string, number>();
  outline.flat.forEach((id, i) => uid.set(id, i + 1));
  const calUid = new Map(project.calendars.map((c, i) => [c.id, i + 1]));
  const lines: string[] = [];
  const push = (s: string) => lines.push(s);

  push('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>');
  push('<Project xmlns="http://schemas.microsoft.com/project">');
  push(`  <Name>${esc(project.name)}</Name>`);
  push(`  <Title>${esc(project.name)}</Title>`);
  push('  <ScheduleFromStart>1</ScheduleFromStart>');
  push(`  <StartDate>${start(isoToDay(project.startDate))}</StartDate>`);
  push(`  <StatusDate>${start(isoToDay(project.statusDate))}</StatusDate>`);
  push(`  <CalendarUID>${calUid.get(project.projectCalendarId) ?? 1}</CalendarUID>`);
  push(
    '  <MinutesPerDay>480</MinutesPerDay><MinutesPerWeek>2400</MinutesPerWeek><DaysPerMonth>20</DaysPerMonth>',
  );
  push(
    '  <DefaultStartTime>08:00:00</DefaultStartTime><DefaultFinishTime>17:00:00</DefaultFinishTime>',
  );

  push('  <Calendars>');
  for (const c of project.calendars) {
    push('    <Calendar>');
    push(
      `      <UID>${calUid.get(c.id)}</UID><Name>${esc(c.name)}</Name><IsBaseCalendar>1</IsBaseCalendar>`,
    );
    push('      <WeekDays>');
    for (let d = 0; d < 7; d++) {
      const working = c.workingWeekdays.includes(d);
      push(
        `        <WeekDay><DayType>${d + 1}</DayType><DayWorking>${working ? 1 : 0}</DayWorking>`,
      );
      if (working) {
        push(
          '          <WorkingTimes><WorkingTime><FromTime>08:00:00</FromTime><ToTime>12:00:00</ToTime></WorkingTime>' +
            '<WorkingTime><FromTime>13:00:00</FromTime><ToTime>17:00:00</ToTime></WorkingTime></WorkingTimes>',
        );
      }
      push('        </WeekDay>');
    }
    push('      </WeekDays>');
    if (c.holidays.length) {
      push('      <Exceptions>');
      for (const h of c.holidays) {
        push(
          `        <Exception><EnteredByOccurrences>0</EnteredByOccurrences><TimePeriod><FromDate>${h}T00:00:00</FromDate>` +
            `<ToDate>${h}T23:59:00</ToDate></TimePeriod><Occurrences>1</Occurrences><Name>Holiday</Name><Type>1</Type><DayWorking>0</DayWorking></Exception>`,
        );
      }
      push('      </Exceptions>');
    }
    push('    </Calendar>');
  }
  push('  </Calendars>');

  push('  <Tasks>');
  for (const id of outline.flat) {
    const t = outline.byId.get(id)!;
    const c = schedule.calc.get(id);
    if (!c) continue;
    const summary = outline.isSummary(id);
    const days = summary ? c.duration : t.duration;
    push('    <Task>');
    push(`      <UID>${uid.get(id)}</UID><ID>${t.rowId}</ID><Name>${esc(t.name)}</Name>`);
    push(
      `      <WBS>${outline.wbs.get(id)}</WBS><OutlineNumber>${outline.wbs.get(id)}</OutlineNumber><OutlineLevel>${(outline.depth.get(id) ?? 0) + 1}</OutlineLevel>`,
    );
    push(
      `      <Manual>0</Manual><Summary>${summary ? 1 : 0}</Summary><Milestone>${c.isMilestone && !summary ? 1 : 0}</Milestone>`,
    );
    push(
      `      <Start>${start(c.es)}</Start><Finish>${c.isMilestone && !summary ? start(c.es) : finish(displayFinishDay(c))}</Finish>`,
    );
    push(`      <Duration>${dur(days)}</Duration><DurationFormat>7</DurationFormat>`);
    push(`      <PercentComplete>${Math.round(c.percentComplete)}</PercentComplete>`);
    if (!summary) {
      push(`      <CalendarUID>${calUid.get(t.calendarId) ?? -1}</CalendarUID>`);
      push(`      <ConstraintType>${CONSTRAINT_CODE[t.constraint.type]}</ConstraintType>`);
      if (t.constraint.date)
        push(`      <ConstraintDate>${start(isoToDay(t.constraint.date))}</ConstraintDate>`);
      if (t.actualStart) push(`      <ActualStart>${start(isoToDay(t.actualStart))}</ActualStart>`);
      if (t.actualFinish)
        push(`      <ActualFinish>${finish(isoToDay(t.actualFinish))}</ActualFinish>`);
    }
    if (t.notes) push(`      <Notes>${esc(t.notes)}</Notes>`);
    for (const d of project.dependencies.filter((x) => x.successorId === id)) {
      const pu = uid.get(d.predecessorId);
      if (!pu) continue;
      // LinkLag is in tenths of a minute; 4800 per 8-hour working day. Elapsed days use 14400.
      const lag = d.lagUnit === 'ed' ? d.lag * 14400 : d.lag * 4800;
      push(
        `      <PredecessorLink><PredecessorUID>${pu}</PredecessorUID><Type>${LINK_CODE[d.type]}</Type>` +
          `<CrossProject>0</CrossProject><LinkLag>${lag}</LinkLag><LagFormat>${d.lagUnit === 'ed' ? 8 : 7}</LagFormat></PredecessorLink>`,
      );
    }
    push('    </Task>');
  }
  push('  </Tasks>');
  push('</Project>');
  return lines.join('\n');
}
