import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { scheduleProject } from '../engine';
import { derive } from '../store/derive';
import { projectFromTemplate } from '../template/load';
import { projectFromCsv } from './csv';
import { buildWorkbook } from './excel';
import { DEFAULT_OPTIONS } from './report';
import { projectFromJson, projectToJson } from './json';
import { projectToMsProjectXml } from './msproject';

const project = projectFromTemplate('IO test', '2026-11-02');
const derived = derive(project);

describe('JSON export/import', () => {
  it('round-trips and gets a fresh id', () => {
    const text = projectToJson(project, derived.schedule);
    expect(JSON.parse(text).schemaVersion).toBe(1);
    expect(JSON.parse(text).project.tasks[1].calc.earlyStart).toBe('2026-11-02');
    const back = projectFromJson(text);
    expect(back.id).not.toBe(project.id);
    expect(back.tasks).toEqual(project.tasks);
    expect(scheduleProject(back).projectFinish).toBe(derived.schedule.projectFinish);
  });
  it('reports invalid JSON', () => {
    expect(() => projectFromJson('{nope')).toThrow(/not valid JSON/);
  });
});

/** Child element names of an XML element at depth 1 (the worksheet's direct children). */
function topLevelOrder(xml: string): string[] {
  const out: string[] = [];
  let depth = 0;
  for (const m of xml.matchAll(/<(\/?)([A-Za-z][\w:]*)[^>]*?(\/?)>/g)) {
    const [, closing, name, selfClosing] = m;
    if (closing) {
      depth--;
      continue;
    }
    if (depth === 1) out.push(name);
    if (!selfClosing) depth++;
  }
  return out;
}

const SCHEMA_ORDER = [
  'sheetPr',
  'dimension',
  'sheetViews',
  'sheetFormatPr',
  'cols',
  'sheetData',
  'sheetCalcPr',
  'sheetProtection',
  'protectedRanges',
  'scenarios',
  'autoFilter',
  'sortState',
  'dataConsolidate',
  'customSheetViews',
  'mergeCells',
  'phoneticPr',
  'conditionalFormatting',
  'dataValidations',
  'hyperlinks',
  'printOptions',
  'pageMargins',
  'pageSetup',
  'headerFooter',
  'rowBreaks',
  'colBreaks',
  'customProperties',
  'cellWatches',
  'ignoredErrors',
  'smartTags',
  'drawing',
  'legacyDrawing',
];

function zipText(bytes: Uint8Array, suffix: string): string {
  const cfb = XLSX.CFB.read(bytes, { type: 'array' });
  const i = cfb.FullPaths.findIndex((p: string) => p.endsWith(suffix));
  if (i < 0) throw new Error(`missing ${suffix}`);
  return new TextDecoder().decode(cfb.FileIndex[i].content as Uint8Array);
}

describe('Excel export', () => {
  const bytes = buildWorkbook(project, derived);
  const wb = XLSX.read(bytes, { type: 'array', cellDates: true });

  it('has Summary, Tasks and Gantt sheets', () => {
    expect(wb.SheetNames).toEqual(['Summary', 'Tasks', 'Gantt']);
    const noSummary = XLSX.read(
      buildWorkbook(project, derived, { ...DEFAULT_OPTIONS, includeSummary: false }),
      { type: 'array' },
    );
    expect(noSummary.SheetNames).toEqual(['Tasks', 'Gantt']);
  });

  it('has a task sheet with all tasks, indented names, status, signal and real dates', () => {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets.Tasks, { header: 1 });
    expect(rows).toHaveLength(project.tasks.length + 1);
    expect(rows[0]).toContain('Predecessors');
    expect(rows[0]).toContain('Status');
    expect(rows[0]).toContain('Schedule signal');
    expect(rows[2][2]).toBe('    Site identified');
    expect(rows[2][rows[0].indexOf('Status')]).toBe('Not started');
    expect(rows[2][rows[0].indexOf('Schedule signal')]).toBe('On track');
    expect(wb.Sheets.Tasks.E3.t).toBe('d');
  });

  it('shades Gantt cells with solid fills', () => {
    const styles = zipText(bytes, '/xl/styles.xml');
    const solid = styles.match(/patternType="solid"/g) ?? [];
    // 11 phase colours + critical red + summary dark + baseline grey + header fills.
    expect(solid.length).toBeGreaterThanOrEqual(14);
    expect(styles).toContain('rgb="FFB3261E"');
    expect(styles).toMatch(
      /fillId="\d+" borderId="0" xfId="0" applyNumberFormat="1" applyFill="1"/,
    );
    const ws = wb.Sheets.Gantt;
    const ref = XLSX.utils.decode_range(ws['!ref']!);
    expect(ref.e.c).toBe(4 + 38 - 1); // monthly columns for about three years
    const milestone = Object.values(ws).find((c) => (c as XLSX.CellObject)?.v === '◆');
    expect(milestone).toBeDefined();
  });

  it('keeps style tables consistent and uses the brand font', () => {
    const styles = zipText(bytes, '/xl/styles.xml');
    const count = (tag: string, child: string) => {
      const m = new RegExp(`<${tag} count="(\\d+)"[^>]*>([\\s\\S]*?)</${tag}>`).exec(styles)!;
      return [Number(m[1]), (m[2].match(new RegExp(`<${child}[ >/]`, 'g')) ?? []).length];
    };
    for (const [tag, child] of [
      ['fonts', 'font'],
      ['fills', 'fill'],
      ['cellXfs', 'xf'],
    ]) {
      const [declared, actual] = count(tag, child);
      expect(declared, tag).toBe(actual);
    }
    expect(styles).toContain('<name val="GT Standard M"/>');
    expect(styles).not.toContain('Calibri');
    expect(styles).not.toContain('<scheme');
    expect(styles).toContain('textRotation="90"');
    // Excel allows at most four sections (positive;negative;zero;text) in a number format.
    for (const m of styles.matchAll(/formatCode="([^"]*)"/g)) {
      const code = m[1].replace(/&quot;/g, '"').replace(/"[^"]*"/g, '');
      expect(code.split(';').length, m[1]).toBeLessThanOrEqual(4);
    }
    // Every fillId / fontId used by a cell format exists.
    const fills = count('fills', 'fill')[1];
    const fonts = count('fonts', 'font')[1];
    for (const m of styles.matchAll(/<xf [^>]*fillId="(\d+)"/g)) expect(+m[1]).toBeLessThan(fills);
    for (const m of styles.matchAll(/<xf [^>]*fontId="(\d+)"/g)) expect(+m[1]).toBeLessThan(fonts);
  });

  it('freezes header row and name columns, in landscape, fit to one page wide', () => {
    const tasks = zipText(bytes, '/xl/worksheets/sheet2.xml');
    const gantt = zipText(bytes, '/xl/worksheets/sheet3.xml');
    expect(tasks).toContain(
      '<pane xSplit="3" ySplit="1" topLeftCell="D2" activePane="bottomRight" state="frozen"/>',
    );
    expect(gantt).toContain(
      '<pane xSplit="4" ySplit="1" topLeftCell="E2" activePane="bottomRight" state="frozen"/>',
    );
    for (const xml of [tasks, gantt]) {
      expect(xml).toContain('<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>');
      expect(xml).toContain(
        '<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>',
      );
    }
    // A3 paper is honoured.
    const a3 = zipText(
      buildWorkbook(project, derived, { ...DEFAULT_OPTIONS, paper: 'A3' }),
      '/xl/worksheets/sheet3.xml',
    );
    expect(a3).toContain('paperSize="8"');
  });

  it('writes sheet elements in schema order on every sheet', () => {
    for (const n of [1, 2, 3]) {
      const xml = zipText(bytes, `/xl/worksheets/sheet${n}.xml`).replace(
        /<sheetData>[\s\S]*<\/sheetData>/,
        '<sheetData/>',
      );
      const order = topLevelOrder(xml);
      const positions = order.map((name) => SCHEMA_ORDER.indexOf(name));
      expect(
        positions.every((p) => p >= 0),
        order.join(),
      ).toBe(true);
      expect(positions, order.join()).toEqual([...positions].sort((a, b) => a - b));
      expect(order).toContain('pageMargins');
      expect(order.indexOf('pageSetup')).toBe(order.indexOf('pageMargins') + 1);
      expect(order[0]).toBe('sheetPr');
      expect(xml.match(/<sheetView\b/g)).toHaveLength(1);
    }
  });

  it('is readable by SheetJS with print titles and the filter intact', () => {
    const wbXml = zipText(bytes, '/xl/workbook.xml');
    expect(wbXml).toContain('_xlnm.Print_Titles');
    expect(wbXml).toContain('_xlnm._FilterDatabase');
    expect(wb.Sheets.Tasks['!autofilter']).toBeDefined();
    const summary = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets.Summary, { header: 1 });
    const flat = summary.flat().map(String);
    expect(flat).toContain('VILLA FELSTEAD');
    expect(flat).toContain('Project finish');
    expect(flat).toContain('Project complete'); // milestone table
    expect(flat).toContain('Acquisition & Feasibility'); // phase table
  });

  it('honours scope, date window and scale on the Gantt sheet', () => {
    const phases = XLSX.read(
      buildWorkbook(project, derived, { ...DEFAULT_OPTIONS, scope: 'phases' }),
      { type: 'array' },
    );
    expect(XLSX.utils.sheet_to_json(phases.Sheets.Gantt, { header: 1 })).toHaveLength(12);

    const weekly = XLSX.read(
      buildWorkbook(project, derived, {
        ...DEFAULT_OPTIONS,
        range: 'custom',
        customFrom: '2027-01-04',
        customTo: '2027-03-28',
      }),
      { type: 'array', cellDates: true },
    );
    const ws = weekly.Sheets.Gantt;
    const ref = XLSX.utils.decode_range(ws['!ref']!);
    expect(ref.e.c).toBe(4 + 12 - 1); // 12 weekly columns, the first is Monday 4 January 2027
    expect(XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1 }).length).toBeLessThan(
      project.tasks.length,
    );
  });
});

describe('CSV import', () => {
  const csv = [
    'Name,Duration,Predecessors,Parent WBS,Responsible',
    'Phase A,,,,',
    'Design,10,,1,Architect',
    'Permit,20d,2,1,City',
    'Phase B,,,,',
    'Build,2w,"3FS+5d, 2SS",2,GC',
    'Done,0,5,,Owner',
    'Bad,abc,99,9.9,',
  ].join('\n');
  const { project: p, warnings } = projectFromCsv(csv, 'CSV');
  const by = (n: string) => p.tasks.find((t) => t.name === n)!;

  it('builds the hierarchy from Parent WBS', () => {
    expect(by('Design').parentId).toBe(by('Phase A').id);
    expect(by('Build').parentId).toBe(by('Phase B').id);
    expect(by('Done').parentId).toBeNull();
    expect(p.tasks.map((t) => t.rowId)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('parses durations, predecessors (by CSV row) and responsible', () => {
    expect(by('Permit').duration).toBe(20);
    expect(by('Build').duration).toBe(10);
    expect(by('Done').duration).toBe(0);
    expect(by('Build').responsible).toBe('GC');
    const preds = p.dependencies.filter((d) => d.successorId === by('Build').id);
    expect(
      preds.map((d) => [p.tasks.find((t) => t.id === d.predecessorId)!.name, d.type, d.lag]),
    ).toEqual([
      ['Permit', 'FS', 5],
      ['Design', 'SS', 0],
    ]);
    const s = scheduleProject(p);
    expect(s.cycles).toEqual([]);
  });

  it('warns about bad rows but keeps importing', () => {
    expect(warnings.join('\n')).toMatch(/duration "abc"/);
    expect(warnings.join('\n')).toMatch(/row 99 not found/);
    expect(warnings.join('\n')).toMatch(/parent WBS "9.9" not found/);
    expect(by('Bad').duration).toBe(1);
  });

  it('skips links that would create a cycle', () => {
    const r = projectFromCsv('Name,Duration,Predecessors\nA,1,2\nB,1,1', 'cyc');
    expect(r.project.dependencies).toHaveLength(1);
    expect(r.warnings.join()).toMatch(/Circular dependency/);
  });
});

describe('MS Project XML export', () => {
  it('writes tasks, links, calendars and constraints', () => {
    const xml = projectToMsProjectXml(project, derived);
    expect(xml.startsWith('<?xml')).toBe(true);
    expect((xml.match(/<Task>/g) ?? []).length).toBe(project.tasks.length);
    expect((xml.match(/<PredecessorLink>/g) ?? []).length).toBe(project.dependencies.length);
    expect(xml).toContain('<Name>Site identified</Name>');
    expect(xml).toContain('<LinkLag>96000</LinkLag>'); // D05: SS+20d → 20 × 480 min × 10
    expect(xml).toContain('<Name>7-day</Name>');
  });
});
