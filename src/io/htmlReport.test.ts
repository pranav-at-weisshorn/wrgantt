import { describe, expect, it } from 'vitest';
import { isoToDay } from '../engine';
import { derive } from '../store/derive';
import { projectFromTemplate } from '../template/load';
import { buildHtmlReport, htmlReportFileName } from './htmlReport';
import { DEFAULT_OPTIONS } from './report';

const TODAY = isoToDay('2026-11-09');
const project = projectFromTemplate('Villa <Felstead> & "Co"', '2026-11-02');
const html = buildHtmlReport(project, derive(project), DEFAULT_OPTIONS, TODAY);

const dataOf = (text: string) => {
  const m = /<script type="application\/json" id="data">([\s\S]*?)<\/script>/.exec(text)!;
  return JSON.parse(m[1]);
};
const scriptOf = (text: string) => {
  const all = [...text.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  expect(all).toHaveLength(1);
  return all[0][1];
};

describe('web page report', () => {
  it('is one HTML document with the project data embedded', () => {
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    const data = dataOf(html);
    expect(data.project).toBe('Villa <Felstead> & "Co"');
    expect(data.rows).toHaveLength(project.tasks.length);
    expect(data.milestones).toHaveLength(18);
    expect(data.phases).toHaveLength(11);
    expect(data.kpis.taskCount).toBe(project.tasks.length - 11);
    expect(data.today).toBe(TODAY);
    expect(Object.keys(data.ticks.bottom)).toEqual(['week', 'month', 'quarter']);
    expect(data.ticks.top.year.length).toBeGreaterThanOrEqual(4);
    expect(data.axis.to).toBeGreaterThan(data.axis.from);
    expect(html).toContain('<meta name="viewport" content="width=device-width');
    expect(html).toContain('GT Standard');
  });

  it('references nothing outside the file', () => {
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toMatch(/<link\b/i);
    expect(html).not.toMatch(/<script[^>]+src=/i);
    // Only in-page references such as url(#hatch) are allowed.
    expect(html).not.toMatch(/\burl\((?!#)/);
    expect(html).not.toMatch(/\b(fetch|XMLHttpRequest|import\()/);
  });

  it('has a script that parses', () => {
    expect(() => new Function(scriptOf(html))).not.toThrow();
  });

  it('escapes the project name in markup and embedded data', () => {
    expect(html).toContain(
      '<title>Villa &lt;Felstead&gt; &amp; &quot;Co&quot; – schedule report</title>',
    );
    const hostile = projectFromTemplate('</script><img src=x onerror=alert(1)>', '2026-11-02');
    const text = buildHtmlReport(hostile, derive(hostile), DEFAULT_OPTIONS, TODAY);
    expect(text).not.toContain('</script><img');
    expect(text).not.toContain('<img');
    expect(dataOf(text).project).toBe('</script><img src=x onerror=alert(1)>');
  });

  it('honours scope, window and summary options', () => {
    const phases = dataOf(
      buildHtmlReport(project, derive(project), { ...DEFAULT_OPTIONS, scope: 'phases' }, TODAY),
    );
    expect(phases.rows).toHaveLength(11);
    const noSummary = dataOf(
      buildHtmlReport(
        project,
        derive(project),
        { ...DEFAULT_OPTIONS, includeSummary: false },
        TODAY,
      ),
    );
    expect(noSummary.summary).toBe(false);
    const ahead = dataOf(
      buildHtmlReport(
        project,
        derive(project),
        { ...DEFAULT_OPTIONS, range: 'lookAhead', lookAheadWeeks: 6 },
        TODAY,
      ),
    );
    expect(ahead.fit).toBe(true);
    expect(ahead.rows.length).toBeLessThan(60);
  });

  it('names the download after the project and the date', () => {
    expect(htmlReportFileName(project, TODAY)).toBe(
      'Villa -Felstead- & -Co- – schedule report 2026-11-09.html',
    );
  });
});
