/** The comparison workbook: old design (Excel) vs new design (planner). */
import * as XLSX from 'xlsx';
import { dayToLocalDate, todayDay } from '../../src/engine';
import { applyStyles, StyleBook, type CellStyle, type SheetSetup } from '../../src/io/excel';
import { fmtLong } from '../../src/ui/format';
import type { MatchLine, Matching } from './matching';
import { dateKind, type OldRow, type OldSchedule } from './old';
import type { NewPlan, NewTask } from './plan';

const DATE_FMT = 'dd mmm yyyy';
const SIGNED = '+0;-0;0';
const MONTHS = '+0.0;-0.0;0.0';
const HEADER_FILL = '#D9D0C8';
const BAND_FILL = '#ECE8E3';
const MOCCA = '#8C7067';
const DARK = '#2A211E';
const OLD_BAR = '#C9BDB4';
const OLD_SUM = '#9C8F86';
const LATE = '#B3261E';
const LATE_FILL = '#F4DCD9';
const EARLY = '#2E6B3F';
const EARLY_FILL = '#DCEBDD';
const STATUS_FILL = '#E8B4AE';
/** Differences within this many days are shown as "about the same". */
const TOLERANCE = 7;

export interface Sources {
  oldFile: string;
  oldSnapshot: number;
  planFile: string;
}

interface Line {
  m: MatchLine;
  o: OldRow;
  news: NewTask[];
  newStart: number | null;
  newFinish: number | null;
  dStart: number | null;
  dFinish: number | null;
}

class Grid {
  rows: unknown[][] = [];
  private z = new Map<string, string>();
  set(r: number, c: number, v: unknown, z?: string) {
    (this.rows[r] ??= [])[c] = v;
    if (z) this.z.set(`${r},${c}`, z);
  }
  toSheet(): XLSX.WorkSheet {
    for (let r = 0; r < this.rows.length; r++) this.rows[r] ??= [];
    const ws = XLSX.utils.aoa_to_sheet(this.rows, { cellDates: true });
    for (const [key, z] of this.z) {
      const [r, c] = key.split(',').map(Number);
      const ref = XLSX.utils.encode_cell({ r, c });
      ws[ref] ??= { t: 's', v: '' };
      ws[ref].z = z;
    }
    ws['!margins'] = { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 };
    return ws;
  }
}

const redone = (o: OldRow) => !o.isSummary && o.percent !== null && o.percent >= 1;
const date = (day: number | null) => (day === null ? '' : dayToLocalDate(day));
const redoneText = (l: Line) => (l.m.status === 'Matched' && redone(l.o) ? 'redone' : null);
const months = (d: number) => Math.round((d / 30.44) * 10) / 10;

function buildLines(old: OldSchedule, plan: NewPlan, matching: Matching, snapshot: number): Line[] {
  const oldBy = new Map(old.rows.map((r) => [r.row, r]));
  const out: Line[] = [];
  for (const m of matching.lines) {
    const o = oldBy.get(m.oldRow);
    if (!o) continue;
    const news = m.newIds.map((id) => plan.byId.get(id)).filter((t): t is NewTask => !!t);
    const newStart = news.length ? Math.min(...news.map((t) => t.start)) : null;
    const newFinish = news.length ? Math.max(...news.map((t) => t.finish)) : null;
    // An old activity that was already complete and is done again in the new design is a
    // redo, not a delay: no difference is shown for it.
    const matched = m.status === 'Matched' && !redone(o);
    out.push({
      m,
      o,
      news,
      newStart,
      newFinish,
      // A start that had already happened in the old plan is history, not a comparison.
      dStart:
        matched && newStart !== null && o.forecast.start !== null && o.forecast.start >= snapshot
          ? newStart - o.forecast.start
          : null,
      dFinish:
        matched && newFinish !== null && o.forecast.finish !== null
          ? newFinish - o.forecast.finish
          : null,
    });
  }
  return out;
}

/** New tasks (without subtasks) that no old line points to. */
function newOnly(plan: NewPlan, matching: Matching): NewTask[] {
  const used = new Set(matching.lines.flatMap((l) => (l.status === 'Matched' ? l.newIds : [])));
  return plan.tasks.filter((t) => !t.isSummary && !used.has(t.id));
}

export function buildComparison(
  old: OldSchedule,
  plan: NewPlan,
  matching: Matching,
  sources: Sources,
): Uint8Array {
  const book = new StyleBook();
  const lines = buildLines(old, plan, matching, sources.oldSnapshot);
  const extra = newOnly(plan, matching);

  const S = {
    head: book.code({ fill: HEADER_FILL, wrap: true, vAlign: 'center' }),
    section: book.code({ fill: HEADER_FILL, size: 10 }),
    band: book.code({ fill: BAND_FILL }),
    date: book.code({ hAlign: 'left' }, DATE_FMT),
    bandDate: book.code({ fill: BAND_FILL, hAlign: 'left' }, DATE_FMT),
    title: book.code({ size: 18 }),
    brand: book.code({ color: MOCCA, size: 9 }),
    sub: book.code({ color: MOCCA }),
    check: book.code({ fill: '#F6E7C8' }),
  };
  const diff = (d: number | null, fmt = SIGNED, band = false) => {
    const style: CellStyle = { hAlign: 'right' };
    if (d !== null && d > TOLERANCE) Object.assign(style, { color: LATE, fill: LATE_FILL });
    else if (d !== null && d < -TOLERANCE) Object.assign(style, { color: EARLY, fill: EARLY_FILL });
    else if (band) style.fill = BAND_FILL;
    return book.code(style, fmt);
  };
  const newNames = (l: Line) => l.news.map((t) => `${t.rowId} ${t.name}`).join(', ');

  const wb = XLSX.utils.book_new();
  const setups: SheetSetup[] = [];
  const add = (ws: XLSX.WorkSheet, name: string, setup: SheetSetup) => {
    XLSX.utils.book_append_sheet(wb, ws, name);
    setups.push(setup);
  };

  // ------------------------------------------------------------------ Key dates
  {
    const g = new Grid();
    let r = 0;
    g.set(r++, 0, 'VILLA FELSTEAD', S.brand);
    g.set(r++, 0, 'Old design vs new design', S.title);
    g.set(
      r++,
      0,
      `Old: Excel schedule of ${fmtLong(sources.oldSnapshot)} (Schedule tab, Actual / Forecast dates) · ` +
        `New: ${plan.name}, status date ${fmtLong(plan.statusDay)} · created ${fmtLong(todayDay())}`,
      S.sub,
    );
    r++;
    const kv = (k: string, v: unknown, z?: string) => {
      g.set(r, 0, k);
      g.set(r, 1, v, z);
      r++;
    };
    const handover = old.rows.find((o) => /handing over/i.test(o.name));
    const oc = old.rows.find((o) => o.name === 'OC' && !o.isSummary);
    const newOc = plan.tasks.find((t) => t.name === 'OC');
    kv('Old forecast OC', date(oc?.forecast.finish ?? null), S.date);
    kv('Old forecast handover', date(handover?.forecast.finish ?? null), S.date);
    kv('Old baseline 1 handover', date(old.r1Finish), S.date);
    kv('New plan OC', date(newOc?.finish ?? null), S.date);
    kv('New plan last finish', date(plan.finish), S.date);
    const count = (s: string) => lines.filter((l) => l.m.status === s).length;
    kv(
      'Old activities',
      `${lines.length}: ${count('Matched')} matched, ${count('Not in new plan yet')} not in the new plan yet, ` +
        `${count('Completed (old)')} completed in the old plan, ${count('Ignore')} ignored`,
    );
    kv('New tasks with no old equivalent', extra.length);
    kv('Lines still to check', lines.filter((l) => l.m.check).length);
    r++;

    const heads = [
      'Key date (old activity)',
      'Old finish',
      'Old dates are',
      'New task(s)',
      'New finish',
      'Difference (days)',
      '≈ months',
      'Note',
    ];
    for (let c = 0; c < heads.length; c++) g.set(r, c, c === 0 ? 'KEY DATES' : '', S.section);
    r++;
    heads.forEach((h, c) => g.set(r, c, h, S.head));
    r++;
    const keys = lines
      .filter((l) => l.m.key)
      .sort((a, b) => (a.o.forecast.finish ?? 0) - (b.o.forecast.finish ?? 0));
    for (const l of keys) {
      g.set(r, 0, l.o.name);
      g.set(r, 1, date(l.o.forecast.finish), S.date);
      g.set(r, 2, dateKind(l.o));
      g.set(r, 3, l.m.status === 'Matched' ? newNames(l) : l.m.status);
      g.set(r, 4, date(l.newFinish), S.date);
      g.set(r, 5, l.dFinish ?? '', diff(l.dFinish));
      g.set(r, 6, l.dFinish === null ? '' : months(l.dFinish), diff(l.dFinish, MONTHS));
      g.set(r, 7, l.m.note);
      r++;
    }
    r++;
    g.set(
      r++,
      0,
      'Difference = new minus old, in calendar days (both schedules count calendar days). ' +
        `Red = later by more than ${TOLERANCE} days, green = earlier. Where one old activity matches ` +
        'several new tasks, the latest new finish is used.',
      S.sub,
    );
    const ws = g.toSheet();
    ws['!cols'] = [36, 14, 18, 48, 14, 12, 9, 70].map((wch) => ({ wch }));
    add(ws, 'Key dates', { hideGridlines: true, paper: 'A4' });
  }

  // ------------------------------------------------------------------ By phase
  {
    const g = new Grid();
    const heads = [
      'Old phase / group',
      'Old start',
      'Old finish',
      'New task(s)',
      'New start',
      'New finish',
      'Start diff (days)',
      'Finish diff (days)',
      '≈ months',
      'Note',
    ];
    heads.forEach((h, c) => g.set(0, c, h, S.head));
    let r = 1;
    for (const l of lines.filter((x) => x.o.isSummary && x.m.status === 'Matched')) {
      g.set(r, 0, [...l.o.path, l.o.name].join(' › '));
      g.set(r, 1, date(l.o.forecast.start), S.date);
      g.set(r, 2, date(l.o.forecast.finish), S.date);
      g.set(r, 3, newNames(l));
      g.set(r, 4, date(l.newStart), S.date);
      g.set(r, 5, date(l.newFinish), S.date);
      g.set(r, 6, l.dStart ?? '', diff(l.dStart));
      g.set(r, 7, l.dFinish ?? '', diff(l.dFinish));
      g.set(r, 8, l.dFinish === null ? '' : months(l.dFinish), diff(l.dFinish, MONTHS));
      g.set(r, 9, l.m.note);
      r++;
    }
    const ws = g.toSheet();
    ws['!cols'] = [44, 13, 13, 62, 13, 13, 10, 10, 9, 70].map((wch) => ({ wch }));
    add(ws, 'By phase', { freeze: { cols: 1, rows: 1 }, paper: 'A3' });
  }

  // ------------------------------------------------------------------ All lines
  {
    const g = new Grid();
    const heads = [
      'Old row',
      'Old activity',
      'Status',
      'Old start',
      'Old finish',
      'Old dates are',
      'New task(s)',
      'New start',
      'New finish',
      'Start diff (days)',
      'Finish diff (days)',
      'Check',
      'Note',
    ];
    heads.forEach((h, c) => g.set(0, c, h, S.head));
    let r = 1;
    for (const l of lines) {
      const b = l.o.isSummary;
      const t = b ? S.band : undefined;
      const d = b ? S.bandDate : S.date;
      g.set(r, 0, l.o.row, t);
      g.set(r, 1, '   '.repeat(Math.max(0, l.o.path.length - 1)) + l.o.name, t);
      g.set(r, 2, l.m.status, t);
      g.set(r, 3, date(l.o.forecast.start), d);
      g.set(r, 4, date(l.o.forecast.finish), d);
      g.set(r, 5, dateKind(l.o), t);
      g.set(r, 6, newNames(l), t);
      g.set(r, 7, date(l.newStart), d);
      g.set(r, 8, date(l.newFinish), d);
      g.set(r, 9, l.dStart ?? '', diff(l.dStart, SIGNED, b));
      g.set(r, 10, redoneText(l) ?? l.dFinish ?? '', diff(l.dFinish, SIGNED, b));
      g.set(r, 11, l.m.check ? 'Check' : '', l.m.check ? S.check : t);
      g.set(
        r,
        12,
        [l.m.note, ...l.o.issues.filter((i) => !l.m.note.includes(i))].filter(Boolean).join(' · '),
        t,
      );
      r++;
    }
    r++;
    for (let c = 0; c < heads.length; c++)
      g.set(
        r,
        c,
        c === 1 ? 'IN THE NEW PLAN ONLY (no old activity points to these tasks)' : '',
        S.section,
      );
    r++;
    for (const t of extra) {
      g.set(r, 0, '');
      g.set(r, 1, [...t.path, t.name].join(' › '));
      g.set(r, 2, 'New only');
      g.set(r, 6, `${t.rowId} ${t.name}`);
      g.set(r, 7, date(t.start), S.date);
      g.set(r, 8, date(t.finish), S.date);
      r++;
    }
    const ws = g.toSheet();
    ws['!cols'] = [7, 46, 18, 12, 12, 16, 40, 12, 12, 9, 9, 7, 70].map((wch) => ({ wch }));
    ws['!autofilter'] = { ref: `A1:M${lines.length + 1}` };
    add(ws, 'All lines', { freeze: { cols: 2, rows: 1 }, paper: 'A3' });
  }

  // ------------------------------------------------------------------ Gantt
  {
    const shown = lines.filter(
      (l) =>
        (l.m.status === 'Matched' || l.m.status === 'Not in new plan yet') &&
        Math.max(l.o.forecast.finish ?? 0, l.newFinish ?? 0) >= sources.oldSnapshot,
    );
    const ends = [
      ...shown.flatMap((l) => [l.o.forecast.finish ?? 0, l.newFinish ?? 0]),
      ...extra.map((t) => t.finish),
    ];
    const from0 = Math.min(sources.oldSnapshot, plan.statusDay);
    const from = from0 - ((new Date(from0 * 86_400_000).getUTCDay() + 6) % 7); // Monday
    const to = Math.max(...ends);
    const weeks = Math.ceil((to - from + 1) / 7);
    const FIRST = 5;
    const g = new Grid();
    const hide = (style: CellStyle) => book.code(style, 'hide');
    const heads = ['Activity', 'Plan', 'Start', 'Finish', 'Finish diff'];
    heads.forEach((h, c) => {
      g.set(0, c, '', S.head);
      g.set(1, c, h, S.head);
    });
    const statusWeek = Math.floor((plan.statusDay - from) / 7);
    for (let w = 0; w < weeks; w++) {
      const d = new Date((from + w * 7) * 86_400_000);
      const monthStart = w === 0 || d.getUTCDate() <= 7;
      const fill = w === statusWeek ? STATUS_FILL : HEADER_FILL;
      g.set(
        0,
        FIRST + w,
        monthStart
          ? d.toLocaleString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' })
          : '',
        book.code({ fill, size: 8 }),
      );
      g.set(1, FIRST + w, d.getUTCDate(), book.code({ fill, size: 7, hAlign: 'center' }, '0'));
    }
    let r = 2;
    const bar = (start: number | null, finish: number | null, colour: string) => {
      if (start === null || finish === null) return;
      for (let w = 0; w < weeks; w++) {
        const ws0 = from + w * 7;
        if (finish >= ws0 && start <= ws0 + 6) g.set(r, FIRST + w, 1, hide({ fill: colour }));
      }
    };
    const statusCol = (style: CellStyle = {}) => {
      if (statusWeek >= 0 && statusWeek < weeks && g.rows[r]?.[FIRST + statusWeek] === undefined)
        g.set(r, FIRST + statusWeek, '', book.code({ ...style, fill: '#F7E3E0' }));
    };
    for (const l of shown) {
      const b = l.o.isSummary;
      const t = b ? S.band : undefined;
      g.set(r, 0, [...l.o.path.slice(1), l.o.name].join(' › '), t);
      g.set(r, 1, 'Old', t);
      g.set(r, 2, date(l.o.forecast.start), b ? S.bandDate : S.date);
      g.set(r, 3, date(l.o.forecast.finish), b ? S.bandDate : S.date);
      g.set(r, 4, '', t);
      bar(l.o.forecast.start, l.o.forecast.finish, b ? OLD_SUM : OLD_BAR);
      statusCol();
      r++;
      g.set(
        r,
        0,
        l.m.status === 'Matched' ? `   ${newNames(l)}` : '   (not in the new plan yet)',
        t,
      );
      g.set(r, 1, 'New', t);
      g.set(r, 2, date(l.newStart), b ? S.bandDate : S.date);
      g.set(r, 3, date(l.newFinish), b ? S.bandDate : S.date);
      g.set(r, 4, redoneText(l) ?? l.dFinish ?? '', diff(l.dFinish, SIGNED, b));
      bar(l.newStart, l.newFinish, b ? DARK : MOCCA);
      statusCol();
      r++;
    }
    for (let c = 0; c < FIRST + weeks; c++)
      g.set(r, c, c === 0 ? 'IN THE NEW PLAN ONLY' : '', S.section);
    r++;
    for (const t of extra) {
      g.set(r, 0, `${t.rowId} ${t.name}`);
      g.set(r, 1, 'New');
      g.set(r, 2, date(t.start), S.date);
      g.set(r, 3, date(t.finish), S.date);
      bar(t.start, t.finish, MOCCA);
      statusCol();
      r++;
    }
    const ws = g.toSheet();
    ws['!cols'] = [
      ...[46, 5, 11, 11, 8].map((wch) => ({ wch })),
      ...Array.from({ length: weeks }, () => ({ wch: 2.4 })),
    ];
    add(ws, 'Gantt', { freeze: { cols: FIRST, rows: 2 }, paper: 'A3' });
  }

  // ------------------------------------------------------------------ Notes
  {
    const g = new Grid();
    let r = 0;
    const line = (text: string, z?: string) => g.set(r++, 0, text, z);
    const sect = (text: string) => {
      r++;
      line(text.toUpperCase(), S.section);
    };
    line('About this comparison', S.title);
    sect('Sources');
    line(`Old design: ${sources.oldFile}`);
    line(
      `  "Schedule" tab, Actuals and Forecast columns (H–K); snapshot of ${fmtLong(sources.oldSnapshot)}.`,
    );
    line(`New design: ${sources.planFile}`);
    line(`  Scheduled with the planner's own engine; status date ${fmtLong(plan.statusDay)}.`);
    line('Both files were only read; neither was changed.');
    sect('How to read it');
    line('Both schedules count calendar days. Finish dates are the last day of the work.');
    line('Difference = new minus old. Positive = the new plan is later.');
    line(
      'Start differences are left blank where the old activity had already started by the snapshot date.',
    );
    line(
      '"redone" = complete in the old plan and done again for the new design; no difference is shown.',
    );
    line(
      '"Old dates are": Actual (100 % complete), In progress (start actual, finish forecast) or Forecast.',
    );
    line(
      'The matching (which old activity is which new task) is in the separate matching workbook.',
    );
    line(
      'The new plan does not yet include blockwork, plastering, waterproofing, interiors, landscape, pool, ' +
        'external works or handover, so compare like with like (e.g. OC with OC), not end date with end date.',
    );
    const fixed = plan.tasks.filter((t) => !t.isSummary && t.constrained).length;
    const leaves = plan.tasks.filter((t) => !t.isSummary).length;
    line(
      `${fixed} of ${leaves} new tasks have a fixed start date (Start No Earlier Than), so the new dates ` +
        'mostly come from those dates rather than from links between tasks.',
    );
    const oldIssues = old.rows.filter((o) => o.issues.length);
    if (oldIssues.length) {
      sect('Problems found in the old Excel');
      for (const o of oldIssues) line(`Row ${o.row} (${o.name}): ${o.issues.join('; ')}`);
    }
    if (matching.warnings.length) {
      sect('Matching warnings');
      for (const w of matching.warnings) line(w);
    }
    const ws = g.toSheet();
    ws['!cols'] = [{ wch: 140 }];
    add(ws, 'Notes', { hideGridlines: true, paper: 'A4' });
  }

  wb.Workbook = {
    Names: ['By phase', 'All lines'].map((n) => ({
      Name: '_xlnm.Print_Titles',
      Ref: `'${n}'!$1:$1`,
      Sheet: n === 'By phase' ? 1 : 2,
    })),
  };
  const raw = new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx', cellDates: true }));
  return applyStyles(raw, book.rules, setups);
}
