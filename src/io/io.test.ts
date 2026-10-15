import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { scheduleProject } from '../engine';
import { derive } from '../store/derive';
import { projectFromTemplate } from '../template/load';
import { projectFromCsv } from './csv';
import { buildWorkbook } from './excel';
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

describe('Excel export', () => {
  const bytes = buildWorkbook(project, derived);
  const wb = XLSX.read(bytes, { type: 'array', cellDates: true });

  it('has a task sheet with all tasks, indented names and real dates', () => {
    expect(wb.SheetNames).toEqual(['Tasks', 'Gantt (weekly)']);
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets.Tasks, { header: 1 });
    expect(rows).toHaveLength(project.tasks.length + 1);
    expect(rows[0]).toContain('Predecessors');
    expect(rows[2][2]).toBe('    Site identified');
    expect(wb.Sheets.Tasks.E3.t).toBe('d');
  });

  it('shades Gantt cells with solid fills', () => {
    const cfb = XLSX.CFB.read(bytes, { type: 'array' });
    const styles = new TextDecoder().decode(
      cfb.FileIndex[cfb.FullPaths.findIndex((p: string) => p.endsWith('/xl/styles.xml'))]
        .content as Uint8Array,
    );
    const solid = styles.match(/patternType="solid"/g) ?? [];
    // 11 phase colours + critical red + summary grey.
    expect(solid.length).toBeGreaterThanOrEqual(12);
    expect(styles).toContain('rgb="FFB3261E"');
    expect(styles).toMatch(
      /fillId="\d+" borderId="0" xfId="0" applyNumberFormat="1" applyFill="1"/,
    );
    const ws = wb.Sheets['Gantt (weekly)'];
    const ref = XLSX.utils.decode_range(ws['!ref']!);
    expect(ref.e.c).toBeGreaterThan(150); // ~3 years of weeks
    const milestone = Object.values(ws).find((c) => (c as XLSX.CellObject)?.v === '◆');
    expect(milestone).toBeDefined();
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
