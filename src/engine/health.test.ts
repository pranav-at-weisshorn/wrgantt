import { describe, expect, it } from 'vitest';
import { checkHealth } from './health';
import { buildOutline } from './outline';
import { scheduleProject } from './schedule';
import { ProjectBuilder } from './testkit';
import { finishVariance, makeBaseline, varianceSummary } from './variance';
import type { Project } from './types';

const health = (p: Project) => {
  const o = buildOutline(p.tasks);
  return checkHealth(p, scheduleProject(p, o), o);
};
const kinds = (p: Project, id: string) =>
  health(p)
    .filter((i) => i.taskId === id)
    .map((i) => i.kind)
    .sort();

describe('schedule health check', () => {
  const base = () =>
    new ProjectBuilder()
      .task('Start', 0)
      .task('A', 5)
      .task('End', 0)
      .link('Start', 'A')
      .link('A', 'End');

  it('a clean network has no issues; first and last milestones may be open ends', () => {
    expect(health(base().project)).toEqual([]);
  });

  it('reports open ends', () => {
    const b = base().task('X', 2);
    expect(kinds(b.project, 'X')).toEqual(['noPredecessor', 'noSuccessor']);
  });

  it('a link on a parent summary counts for its children', () => {
    const b = base().task('S', 0).task('K', 2, { parentId: 'S' }).link('A', 'S').link('S', 'End');
    expect(kinds(b.project, 'K')).toEqual([]);
    expect(health(b.project).filter((i) => i.kind === 'summaryLink')).toHaveLength(2);
  });

  it('reports long lags, negative float and constraint conflicts', () => {
    const b = base().task('B', 3).link('A', 'B', 'FS', 61).link('B', 'End');
    b.constrain('B', 'MSO', b.day(2));
    const k = kinds(b.project, 'B');
    expect(k).toContain('longLag');
    expect(k).toContain('negativeFloat');
    expect(k).toContain('constraintConflict');
  });

  it('reports actual start after the status date', () => {
    const b = base();
    Object.assign(b.project.tasks[1], { actualStart: b.day(3), percentComplete: 10 });
    b.project.statusDate = b.day(1);
    expect(kinds(b.project, 'A')).toContain('actualAfterStatus');
  });

  it('reports cycles as errors', () => {
    const b = base().link('A', 'Start');
    expect(health(b.project).some((i) => i.kind === 'cycle' && i.severity === 'error')).toBe(true);
  });
});

describe('variance', () => {
  it('measures finish slip in working days against the active baseline', () => {
    const b = new ProjectBuilder({ calendar: 'standard' }).task('A', 5).task('B', 5).link('A', 'B');
    const s0 = scheduleProject(b.project);
    const bl = makeBaseline(b.project, s0, 'bl', 'Original', '');
    b.project.baselines = [bl];
    b.project.activeBaselineId = 'bl';
    expect(bl.tasks.B).toEqual({ start: '2027-01-11', finish: '2027-01-15', duration: 5 });

    b.project.tasks[0].duration = 8;
    const o = buildOutline(b.project.tasks);
    const s1 = scheduleProject(b.project, o);
    expect(finishVariance(b.project, s1.calc.get('B'), bl.tasks.B)).toBe(3);
    const v = varianceSummary(b.project, s1, o)!;
    expect(v.finishVariance).toBe(3);
    expect(v.slippedCount).toBe(2);
    expect(v.topSlippingCritical.map((x) => x.id)).toEqual(['A', 'B']);
  });
});
