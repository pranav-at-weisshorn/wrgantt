import { describe, expect, it } from 'vitest';
import { parseDuration } from '../ui/format';
import { defaultCalendars } from './calendar';
import { parseLinkList } from './links';
import { scheduleProject } from './schedule';
import { ProjectBuilder } from './testkit';
import { durationUnits, workingDaysPerWeek } from './units';

describe('day counts follow the project calendar', () => {
  it('a week is the working days per week, a month is 30 calendar days', () => {
    expect(durationUnits(7)).toEqual({ week: 7, month: 30 });
    expect(durationUnits(5)).toEqual({ week: 5, month: 21 });
    expect(durationUnits(6)).toEqual({ week: 6, month: 26 });
  });

  it('typed durations on a seven-day calendar', () => {
    expect(parseDuration('1 month', 7)).toBe(30);
    expect(parseDuration('2 months', 7)).toBe(60);
    expect(parseDuration('2 weeks', 7)).toBe(14);
    expect(parseDuration('14', 7)).toBe(14);
    expect(parseDuration('14 days', 7)).toBe(14);
  });

  it('typed durations on a Monday-to-Friday calendar', () => {
    expect(parseDuration('2 weeks', 5)).toBe(10);
    expect(parseDuration('1 month', 5)).toBe(21);
  });

  it('lags in weeks', () => {
    expect(parseLinkList('5 +2 weeks', 7).links[0].lag).toBe(14);
    expect(parseLinkList('5 +2 weeks', 5).links[0].lag).toBe(10);
  });

  it('reads the working days per week from the project calendar', () => {
    const cals = defaultCalendars();
    expect(workingDaysPerWeek({ calendars: cals, projectCalendarId: 'standard' })).toBe(5);
    expect(workingDaysPerWeek({ calendars: cals, projectCalendarId: '7day' })).toBe(7);
  });
});

describe('summary duration matches its displayed dates', () => {
  it('a phase that ends with a milestone counts the milestone day', () => {
    // 7-day calendar: A runs days 0-9 (10 days), then milestone M on day 10.
    const b = new ProjectBuilder()
      .task('S', 0)
      .task('A', 10, { parentId: 'S' })
      .task('M', 0, { parentId: 'S' })
      .link('A', 'M');
    const c = scheduleProject(b.project).calc.get('S')!;
    expect(c.finishDay - c.es + 1).toBe(11); // start through displayed finish, inclusive
    expect(c.duration).toBe(11);
  });

  it('a phase of work tasks is unchanged', () => {
    const b = new ProjectBuilder()
      .task('S', 0)
      .task('A', 10, { parentId: 'S' })
      .task('B', 5, { parentId: 'S' })
      .link('A', 'B');
    expect(scheduleProject(b.project).calc.get('S')!.duration).toBe(15);
  });

  it('a phase of only milestones has no duration', () => {
    const b = new ProjectBuilder().task('S', 0).task('M', 0, { parentId: 'S' });
    expect(scheduleProject(b.project).calc.get('S')!.duration).toBe(0);
  });
});
