import { beforeEach, describe, expect, it } from 'vitest';
import { ProjectBuilder } from '../engine/testkit';
import { derive } from './derive';
import {
  addLink,
  deleteTasks,
  indentTask,
  insertTask,
  moveTask,
  outdentTask,
  setDuration,
  setPercentComplete,
  setPredecessorsText,
  setStartDate,
  updateLink,
} from './ops';
import { HISTORY_LIMIT, useStore } from './store';

const S = () => useStore.getState();
const P = () => S().project!;
const calc = (id: string) => derive(P()).schedule.calc.get(id)!;
const task = (id: string) => P().tasks.find((t) => t.id === id)!;
const rowOf = (id: string) => task(id).rowId;

function open() {
  const b = new ProjectBuilder()
    .task('A', 5)
    .task('B', 3)
    .task('C', 4)
    .task('D', 2)
    .link('A', 'B')
    .link('A', 'C')
    .link('B', 'D')
    .link('C', 'D');
  S().openProject(b.project);
  return b;
}

beforeEach(() => {
  open();
});

describe('edits recalculate and are undoable', () => {
  it('duration change moves successors and the project finish; undo restores', () => {
    const before = derive(P()).schedule.projectFinish;
    expect(setDuration('C', 10).ok).toBe(true);
    expect(calc('D').es - calc('A').es).toBe(15);
    expect(derive(P()).schedule.projectFinish).toBe(before + 6);
    S().undo();
    expect(task('C').duration).toBe(4);
    expect(derive(P()).schedule.projectFinish).toBe(before);
    S().redo();
    expect(task('C').duration).toBe(10);
  });

  it('typing a start date sets SNET', () => {
    const b = open();
    setStartDate('B', b.day(7));
    expect(task('B').constraint).toEqual({ type: 'SNET', date: b.day(7) });
    expect(calc('B').earlyStart).toBe(b.day(7));
  });

  it('predecessor text is parsed, validated and applied', () => {
    expect(setPredecessorsText('D', `${rowOf('A')}SS+2d`).ok).toBe(true);
    const preds = P().dependencies.filter((d) => d.successorId === 'D');
    expect(preds).toHaveLength(1);
    expect(preds[0]).toMatchObject({ predecessorId: 'A', type: 'SS', lag: 2 });
    const bad = setPredecessorsText('D', '99');
    expect(bad.ok).toBe(false);
    expect(bad.error).toMatch(/Unknown task ID 99/);
  });

  it('rejects an edit that creates a cycle and names the loop', () => {
    const depth = S().past.length;
    const r = addLink('D', 'A');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('Circular dependency: 1 → 2 → 4 → 1');
    expect(S().past.length).toBe(depth);
    expect(P().dependencies).toHaveLength(4);
  });

  it('link edits are undoable', () => {
    const dep = P().dependencies.find((d) => d.predecessorId === 'B')!;
    updateLink(dep.id, { lag: 5 });
    expect(calc('D').es).toBeGreaterThan(calc('C').ef);
    S().undo();
    expect(P().dependencies.find((d) => d.id === dep.id)!.lag).toBe(0);
  });

  it('% complete fills actual dates from the schedule', () => {
    setPercentComplete('A', 100);
    expect(task('A').actualStart).toBe(calc('A').earlyStart);
    expect(task('A').actualFinish).toBeDefined();
    setPercentComplete('A', 0);
    expect(task('A').actualStart).toBeUndefined();
  });
});

describe('structure edits', () => {
  it('insert above the selected row and renumber', () => {
    const id = insertTask('C')!;
    expect(rowOf(id)).toBe(3);
    expect(rowOf('C')).toBe(4);
    expect(rowOf('D')).toBe(5);
    S().undo();
    expect(P().tasks).toHaveLength(4);
    expect(rowOf('D')).toBe(4);
  });

  it('indenting under a linked predecessor is rejected as a cycle', () => {
    // A FS B: making B a child of A would link a summary to its own subtask.
    const r = indentTask('B');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/^Circular dependency/);
    expect(task('B').parentId).toBeNull();
  });

  it('indent and outdent unlinked tasks', () => {
    const x = insertTask(null, { name: 'X' })!;
    const y = insertTask(null, { name: 'Y' })!;
    expect(indentTask(y).ok).toBe(true);
    expect(task(y).parentId).toBe(x);
    expect(calc(x).isSummary).toBe(true);
    expect(outdentTask(y).ok).toBe(true);
    expect(task(y).parentId).toBeNull();
    expect(rowOf(y)).toBe(rowOf(x) + 1);
  });

  it('outdent keeps the row in place and adopts later siblings', () => {
    const p = insertTask(null, { name: 'P' })!;
    const a = insertTask(null, { name: 'a' })!;
    const b = insertTask(null, { name: 'b' })!;
    const c = insertTask(null, { name: 'c' })!;
    for (const id of [a, b, c]) indentTask(id);
    // all three under P
    expect([a, b, c].every((id) => task(id).parentId === p)).toBe(true);
    outdentTask(b);
    expect(task(b).parentId).toBeNull();
    expect(task(c).parentId).toBe(b);
    expect([rowOf(p), rowOf(a), rowOf(b), rowOf(c)]).toEqual([5, 6, 7, 8]);
  });

  it('move before / after / inside', () => {
    moveTask('D', 'A', 'before');
    expect(rowOf('D')).toBe(1);
    moveTask('D', 'C', 'after');
    expect(rowOf('D')).toBe(4);
    const g = insertTask(null, { name: 'Group' })!;
    moveTask('D', g, 'inside');
    expect(task('D').parentId).toBe(g);
  });

  it('delete removes descendants and their links', () => {
    deleteTasks(['B']);
    expect(P().tasks.map((t) => t.id)).toEqual(['A', 'C', 'D']);
    expect(P().dependencies.some((d) => d.predecessorId === 'B' || d.successorId === 'B')).toBe(
      false,
    );
    S().undo();
    expect(P().tasks).toHaveLength(4);
    expect(P().dependencies).toHaveLength(4);
  });
});

describe('history', () => {
  it(`keeps at least 100 steps (limit ${HISTORY_LIMIT})`, () => {
    for (let i = 1; i <= 120; i++) setDuration('A', i);
    expect(S().past.length).toBe(120);
    for (let i = 0; i < 120; i++) S().undo();
    expect(task('A').duration).toBe(5);
    expect(S().future.length).toBe(120);
  });

  it('a new edit clears redo', () => {
    setDuration('A', 9);
    S().undo();
    expect(S().future.length).toBe(1);
    setDuration('B', 9);
    expect(S().future.length).toBe(0);
  });
});
