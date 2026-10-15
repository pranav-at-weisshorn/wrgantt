import { isoToDay, weekday } from './dates';
import type { Calendar } from './types';

/** Covered range: 1990-01-01 … ~2150. Anything outside is clamped. */
const ANCHOR = isoToDay('1990-01-01');
const SPAN = 160 * 366;

/**
 * Working-time arithmetic on one calendar.
 *
 * A *point* `t` is 00:00 of day `t`. `cum(t)` = number of working days strictly before `t`.
 * `workDay(k)` = the day number of the k-th working day (0-based from the anchor).
 * Start points are always working days; finish points are exclusive (last working day + 1).
 */
export class WorkCalendar {
  readonly id: string;
  private readonly cumArr: Int32Array;
  private readonly work: Int32Array;
  private readonly holidays: Set<number>;
  private readonly weekdays: boolean[];

  constructor(cal: Calendar) {
    this.id = cal.id;
    this.weekdays = Array.from({ length: 7 }, (_, i) => cal.workingWeekdays.includes(i));
    // A calendar with no working weekdays would make every computation diverge.
    if (!this.weekdays.some(Boolean)) this.weekdays.fill(true);
    this.holidays = new Set();
    for (const h of cal.holidays) {
      try {
        this.holidays.add(isoToDay(h));
      } catch {
        /* ignore malformed holiday */
      }
    }
    this.cumArr = new Int32Array(SPAN + 1);
    const work: number[] = [];
    let c = 0;
    for (let i = 0; i < SPAN; i++) {
      this.cumArr[i] = c;
      const d = ANCHOR + i;
      if (this.isWorkingRaw(d)) {
        work.push(d);
        c++;
      }
    }
    this.cumArr[SPAN] = c;
    // Guard against a calendar whose holidays cover everything.
    if (work.length === 0) work.push(ANCHOR);
    this.work = Int32Array.from(work);
  }

  private isWorkingRaw(d: number): boolean {
    return this.weekdays[weekday(d)] && !this.holidays.has(d);
  }

  isWorking(d: number): boolean {
    return this.isWorkingRaw(d);
  }

  cum(t: number): number {
    const i = t - ANCHOR;
    if (i <= 0) return 0;
    if (i >= SPAN) return this.cumArr[SPAN];
    return this.cumArr[i];
  }

  workDay(k: number): number {
    if (k < 0) return this.work[0];
    if (k >= this.work.length) return this.work[this.work.length - 1];
    return this.work[k];
  }

  /** First working day at or after `t`. */
  snap(t: number): number {
    return this.workDay(this.cum(t));
  }

  /** Last working day at or before `t`. */
  snapBack(t: number): number {
    return this.workDay(this.cum(t + 1) - 1);
  }

  /** Exclusive finish of a task of `n` working days starting at (or snapped from) `start`. */
  addDuration(start: number, n: number): number {
    const s = this.snap(start);
    if (n <= 0) return s;
    return this.workDay(this.cum(s) + n - 1) + 1;
  }

  /** Earliest start of an `n`-day task that finishes no earlier than point `f` (working time). */
  startForFinish(f: number, n: number): number {
    if (n <= 0) return this.snap(f);
    return this.workDay(this.cum(f) - n);
  }

  /** Latest normalised finish point (last working day + 1) at or before point `b`. */
  latestFinishLE(b: number): number {
    return this.workDay(this.cum(b) - 1) + 1;
  }

  /** Latest working-day start at or before point `b`. */
  latestStartLE(b: number): number {
    return this.snapBack(b);
  }

  /** Working days in [a, b). Negative if b < a. */
  between(a: number, b: number): number {
    return this.cum(b) - this.cum(a);
  }

  /** Start of the lag-th working day after (lag < 0: before) point `t`. */
  shift(t: number, lag: number): number {
    return this.workDay(this.cum(t) + lag);
  }

  /** Latest point `t` such that `shift(t, lag) <= x`. */
  invShift(x: number, lag: number): number {
    return this.workDay(this.cum(x + 1) - 1 - lag);
  }
}

const cache = new Map<string, WorkCalendar>();

export function getWorkCalendar(cal: Calendar): WorkCalendar {
  const key = `${cal.id}|${[...cal.workingWeekdays].sort().join(',')}|${[...cal.holidays].sort().join(',')}`;
  let wc = cache.get(key);
  if (!wc) {
    if (cache.size > 50) cache.clear();
    wc = new WorkCalendar(cal);
    cache.set(key, wc);
  }
  return wc;
}

export const STANDARD_CALENDAR_ID = 'standard';
export const SEVEN_DAY_CALENDAR_ID = '7day';

export function defaultCalendars(): Calendar[] {
  return [
    { id: STANDARD_CALENDAR_ID, name: 'Standard', workingWeekdays: [1, 2, 3, 4, 5], holidays: [] },
    {
      id: SEVEN_DAY_CALENDAR_ID,
      name: '7-day',
      workingWeekdays: [0, 1, 2, 3, 4, 5, 6],
      holidays: [],
    },
  ];
}
