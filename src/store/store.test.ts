import { beforeEach, describe, expect, it } from 'vitest';
import { ProjectBuilder } from '../engine/testkit';
import { derive } from './derive';
import { isoToDay, statusOf } from '../engine';
import { projectFromTemplate } from '../template/load';
import { linkTexts } from '../ui/rows';
import {
  addLink,
  applyProgress,
  onSchedulePercent,
  deleteTasks,
  indentTask,
  insertTask,
  insertTaskAt,
  canMoveTask,
  deleteLink,
  moveTaskBy,
  renameTask,
  setStatus,
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

describe('progress', () => {
  it('on-schedule progress uses the current plan up to a new status date', () => {
    const b = open();
    // A runs days 0-5; at day 3 it should be 60 % done; B (5-8) not started.
    const a = onSchedulePercent(P(), 'A', isoToDay(b.day(3)))!;
    expect(a).toEqual({ id: 'A', percentComplete: 60, actualStart: b.day(0) });
    expect(onSchedulePercent(P(), 'B', isoToDay(b.day(3)))!.percentComplete).toBe(0);
    applyProgress([a], b.day(3));
    expect(P().statusDate).toBe(b.day(3));
    expect(calc('A').ef - isoToDay(b.day(0))).toBe(5); // 2 days left from day 3
    S().undo();
    expect(P().statusDate).toBe(b.day(0));
    expect(task('A').percentComplete).toBe(0);
  });
});

describe('move up / down and insert positions', () => {
  it('swaps a task with its neighbour and keeps links', () => {
    expect(canMoveTask(P(), 'A', -1)).toBe(false);
    expect(moveTaskBy('C', -1).ok).toBe(true);
    expect([rowOf('A'), rowOf('C'), rowOf('B'), rowOf('D')]).toEqual([1, 2, 3, 4]);
    // Links follow the tasks, so the schedule is unchanged.
    expect(P().dependencies).toHaveLength(4);
    expect(linkTexts(P()).preds.get('D')).toBe('2 Finish-to-Start, 3 Finish-to-Start');
    S().undo();
    expect(rowOf('B')).toBe(2);
    expect(moveTaskBy('D', 1).ok).toBe(false);
  });

  it('moves a summary together with its subtasks, within its parent', () => {
    const p = projectFromTemplate('T', '2026-11-02');
    S().openProject(p);
    const byKey = (k: string) => P().tasks.find((t) => t.templateKey === k)!;
    const financing = byKey('P2');
    expect(financing.rowId).toBe(17);
    moveTaskBy(financing.id, -1);
    expect(byKey('P2').rowId).toBe(1);
    expect(byKey('F01').rowId).toBe(2);
    expect(byKey('P1').rowId).toBe(10);
    // A subtask only moves among its siblings.
    expect(canMoveTask(P(), byKey('A01').id, -1)).toBe(false);
    moveTaskBy(byKey('A02').id, 1);
    expect(byKey('A03').rowId).toBe(byKey('A02').rowId - 1);
    expect(byKey('A02').parentId).toBe(byKey('P1').id);
  });

  it('inserts below and as a subtask', () => {
    const below = insertTaskAt('A', 'below')!;
    expect(rowOf(below)).toBe(2);
    const sub = insertTaskAt('C', 'inside', { name: 'Sub' })!;
    expect(task(sub).parentId).toBe('C');
    expect(derive(P()).outline.isSummary('C')).toBe(true);
  });
});

describe('row IDs', () => {
  it('renumber automatically when a whole parent task in the middle is deleted', () => {
    const p = projectFromTemplate('T', '2026-11-02');
    S().openProject(p);
    const byKey = (k: string) => P().tasks.find((t) => t.templateKey === k)!;
    // Entitlements (row 26, 11 subtasks) sits in the middle of the schedule.
    expect(byKey('P3').rowId).toBe(26);
    expect(byKey('D01').rowId).toBe(39);
    deleteTasks([byKey('P3').id]);
    expect(P().tasks).toHaveLength(132 - 12);
    expect(
      P()
        .tasks.map((t) => t.rowId)
        .sort((a, b) => a - b),
    ).toEqual(Array.from({ length: 120 }, (_, i) => i + 1));
    // Everything after it moved up by 12, and predecessor texts show the new IDs.
    expect(byKey('D01').rowId).toBe(27);
    expect(byKey('D02').rowId).toBe(28);
    expect(linkTexts(P()).preds.get(byKey('D02').id)).toBe('7 Finish-to-Start, 27 Finish-to-Start');
    // Links to the deleted tasks are gone, not left dangling.
    const ids = new Set(P().tasks.map((t) => t.id));
    expect(P().dependencies.every((d) => ids.has(d.predecessorId) && ids.has(d.successorId))).toBe(
      true,
    );
    S().undo();
    expect(byKey('D01').rowId).toBe(39);
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

describe('task status', () => {
  it('Complete is one undoable step: 100 % with actual dates from the schedule', () => {
    const depth = S().past.length;
    expect(setStatus('A', 'complete').ok).toBe(true);
    expect(S().past.length).toBe(depth + 1);
    expect(S().past.at(-1)!.label).toBe('Status of “A”: Complete');
    expect(task('A').percentComplete).toBe(100);
    expect(task('A').actualStart).toBe(calc('A').earlyStart);
    expect(task('A').actualFinish).toBeDefined();
    expect(statusOf(task('A'))).toBe('complete');
    S().undo();
    expect(task('A').percentComplete).toBe(0);
    expect(task('A').actualStart).toBeUndefined();
    expect(task('A').actualFinish).toBeUndefined();
  });

  it('In progress sets the actual start to the scheduled start when not yet started', () => {
    setStatus('B', 'inProgress');
    expect(task('B').status).toBe('inProgress');
    expect(task('B').actualStart).toBe(calc('B').earlyStart);
    expect(task('B').percentComplete).toBe(0);
    expect(statusOf(task('B'))).toBe('inProgress');
    // An existing actual start is kept.
    const before = task('B').actualStart;
    setStatus('B', 'onHold');
    setStatus('B', 'inProgress');
    expect(task('B').actualStart).toBe(before);
  });

  it('On hold and Blocked only set the status', () => {
    setStatus('C', 'blocked');
    expect(task('C')).toMatchObject({ status: 'blocked', percentComplete: 0 });
    expect(task('C').actualStart).toBeUndefined();
    expect(statusOf(task('C'))).toBe('blocked');
    setStatus('C', 'onHold');
    expect(statusOf(task('C'))).toBe('onHold');
    expect(S().past.at(-1)!.label).toBe('Status of “C”: On hold');
  });

  it('Not started resets progress, actuals and the stored status', () => {
    setStatus('A', 'complete');
    setStatus('A', 'notStarted');
    expect(task('A').percentComplete).toBe(0);
    expect(task('A').actualStart).toBeUndefined();
    expect(task('A').actualFinish).toBeUndefined();
    expect(task('A').status).toBeUndefined();
    setStatus('A', 'blocked');
    setStatus('A', 'notStarted');
    expect(task('A').status).toBeUndefined();
    expect(statusOf(task('A'))).toBe('notStarted');
  });

  it('a completed task set to On hold is reopened', () => {
    setStatus('A', 'complete');
    setStatus('A', 'onHold');
    expect(task('A').percentComplete).toBeLessThan(100);
    expect(task('A').actualFinish).toBeUndefined();
    expect(statusOf(task('A'))).toBe('onHold');
  });

  it('% complete keeps On hold / Blocked unless it reaches 100 %', () => {
    setStatus('B', 'blocked');
    setPercentComplete('B', 40);
    expect(statusOf(task('B'))).toBe('blocked');
    expect(task('B').percentComplete).toBe(40);
    setPercentComplete('B', 100);
    expect(statusOf(task('B'))).toBe('complete');
    expect(task('B').status).toBeUndefined();
    // Reopening via 50 % does not bring the old Blocked back.
    setPercentComplete('B', 50);
    expect(statusOf(task('B'))).toBe('inProgress');
  });

  it('status survives undo and redo of other edits', () => {
    setStatus('A', 'blocked');
    setDuration('A', 8);
    S().undo();
    expect(statusOf(task('A'))).toBe('blocked');
    S().undo();
    expect(statusOf(task('A'))).toBe('notStarted');
    S().redo();
    expect(statusOf(task('A'))).toBe('blocked');
  });
});

describe('descriptive history labels', () => {
  it('describes common edits', () => {
    setDuration('A', 20);
    expect(S().past.at(-1)!.label).toBe('Duration of “A”: 20 days');
    setDuration('A', 1);
    expect(S().past.at(-1)!.label).toBe('Duration of “A”: 1 day');
    renameTask('A', 'Appraisal');
    expect(S().past.at(-1)!.label).toBe('Renamed “A” to “Appraisal”');
    moveTaskBy('C', -1);
    expect(S().past.at(-1)!.label).toBe('Moved “C” up');
    const dep = P().dependencies.find((d) => d.predecessorId === 'A' && d.successorId === 'C')!;
    const pred = rowOf('A');
    const succ = rowOf('C');
    deleteLink(dep.id);
    expect(S().past.at(-1)!.label).toBe(`Link from ${pred} to ${succ} removed`);
    deleteTasks(['D']);
    expect(S().past.at(-1)!.label).toBe('Deleted “D”');
    expect(S().past.at(-1)!.at).toMatch(/^\d{4}-\d\d-\d\dT/);
  });
});

describe('undo history', () => {
  it('jumps to any earlier or later state in one step', () => {
    const start = P();
    setDuration('A', 6);
    setDuration('A', 7);
    setDuration('B', 9);
    S().jumpTo(0);
    expect(task('A').duration).toBe(6);
    expect(task('B').duration).toBe(3);
    expect(S().past).toHaveLength(1);
    expect(S().future).toHaveLength(2);
    S().jumpTo(2);
    expect(task('B').duration).toBe(9);
    S().jumpTo(-1);
    expect(P().tasks).toEqual(start.tasks);
  });

  it('read-only blocks edit, undo, redo and jump', () => {
    setDuration('A', 6);
    S().setReadOnly(true);
    expect(setDuration('A', 9).ok).toBe(false);
    S().undo();
    S().jumpTo(-1);
    S().clearHistory();
    expect(task('A').duration).toBe(6);
    expect(S().past).toHaveLength(1);
    S().setReadOnly(false);
  });

  it('clearing history keeps the project', () => {
    setDuration('A', 6);
    S().undo();
    S().clearHistory();
    expect(S().past).toHaveLength(0);
    expect(S().future).toHaveLength(0);
    expect(task('A').duration).toBe(5);
  });

  it('caps at 5,000 entries', () => {
    expect(HISTORY_LIMIT).toBe(5000);
  });
});
