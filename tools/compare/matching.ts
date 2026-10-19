/**
 * The matching table: one line per old Excel activity, saying which new task(s) it corresponds
 * to. Written once as an editable workbook; afterwards it is only read, never overwritten.
 *
 * New tasks are stored twice: as row numbers (what you see and edit) and, in hidden columns, as
 * the planner's permanent task IDs plus the row numbers they had when the file was written. If
 * you have not edited a line's row numbers, the IDs are used (so the matching survives tasks
 * being inserted or moved in the planner); if you have, your row numbers win.
 */
import * as XLSX from 'xlsx';
import { applyStyles, StyleBook, type SheetSetup } from '../../src/io/excel';
import { dayToLocalDate } from '../../src/engine';
import { DRAFT, STATUSES, type MatchStatus } from './draft';
import { dateKind, type OldRow, type OldSchedule } from './old';
import type { NewPlan, NewTask } from './plan';

export interface MatchLine {
  oldRow: number;
  oldName: string;
  status: MatchStatus;
  newIds: string[];
  key: boolean;
  check: boolean;
  note: string;
}

export interface Matching {
  lines: MatchLine[];
  /** Problems found while reading the matching file. */
  warnings: string[];
}

const HEAD = [
  'Old row',
  'Phase',
  'Old activity',
  'Old start',
  'Old finish',
  'Old dates are',
  'Status',
  'New rows',
  'New tasks (filled in for checking)',
  'Key date',
  'Check',
  'Note',
  'New IDs (do not edit)',
  'Rows when written (do not edit)',
];
const COL = Object.fromEntries(HEAD.map((h, i) => [h, i])) as Record<string, number>;
const DATE_FMT = 'dd mmm yyyy';
const HEADER_FILL = '#D9D0C8';
const BAND_FILL = '#ECE8E3';
const CHECK_FILL = '#F6E7C8';
const MOCCA = '#8C7067';

const rowsText = (ids: string[], plan: NewPlan) =>
  ids
    .map((id) => plan.byId.get(id)?.rowId)
    .filter((n): n is number => n !== undefined)
    .join(', ');
const norm = (s: string) => s.replace(/\s+/g, '').replace(/;/g, ',');

/** Default line for every old row: the draft, or a status from its completion. */
export function draftMatching(old: OldSchedule, plan: NewPlan): Matching {
  const warnings: string[] = [];
  const byName = new Map<string, NewTask[]>();
  for (const t of plan.tasks) byName.set(t.name, [...(byName.get(t.name) ?? []), t]);
  const lines = old.rows.map((r): MatchLine => {
    const d = DRAFT[r.row];
    const status: MatchStatus =
      d?.status ??
      (r.percent !== null && r.percent >= 1 ? 'Completed (old)' : 'Not in new plan yet');
    const newIds: string[] = [];
    for (const name of d?.newTasks ?? []) {
      const found = byName.get(name) ?? [];
      if (found.length !== 1)
        warnings.push(
          `Draft for old row ${r.row}: ${found.length ? 'several' : 'no'} new tasks named "${name}"`,
        );
      else newIds.push(found[0].id);
    }
    return {
      oldRow: r.row,
      oldName: r.name,
      status,
      newIds,
      key: !!d?.key,
      check: !!d?.check,
      note: d?.note ?? (r.issues.length ? r.issues.join('; ') : ''),
    };
  });
  // Summaries without a draft entry: completed when everything under them is.
  const byRow = new Map(lines.map((l) => [l.oldRow, l]));
  for (const r of old.rows) {
    if (!r.isSummary || DRAFT[r.row]) continue;
    const kids = r.childRows
      .map((c) => old.rows.find((o) => o.row === c)!)
      .filter((o) => !o.isSummary);
    if (kids.length && kids.every((k) => k.percent !== null && k.percent >= 1))
      byRow.get(r.row)!.status = 'Completed (old)';
  }
  return { lines, warnings };
}

export function writeMatchingFile(matching: Matching, old: OldSchedule, plan: NewPlan): Uint8Array {
  const book = new StyleBook();
  const oldBy = new Map(old.rows.map((r) => [r.row, r]));
  const head = book.code({ fill: HEADER_FILL, wrap: true, vAlign: 'center' });
  const date = book.code({ hAlign: 'left' }, DATE_FMT);
  const summary = book.code({ fill: BAND_FILL });
  const summaryDate = book.code({ fill: BAND_FILL, hAlign: 'left' }, DATE_FMT);
  const check = book.code({ fill: CHECK_FILL });

  const aoa: unknown[][] = [HEAD];
  const z: [number, number, string][] = HEAD.map((_, c) => [0, c, head]);
  matching.lines.forEach((l, i) => {
    const r = i + 1;
    const o = oldBy.get(l.oldRow);
    const rows = rowsText(l.newIds, plan);
    aoa.push([
      l.oldRow,
      o?.phase ?? '',
      o ? [...o.path.slice(1), o.name].join(' › ') : l.oldName,
      o?.forecast.start != null ? dayToLocalDate(o.forecast.start) : '',
      o?.forecast.finish != null ? dayToLocalDate(o.forecast.finish) : '',
      o ? dateKind(o) : '',
      l.status,
      rows,
      l.newIds.map((id) => plan.byId.get(id)?.name ?? '?').join(', '),
      l.key ? 'Yes' : '',
      l.check ? 'Check' : '',
      l.note,
      l.newIds.join(' '),
      rows,
    ]);
    const isSum = !!o?.isSummary;
    for (let c = 0; c < HEAD.length; c++) {
      if (c === COL['Old start'] || c === COL['Old finish'])
        z.push([r, c, isSum ? summaryDate : date]);
      else if (c === COL['Check'] && l.check) z.push([r, c, check]);
      else if (isSum) z.push([r, c, summary]);
    }
  });
  const ws = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true });
  for (const [r, c, code] of z) {
    const cell = ws[XLSX.utils.encode_cell({ r, c })];
    if (cell) cell.z = code;
    else ws[XLSX.utils.encode_cell({ r, c })] = { t: 's', v: '', z: code };
  }
  ws['!cols'] = [7, 20, 52, 12, 12, 16, 20, 12, 40, 9, 8, 60, 10, 10].map((wch, c) => ({
    wch,
    hidden: c >= COL['New IDs (do not edit)'],
  }));
  ws['!autofilter'] = { ref: `A1:L${aoa.length}` };

  const planWs = newPlanSheet(plan, book);
  const help = helpSheet(book);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Matching');
  XLSX.utils.book_append_sheet(wb, planWs, 'New plan tasks');
  XLSX.utils.book_append_sheet(wb, help, 'How to edit');
  const setups: SheetSetup[] = [
    { freeze: { cols: 3, rows: 1 }, paper: 'A3' },
    { freeze: { cols: 2, rows: 1 }, paper: 'A4' },
    { hideGridlines: true, paper: 'A4' },
  ];
  const raw = new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx', cellDates: true }));
  return applyStyles(raw, book.rules, setups);
}

function newPlanSheet(plan: NewPlan, book: StyleBook): XLSX.WorkSheet {
  const head = book.code({ fill: HEADER_FILL });
  const date = book.code({ hAlign: 'left' }, DATE_FMT);
  const sum = book.code({ fill: BAND_FILL });
  const aoa: unknown[][] = [['Row', 'Task', 'Phase', 'Start', 'Finish', 'Summary']];
  for (const t of plan.tasks)
    aoa.push([
      t.rowId,
      '   '.repeat(t.depth) + t.name,
      t.phase,
      dayToLocalDate(t.start),
      dayToLocalDate(t.finish),
      t.isSummary ? 'Yes' : '',
    ]);
  const ws = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true });
  const set = (r: number, c: number, code: string) => {
    const cell = ws[XLSX.utils.encode_cell({ r, c })];
    if (cell) cell.z = code;
  };
  for (let c = 0; c < 6; c++) set(0, c, head);
  plan.tasks.forEach((t, i) => {
    set(i + 1, 3, date);
    set(i + 1, 4, date);
    if (t.isSummary) [0, 1, 2, 5].forEach((c) => set(i + 1, c, sum));
  });
  ws['!cols'] = [6, 44, 24, 12, 12, 9].map((wch) => ({ wch }));
  return ws;
}

function helpSheet(book: StyleBook): XLSX.WorkSheet {
  const title = book.code({ size: 16 });
  const sub = book.code({ color: MOCCA });
  const lines: [string, string?][] = [
    ['How to check and edit the matching', title],
    [
      'One line per activity of the old Excel schedule (Schedule tab). Edit only these columns:',
      sub,
    ],
    [''],
    ['Status', book.code({ fill: HEADER_FILL })],
    ['  Matched – the old activity corresponds to the new task(s) in "New rows".'],
    ['  Completed (old) – done in the old plan and not part of the new plan.'],
    ['  Not in new plan yet – still to come, but the new plan does not have it yet.'],
    ['  Ignore – leave out of the comparison (e.g. Excel errors).'],
    [''],
    ['New rows', book.code({ fill: HEADER_FILL })],
    ['  Row numbers (the ID column in the planner), separated by commas, e.g. 13, 14.'],
    ['  Several rows = the old activity was split; the earliest start and latest finish are used.'],
    [
      '  The same new row may appear on several old lines (several old activities merged into one).',
    ],
    ['  See the "New plan tasks" tab for the row numbers.'],
    [''],
    ['Key date', book.code({ fill: HEADER_FILL })],
    ['  "Yes" puts the line on the Key dates sheet of the comparison.'],
    [''],
    ['Check', book.code({ fill: HEADER_FILL })],
    ['  Lines I was not sure about are marked "Check". Clear it once you have confirmed the line.'],
    [''],
    ['Note', book.code({ fill: HEADER_FILL })],
    ['  Free text; shown in the comparison.'],
    [''],
    ['Then save this file and ask for the comparison to be refreshed.', sub],
    ['Do not edit the hidden columns (New IDs, Rows when written).', sub],
  ];
  const ws = XLSX.utils.aoa_to_sheet(lines.map(([t]) => [t]));
  lines.forEach(([, code], r) => {
    const cell = ws[XLSX.utils.encode_cell({ r, c: 0 })];
    if (cell && code) cell.z = code;
  });
  ws['!cols'] = [{ wch: 110 }];
  return ws;
}

export function readMatchingFile(data: Uint8Array, old: OldSchedule, plan: NewPlan): Matching {
  const wb = XLSX.read(data, { type: 'array' });
  const ws = wb.Sheets['Matching'];
  if (!ws) throw new Error('The matching file has no "Matching" tab');
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '', raw: true });
  const head = (aoa[0] ?? []).map((h) => String(h).trim());
  const col = (name: string) => {
    const i = head.indexOf(name);
    if (i < 0) throw new Error(`The matching file is missing the column "${name}"`);
    return i;
  };
  const C = {
    row: col('Old row'),
    activity: col('Old activity'),
    status: col('Status'),
    rows: col('New rows'),
    key: col('Key date'),
    check: col('Check'),
    note: col('Note'),
    ids: col('New IDs (do not edit)'),
    written: col('Rows when written (do not edit)'),
  };
  const warnings: string[] = [];
  const oldBy = new Map(old.rows.map((r) => [r.row, r]));
  const byRowId = new Map(plan.tasks.map((t) => [t.rowId, t]));
  const lines: MatchLine[] = [];
  for (const r of aoa.slice(1)) {
    const oldRow = Number(r[C.row]);
    if (!Number.isFinite(oldRow) || oldRow <= 0) continue;
    const o: OldRow | undefined = oldBy.get(oldRow);
    const activity = String(r[C.activity] ?? '');
    if (!o)
      warnings.push(`Old row ${oldRow} ("${activity}") is not in the Excel schedule any more`);
    else if (!activity.endsWith(o.name))
      warnings.push(
        `Old row ${oldRow} is now "${o.name}" in the Excel, but the matching says "${activity}"`,
      );

    const statusText = String(r[C.status] ?? '').trim();
    const status = STATUSES.find((s) => s.toLowerCase() === statusText.toLowerCase());
    if (!status) warnings.push(`Old row ${oldRow}: unknown status "${statusText}" (line left out)`);

    const typed = String(r[C.rows] ?? '');
    const written = String(r[C.written] ?? '');
    const storedIds = String(r[C.ids] ?? '')
      .split(/\s+/)
      .filter(Boolean);
    let newIds: string[];
    if (norm(typed) === norm(written) && storedIds.every((id) => plan.byId.has(id))) {
      newIds = storedIds;
    } else {
      newIds = [];
      for (const part of typed.split(/[,;\s]+/).filter(Boolean)) {
        const t = byRowId.get(Number(part));
        if (t) newIds.push(t.id);
        else warnings.push(`Old row ${oldRow}: new row "${part}" does not exist in the plan`);
      }
    }
    if (status === 'Matched' && newIds.length === 0)
      warnings.push(`Old row ${oldRow} is "Matched" but has no new rows`);
    if (!status) continue;
    lines.push({
      oldRow,
      oldName: o?.name ?? activity,
      status,
      newIds,
      key: /^(y|yes|x|true|1)$/i.test(String(r[C.key] ?? '').trim()),
      check: String(r[C.check] ?? '').trim() !== '',
      note: String(r[C.note] ?? ''),
    });
  }
  for (const o of old.rows)
    if (!lines.some((l) => l.oldRow === o.row))
      warnings.push(
        `Old row ${o.row} ("${o.name}") is new in the Excel and not in the matching yet`,
      );
  return { lines, warnings };
}
