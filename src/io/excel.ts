import * as XLSX from 'xlsx';
import {
  activeBaseline,
  CONSTRAINT_LABEL,
  dayToLocalDate,
  displayFinishDay,
  finishVariance,
  isoToDay,
  type Project,
} from '../engine';
import type { Derived } from '../store/derive';
import { linkTexts, phaseColorOf } from '../ui/rows';

const DATE_FMT = 'ddd dd mmm yy';
const CRIT_COLOR = '#B3261E';
const SUMMARY_COLOR = '#2A211E';

/**
 * Two-sheet workbook: the task table, and a weekly Gantt with shaded cells.
 *
 * SheetJS Community Edition cannot write cell fills, so each shading colour gets its own
 * custom number format (all of which render as blank / the cell text) and `xl/styles.xml` is
 * patched afterwards to give the cell styles using those formats a solid fill.
 */
export function buildWorkbook(project: Project, derived: Derived): Uint8Array {
  const { outline, schedule } = derived;
  const bl = activeBaseline(project);
  const links = linkTexts(project);
  const wb = XLSX.utils.book_new();

  // ---------------------------------------------------------------- sheet 1: tasks
  const header = [
    'ID',
    'WBS',
    'Name',
    'Duration (working days)',
    'Start',
    'Finish',
    'Predecessors',
    'Successors',
    'Responsible',
    '% Complete',
    'Total float (working days)',
    'Free float (working days)',
    'Critical',
    'Baseline start',
    'Baseline finish',
    'Finish variance (working days)',
    'Constraint',
    'Constraint date',
    'Actual start',
    'Actual finish',
    'Notes',
  ];
  const date = (day: number | undefined) => (day === undefined ? '' : dayToLocalDate(day));
  const isoDate = (iso: string | undefined) => (iso ? dayToLocalDate(isoToDay(iso)) : '');
  const rows: unknown[][] = [header];
  for (const id of outline.flat) {
    const t = outline.byId.get(id)!;
    const c = schedule.calc.get(id);
    const depth = outline.depth.get(id) ?? 0;
    const b = bl?.tasks[id];
    rows.push([
      t.rowId,
      outline.wbs.get(id) ?? '',
      `${'    '.repeat(depth)}${t.name}`,
      c ? (outline.isSummary(id) ? c.duration : t.duration) : '',
      date(c?.es),
      c ? date(displayFinishDay(c)) : '',
      links.preds.get(id) ?? '',
      links.succs.get(id) ?? '',
      t.responsible,
      c ? Math.round(c.percentComplete) / 100 : '',
      c?.totalFloat ?? '',
      c?.freeFloat ?? '',
      c?.critical ? 'Yes' : '',
      isoDate(b?.start),
      isoDate(b?.finish),
      finishVariance(project, c, b) ?? '',
      t.constraint.type === 'ASAP' ? '' : CONSTRAINT_LABEL[t.constraint.type],
      isoDate(t.constraint.date),
      isoDate(t.actualStart),
      isoDate(t.actualFinish),
      t.notes,
    ]);
  }
  const ws1 = XLSX.utils.aoa_to_sheet(rows, { cellDates: true });
  const range = XLSX.utils.decode_range(ws1['!ref']!);
  for (let r = 1; r <= range.e.r; r++) {
    for (const col of [4, 5, 13, 14, 17, 18, 19]) {
      const cell = ws1[XLSX.utils.encode_cell({ r, c: col })];
      if (cell && cell.t === 'd') cell.z = DATE_FMT;
    }
    const pct = ws1[XLSX.utils.encode_cell({ r, c: 9 })];
    if (pct && pct.t === 'n') pct.z = '0%';
  }
  ws1['!cols'] = [
    6, 8, 50, 11, 14, 14, 18, 18, 22, 10, 12, 12, 8, 14, 14, 14, 10, 14, 14, 14, 40,
  ].map((wch) => ({ wch }));
  ws1['!autofilter'] = {
    ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: 0, c: header.length - 1 } }),
  };
  XLSX.utils.book_append_sheet(wb, ws1, 'Tasks');

  // ---------------------------------------------------------------- sheet 2: weekly gantt
  const start =
    schedule.projectStart - ((new Date(schedule.projectStart * 864e5).getUTCDay() + 6) % 7);
  let finish = schedule.projectStart;
  for (const c of schedule.calc.values()) finish = Math.max(finish, displayFinishDay(c));
  const weeks: number[] = [];
  for (let w = start; w <= finish; w += 7) weeks.push(w);

  const colors: string[] = [];
  const formatFor = (color: string) => {
    let i = colors.indexOf(color);
    if (i < 0) {
      colors.push(color);
      i = colors.length - 1;
    }
    // Blank for numbers; shows text (milestone diamond). The trailing empty literals only make
    // each format string unique per colour.
    return `"";"";"";@${'""'.repeat(i + 1)}`;
  };

  const g: unknown[][] = [
    ['ID', 'Task', 'Start', 'Finish', ...weeks.map((w) => dayToLocalDate(w))],
  ];
  const fmts: { r: number; c: number; z: string }[] = [];
  outline.flat.forEach((id, idx) => {
    const t = outline.byId.get(id)!;
    const c = schedule.calc.get(id);
    const depth = outline.depth.get(id) ?? 0;
    const row: unknown[] = [
      t.rowId,
      `${'  '.repeat(depth)}${t.name}`,
      date(c?.es),
      c ? date(displayFinishDay(c)) : '',
    ];
    if (c) {
      const summary = outline.isSummary(id);
      const color = summary
        ? SUMMARY_COLOR
        : c.critical
          ? CRIT_COLOR
          : phaseColorOf(project, derived, id);
      const z = formatFor(color);
      const last = displayFinishDay(c);
      weeks.forEach((w, k) => {
        if (c.isMilestone && !summary) {
          if (c.es >= w && c.es < w + 7) {
            row[4 + k] = '◆';
            fmts.push({ r: idx + 1, c: 4 + k, z });
          }
        } else if (c.es < w + 7 && last >= w) {
          row[4 + k] = 1;
          fmts.push({ r: idx + 1, c: 4 + k, z });
        }
      });
    }
    g.push(row);
  });
  const ws2 = XLSX.utils.aoa_to_sheet(g, { cellDates: true });
  for (let k = 0; k < weeks.length; k++) {
    const h = ws2[XLSX.utils.encode_cell({ r: 0, c: 4 + k })];
    if (h) h.z = 'dd mmm';
  }
  for (let r = 1; r < g.length; r++) {
    for (const col of [2, 3]) {
      const cell = ws2[XLSX.utils.encode_cell({ r, c: col })];
      if (cell && cell.t === 'd') cell.z = 'dd.mm.yy';
    }
  }
  for (const f of fmts) {
    const cell = ws2[XLSX.utils.encode_cell({ r: f.r, c: f.c })];
    if (cell) cell.z = f.z;
  }
  ws2['!cols'] = [
    { wch: 5 },
    { wch: 44 },
    { wch: 9 },
    { wch: 9 },
    ...weeks.map(() => ({ wch: 3.2 })),
  ];
  XLSX.utils.book_append_sheet(wb, ws2, 'Gantt (weekly)');

  const raw = new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx', cellDates: true }));
  const formatColors = colors.map((color, i) => ({
    code: `"";"";"";@${'""'.repeat(i + 1)}`,
    color,
  }));
  return applyFills(raw, formatColors);
}

const xmlEscape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Give every cell style that uses one of `formats` a solid fill of its colour. */
export function applyFills(
  xlsx: Uint8Array,
  formats: { code: string; color: string }[],
): Uint8Array {
  const cfb = XLSX.CFB.read(xlsx, { type: 'array' });
  const idx = cfb.FullPaths.findIndex((p: string) => p.endsWith('/xl/styles.xml'));
  if (idx < 0) return xlsx;
  const entry = cfb.FileIndex[idx];
  let xml = new TextDecoder().decode(entry.content as Uint8Array);

  const fillsMatch = /<fills count="(\d+)">([\s\S]*?)<\/fills>/.exec(xml);
  if (!fillsMatch) return xlsx;
  let fillCount = Number(fillsMatch[1]);
  let newFills = '';
  const fillForFmtId = new Map<string, number>();
  for (const f of formats) {
    const m = new RegExp(
      `<numFmt numFmtId="(\\d+)" formatCode="${xmlEscape(f.code).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"/>`,
    ).exec(xml);
    if (!m) continue;
    const rgb = `FF${f.color.replace('#', '').toUpperCase()}`;
    newFills += `<fill><patternFill patternType="solid"><fgColor rgb="${rgb}"/><bgColor indexed="64"/></patternFill></fill>`;
    fillForFmtId.set(m[1], fillCount++);
  }
  xml = xml.replace(
    fillsMatch[0],
    `<fills count="${fillCount}">${fillsMatch[2]}${newFills}</fills>`,
  );
  xml = xml.replace(/<cellXfs count="(\d+)">([\s\S]*?)<\/cellXfs>/, (_all, count, body: string) => {
    const patched = body.replace(
      /<xf numFmtId="(\d+)"([^>]*?)fillId="0"([^>]*?)\/>/g,
      (x, id, a, b) => {
        const fill = fillForFmtId.get(id);
        return fill === undefined
          ? x
          : `<xf numFmtId="${id}"${a}fillId="${fill}"${b} applyFill="1"/>`;
      },
    );
    return `<cellXfs count="${count}">${patched}</cellXfs>`;
  });
  entry.content = new TextEncoder().encode(xml);
  return new Uint8Array(
    XLSX.CFB.write(cfb, { fileType: 'zip', type: 'array' }) as ArrayLike<number>,
  );
}
