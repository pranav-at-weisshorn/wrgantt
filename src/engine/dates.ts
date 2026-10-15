/**
 * Day numbers: integer days since 1970-01-01 (UTC). All engine arithmetic uses them so there
 * are no time-zone or DST surprises.
 */

const MS_PER_DAY = 86_400_000;

export function isoToDay(iso: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) throw new Error(`Invalid ISO date: ${iso}`);
  return Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / MS_PER_DAY);
}

export function dayToIso(day: number): string {
  const d = new Date(day * MS_PER_DAY);
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
  const da = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${mo}-${da}`;
}

/** 0 = Sunday … 6 = Saturday. 1970-01-01 was a Thursday. */
export function weekday(day: number): number {
  return (((day + 4) % 7) + 7) % 7;
}

/** A local-time Date at midnight for display with date-fns. */
export function dayToLocalDate(day: number): Date {
  const d = new Date(day * MS_PER_DAY);
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export function localDateToDay(date: Date): number {
  return Math.round(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / MS_PER_DAY);
}

export function todayDay(): number {
  return localDateToDay(new Date());
}

export function isValidIso(iso: string | undefined): iso is string {
  if (!iso) return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return false;
  return dayToIso(isoToDay(iso)) === iso;
}

/** Next Monday strictly after `day` (or `day` itself if `inclusive` and it is a Monday). */
export function nextMonday(day: number, inclusive = false): number {
  const wd = weekday(day);
  if (inclusive && wd === 1) return day;
  const delta = (8 - wd) % 7 || 7;
  return day + delta;
}
