import { describe, expect, it } from 'vitest';
import { dayToIso, isoToDay, makeBaseline, type Project } from '../engine';
import { derive } from '../store/derive';
import { projectFromTemplate } from '../template/load';
import {
  buildReport,
  DEFAULT_OPTIONS,
  describeReport,
  excelColumns,
  excelUnit,
  resolveUnit,
  worstSignal,
  type ReportOptions,
} from './report';

const base = projectFromTemplate('T', '2026-11-02');
const TODAY = isoToDay('2026-11-02');
const opts = (patch: Partial<ReportOptions> = {}): ReportOptions => ({
  ...DEFAULT_OPTIONS,
  ...patch,
});
const report = (patch: Partial<ReportOptions> = {}, p: Project = base) =>
  buildReport(p, derive(p), opts(patch), TODAY);

/** The template with an active baseline, a task that slipped and some progress. */
function slippedProject(): Project {
  const p = structuredClone(base);
  const d0 = derive(p);
  const bl = makeBaseline(p, d0.schedule, 'bl1', 'Baseline 1', '2026-11-02T00:00:00Z');
  p.baselines.push(bl);
  p.activeBaselineId = 'bl1';
  // Slip the first task on the critical path by 10 working days.
  const first = p.tasks.find((t) => t.templateKey === 'A03')!;
  first.duration += 10;
  // Two finished tasks and one half-done task.
  const a01 = p.tasks.find((t) => t.templateKey === 'A01')!;
  a01.percentComplete = 100;
  a01.actualStart = '2026-11-02';
  a01.actualFinish = '2026-11-02';
  const a02 = p.tasks.find((t) => t.templateKey === 'A02')!;
  a02.percentComplete = 50;
  a02.actualStart = '2026-11-02';
  return structuredClone(p);
}

describe('rows and scope', () => {
  it('lists every task for scope "all", with phases at depth 0', () => {
    const r = report();
    expect(r.rows).toHaveLength(base.tasks.length);
    expect(r.rows[0].kind).toBe('phase');
    expect(r.rows[0].depth).toBe(0);
    expect(r.rows[1].depth).toBe(1);
    expect(r.rows.filter((x) => x.kind === 'phase')).toHaveLength(11);
    expect(r.rows.filter((x) => x.kind === 'milestone')).toHaveLength(18);
  });

  it('"phases" keeps only the top-level phases', () => {
    const r = report({ scope: 'phases' });
    expect(r.rows).toHaveLength(11);
    expect(r.rows.every((x) => x.kind === 'phase')).toBe(true);
  });

  it('"phasesAndMilestones" keeps phases and milestones, milestones indented once', () => {
    const r = report({ scope: 'phasesAndMilestones' });
    expect(r.rows).toHaveLength(11 + 18);
    const ms = r.rows.filter((x) => x.kind === 'milestone');
    expect(ms).toHaveLength(18);
    expect(ms.every((x) => x.depth === 1)).toBe(true);
    expect(r.rows[0].kind).toBe('phase');
  });

  it('"milestones" lists milestones only, in date order', () => {
    const r = report({ scope: 'milestones' });
    expect(r.rows).toHaveLength(18);
    expect(r.rows.every((x) => x.kind === 'milestone' && x.depth === 0)).toBe(true);
    const starts = r.rows.map((x) => x.start);
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
  });
});

describe('date window', () => {
  const custom = { range: 'custom' as const, customFrom: '2027-01-01', customTo: '2027-03-31' };

  it('drops tasks with no activity inside a custom window but keeps all phases', () => {
    const r = report(custom);
    expect(r.window).toEqual({ from: isoToDay('2027-01-01'), to: isoToDay('2027-03-31') + 1 });
    expect(r.rows.filter((x) => x.kind === 'phase')).toHaveLength(11);
    const others = r.rows.filter((x) => x.kind !== 'phase');
    expect(others.length).toBeGreaterThan(0);
    expect(others.length).toBeLessThan(base.tasks.length - 11);
    for (const x of others) {
      expect(x.start).toBeLessThan(r.window.to);
      expect(x.finish).toBeGreaterThanOrEqual(r.window.from);
    }
  });

  it('aligns the axis to whole scale units', () => {
    const r = report({ ...custom, scale: 'month' });
    expect(dayToIso(r.axis.from)).toBe('2027-01-01');
    expect(dayToIso(r.axis.to)).toBe('2027-04-01');
    expect(r.slices[0].bottom.map((t) => t.label)).toEqual(['Jan', 'Feb', 'Mar']);
  });

  it('look-ahead starts at the status date and spans the given weeks', () => {
    const r = report({ range: 'lookAhead', lookAheadWeeks: 6 });
    expect(r.window.from).toBe(isoToDay(base.statusDate));
    expect(r.window.to - r.window.from).toBe(42);
    expect(r.unit).toBe('week');
    const inside = r.rows.filter((x) => x.kind === 'task');
    expect(inside.length).toBeGreaterThan(0);
    expect(inside.length).toBeLessThan(40);
  });

  it('swaps a reversed custom window and ignores invalid dates', () => {
    const swapped = report({ range: 'custom', customFrom: '2027-03-31', customTo: '2027-01-01' });
    expect(swapped.window.from).toBeLessThan(swapped.window.to);
    const invalid = report({ range: 'custom', customFrom: '', customTo: 'nope' });
    expect(invalid.window.from).toBe(isoToDay('2026-11-02'));
  });
});

describe('scale', () => {
  it('auto picks week up to 4 months, month up to 24 months, else quarter', () => {
    expect(resolveUnit('auto', 120)).toBe('week');
    expect(resolveUnit('auto', 122)).toBe('week');
    expect(resolveUnit('auto', 200)).toBe('month');
    expect(resolveUnit('auto', 24 * 30.4375)).toBe('month');
    expect(resolveUnit('auto', 800)).toBe('quarter');
    expect(resolveUnit('quarter', 30)).toBe('quarter');
  });

  it('uses quarters for the whole template and builds two header tiers', () => {
    const r = report();
    expect(r.unit).toBe('quarter');
    const s = r.slices[0];
    expect(s.top.map((t) => t.label)).toEqual(['2026', '2027', '2028', '2029']);
    expect(s.bottom[0].label).toBe('Q4');
    expect(dayToIso(s.from)).toBe('2026-10-01');
    // Tiers are contiguous and cover the axis.
    expect(s.bottom[0].day).toBe(s.from);
    expect(s.bottom[s.bottom.length - 1].end).toBe(s.to);
  });
});

describe('KPIs', () => {
  it('reports start, finish, counts and zero progress on a fresh template', () => {
    const k = report().kpis;
    expect(dayToIso(k.projectStart)).toBe('2026-11-02');
    expect(dayToIso(k.projectFinish)).toBe('2029-12-19');
    expect(dayToIso(k.statusDay)).toBe('2026-11-02');
    expect(k.taskCount).toBe(base.tasks.length - 11);
    expect(k.milestoneCount).toBe(18);
    expect(k.percentComplete).toBe(0);
    expect(k.baselineFinish).toBeNull();
    expect(k.finishVariance).toBeNull();
    expect(k.statusCounts.notStarted).toBe(k.taskCount);
    expect(k.signalCounts.onTrack).toBe(k.taskCount);
    expect(k.criticalRemaining).toBeGreaterThan(30);
  });

  it('computes variance, progress and counts against a baseline', () => {
    const p = slippedProject();
    const k = report({}, p).kpis;
    expect(k.baselineName).toBe('Baseline 1');
    expect(dayToIso(k.baselineFinish!)).toBe('2029-12-19');
    expect(k.finishVariance).toBeGreaterThan(0);
    expect(k.slippedCount).toBeGreaterThan(30);
    expect(k.statusCounts.complete).toBe(1);
    expect(k.statusCounts.inProgress).toBe(1);
    expect(k.signalCounts.late).toBeGreaterThan(30);
    expect(k.signalCounts.complete).toBe(1);
    expect(k.percentComplete).toBeGreaterThan(0);
    expect(k.percentComplete).toBeLessThan(5);
    expect(
      k.statusCounts.notStarted +
        k.statusCounts.inProgress +
        k.statusCounts.onHold +
        k.statusCounts.blocked +
        k.statusCounts.complete,
    ).toBe(k.taskCount);
  });

  it('weights overall progress by duration', () => {
    const p = structuredClone(base);
    const tasks = p.tasks.filter((t) => t.parentId && t.duration > 0);
    // First task is 100 % done; its share of the total working days is the progress.
    const done = tasks[0];
    done.percentComplete = 100;
    done.actualStart = '2026-11-02';
    done.actualFinish = '2026-11-02';
    const total = tasks.reduce((a, t) => a + derive(p).schedule.calc.get(t.id)!.duration, 0);
    const own = derive(p).schedule.calc.get(done.id)!.duration;
    const k = report({}, p).kpis;
    expect(k.percentComplete).toBeCloseTo((own / total) * 100, 0);
  });
});

describe('tables', () => {
  const p = slippedProject();
  const r = report({}, p);

  it('lists all milestones by date with baseline and variance', () => {
    expect(r.milestones).toHaveLength(18);
    const dates = r.milestones.map((m) => m.planned);
    expect([...dates].sort((a, b) => a - b)).toEqual(dates);
    const last = r.milestones[r.milestones.length - 1];
    expect(last.name).toBe('Project complete');
    expect(last.variance).toBe(r.kpis.finishVariance);
    expect(last.signal).toBe('late');
    expect(dayToIso(last.baseline!)).toBe('2029-12-19');
    expect(r.milestones[0].name).toBe('Site identified');
    expect(r.milestones[0].signal).toBe('complete');
  });

  it('summarises phases with rolled-up status and the worst child signal', () => {
    expect(r.phases).toHaveLength(11);
    const first = r.phases[0];
    expect(first.name).toBe('Acquisition & Feasibility');
    expect(first.status).toBe('inProgress');
    expect(first.signal).toBe('late');
    expect(first.percent).toBeGreaterThan(0);
    expect(first.variance).toBeGreaterThan(0);
    expect(first.taskCount).toBeGreaterThan(5);
    const fresh = report().phases;
    expect(fresh.every((x) => x.signal === 'onTrack' && x.status === 'notStarted')).toBe(true);
  });

  it('worstSignal ranks late > at risk > on track and needs everything complete', () => {
    expect(worstSignal(['complete', 'onTrack', 'late', 'atRisk'])).toBe('late');
    expect(worstSignal(['complete', 'onTrack', 'atRisk'])).toBe('atRisk');
    expect(worstSignal(['complete', 'onTrack'])).toBe('onTrack');
    expect(worstSignal(['complete', 'complete'])).toBe('complete');
  });

  it('lists the ten most slipped tasks, worst first', () => {
    expect(r.slipping).toHaveLength(10);
    const v = r.slipping.map((s) => s.variance ?? 0);
    expect([...v].sort((a, b) => b - a)).toEqual(v);
    expect(v[0]).toBeGreaterThan(0);
    expect(r.slipping.every((s) => s.status !== 'complete')).toBe(true);
  });

  it('lists tasks starting or finishing in the four weeks after the status date', () => {
    const next = report().nextWeeks;
    expect(next.length).toBeGreaterThanOrEqual(3);
    const { from, to } = report().nextWindow;
    expect(to - from).toBe(28);
    for (const n of next) {
      const inWin = (d: number) => d >= from && d < to;
      expect(inWin(n.start) || inWin(n.finish)).toBe(true);
    }
    const dates = next.map((n) => n.date);
    expect([...dates].sort((a, b) => a - b)).toEqual(dates);
    expect(next.some((n) => n.event === 'milestone')).toBe(true);
    // Completed tasks never appear.
    expect(report({}, p).nextWeeks.some((n) => n.name === 'Site identified')).toBe(false);
  });
});

describe('split layout', () => {
  it('cuts a three-year window into half-year slices with a repeated axis', () => {
    const r = report({ layout: 'split', monthsPerPage: 6, scope: 'all' });
    expect(r.unit).toBe('month');
    expect(r.slices).toHaveLength(7);
    expect(r.slices[0].title).toBe('Nov – Dec 2026 · part 1 of 7');
    expect(r.slices[1].title).toBe('Jan – Jun 2027 · part 2 of 7');
    expect(r.slices[6].title).toBe('Jul – Dec 2029 · part 7 of 7');
    expect(r.slices[1].bottom.map((t) => t.label)).toEqual([
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
    ]);
    // Slices tile the axis without gaps.
    for (let i = 1; i < r.slices.length; i++) expect(r.slices[i].from).toBe(r.slices[i - 1].to);
    expect(r.slices[0].from).toBe(r.axis.from);
    expect(r.slices[6].to).toBe(r.axis.to);
  });

  it('hides rows without a bar on each page, or keeps them all', () => {
    const hidden = report({ layout: 'split', monthsPerPage: 6 });
    const all = report({ layout: 'split', monthsPerPage: 6, hideEmptyRows: false });
    for (const s of hidden.slices) {
      expect(s.rows.length).toBeLessThan(hidden.rows.length);
      for (const i of s.rows) {
        const row = hidden.rows[i];
        expect(row.start < s.to && row.finish >= s.from).toBe(true);
      }
    }
    for (const s of all.slices) expect(s.rows).toHaveLength(all.rows.length);
  });

  it('uses weeks for 3 months per page and quarters-of-a-year for 12', () => {
    const three = report({ layout: 'split', monthsPerPage: 3 });
    expect(three.unit).toBe('week');
    expect(three.slices[1].title).toBe('Jan – Mar 2027 · part 2 of ' + three.slices.length);
    const twelve = report({ layout: 'split', monthsPerPage: 12 });
    expect(twelve.slices).toHaveLength(4);
    expect(twelve.slices[1].title).toBe('Jan – Dec 2027 · part 2 of 4');
  });

  it('fit layout has a single slice with every row', () => {
    const r = report({ layout: 'fit' });
    expect(r.slices).toHaveLength(1);
    expect(r.slices[0].rows).toHaveLength(r.rows.length);
  });
});

describe('descriptions and Excel columns', () => {
  it('describes the PDF with page counts, span and scale', () => {
    const text = describeReport(
      'pdf',
      report({ scope: 'phasesAndMilestones', layout: 'split', monthsPerPage: 12 }),
    );
    expect(text).toMatch(/^\d+ pages: summary \(2 pages\) \+ \d+ timeline pages\./);
    expect(text).toContain('Nov 2026 – Dec 2029');
    expect(text).toContain('monthly');
    expect(describeReport('pdf', report({ includeSummary: false, scope: 'phases' }))).toMatch(
      /^1 page: 1 timeline page\./,
    );
  });

  it('picks monthly Excel columns for windows longer than 18 months', () => {
    const long = report();
    expect(excelUnit(long)).toBe('month');
    expect(excelColumns(long)).toHaveLength(38);
    const short = report({ range: 'lookAhead', lookAheadWeeks: 12 });
    expect(excelUnit(short)).toBe('week');
    expect(excelColumns(short)).toHaveLength(12);
    expect(excelUnit(report({ scale: 'week' }))).toBe('week');
    expect(excelColumns(report({ scale: 'week' })).length).toBeGreaterThan(150);
  });

  it('describes Excel and the web page', () => {
    expect(describeReport('excel', report())).toContain('Summary, Tasks and Gantt');
    expect(describeReport('html', report())).toContain('self-contained');
  });
});
