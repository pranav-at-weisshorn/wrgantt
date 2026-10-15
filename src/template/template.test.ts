import { describe, expect, it } from 'vitest';
import { buildOutline, checkHealth, detectCycle, scheduleProject } from '../engine';
import { CONDO_TEMPLATE } from './condo';
import { projectFromTemplate } from './load';

describe('spec test 9: condo template', () => {
  const project = projectFromTemplate('Template', '2026-11-02');
  const outline = buildOutline(project.tasks);
  const schedule = scheduleProject(project, outline);
  const byKey = new Map(project.tasks.map((t) => [t.templateKey, t]));
  const calcOf = (key: string) => schedule.calc.get(byKey.get(key)!.id)!;

  it('loads every phase and task', () => {
    const count = CONDO_TEMPLATE.reduce((n, p) => n + 1 + p.tasks.length, 0);
    expect(project.tasks).toHaveLength(count);
    expect(project.tasks.map((t) => t.rowId)).toEqual(project.tasks.map((_, i) => i + 1));
  });

  it('has no cycles', () => {
    expect(detectCycle(project, outline)).toBeNull();
    expect(schedule.cycles).toEqual([]);
    expect(schedule.errors).toEqual([]);
  });

  it('has exactly one start (A01) and one finish (H08) milestone and no open ends', () => {
    const issues = checkHealth(project, schedule, outline);
    const open = issues.filter((i) => i.kind === 'noPredecessor' || i.kind === 'noSuccessor');
    expect(open).toEqual([]);
    const leaves = project.tasks.filter((t) => !outline.isSummary(t.id));
    const noPred = leaves.filter((t) => !project.dependencies.some((d) => d.successorId === t.id));
    const noSucc = leaves.filter(
      (t) => !project.dependencies.some((d) => d.predecessorId === t.id),
    );
    expect(noPred.map((t) => t.templateKey)).toEqual(['A01']);
    expect(noSucc.map((t) => t.templateKey)).toEqual(['H08']);
    expect(calcOf('A01').isMilestone && calcOf('H08').isMilestone).toBe(true);
  });

  it('computes a finish date without errors and no negative float', () => {
    expect(Number.isFinite(schedule.projectFinish)).toBe(true);
    expect(schedule.projectFinish).toBeGreaterThan(schedule.projectStart);
    expect(calcOf('H08').earlyStart).toBe('2029-12-19');
    expect([...schedule.calc.values()].every((c) => c.totalFloat >= 0)).toBe(true);
  });

  it('has a critical path through acquisition, entitlements, permitting/financing, construction, closings and closeout', () => {
    const path = [
      'A01',
      'A04',
      'E05',
      'E09',
      'D06',
      'P02',
      'P05',
      'F07',
      'C01',
      'C08',
      'C25',
      'X03',
      'H04',
      'H07',
      'H08',
    ];
    for (const key of path)
      expect({ key, critical: calcOf(key).critical }).toEqual({ key, critical: true });
    // Sales is close but not driving.
    expect(calcOf('S08').critical).toBe(false);
  });

  it('uses the 7-day calendar for the appeal period', () => {
    expect(byKey.get('E10')!.calendarId).toBe('7day');
    const e10 = calcOf('E10');
    expect(e10.ef - e10.es).toBe(30);
  });
});
