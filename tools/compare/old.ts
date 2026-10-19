/**
 * Reads the "Schedule" tab of the old Villa Felstead Excel schedule (read-only).
 *
 * Layout of that tab: row 4 is the header; activities run from row 5 down to the "SUMMARY"
 * block. Columns: A activity, B/C/D Baseline 0 (duration, start, finish), E/F/G Baseline 1,
 * H/I/J Actuals and Forecast, K % completion. Summary rows compute their dates with
 * MIN()/MAX() over the rows below them; rows without any date at outline level 1 are group
 * labels ("Facade", "Landscape", …) for the rows that follow. Hidden rows are skipped.
 */
import * as XLSX from 'xlsx';

export interface OldRow {
  /** Row number in the Excel sheet. */
  row: number;
  name: string;
  /** Phase › sub-phase › group label (without the row's own name). */
  path: string[];
  /** Top-level phase (Design, Approval, Construction, …). */
  phase: string;
  isSummary: boolean;
  /** Excel row numbers of the rows a summary covers. */
  childRows: number[];
  /** Day numbers (days since 1970-01-01); finishes are the dates shown (inclusive). */
  r0: { start: number | null; finish: number | null };
  r1: { start: number | null; finish: number | null };
  forecast: { start: number | null; finish: number | null };
  /** 0–1, or null when blank. */
  percent: number | null;
  /** Problems found in this row (e.g. a formula that yields an impossible date). */
  issues: string[];
}

export interface OldSchedule {
  sheet: string;
  rows: OldRow[];
  /** Project-level figures from row 3 of the sheet. */
  forecastFinish: number | null;
  r1Finish: number | null;
}

const SERIAL_EPOCH = 25569; // Excel serial of 1970-01-01

function cell(ws: XLSX.WorkSheet, col: string, row: number) {
  return ws[`${col}${row}`] as XLSX.CellObject | undefined;
}

function dayOf(ws: XLSX.WorkSheet, col: string, row: number, issues: string[]): number | null {
  const c = cell(ws, col, row);
  if (!c || c.v === undefined || c.v === '' || c.t === 'e') return null;
  let serial: number | null = null;
  if (typeof c.v === 'number') serial = c.v;
  else if (c.v instanceof Date) serial = c.v.getTime() / 86_400_000 + SERIAL_EPOCH;
  if (serial === null || !Number.isFinite(serial)) return null;
  const day = Math.round(serial) - SERIAL_EPOCH;
  const year = new Date(day * 86_400_000).getUTCFullYear();
  if (year < 2020 || year > 2035) {
    issues.push(
      `${col}${row} gives an impossible date (${new Date(day * 86_400_000).toISOString().slice(0, 10)})` +
        (c.f ? ` from the formula =${c.f}` : ''),
    );
    return null;
  }
  return day;
}

function text(ws: XLSX.WorkSheet, col: string, row: number): string {
  const c = cell(ws, col, row);
  return c && c.v !== undefined ? String(c.v).replace(/\s+/g, ' ').trim() : '';
}

/** Row range of a MIN(X12:X40) formula in any of the start columns. */
function summaryRange(ws: XLSX.WorkSheet, row: number): [number, number] | null {
  for (const col of ['C', 'F', 'I']) {
    const f = cell(ws, col, row)?.f;
    const m = f && /^MIN\(\$?[A-Z]+\$?(\d+):\$?[A-Z]+\$?(\d+)\)$/i.exec(f.replace(/\s/g, ''));
    if (m) return [Number(m[1]), Number(m[2])];
  }
  return null;
}

export function readOldSchedule(
  data: Uint8Array,
  statusDay: number,
  sheetName = 'Schedule',
): OldSchedule {
  const wb = XLSX.read(data, { type: 'array', cellFormula: true, cellStyles: true });
  const ws = wb.Sheets[sheetName];
  if (!ws) throw new Error(`The workbook has no "${sheetName}" tab`);
  const meta = ws['!rows'] ?? [];
  const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1');

  // Last activity row: just above the "SUMMARY" block (or the end of the sheet).
  let last = range.e.r + 1;
  for (let r = 5; r <= range.e.r + 1; r++) {
    if (/^summary$/i.test(text(ws, 'A', r))) {
      last = r - 1;
      break;
    }
  }

  // Summaries and their ranges, so every row gets its smallest enclosing summary as parent.
  const ranges = new Map<number, [number, number]>();
  for (let r = 5; r <= last; r++) {
    const rg = summaryRange(ws, r);
    // A summary's MIN() sometimes skips the first row below it; it still owns that row.
    if (rg) ranges.set(r, [Math.min(rg[0], r + 1), rg[1]]);
  }
  const parentOf = (r: number): number | null => {
    let best: number | null = null;
    let bestSize = Infinity;
    for (const [s, [a, b]] of ranges) {
      if (s === r || r < a || r > b) continue;
      if (b - a < bestSize) {
        best = s;
        bestSize = b - a;
      }
    }
    return best;
  };

  const rows: OldRow[] = [];
  const byRow = new Map<number, OldRow>();
  let label = '';
  let labelParent: number | null = null;
  for (let r = 5; r <= last; r++) {
    const name = text(ws, 'A', r);
    if (!name || meta[r - 1]?.hidden) continue;
    const issues: string[] = [];
    const r0 = { start: dayOf(ws, 'C', r, issues), finish: dayOf(ws, 'D', r, issues) };
    const r1 = { start: dayOf(ws, 'F', r, issues), finish: dayOf(ws, 'G', r, issues) };
    const forecast = { start: dayOf(ws, 'I', r, issues), finish: dayOf(ws, 'J', r, issues) };
    const hasDate = [r0, r1, forecast].some((d) => d.start !== null || d.finish !== null);
    const level = meta[r - 1]?.level ?? 0;
    const parent = parentOf(r);

    if (!hasDate && !ranges.has(r) && issues.length === 0) {
      // A group label at level 1 ("Facade", "Landscape", …); deeper rows without dates are
      // drawing lists with nothing to compare.
      if (level <= 1) {
        label = name;
        labelParent = parent;
      }
      continue;
    }
    if (parent !== labelParent) label = '';

    const path: string[] = [];
    for (let p = parent; p !== null; p = parentOf(p))
      path.unshift(byRow.get(p)?.name ?? text(ws, 'A', p));
    if (label && !ranges.has(r)) path.push(label);

    const k = cell(ws, 'K', r)?.v;
    // Only 0–100 % counts; one row holds a date in this column.
    const percent = typeof k === 'number' && k >= 0 && k <= 1 ? k : null;
    if (typeof k === 'number' && percent === null)
      issues.push(`K${r} (% completion) holds ${k > 2000 ? 'a date' : k}, not a percentage`);
    const rg = ranges.get(r);
    const row: OldRow = {
      row: r,
      name,
      path,
      phase: path[0] ?? name,
      isSummary: !!rg,
      childRows: [],
      r0,
      r1,
      forecast,
      percent,
      issues,
    };
    if (rg) label = '';
    if (!rg && percent === null && forecast.finish !== null && forecast.finish < statusDay)
      issues.push('Dates are before the snapshot date but the row is not marked complete');
    rows.push(row);
    byRow.set(r, row);
  }
  for (const row of rows) {
    const rg = ranges.get(row.row);
    if (rg) row.childRows = rows.filter((x) => x.row >= rg[0] && x.row <= rg[1]).map((x) => x.row);
  }

  const issues: string[] = [];
  return {
    sheet: sheetName,
    rows,
    forecastFinish: dayOf(ws, 'J', 3, issues),
    r1Finish: dayOf(ws, 'G', 3, issues),
  };
}

/** "Actual", "In progress (90 %)" or "Forecast" for the Actual/Forecast dates of a row. */
export function dateKind(row: OldRow): string {
  if (row.isSummary) return 'Summary';
  if (row.percent === null || row.percent <= 0) return 'Forecast';
  if (row.percent >= 1) return 'Actual';
  return `In progress (${Math.round(row.percent * 100)} %)`;
}
