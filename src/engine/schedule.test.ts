import { describe, expect, it } from 'vitest';
import { isoToDay } from './dates';
import { scheduleProject } from './schedule';
import { ProjectBuilder } from './testkit';
import { displayFinishDay } from './variance';
import type { ScheduleResult } from './types';

/** Dates relative to the project start (day numbers), exclusive finish. */
function rel(b: ProjectBuilder, r: ScheduleResult, id: string) {
  const c = r.calc.get(id)!;
  const s = isoToDay(b.project.startDate);
  return {
    es: c.es - s,
    ef: c.ef - s,
    ls: c.ls - s,
    lf: c.lf - s,
    tf: c.totalFloat,
    ff: c.freeFloat,
    crit: c.critical,
    c,
  };
}
const finishRel = (b: ProjectBuilder, r: ScheduleResult) =>
  r.projectFinish - isoToDay(b.project.startDate);
const iso = (d: number) => new Date(d * 86_400_000).toISOString().slice(0, 10);

describe('spec test 1: FS network', () => {
  const b = new ProjectBuilder()
    .task('A', 5)
    .task('B', 3)
    .task('C', 4)
    .task('D', 2)
    .link('A', 'B')
    .link('A', 'C')
    .link('B', 'D')
    .link('C', 'D');
  const r = scheduleProject(b.project);

  it('computes early dates', () => {
    expect([rel(b, r, 'A').es, rel(b, r, 'A').ef]).toEqual([0, 5]);
    expect([rel(b, r, 'B').es, rel(b, r, 'B').ef]).toEqual([5, 8]);
    expect([rel(b, r, 'C').es, rel(b, r, 'C').ef]).toEqual([5, 9]);
    expect([rel(b, r, 'D').es, rel(b, r, 'D').ef]).toEqual([9, 11]);
    expect(finishRel(b, r)).toBe(11);
  });
  it('computes float and the critical path', () => {
    expect(rel(b, r, 'B').tf).toBe(1);
    expect(rel(b, r, 'B').ff).toBe(1);
    const critical = ['A', 'B', 'C', 'D'].filter((id) => r.calc.get(id)!.critical);
    expect(critical).toEqual(['A', 'C', 'D']);
  });
});

describe('spec test 2: SS / FF / lead', () => {
  const b = new ProjectBuilder()
    .task('A', 10)
    .task('B', 6)
    .task('C', 4)
    .task('D', 5)
    .link('A', 'B', 'SS', 3)
    .link('A', 'C', 'FF', 1)
    .link('B', 'D', 'FS', -2);
  const r = scheduleProject(b.project);

  it('computes early dates', () => {
    expect([rel(b, r, 'B').es, rel(b, r, 'B').ef]).toEqual([3, 9]);
    expect([rel(b, r, 'C').es, rel(b, r, 'C').ef]).toEqual([7, 11]);
    expect([rel(b, r, 'D').es, rel(b, r, 'D').ef]).toEqual([7, 12]);
    expect(finishRel(b, r)).toBe(12);
  });
  it('computes float and the critical path', () => {
    expect(rel(b, r, 'C').tf).toBe(1);
    expect(['A', 'B', 'D'].every((id) => r.calc.get(id)!.critical)).toBe(true);
    expect(r.calc.get('C')!.critical).toBe(false);
  });
});

describe('spec test 3: SF', () => {
  it('B SF A+4 runs 1–4', () => {
    const b = new ProjectBuilder().task('A', 5).task('B', 3).link('A', 'B', 'SF', 4);
    const r = scheduleProject(b.project);
    expect([rel(b, r, 'B').es, rel(b, r, 'B').ef]).toEqual([1, 4]);
  });
});

describe('spec test 4: cycle', () => {
  it('reports a cycle containing A, B and C', () => {
    const b = new ProjectBuilder()
      .task('A', 1)
      .task('B', 1)
      .task('C', 1)
      .link('A', 'B')
      .link('B', 'C')
      .link('C', 'A');
    const r = scheduleProject(b.project);
    expect(r.cycles).toHaveLength(1);
    expect(new Set(r.cycles[0].taskIds)).toEqual(new Set(['A', 'B', 'C']));
    expect(r.cycles[0].message).toMatch(/^Circular dependency: \d → \d → \d → \d$/);
    // A schedule is still produced.
    expect(r.calc.size).toBe(3);
  });
});

describe('spec test 5: Standard calendar with holiday', () => {
  const b = new ProjectBuilder({
    calendar: 'standard',
    start: '2027-01-04',
    holidays: ['2027-01-18'],
  })
    .task('A', 10)
    .task('B', 1)
    .link('A', 'B');
  const r = scheduleProject(b.project);
  it('A(10) displays Mon Jan 4 – Fri Jan 15', () => {
    const a = r.calc.get('A')!;
    expect(a.earlyStart).toBe('2027-01-04');
    expect(iso(displayFinishDay(a))).toBe('2027-01-15');
  });
  it('B(1) FS A starts Tue Jan 19 (skips weekend and the Jan 18 holiday)', () => {
    expect(r.calc.get('B')!.earlyStart).toBe('2027-01-19');
  });
});

describe('spec test 6: elapsed lag', () => {
  it('A(5) Mon Jan 4; B FS A+3ed starts Tue Jan 12 (see PLAN.md)', () => {
    const b = new ProjectBuilder({ calendar: 'standard', start: '2027-01-04' })
      .task('A', 5)
      .task('B', 1)
      .link('A', 'B', 'FS', 3, 'ed');
    const r = scheduleProject(b.project);
    expect(iso(displayFinishDay(r.calc.get('A')!))).toBe('2027-01-08');
    expect(r.calc.get('A')!.earlyFinish).toBe('2027-01-09'); // exclusive
    expect(r.calc.get('B')!.earlyStart).toBe('2027-01-12');
  });
});

describe('spec test 7: MSO conflict', () => {
  it('holds the date, flags the violation and produces negative float', () => {
    const b = new ProjectBuilder().task('A', 10).task('B', 2).link('A', 'B');
    b.constrain('B', 'MSO', b.day(5));
    const r = scheduleProject(b.project);
    const B = rel(b, r, 'B');
    expect(B.es).toBe(5);
    expect(B.ef).toBe(7);
    expect(B.c.constraintViolated).toBe(true);
    expect(B.tf).toBeLessThan(0);
    expect(B.tf).toBe(-5);
    expect(rel(b, r, 'A').tf).toBe(-5);
  });
});

describe('spec test 8: progress', () => {
  it('schedules remaining work from the status date', () => {
    const b = new ProjectBuilder().task('A', 10).task('B', 2).link('A', 'B');
    b.project.statusDate = b.day(6);
    const a = b.project.tasks.find((t) => t.id === 'A')!;
    a.actualStart = b.day(0);
    a.percentComplete = 30;
    const r = scheduleProject(b.project);
    const A = rel(b, r, 'A');
    expect(A.es).toBe(0);
    expect(A.ef).toBe(13);
    expect(A.c.remainingDuration).toBe(7);
    expect(rel(b, r, 'B').es).toBe(13);
  });
});

// ------------------------------------------------------------------- edge cases

describe('working-day lags on the Standard calendar', () => {
  const std = () => new ProjectBuilder({ calendar: 'standard', start: '2027-01-04' });

  it('FS +2d over a weekend', () => {
    const b = std().task('A', 5).task('B', 1).link('A', 'B', 'FS', 2);
    expect(scheduleProject(b.project).calc.get('B')!.earlyStart).toBe('2027-01-13');
  });
  it('FS -2d lead overlaps the last two days', () => {
    const b = std().task('A', 5).task('B', 1).link('A', 'B', 'FS', -2);
    expect(scheduleProject(b.project).calc.get('B')!.earlyStart).toBe('2027-01-07');
  });
  it('FF +1d makes B finish one working day after A', () => {
    const b = std().task('A', 5).task('B', 2).link('A', 'B', 'FF', 1);
    const c = scheduleProject(b.project).calc.get('B')!;
    expect(iso(displayFinishDay(c))).toBe('2027-01-11');
    expect(c.earlyStart).toBe('2027-01-08');
  });
  it('1 elapsed day over a weekend costs nothing (finish is Sat 00:00)', () => {
    const b = std().task('A', 5).task('B', 1).link('A', 'B', 'FS', 1, 'ed');
    expect(scheduleProject(b.project).calc.get('B')!.earlyStart).toBe('2027-01-11');
  });
  it('a start date on a weekend snaps forward', () => {
    const b = new ProjectBuilder({ calendar: 'standard', start: '2027-01-02' }).task('A', 1);
    expect(scheduleProject(b.project).calc.get('A')!.earlyStart).toBe('2027-01-04');
  });
  it('mixed calendars: 7-day task inside a Standard project', () => {
    const b = std().task('A', 5).task('E', 30, { calendarId: '7day' }).task('F', 1);
    b.link('A', 'E').link('E', 'F');
    const r = scheduleProject(b.project);
    expect(r.calc.get('E')!.earlyStart).toBe('2027-01-09'); // Saturday is a working day for E
    expect(iso(displayFinishDay(r.calc.get('E')!))).toBe('2027-02-07'); // Sunday
    expect(r.calc.get('F')!.earlyStart).toBe('2027-02-08');
    expect(['A', 'E', 'F'].every((id) => r.calc.get(id)!.critical)).toBe(true);
  });
});

describe('milestones', () => {
  it('a milestone after a Friday finish sits on Monday with zero float', () => {
    const b = new ProjectBuilder({ calendar: 'standard' }).task('A', 5).task('M', 0).task('B', 1);
    b.link('A', 'M').link('M', 'B');
    const r = scheduleProject(b.project);
    const m = r.calc.get('M')!;
    expect(m.isMilestone).toBe(true);
    expect(m.earlyStart).toBe('2027-01-11');
    expect(m.es).toBe(m.ef);
    expect(m.totalFloat).toBe(0);
    expect(r.calc.get('A')!.totalFloat).toBe(0);
    expect(r.calc.get('B')!.earlyStart).toBe('2027-01-11');
  });
  it('a finish milestone does not create float on its predecessor', () => {
    const b = new ProjectBuilder({ calendar: 'standard' }).task('A', 5).task('M', 0).link('A', 'M');
    const r = scheduleProject(b.project);
    expect(r.calc.get('A')!.totalFloat).toBe(0);
    expect(r.calc.get('M')!.critical).toBe(true);
  });
});

describe('constraints', () => {
  it('SNET pushes the start', () => {
    const b = new ProjectBuilder().task('A', 3);
    b.constrain('A', 'SNET', b.day(4));
    expect(rel(b, scheduleProject(b.project), 'A').es).toBe(4);
  });
  it('FNET pushes the finish (inclusive date)', () => {
    const b = new ProjectBuilder().task('A', 3);
    b.constrain('A', 'FNET', b.day(9));
    const A = rel(b, scheduleProject(b.project), 'A');
    expect([A.es, A.ef]).toEqual([7, 10]);
  });
  it('SNLT violated gives negative float and a flag', () => {
    const b = new ProjectBuilder().task('A', 10).task('B', 2).link('A', 'B');
    b.constrain('B', 'SNLT', b.day(6));
    const r = scheduleProject(b.project);
    expect(rel(b, r, 'B').es).toBe(10);
    expect(rel(b, r, 'B').tf).toBe(-4);
    expect(rel(b, r, 'A').tf).toBe(-4);
    expect(r.calc.get('B')!.constraintViolated).toBe(true);
  });
  it('FNLT limits late dates without moving early dates', () => {
    const b = new ProjectBuilder().task('A', 10).task('Z', 20);
    b.constrain('A', 'FNLT', b.day(7)); // must finish by end of day 7 → point 8
    const r = scheduleProject(b.project);
    expect(rel(b, r, 'A').ef).toBe(10);
    expect(rel(b, r, 'A').tf).toBe(-2);
    expect(r.calc.get('A')!.constraintViolated).toBe(true);
  });
  it('MSO not in conflict pins the task with zero float', () => {
    const b = new ProjectBuilder().task('A', 2).task('Z', 20);
    b.constrain('A', 'MSO', b.day(5));
    const r = scheduleProject(b.project);
    expect(rel(b, r, 'A').es).toBe(5);
    expect(rel(b, r, 'A').tf).toBe(0);
    expect(r.calc.get('A')!.constraintViolated).toBeUndefined();
  });
  it('MFO conflict holds the finish and flags', () => {
    const b = new ProjectBuilder().task('A', 10).task('B', 2).link('A', 'B');
    b.constrain('B', 'MFO', b.day(7)); // finish inclusive day 7 → 6–8
    const r = scheduleProject(b.project);
    expect([rel(b, r, 'B').es, rel(b, r, 'B').ef]).toEqual([6, 8]);
    expect(r.calc.get('B')!.constraintViolated).toBe(true);
    expect(rel(b, r, 'B').tf).toBe(-4);
  });
});

describe('summary tasks', () => {
  const build = () =>
    new ProjectBuilder()
      .task('S', 0)
      .task('A', 4, { parentId: 'S' })
      .task('B', 6, { parentId: 'S' })
      .task('X', 2)
      .link('A', 'B');

  it('rolls up dates, duration and duration-weighted % complete', () => {
    const b = build();
    b.project.tasks.find((t) => t.id === 'A')!.percentComplete = 100;
    b.project.tasks.find((t) => t.id === 'A')!.actualStart = b.day(0);
    b.project.tasks.find((t) => t.id === 'A')!.actualFinish = b.day(3);
    const r = scheduleProject(b.project);
    const S = rel(b, r, 'S');
    expect(S.c.isSummary).toBe(true);
    expect([S.es, S.ef]).toEqual([0, 10]);
    expect(S.c.duration).toBe(10);
    expect(S.c.percentComplete).toBe(40); // (4*100 + 6*0) / 10
  });
  it('a link from a summary applies to all of its children', () => {
    const b = build().link('S', 'X');
    const r = scheduleProject(b.project);
    expect(rel(b, r, 'X').es).toBe(10);
  });
  it('a link into a summary pushes all of its children', () => {
    const b = new ProjectBuilder()
      .task('P', 5)
      .task('S', 0)
      .task('A', 2, { parentId: 'S' })
      .task('B', 3, { parentId: 'S' })
      .link('P', 'S');
    const r = scheduleProject(b.project);
    expect(rel(b, r, 'A').es).toBe(5);
    expect(rel(b, r, 'B').es).toBe(5);
    expect(rel(b, r, 'S').es).toBe(5);
  });
  it('a link between a task and its own summary is a cycle', () => {
    const b = build().link('S', 'A');
    const r = scheduleProject(b.project);
    expect(r.cycles.length).toBeGreaterThan(0);
    expect(r.cycles[0].message).toMatch(/summary task 1/);
  });
});

describe('progress and status date', () => {
  it('not-started tasks cannot start before the status date', () => {
    const b = new ProjectBuilder().task('A', 3);
    b.project.statusDate = b.day(4);
    expect(rel(b, scheduleProject(b.project), 'A').es).toBe(4);
  });
  it('completed tasks keep their actual dates regardless of logic', () => {
    const b = new ProjectBuilder().task('A', 5).task('B', 3).link('A', 'B');
    const B = b.project.tasks.find((t) => t.id === 'B')!;
    Object.assign(B, { percentComplete: 100, actualStart: b.day(1), actualFinish: b.day(2) });
    b.project.statusDate = b.day(3);
    const r = scheduleProject(b.project);
    expect([rel(b, r, 'B').es, rel(b, r, 'B').ef]).toEqual([1, 3]);
    expect(r.calc.get('B')!.critical).toBe(false);
  });
  it('retained logic: remaining work waits for an unfinished predecessor', () => {
    const b = new ProjectBuilder().task('P', 10).task('A', 6).link('P', 'A');
    const A = b.project.tasks.find((t) => t.id === 'A')!;
    Object.assign(A, { percentComplete: 50, actualStart: b.day(2) }); // out of sequence
    b.project.statusDate = b.day(4);
    const r = scheduleProject(b.project);
    expect(rel(b, r, 'A').es).toBe(2);
    // P has not started, so the status date pushes it to 4–14; A's 3 remaining days follow.
    expect(rel(b, r, 'P').es).toBe(4);
    expect(rel(b, r, 'A').ef).toBe(17);
  });
});

describe('float details', () => {
  it('critical float threshold widens the critical set', () => {
    const b = new ProjectBuilder()
      .task('A', 5)
      .task('B', 3)
      .task('C', 4)
      .task('D', 2)
      .link('A', 'B')
      .link('A', 'C')
      .link('B', 'D')
      .link('C', 'D');
    b.project.criticalFloatThreshold = 1;
    expect(scheduleProject(b.project).calc.get('B')!.critical).toBe(true);
  });
  it('free float is zero when total float is shared down a chain', () => {
    const b = new ProjectBuilder()
      .task('A', 10)
      .task('B', 2)
      .task('C', 2)
      .task('D', 1)
      .link('A', 'D')
      .link('B', 'C')
      .link('C', 'D');
    const r = scheduleProject(b.project);
    expect(rel(b, r, 'B').tf).toBe(6);
    expect(rel(b, r, 'B').ff).toBe(0);
    expect(rel(b, r, 'C').ff).toBe(6);
  });
});
