import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { derive } from '../store/derive';
import { projectFromTemplate } from '../template/load';
import { buildWorkbook } from './excel';
import { buildHtmlReport } from './htmlReport';
import { buildReport, DEFAULT_OPTIONS } from './report';

// Template with worst-case extra time on a critical task (A03) and a milestone-adjacent task.
const project = projectFromTemplate('Worst', '2026-11-02');
const a03 = project.tasks.find((t) => t.templateKey === 'A03')!;
const h07 = project.tasks.find((t) => t.templateKey === 'H07')!;
a03.worstCaseDays = 15;
h07.worstCaseDays = 10;
const derived = derive(project);
const opts = { ...DEFAULT_OPTIONS, scope: 'all' as const };

describe('worst case in exports', () => {
  const report = buildReport(project, derived, opts);
  const row = (key: string) =>
    report.rows.find((r) => r.id === project.tasks.find((t) => t.templateKey === key)!.id)!;

  it('report rows carry the extension and the knock-on worst-case dates', () => {
    expect(row('A03').worstCaseDays).toBe(15);
    expect(row('A03').worstEnd).toBeGreaterThan(row('A03').finish);
    // A03 is critical, so everything after it moves in the worst case.
    expect(row('H08').worstFinish).toBeGreaterThan(row('H08').finish);
    // Phases and milestones extend to their worst-case (knock-on) date.
    expect(row('P1').worstEnd).toBe(row('P1').worstFinish);
    expect(row('P11').worstEnd).toBe(row('P11').worstFinish);
    expect(row('H08').worstEnd).toBe(row('H08').worstFinish);
    expect(row('A01').worstEnd).toBeNull(); // nothing before the project start can overrun
  });

  it('key figures give the worst-case finish and delay; the window includes it', () => {
    const k = report.kpis;
    expect(k.worstCaseFinish).not.toBeNull();
    expect(k.worstCaseDelay).toBe(25); // 15 on the critical path + 10 on the last task
    expect(report.window.to).toBeGreaterThan(k.worstCaseFinish!);
    expect(report.milestones.find((m) => m.name === 'Project complete')!.worstCase).not.toBeNull();
  });

  it('can be switched off', () => {
    const off = buildReport(project, derived, { ...opts, includeWorstCase: false });
    expect(off.rows.every((r) => r.worstEnd === null && r.worstFinish === null)).toBe(true);
    expect(off.kpis.worstCaseFinish).toBeNull();
  });

  it('Excel: hatched Gantt cells, worst-case columns and key figure', () => {
    const bytes = buildWorkbook(project, derived, opts);
    const cfb = XLSX.CFB.read(bytes, { type: 'array' });
    const file = (end: string) =>
      new TextDecoder().decode(
        cfb.FileIndex[cfb.FullPaths.findIndex((p: string) => p.endsWith(end))]
          .content as Uint8Array,
      );
    expect(file('/xl/styles.xml')).toContain('patternType="lightUp"');
    const wb = XLSX.read(bytes, { type: 'array' });
    const tasks = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets.Tasks, { header: 1 });
    expect(tasks[0]).toContain('Worst case (extra working days)');
    expect(tasks[0]).toContain('Finish (worst case)');
    const summary = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets.Summary, { header: 1 });
    expect(summary.some((r) => r[0] === 'Worst-case finish')).toBe(true);
  });

  it('web page embeds the worst-case data', () => {
    const html = buildHtmlReport(project, derived, opts);
    expect(html).toContain('"worstCaseFinish"');
    expect(html).toContain('"wd":15');
    expect(html).toContain("url(#' + (hc ? 'whc' : 'wh') + ')");
  });
});
