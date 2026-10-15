import * as XLSX from 'xlsx';
import {
  activeBaseline,
  CONSTRAINT_LABEL,
  dayToLocalDate,
  HEALTH_SIGNAL_LABEL,
  isoToDay,
  STATUS_LABEL,
  todayDay,
  type Project,
  type ScheduleHealth,
  type TaskStatus,
} from '../engine';
import type { Derived } from '../store/derive';
import { fmtLong } from '../ui/format';
import { linkTexts } from '../ui/rows';
import {
  buildReport,
  CRITICAL_COLOR,
  DEFAULT_OPTIONS,
  excelColumns,
  excelUnit,
  SIGNAL_COLOR,
  type Report,
  type ReportOptions,
} from './report';

const DATE_FMT = 'ddd dd mmm yy';
const SIGNED = '+0;-0;0';
const SUMMARY_COLOR = '#2A211E';
const BASELINE_COLOR = '#D9D0C8';
const HEADER_FILL = '#D9D0C8';
const BAND_FILL = '#ECE8E3';
const WHITE = '#FFFFFF';
const MOCCA = '#8C7067';
const FONT_NAME = 'GT Standard M';

export const EXCEL_DEFAULT_OPTIONS: ReportOptions = { ...DEFAULT_OPTIONS, scope: 'all' };

// ------------------------------------------------------------------------------ styles

/**
 * SheetJS Community Edition cannot write cell fills, fonts or alignment. Every distinct look
 * therefore gets its own custom number format (all of them render the cell normally; the
 * trailing empty literals only make each code unique) and `xl/styles.xml` is patched afterwards
 * so the cell format using that number format also carries the fill, font colour and alignment.
 */
export interface CellStyle {
  fill?: string;
  color?: string;
  size?: number;
  rotate?: number;
  hAlign?: 'left' | 'center' | 'right';
  vAlign?: 'top' | 'center';
  wrap?: boolean;
}

export interface StyleRule {
  code: string;
  style: CellStyle;
}

/** `'text'` = text cells, `'hide'` = numbers render blank (Gantt cells), else a number format. */
type Base = 'text' | 'hide' | string;

export class StyleBook {
  readonly rules: StyleRule[] = [];
  private index = new Map<string, string>();

  code(style: CellStyle, base: Base = 'text'): string {
    const key = JSON.stringify([style, base]);
    let code = this.index.get(key);
    if (code === undefined) {
      const suffix = `@${'""'.repeat(this.rules.length + 1)}`;
      const head =
        base === 'text'
          ? ''
          : base === 'hide'
            ? '"";"";"";'
            : base.includes(';')
              ? `${base};`
              : `${base};${base};${base};`;
      code = `${head}${suffix}`;
      this.index.set(key, code);
      this.rules.push({ code, style });
    }
    return code;
  }
}

const xmlEscape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const reEscape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const argb = (hex: string) => `FF${hex.replace('#', '').toUpperCase()}`;

/** Per-sheet settings applied to the sheet XML after SheetJS has written it. */
export interface SheetSetup {
  /** Freeze this many leading columns and rows. */
  freeze?: { cols: number; rows: number };
  hideGridlines?: boolean;
  paper: 'A4' | 'A3';
}

function sheetViewXml(setup: SheetSetup, first: boolean): string {
  const attrs = `${setup.hideGridlines ? ' showGridLines="0"' : ''}${first ? ' tabSelected="1"' : ''} workbookViewId="0"`;
  const f = setup.freeze;
  if (!f || (f.cols <= 0 && f.rows <= 0)) return `<sheetViews><sheetView${attrs}/></sheetViews>`;
  const col = (n: number) => String.fromCharCode(65 + n); // freeze panes stay within A..Z
  const topLeft = `${col(f.cols)}${f.rows + 1}`;
  const pane = f.cols > 0 && f.rows > 0 ? 'bottomRight' : f.rows > 0 ? 'bottomLeft' : 'topRight';
  const split = `${f.cols > 0 ? ` xSplit="${f.cols}"` : ''}${f.rows > 0 ? ` ySplit="${f.rows}"` : ''}`;
  const sel: string[] = [];
  if (f.cols > 0 && f.rows > 0) {
    sel.push(`<selection pane="topRight" activeCell="${col(f.cols)}1" sqref="${col(f.cols)}1"/>`);
    sel.push(`<selection pane="bottomLeft" activeCell="A${f.rows + 1}" sqref="A${f.rows + 1}"/>`);
  }
  sel.push(`<selection pane="${pane}" activeCell="${topLeft}" sqref="${topLeft}"/>`);
  return `<sheetViews><sheetView${attrs}><pane${split} topLeftCell="${topLeft}" activePane="${pane}" state="frozen"/>${sel.join('')}</sheetView></sheetViews>`;
}

/**
 * Insert freeze panes, landscape / fit-to-one-page-wide page setup into a sheet's XML,
 * keeping the elements in CT_Worksheet schema order:
 * sheetPr, dimension, sheetViews, sheetFormatPr, cols, sheetData, …, autoFilter, …,
 * pageMargins, pageSetup, headerFooter, …, ignoredErrors, …
 */
export function patchSheetXml(xml: string, setup: SheetSetup, first = false): string {
  // sheetPr / pageSetUpPr (first element of the worksheet)
  const fit = '<pageSetUpPr fitToPage="1"/>';
  if (/<sheetPr\b[^>]*\/>/.test(xml)) {
    xml = xml.replace(/<sheetPr\b([^>]*)\/>/, `<sheetPr$1>${fit}</sheetPr>`);
  } else if (/<sheetPr\b/.test(xml)) {
    xml = xml.replace('</sheetPr>', `${fit}</sheetPr>`);
  } else {
    xml = xml.replace(/<dimension\b/, `<sheetPr>${fit}</sheetPr><dimension`);
  }

  // sheetViews (after dimension, before sheetFormatPr / cols / sheetData)
  const views = sheetViewXml(setup, first);
  if (/<sheetViews>[\s\S]*?<\/sheetViews>/.test(xml)) {
    xml = xml.replace(/<sheetViews>[\s\S]*?<\/sheetViews>/, views);
  } else if (/<dimension\b[^>]*\/>/.test(xml)) {
    xml = xml.replace(/(<dimension\b[^>]*\/>)/, `$1${views}`);
  } else {
    xml = xml.replace(/(<sheetFormatPr\b|<cols>|<sheetData)/, `${views}$1`);
  }

  // pageSetup goes right after pageMargins (added when SheetJS did not write it)
  const margins =
    '<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>';
  const pageSetup = `<pageSetup paperSize="${setup.paper === 'A3' ? 8 : 9}" orientation="landscape" fitToWidth="1" fitToHeight="0"/>`;
  xml = xml.replace(/<pageSetup\b[^>]*\/>/, '');
  if (/<pageMargins\b[^>]*\/>/.test(xml)) {
    xml = xml.replace(/(<pageMargins\b[^>]*\/>)/, `$1${pageSetup}`);
  } else {
    const after =
      /<(headerFooter|rowBreaks|colBreaks|customProperties|cellWatches|ignoredErrors|smartTags|drawing|legacyDrawing|legacyDrawingHF|picture|oleObjects|controls|webPublishItems|tableParts|extLst)\b/.exec(
        xml,
      );
    const at = after ? after.index : xml.lastIndexOf('</worksheet>');
    xml = `${xml.slice(0, at)}${margins}${pageSetup}${xml.slice(at)}`;
  }
  return xml;
}

/**
 * Patch a workbook written by SheetJS: cell styles for the registered rules, the default
 * font, and per-sheet freeze panes and page setup. Works on the zip through SheetJS's own
 * bundled CFB module, so no extra dependency is needed.
 */
export function applyStyles(
  xlsx: Uint8Array,
  rules: StyleRule[],
  sheets: SheetSetup[],
  fontName = FONT_NAME,
): Uint8Array {
  const cfb = XLSX.CFB.read(xlsx, { type: 'array' });
  const find = (suffix: string) => cfb.FullPaths.findIndex((p: string) => p.endsWith(suffix));
  const read = (i: number) => new TextDecoder().decode(cfb.FileIndex[i].content as Uint8Array);
  const write = (i: number, text: string) => {
    cfb.FileIndex[i].content = new TextEncoder().encode(text);
  };

  const si = find('/xl/styles.xml');
  if (si >= 0) {
    let xml = read(si);

    // Default font: our brand font at a compact size. The theme scheme would override the name.
    xml = xml.replace(/(<fonts\b[^>]*>\s*<font>)([\s\S]*?)(<\/font>)/, (_a, open, body, close) => {
      const patched = body
        .replace(/<sz val="[^"]*"\/>/, '<sz val="10"/>')
        .replace(/<name val="[^"]*"\/>/, `<name val="${xmlEscape(fontName)}"/>`)
        .replace(/<scheme val="[^"]*"\/>/, '');
      return `${open}${patched}${close}`;
    });

    const fillsMatch = /<fills count="(\d+)">([\s\S]*?)<\/fills>/.exec(xml);
    const fontsMatch = /<fonts count="(\d+)"([^>]*)>([\s\S]*?)<\/fonts>/.exec(xml);
    if (fillsMatch && fontsMatch) {
      let fillCount = Number(fillsMatch[1]);
      let fontCount = Number(fontsMatch[1]);
      let newFills = '';
      let newFonts = '';
      const fillIdx = new Map<string, number>();
      const fontIdx = new Map<string, number>();
      const alignment = (s: CellStyle) => {
        const a: string[] = [];
        if (s.hAlign) a.push(`horizontal="${s.hAlign}"`);
        if (s.vAlign) a.push(`vertical="${s.vAlign}"`);
        if (s.rotate) a.push(`textRotation="${s.rotate}"`);
        if (s.wrap) a.push('wrapText="1"');
        return a.length ? `<alignment ${a.join(' ')}/>` : '';
      };
      const patchFor = new Map<string, { fill?: number; font?: number; align: string }>();
      for (const r of rules) {
        const m = new RegExp(
          `<numFmt numFmtId="(\\d+)" formatCode="${reEscape(xmlEscape(r.code))}"/>`,
        ).exec(xml);
        if (!m) continue;
        const s = r.style;
        let fill: number | undefined;
        let font: number | undefined;
        if (s.fill) {
          fill = fillIdx.get(s.fill);
          if (fill === undefined) {
            newFills += `<fill><patternFill patternType="solid"><fgColor rgb="${argb(s.fill)}"/><bgColor indexed="64"/></patternFill></fill>`;
            fill = fillCount++;
            fillIdx.set(s.fill, fill);
          }
        }
        if (s.color || s.size) {
          const key = `${s.color ?? ''}|${s.size ?? ''}`;
          font = fontIdx.get(key);
          if (font === undefined) {
            newFonts += `<font><sz val="${s.size ?? 10}"/>${s.color ? `<color rgb="${argb(s.color)}"/>` : ''}<name val="${xmlEscape(fontName)}"/><family val="2"/></font>`;
            font = fontCount++;
            fontIdx.set(key, font);
          }
        }
        patchFor.set(m[1], { fill, font, align: alignment(s) });
      }
      xml = xml.replace(
        fillsMatch[0],
        `<fills count="${fillCount}">${fillsMatch[2]}${newFills}</fills>`,
      );
      xml = xml.replace(
        fontsMatch[0],
        `<fonts count="${fontCount}"${fontsMatch[2]}>${fontsMatch[3]}${newFonts}</fonts>`,
      );
      xml = xml.replace(
        /<cellXfs count="(\d+)">([\s\S]*?)<\/cellXfs>/,
        (_all, count, body: string) => {
          const patched = body.replace(
            /<xf numFmtId="(\d+)"([^>]*?)\/>/g,
            (x: string, id: string, attrs: string) => {
              const p = patchFor.get(id);
              if (!p) return x;
              let a = attrs;
              if (p.fill !== undefined) a = a.replace(/fillId="\d+"/, `fillId="${p.fill}"`);
              if (p.font !== undefined) a = a.replace(/fontId="\d+"/, `fontId="${p.font}"`);
              const flags =
                (p.fill !== undefined ? ' applyFill="1"' : '') +
                (p.font !== undefined ? ' applyFont="1"' : '') +
                (p.align ? ' applyAlignment="1"' : '');
              return p.align
                ? `<xf numFmtId="${id}"${a}${flags}>${p.align}</xf>`
                : `<xf numFmtId="${id}"${a}${flags}/>`;
            },
          );
          return `<cellXfs count="${count}">${patched}</cellXfs>`;
        },
      );
    }
    write(si, xml);
  }

  sheets.forEach((setup, i) => {
    const wi = find(`/xl/worksheets/sheet${i + 1}.xml`);
    if (wi >= 0) write(wi, patchSheetXml(read(wi), setup, i === 0));
  });

  return new Uint8Array(
    XLSX.CFB.write(cfb, { fileType: 'zip', type: 'array' }) as ArrayLike<number>,
  );
}

// -------------------------------------------------------------------------------- grid

/** A sparse grid of values and per-cell number format codes, turned into a SheetJS sheet. */
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
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (cell) cell.z = z;
    }
    ws['!margins'] = { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 };
    return ws;
  }
}

const dateOf = (day: number | null | undefined) =>
  day === null || day === undefined ? '' : dayToLocalDate(day);
const isoDate = (iso: string | undefined) => (iso ? dayToLocalDate(isoToDay(iso)) : '');

// ------------------------------------------------------------------------------ workbook

/**
 * Workbook for management review: a Summary sheet (key figures, milestones, phases, watch
 * lists), the Tasks table (all tasks, with status and schedule signal) and a shaded Gantt at
 * weekly or monthly resolution that honours the chosen scope and date window.
 */
export function buildWorkbook(
  project: Project,
  derived: Derived,
  options: ReportOptions = EXCEL_DEFAULT_OPTIONS,
  today: number = todayDay(),
): Uint8Array {
  const report = buildReport(project, derived, options, today);
  const book = new StyleBook();
  const wb = XLSX.utils.book_new();
  const setups: SheetSetup[] = [];
  const names: string[] = [];
  const paper = options.paper;

  if (options.includeSummary) {
    XLSX.utils.book_append_sheet(wb, summarySheet(project, report, book), 'Summary');
    names.push('Summary');
    setups.push({ hideGridlines: true, paper });
  }
  const everything = buildReport(
    project,
    derived,
    { ...options, scope: 'all', range: 'project' },
    today,
  );
  XLSX.utils.book_append_sheet(wb, tasksSheet(project, derived, book, everything), 'Tasks');
  names.push('Tasks');
  setups.push({ freeze: { cols: 3, rows: 1 }, paper });
  XLSX.utils.book_append_sheet(wb, ganttSheet(report, book), 'Gantt');
  names.push('Gantt');
  setups.push({ freeze: { cols: 4, rows: 1 }, paper });

  // Print the header row on every page.
  wb.Workbook = {
    Names: names.flatMap((n, i) =>
      n === 'Summary' ? [] : [{ Name: '_xlnm.Print_Titles', Ref: `${n}!$1:$1`, Sheet: i }],
    ),
  };

  const raw = new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx', cellDates: true }));
  return applyStyles(raw, book.rules, setups);
}

// ------------------------------------------------------------------------------ summary

function summarySheet(project: Project, report: Report, book: StyleBook): XLSX.WorkSheet {
  const g = new Grid();
  const k = report.kpis;
  const LAST_COL = 7;
  let r = 0;

  const label = (c: number, text: string, style: CellStyle = {}) =>
    g.set(r, c, text, book.code(style));
  const dateCell = (c: number, day: number | null, style: CellStyle = {}) =>
    g.set(r, c, dateOf(day), book.code({ hAlign: 'left', ...style }, DATE_FMT));
  const signal = (c: number, s: ScheduleHealth) =>
    g.set(r, c, HEALTH_SIGNAL_LABEL[s], book.code({ color: SIGNAL_COLOR[s] }));
  const status = (c: number, s: TaskStatus) => g.set(r, c, STATUS_LABEL[s]);
  const variance = (c: number, v: number | null) =>
    g.set(
      r,
      c,
      v ?? '',
      book.code(
        { color: v !== null && v > 0 ? CRITICAL_COLOR : undefined, hAlign: 'right' },
        SIGNED,
      ),
    );
  const section = (title: string) => {
    r++;
    for (let c = 0; c <= LAST_COL; c++)
      g.set(r, c, c === 0 ? title.toUpperCase() : '', book.code({ fill: HEADER_FILL, size: 10 }));
    r++;
  };
  const header = (...heads: string[]) => {
    heads.forEach((h, c) =>
      g.set(r, c, h, book.code({ fill: BAND_FILL, wrap: true, vAlign: 'center' })),
    );
    r++;
  };

  g.set(r++, 0, 'VILLA FELSTEAD', book.code({ color: MOCCA, size: 9 }));
  g.set(r++, 0, project.name, book.code({ size: 18 }));
  g.set(
    r++,
    0,
    `Schedule report · status date ${fmtLong(k.statusDay)} · created ${fmtLong(report.generatedDay)}`,
    book.code({ color: MOCCA }),
  );

  section('Key figures');
  const kv = (name: string, put: () => void, note?: string) => {
    label(0, name);
    put();
    if (note) g.set(r, 2, note, book.code({ color: MOCCA }));
    r++;
  };
  kv('Project start', () => dateCell(1, k.projectStart));
  kv('Project finish', () => dateCell(1, k.projectFinish));
  kv(
    'Baseline finish',
    () =>
      k.baselineFinish === null ? label(1, 'No active baseline') : dateCell(1, k.baselineFinish),
    k.baselineName ?? undefined,
  );
  kv(
    'Finish variance (working days)',
    () => variance(1, k.finishVariance),
    'Positive = later than the baseline',
  );
  kv('Status date', () => dateCell(1, k.statusDay));
  kv(
    'Overall complete',
    () => g.set(r, 1, k.percentComplete / 100, book.code({ hAlign: 'left' }, '0.0%')),
    'Weighted by task duration',
  );
  kv('Tasks', () => g.set(r, 1, k.taskCount, book.code({ hAlign: 'left' }, '0')));
  kv('Milestones', () => g.set(r, 1, k.milestoneCount, book.code({ hAlign: 'left' }, '0')));
  kv('Critical tasks remaining', () =>
    g.set(
      r,
      1,
      k.criticalRemaining,
      book.code({ hAlign: 'left', color: k.criticalRemaining ? CRITICAL_COLOR : undefined }, '0'),
    ),
  );
  kv(
    'Slipped against the baseline',
    () => g.set(r, 1, k.slippedCount, book.code({ hAlign: 'left' }, '0')),
    'Tasks finishing later than planned',
  );
  r++;
  header('Schedule signal', 'Tasks');
  for (const s of ['late', 'atRisk', 'onTrack', 'complete'] as ScheduleHealth[]) {
    signal(0, s);
    g.set(r++, 1, k.signalCounts[s], book.code({ hAlign: 'left' }, '0'));
  }
  r++;
  header('Status', 'Tasks');
  for (const s of ['notStarted', 'inProgress', 'onHold', 'blocked', 'complete'] as TaskStatus[]) {
    status(0, s);
    g.set(r++, 1, k.statusCounts[s], book.code({ hAlign: 'left' }, '0'));
  }

  section('Milestones');
  header(
    'Milestone',
    'Phase',
    'Planned',
    'Baseline',
    'Variance (working days)',
    'Status',
    'Schedule signal',
  );
  for (const m of report.milestones) {
    label(0, m.name);
    label(1, m.phaseName);
    dateCell(2, m.planned);
    dateCell(3, m.baseline);
    variance(4, m.variance);
    status(5, m.status);
    signal(6, m.signal);
    r++;
  }

  section('Phases');
  header(
    'Phase',
    'Status',
    'Start',
    'Finish',
    'Duration (working days)',
    'Complete',
    'Schedule signal',
    'Variance (working days)',
  );
  for (const p of report.phases) {
    label(0, p.name);
    status(1, p.status);
    dateCell(2, p.start);
    dateCell(3, p.finish);
    g.set(r, 4, p.duration, book.code({ hAlign: 'right' }, '0'));
    g.set(r, 5, p.percent / 100, book.code({ hAlign: 'right' }, '0%'));
    signal(6, p.signal);
    variance(7, p.variance);
    r++;
  }

  section('Top 10 slipping or late tasks');
  if (report.slipping.length) {
    header(
      'Task',
      'Phase',
      'Finish',
      'Baseline finish',
      'Variance (working days)',
      'Float (working days)',
      'Schedule signal',
    );
    for (const t of report.slipping) {
      label(0, t.name);
      label(1, t.phaseName);
      dateCell(2, t.finish);
      dateCell(3, t.baselineFinish);
      variance(4, t.variance);
      g.set(r, 5, t.totalFloat ?? '', book.code({ hAlign: 'right' }, '0'));
      signal(6, t.signal);
      r++;
    }
  } else {
    label(0, 'None: no open task is late or behind its baseline.', { color: MOCCA });
    r++;
  }

  section(
    `Next four weeks (${fmtLong(report.nextWindow.from)} to ${fmtLong(report.nextWindow.to - 1)})`,
  );
  if (report.nextWeeks.length) {
    header('Task', 'Phase', 'Start', 'Finish', 'What happens', 'Complete', 'Schedule signal');
    for (const t of report.nextWeeks) {
      label(0, t.name);
      label(1, t.phaseName);
      dateCell(2, t.start);
      dateCell(3, t.finish);
      label(4, t.event === 'milestone' ? 'Milestone' : `Task ${t.event}`);
      g.set(r, 5, t.percent / 100, book.code({ hAlign: 'right' }, '0%'));
      signal(6, t.signal);
      r++;
    }
  } else {
    label(0, 'Nothing starts or finishes in this period.', { color: MOCCA });
    r++;
  }

  const ws = g.toSheet();
  ws['!cols'] = [44, 26, 17, 17, 16, 16, 16, 16].map((wch) => ({ wch }));
  return ws;
}

// --------------------------------------------------------------------------------- tasks

function tasksSheet(
  project: Project,
  derived: Derived,
  book: StyleBook,
  report: Report,
): XLSX.WorkSheet {
  const { outline, schedule } = derived;
  const bl = activeBaseline(project);
  const links = linkTexts(project);
  const byId = new Map(report.rows.map((x) => [x.id, x]));

  interface Col {
    header: string;
    width: number;
    z?: string;
    value: (id: string) => unknown;
    style?: (id: string) => CellStyle;
  }
  const cols: Col[] = [
    { header: 'ID', width: 6, value: (id) => outline.byId.get(id)!.rowId },
    { header: 'WBS', width: 8, value: (id) => outline.wbs.get(id) ?? '' },
    {
      header: 'Name',
      width: 50,
      value: (id) => `${'    '.repeat(outline.depth.get(id) ?? 0)}${outline.byId.get(id)!.name}`,
    },
    {
      header: 'Duration (working days)',
      width: 11,
      value: (id) => {
        const c = schedule.calc.get(id);
        return c ? (outline.isSummary(id) ? c.duration : outline.byId.get(id)!.duration) : '';
      },
    },
    { header: 'Start', width: 14, z: DATE_FMT, value: (id) => dateOf(schedule.calc.get(id)?.es) },
    { header: 'Finish', width: 14, z: DATE_FMT, value: (id) => dateOf(byId.get(id)?.finish) },
    {
      header: 'Status',
      width: 13,
      value: (id) => (byId.has(id) ? STATUS_LABEL[byId.get(id)!.status] : ''),
    },
    {
      header: 'Schedule signal',
      width: 14,
      value: (id) => (byId.has(id) ? HEALTH_SIGNAL_LABEL[byId.get(id)!.signal] : ''),
      style: (id) => ({ color: SIGNAL_COLOR[byId.get(id)?.signal ?? 'onTrack'] }),
    },
    { header: 'Predecessors', width: 18, value: (id) => links.preds.get(id) ?? '' },
    { header: 'Successors', width: 18, value: (id) => links.succs.get(id) ?? '' },
    { header: 'Responsible', width: 22, value: (id) => outline.byId.get(id)!.responsible },
    {
      header: 'Percent complete',
      width: 10,
      z: '0%',
      value: (id) => {
        const c = schedule.calc.get(id);
        return c ? Math.round(c.percentComplete) / 100 : '';
      },
    },
    {
      header: 'Total float (working days)',
      width: 12,
      value: (id) => schedule.calc.get(id)?.totalFloat ?? '',
    },
    {
      header: 'Free float (working days)',
      width: 12,
      value: (id) => schedule.calc.get(id)?.freeFloat ?? '',
    },
    { header: 'Critical', width: 8, value: (id) => (schedule.calc.get(id)?.critical ? 'Yes' : '') },
    {
      header: 'Baseline start',
      width: 14,
      z: DATE_FMT,
      value: (id) => isoDate(bl?.tasks[id]?.start),
    },
    {
      header: 'Baseline finish',
      width: 14,
      z: DATE_FMT,
      value: (id) => isoDate(bl?.tasks[id]?.finish),
    },
    {
      header: 'Finish variance (working days)',
      width: 14,
      z: SIGNED,
      value: (id) => byId.get(id)?.variance ?? '',
      style: (id) => ({ color: (byId.get(id)?.variance ?? 0) > 0 ? CRITICAL_COLOR : undefined }),
    },
    {
      header: 'Constraint',
      width: 20,
      value: (id) => {
        const t = outline.byId.get(id)!;
        return t.constraint.type === 'ASAP' ? '' : CONSTRAINT_LABEL[t.constraint.type];
      },
    },
    {
      header: 'Constraint date',
      width: 14,
      z: DATE_FMT,
      value: (id) => isoDate(outline.byId.get(id)!.constraint.date),
    },
    {
      header: 'Actual start',
      width: 14,
      z: DATE_FMT,
      value: (id) => isoDate(outline.byId.get(id)!.actualStart),
    },
    {
      header: 'Actual finish',
      width: 14,
      z: DATE_FMT,
      value: (id) => isoDate(outline.byId.get(id)!.actualFinish),
    },
    { header: 'Notes', width: 40, value: (id) => outline.byId.get(id)!.notes },
  ];

  const g = new Grid();
  const head = book.code({ fill: HEADER_FILL, wrap: true, vAlign: 'center' });
  cols.forEach((c, i) => g.set(0, i, c.header, head));
  outline.flat.forEach((id, idx) => {
    const phase = outline.depth.get(id) === 0 && outline.isSummary(id);
    cols.forEach((c, i) => {
      const style: CellStyle = { ...(phase ? { fill: BAND_FILL } : {}), ...(c.style?.(id) ?? {}) };
      const v = c.value(id);
      const plain = Object.keys(style).length === 0;
      const z = plain ? c.z : book.code(style, c.z ?? (typeof v === 'string' ? 'text' : '0'));
      g.set(idx + 1, i, v, z);
    });
  });
  const ws = g.toSheet();
  ws['!cols'] = cols.map((c) => ({ wch: c.width }));
  ws['!rows'] = [{ hpt: 32 }];
  ws['!autofilter'] = {
    ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: 0, c: cols.length - 1 } }),
  };
  return ws;
}

// --------------------------------------------------------------------------------- gantt

function ganttSheet(report: Report, book: StyleBook): XLSX.WorkSheet {
  const unit = excelUnit(report);
  const columns = excelColumns(report);
  const FIRST = 4;
  const g = new Grid();

  const headFmt = unit === 'month' ? 'mmm yy' : 'dd mmm yy';
  const head = book.code({ fill: HEADER_FILL, wrap: true, vAlign: 'center' });
  ['ID', 'Task', 'Start', 'Finish'].forEach((h, c) => g.set(0, c, h, head));
  const statusCol = columns.findIndex(
    (d, i) => report.statusDay >= d && report.statusDay < (columns[i + 1] ?? Infinity),
  );
  columns.forEach((d, k) => {
    const marked = k === statusCol;
    g.set(
      0,
      FIRST + k,
      dayToLocalDate(d),
      book.code(
        {
          fill: marked ? '#462F28' : HEADER_FILL,
          color: marked ? WHITE : undefined,
          rotate: 90,
          hAlign: 'center',
          vAlign: 'center',
        },
        headFmt,
      ),
    );
  });

  report.rows.forEach((row, idx) => {
    const r = idx + 1;
    const phase = row.kind === 'phase';
    const band: CellStyle = phase ? { fill: BAND_FILL } : {};
    g.set(r, 0, row.rowId, book.code(band, '0'));
    g.set(r, 1, `${'  '.repeat(row.depth)}${row.name}`, book.code(band));
    g.set(r, 2, dateOf(row.start), book.code(band, 'dd.mm.yy'));
    g.set(r, 3, dateOf(row.finish), book.code(band, 'dd.mm.yy'));
    const summary = row.kind === 'phase' || row.kind === 'summary';
    const color = summary
      ? SUMMARY_COLOR
      : report.options.highlightCritical && row.critical
        ? CRITICAL_COLOR
        : row.color;
    const showBaseline =
      report.options.includeBaseline && row.baselineStart !== null && row.baselineFinish !== null;
    columns.forEach((d, k) => {
      const next = columns[k + 1] ?? report.window.to + 7;
      const c = FIRST + k;
      if (row.kind === 'milestone') {
        if (row.start >= d && row.start < next) {
          g.set(r, c, '◆', book.code({ fill: color, color: WHITE, hAlign: 'center' }, 'hide'));
          return;
        }
      } else if (row.start < next && row.finish >= d) {
        g.set(r, c, 1, book.code({ fill: color }, 'hide'));
        return;
      }
      if (showBaseline && row.baselineStart! < next && row.baselineFinish! >= d) {
        g.set(r, c, 1, book.code({ fill: BASELINE_COLOR }, 'hide'));
      }
    });
  });

  const ws = g.toSheet();
  const colWidth = unit === 'month' ? 5.2 : 3.2;
  ws['!cols'] = [
    { wch: 5 },
    { wch: 42 },
    { wch: 9 },
    { wch: 9 },
    ...columns.map(() => ({ wch: colWidth })),
  ];
  ws['!rows'] = [{ hpt: 54 }];
  return ws;
}
