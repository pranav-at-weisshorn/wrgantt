import type { ConstraintType, DepType, LagUnit } from './types';

/** Full names shown to users; the short codes are internal only. */
export const DEP_TYPE_LABEL: Record<DepType, string> = {
  FS: 'Finish-to-Start',
  SS: 'Start-to-Start',
  FF: 'Finish-to-Finish',
  SF: 'Start-to-Finish',
};

export const DEP_TYPE_HELP: Record<DepType, string> = {
  FS: 'This task starts after the other finishes',
  SS: 'This task starts after the other starts',
  FF: 'This task finishes after the other finishes',
  SF: 'This task finishes after the other starts',
};

export const LAG_UNIT_LABEL: Record<LagUnit, string> = {
  wd: 'working days',
  ed: 'calendar days',
};

export const CONSTRAINT_LABEL: Record<ConstraintType, string> = {
  ASAP: 'As soon as possible',
  SNET: 'Start no earlier than',
  SNLT: 'Start no later than',
  FNET: 'Finish no earlier than',
  FNLT: 'Finish no later than',
  MSO: 'Must start on',
  MFO: 'Must finish on',
};

/** "1 day", "10 days", "-2 days". */
export function days(n: number, unit = 'day'): string {
  return `${n} ${unit}${Math.abs(n) === 1 ? '' : 's'}`;
}

/** "+3 days", "-2 days", "0 days". */
export function signedDays(n: number): string {
  return `${n > 0 ? '+' : ''}${days(n)}`;
}

/** "+10 working days", "-2 working days", "+30 calendar days". */
export function lagText(lag: number, unit: LagUnit): string {
  const word = unit === 'ed' ? 'calendar day' : 'working day';
  return `${lag > 0 ? '+' : '-'}${days(Math.abs(lag), word)}`;
}
