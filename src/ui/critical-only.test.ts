import { describe, expect, it } from 'vitest';
import { ProjectBuilder } from '../engine/testkit';
import { derive } from '../store/derive';
import { EMPTY_FILTERS } from '../store/store';
import { computeRows } from './rows';

/** P1 (A, B), P2 (C, D). Links: A to B, B to C. D runs alongside, off the critical path. */
function project() {
  return new ProjectBuilder({ calendar: 'standard' })
    .task('P1', 0)
    .task('A', 5, { parentId: 'P1' })
    .task('B', 3, { parentId: 'P1' })
    .task('P2', 0)
    .task('C', 4, { parentId: 'P2' })
    .task('D', 2, { parentId: 'P2' })
    .link('A', 'B')
    .link('B', 'C').project;
}

describe('critical path only', () => {
  it('shows exactly the critical tasks, without phases or other tasks', () => {
    const p = project();
    const rows = computeRows(p, derive(p), {}, { ...EMPTY_FILTERS, criticalOnly: true });
    expect(rows.map((r) => r.id)).toEqual(['A', 'B', 'C']);
    expect(rows.every((r) => r.depth === 0)).toBe(true);
  });

  it('ignores collapsed phases, so no critical task is hidden', () => {
    const p = project();
    const rows = computeRows(p, derive(p), { P1: true }, { ...EMPTY_FILTERS, criticalOnly: true });
    expect(rows.map((r) => r.id)).toEqual(['A', 'B', 'C']);
  });

  it('switched off, everything is back', () => {
    const p = project();
    const rows = computeRows(p, derive(p), {}, EMPTY_FILTERS);
    expect(rows.map((r) => r.id)).toEqual(['P1', 'A', 'B', 'P2', 'C', 'D']);
  });
});
