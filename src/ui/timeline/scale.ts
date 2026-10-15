import { format } from 'date-fns';
import { dayToLocalDate, weekday } from '../../engine';
import type { Zoom } from '../../store/prefs';

export const PX_PER_DAY: Record<Zoom, number> = { day: 26, week: 7, month: 2.2, quarter: 0.75 };

export interface Scale {
  zoom: Zoom;
  ppd: number;
  start: number;
  end: number;
  width: number;
  x: (day: number) => number;
  dayAt: (x: number) => number;
}

const MS = 86_400_000;
const ymd = (day: number) => {
  const d = new Date(day * MS);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate() };
};
const dayOf = (y: number, m: number, d = 1) => Math.round(Date.UTC(y, m, d) / MS);

export const startOfWeek = (day: number) => day - ((weekday(day) + 6) % 7);
export const startOfMonth = (day: number) => {
  const { y, m } = ymd(day);
  return dayOf(y, m);
};
export const startOfQuarter = (day: number) => {
  const { y, m } = ymd(day);
  return dayOf(y, m - (m % 3));
};
export const startOfYear = (day: number) => dayOf(ymd(day).y, 0);
const addMonths = (day: number, n: number) => {
  const { y, m } = ymd(day);
  return dayOf(y, m + n);
};

type Unit = 'day' | 'week' | 'month' | 'quarter' | 'year';

const startOf: Record<Unit, (d: number) => number> = {
  day: (d) => d,
  week: startOfWeek,
  month: startOfMonth,
  quarter: startOfQuarter,
  year: startOfYear,
};
const next: Record<Unit, (d: number) => number> = {
  day: (d) => d + 1,
  week: (d) => d + 7,
  month: (d) => addMonths(d, 1),
  quarter: (d) => addMonths(d, 3),
  year: (d) => addMonths(d, 12),
};

const PAD: Record<Zoom, number> = { day: 14, week: 28, month: 62, quarter: 184 };
const ALIGN: Record<Zoom, Unit> = { day: 'week', week: 'month', month: 'quarter', quarter: 'year' };

export function makeScale(zoom: Zoom, minDay: number, maxDay: number): Scale {
  const ppd = PX_PER_DAY[zoom];
  const unit = ALIGN[zoom];
  const start = startOf[unit](minDay - PAD[zoom]);
  const end = next[unit](startOf[unit](maxDay + PAD[zoom]));
  return {
    zoom,
    ppd,
    start,
    end,
    width: Math.ceil((end - start) * ppd),
    x: (day) => (day - start) * ppd,
    dayAt: (x) => start + x / ppd,
  };
}

export interface Tick {
  day: number;
  end: number;
  label: string;
}

const LETTER = 'SMTWTFS';

function label(unit: Unit, day: number, tier: 'top' | 'bottom'): string {
  const date = dayToLocalDate(day);
  switch (unit) {
    case 'day':
      return `${LETTER[weekday(day)]} ${date.getDate()}`;
    case 'week':
      return tier === 'top' ? `w/c ${format(date, 'dd MMM yyyy')}` : format(date, 'd MMM');
    case 'month':
      return tier === 'top' ? format(date, 'MMMM yyyy') : format(date, 'MMM');
    case 'quarter': {
      const q = Math.floor(date.getMonth() / 3) + 1;
      return tier === 'top' ? `Q${q} ${date.getFullYear()}` : `Q${q}`;
    }
    case 'year':
      return String(date.getFullYear());
  }
}

export const TIERS: Record<Zoom, { top: Unit; bottom: Unit }> = {
  day: { top: 'week', bottom: 'day' },
  week: { top: 'month', bottom: 'week' },
  month: { top: 'quarter', bottom: 'month' },
  quarter: { top: 'year', bottom: 'quarter' },
};

/** Ticks of `unit` that intersect [from, to). */
export function ticks(unit: Unit, from: number, to: number, tier: 'top' | 'bottom'): Tick[] {
  const out: Tick[] = [];
  let d = startOf[unit](from);
  for (let guard = 0; d < to && guard < 5000; guard++) {
    const e = next[unit](d);
    out.push({ day: d, end: e, label: label(unit, d, tier) });
    d = e;
  }
  return out;
}
