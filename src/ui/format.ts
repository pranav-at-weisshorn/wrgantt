import { format, isValid, parse } from 'date-fns';
import { dayToLocalDate, isoToDay, localDateToDay, dayToIso } from '../engine';

export const DATE_FMT = 'EEE dd MMM yy';

export function fmtDay(day: number | null | undefined): string {
  if (day === null || day === undefined || !Number.isFinite(day)) return '';
  return format(dayToLocalDate(day), DATE_FMT);
}

export function fmtIso(iso: string | undefined): string {
  if (!iso) return '';
  try {
    return fmtDay(isoToDay(iso));
  } catch {
    return iso;
  }
}

export function fmtLong(day: number): string {
  return format(dayToLocalDate(day), 'EEE d MMM yyyy');
}

const DATE_INPUT_FORMATS = [
  'yyyy-MM-dd',
  'dd.MM.yyyy',
  'd.M.yyyy',
  'dd.MM.yy',
  'd.M.yy',
  'dd/MM/yyyy',
  'd/M/yyyy',
  'dd/MM/yy',
  'EEE dd MMM yy',
  'EEE d MMM yy',
  'EEE dd MMM yyyy',
  'EEE d MMM yyyy',
  'dd MMM yy',
  'd MMM yy',
  'd MMM yyyy',
  'MMM d yyyy',
  'MMM d, yyyy',
];

/** Parse a user-typed date. Returns ISO or null. */
export function parseDateInput(text: string): string | null {
  const s = text.trim();
  if (!s) return null;
  const ref = new Date(2000, 0, 1);
  for (const f of DATE_INPUT_FORMATS) {
    const d = parse(s, f, ref);
    if (isValid(d) && d.getFullYear() > 1900 && d.getFullYear() < 2200) {
      return dayToIso(localDateToDay(d));
    }
  }
  return null;
}

/** Parse "10", "10d", "2w", "1mo", "0". Returns working days or null. */
export function parseDuration(text: string): number | null {
  const m = /^\s*(\d+(?:\.\d+)?)\s*(d|days?|w|wks?|weeks?|mo|mons?|months?)?\s*$/i.exec(text);
  if (!m) return null;
  let v = parseFloat(m[1]);
  const u = (m[2] ?? 'd').toLowerCase();
  if (u.startsWith('w')) v *= 5;
  else if (u.startsWith('mo')) v *= 20;
  return Math.round(v);
}

export function fmtDuration(d: number): string {
  return `${d}d`;
}

export function fmtSigned(n: number | null | undefined): string {
  if (n === null || n === undefined) return '';
  return n > 0 ? `+${n}d` : `${n}d`;
}
