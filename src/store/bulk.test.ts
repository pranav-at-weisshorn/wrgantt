import { beforeEach, describe, expect, it } from 'vitest';
import { statusOf } from '../engine';
import { ProjectBuilder } from '../engine/testkit';
import { derive } from './derive';
import {
  bulkTargets,
  bulkUpdate,
  canMoveTasks,
  deleteTasks,
  indentTasks,
  linkInSequence,
  moveTasksBy,
  outdentTasks,
  setStatus,
  unlinkTasks,
} from './ops';
import { useStore } from './store';

const S = () => useStore.getState();
const P = () => S().project!;
const task = (id: string) => P().tasks.find((t) => t.id === id)!;
const calc = (id: string) => derive(P()).schedule.calc.get(id)!;
const flat = () => derive(P()).outline.flat;
const steps = () => S().past.length;
const lastLabel = () => S().past[S().past.length - 1].label;

/**
 * P1 (A, B, C), P2 (D, E), F on the Monday-to-Friday calendar, starting Monday 2027-01-04.
 * Links: A to B, B to C, C to D, E to F.
 */
function open() {
  const b = new ProjectBuilder({ calendar: 'standard' })
    .task('P1', 0)
    .task('A', 5, { parentId: 'P1' })
    .task('B', 3, { parentId: 'P1' })
    .task('C', 4, { parentId: 'P1' })
    .task('P2', 0)
    .task('D', 2, { parentId: 'P2' })
    .task('E', 2, { parentId: 'P2' })
    .task('F', 1)
    .link('A', 'B')
    .link('B', 'C')
    .link('C', 'D')
    .link('E', 'F');
  S().openProject(b.project);
  return b;
}

beforeEach(() => {
  open();
});

describe('selection', () => {
  it('keeps the focused task inside the selected ids', () => {
    S().select('A');
    expect(S().selectedId).toBe('A');
    expect(S().selectedIds).toEqual(['A']);
    S().toggleSelect('C');
    expect(S().selectedIds).toEqual(['A', 'C']);
    expect(S().selectedId).toBe('C');
    S().toggleSelect('C'); // deselect the focused task: the focus moves to the last one left
    expect(S().selectedIds).toEqual(['A']);
    expect(S().selectedId).toBe('A');
    S().toggleSelect('A');
    expect(S().selectedIds).toEqual([]);
    expect(S().selectedId).toBeNull();
  });

  it('selects a range from the anchor in the given order, in both directions', () => {
    const order = ['P1', 'A', 'B', 'C', 'P2', 'D'];
    S().select('A');
    S().selectRange('C', order);
    expect(S().selectedIds).toEqual(['A', 'B', 'C']);
    expect(S().selectedId).toBe('C');
    S().selectRange('P1', order); // the anchor stays at A
    expect(S().selectedIds).toEqual(['P1', 'A']);
    S().selectRange('D', order);
    expect(S().selectedIds).toEqual(['A', 'B', 'C', 'P2', 'D']);
  });

  it('selects a range from the first task when nothing was selected', () => {
    S().clearSelection();
    S().selectRange('B', ['P1', 'A', 'B']);
    expect(S().selectedIds).toEqual(['B']);
  });

  it('sets and clears the selection; a plain select replaces it', () => {
    S().setSelection(['A', 'B', 'A', 'F'], 'B');
    expect(S().selectedIds).toEqual(['A', 'B', 'F']);
    expect(S().selectedId).toBe('B');
    S().setSelection(['A', 'B']);
    expect(S().selectedId).toBe('B'); // default: the last one
    S().select('D');
    expect(S().selectedIds).toEqual(['D']);
    S().clearSelection();
    expect(S().selectedIds).toEqual([]);
    expect(S().selectedId).toBeNull();
  });

  it('forgets tasks that are deleted and resets when another project opens', () => {
    S().setSelection(['A', 'B', 'F']);
    deleteTasks(['B']);
    expect(S().selectedIds).toEqual(['A', 'F']);
    S().undo();
    S().setSelection(['A', 'B']);
    open();
    expect(S().selectedIds).toEqual([]);
    expect(S().selectedId).toBeNull();
  });
});

describe('bulk delete', () => {
  it('deletes summaries with their subtasks and the links, once, ignoring duplicates', () => {
    const before = steps();
    expect(deleteTasks(['P1', 'A', 'A', 'F']).ok).toBe(true);
    expect(steps()).toBe(before + 1);
    expect(flat()).toEqual(['P2', 'D', 'E']);
    expect(P().dependencies.map((d) => d.id)).toEqual([]);
    expect(lastLabel()).toBe('Deleted 2 tasks and 3 subtasks');
    S().undo();
    expect(flat()).toHaveLength(8);
    expect(P().dependencies).toHaveLength(4);
  });
});

describe('structure', () => {
  it('indents a block of adjacent siblings together, as one step', () => {
    // Indent B and C: both become children of A (their previous sibling). Without links, which
    // could not point from a summary to its own subtasks.
    S().commit('Remove links', (d) => {
      d.dependencies = [];
    });
    const before = steps();
    expect(indentTasks(['B', 'C']).ok).toBe(true);
    expect(steps()).toBe(before + 1);
    expect(task('B').parentId).toBe('A');
    expect(task('C').parentId).toBe('A');
    expect(flat().slice(0, 4)).toEqual(['P1', 'A', 'B', 'C']);
    S().undo();
    expect(task('B').parentId).toBe('P1');
  });

  it('skips tasks that cannot move and treats a summary with its subtasks as one', () => {
    const before = steps();
    // A is the first child of P1: it cannot be indented. P2 and its child D: only P2 moves.
    expect(indentTasks(['A', 'P2', 'D']).ok).toBe(true);
    expect(steps()).toBe(before + 1);
    expect(task('A').parentId).toBe('P1');
    expect(task('P2').parentId).toBe('P1');
    expect(task('D').parentId).toBe('P2');
    expect(indentTasks(['P1']).ok).toBe(false); // nothing to do
    expect(steps()).toBe(before + 1);
  });

  it('outdents several tasks in one step', () => {
    const before = steps();
    expect(outdentTasks(['B', 'C', 'D']).ok).toBe(true);
    expect(steps()).toBe(before + 1);
    expect(task('B').parentId).toBeNull();
    expect(task('C').parentId).toBeNull();
    expect(task('D').parentId).toBeNull();
    // Orders stay distinct.
    const orders = P()
      .tasks.filter((t) => !t.parentId)
      .map((t) => t.order);
    expect(new Set(orders).size).toBe(orders.length);
    expect(outdentTasks(['P1']).ok).toBe(false);
  });

  it('moves a block of siblings together and stops at the ends', () => {
    expect(canMoveTasks(P(), ['A', 'B'], -1)).toBe(false);
    expect(canMoveTasks(P(), ['A', 'B'], 1)).toBe(true);
    const before = steps();
    expect(moveTasksBy(['A', 'B'], 1).ok).toBe(true);
    expect(steps()).toBe(before + 1);
    expect(flat().slice(0, 4)).toEqual(['P1', 'C', 'A', 'B']);
    expect(moveTasksBy(['B', 'A'], 1).ok).toBe(false); // already last
    // Tasks under different parents move within their own parent.
    expect(moveTasksBy(['D', 'F'], -1).ok).toBe(true); // D is first in P2; F moves above P2
    expect(flat()).toEqual(['P1', 'C', 'A', 'B', 'F', 'P2', 'D', 'E']);
    S().undo();
    expect(flat()).toEqual(['P1', 'C', 'A', 'B', 'P2', 'D', 'E', 'F']);
  });
});

describe('bulkUpdate', () => {
  it('lists what an edit touches: summaries stand for their work tasks', () => {
    const t = bulkTargets(P(), ['F', 'P1', 'A']);
    expect(t.all).toEqual(['P1', 'A', 'F']);
    expect(t.summaries).toEqual(['P1']);
    expect(t.work).toEqual(['A', 'B', 'C', 'F']);
  });

  it('sets the status like the single-task action', () => {
    const before = steps();
    expect(bulkUpdate(['A', 'B'], { status: 'complete' }).ok).toBe(true);
    expect(steps()).toBe(before + 1);
    expect(lastLabel()).toBe('Edited 2 tasks: status Complete');
    setStatus('C', 'complete');
    for (const id of ['A', 'B', 'C']) expect(statusOf(task(id))).toBe('complete');
    const a = task('A');
    const c = task('C');
    expect(a.percentComplete).toBe(100);
    expect(a.actualStart).toBeTruthy();
    expect(a.actualFinish).toBeTruthy();
    expect(c.percentComplete).toBe(100);
    bulkUpdate(['A', 'B'], { status: 'blocked' });
    expect(task('A').status).toBe('blocked');
    expect(task('A').percentComplete).toBe(99); // reopened, as for one task
    expect(task('A').actualFinish).toBeUndefined();
    bulkUpdate(['A'], { status: 'notStarted' });
    expect(task('A').percentComplete).toBe(0);
    expect(task('A').actualStart).toBeUndefined();
  });

  it('sets % complete with actual dates, and clamps it', () => {
    bulkUpdate(['A', 'B'], { percentComplete: 40 });
    expect(task('A').percentComplete).toBe(40);
    expect(task('A').actualStart).toBeTruthy();
    expect(task('A').actualFinish).toBeUndefined();
    bulkUpdate(['A'], { percentComplete: 250 });
    expect(task('A').percentComplete).toBe(100);
    expect(task('A').actualFinish).toBeTruthy();
    bulkUpdate(['A', 'B'], { percentComplete: 0 });
    expect(task('A').actualStart).toBeUndefined();
    expect(task('B').percentComplete).toBe(0);
  });

  it('applies progress first, then status', () => {
    bulkUpdate(['A'], { percentComplete: 50, status: 'blocked' });
    expect(task('A').percentComplete).toBe(50);
    expect(task('A').status).toBe('blocked');
  });

  it('sets, trims and clears responsible on every selected task including summaries', () => {
    bulkUpdate(['P1', 'F'], { responsible: '  GC ' });
    expect(task('P1').responsible).toBe('GC');
    expect(task('F').responsible).toBe('GC');
    expect(task('A').responsible).toBe(''); // the summary's subtasks are not touched
    expect(lastLabel()).toBe('Edited 2 tasks: responsible “GC”');
    bulkUpdate(['F'], { responsible: '' });
    expect(task('F').responsible).toBe('');
    expect(lastLabel()).toBe('Edited “F”: responsible cleared');
  });

  it('sets duration (0 = milestone) and calendar on work tasks only', () => {
    bulkUpdate(['A', 'F'], { duration: 7 });
    expect(task('A').duration).toBe(7);
    expect(task('F').duration).toBe(7);
    expect(task('B').duration).toBe(3);
    bulkUpdate(['F'], { duration: 0 });
    expect(calc('F').isMilestone).toBe(true);
    const cal = P().calendars.find((c) => c.id !== P().projectCalendarId)!;
    bulkUpdate(['A', 'B'], { calendarId: cal.id });
    expect(task('A').calendarId).toBe(cal.id);
    expect(task('B').calendarId).toBe(cal.id);
    expect(task('C').calendarId).toBe(P().projectCalendarId);
    expect(task('P1').calendarId).toBe(P().projectCalendarId);
    expect(bulkUpdate(['A'], { calendarId: 'nope' }, { quiet: true }).ok).toBe(false);
  });

  it('sets and removes constraints', () => {
    bulkUpdate(['A', 'F'], { constraint: { type: 'SNET', date: '2027-02-01' } });
    expect(task('A').constraint).toEqual({ type: 'SNET', date: '2027-02-01' });
    expect(task('F').constraint).toEqual({ type: 'SNET', date: '2027-02-01' });
    expect(bulkUpdate(['A'], { constraint: { type: 'MSO' } }, { quiet: true }).ok).toBe(false);
    bulkUpdate(['A'], { constraint: { type: 'ASAP' } });
    expect(task('A').constraint).toEqual({ type: 'ASAP' });
    expect(task('F').constraint.type).toBe('SNET');
  });

  it('expands a selected summary to its work tasks', () => {
    const before = steps();
    bulkUpdate(['P1'], { duration: 2, constraint: { type: 'SNET', date: '2027-03-01' } });
    expect(steps()).toBe(before + 1);
    for (const id of ['A', 'B', 'C']) {
      expect(task(id).duration).toBe(2);
      expect(task(id).constraint.type).toBe('SNET');
    }
    expect(task('P1').duration).toBe(0);
    expect(task('P1').constraint).toEqual({ type: 'ASAP' }); // a summary has no constraint of its own
    expect(task('D').duration).toBe(2); // not selected: unchanged (it was already 2)
    expect(task('E').constraint.type).toBe('ASAP');
    // A leaf selected together with its summary is changed once.
    bulkUpdate(['P1', 'A'], { percentComplete: 10 });
    expect(task('A').percentComplete).toBe(10);
    expect(task('C').percentComplete).toBe(10);
  });

  it('shifts the start by working days with a Start no earlier than constraint', () => {
    expect(calc('A').earlyStart).toBe('2027-01-04'); // Monday
    bulkUpdate(['A'], { shiftStartBy: 3 });
    expect(task('A').constraint).toEqual({ type: 'SNET', date: '2027-01-07' }); // Thursday
    expect(calc('A').earlyStart).toBe('2027-01-07');
    // Later than the weekend: 3 more working days from Thursday is Tuesday.
    bulkUpdate(['A'], { shiftStartBy: 3 });
    expect(task('A').constraint.date).toBe('2027-01-12');
    // Earlier: one working day before Tuesday 12th is Monday 11th; the Monday before is the 4th.
    bulkUpdate(['A'], { shiftStartBy: -1 });
    expect(task('A').constraint.date).toBe('2027-01-11');
    expect(lastLabel()).toBe('Edited “A”: start moved earlier by 1 working day');
    // The shift is relative to each task's own current start.
    bulkUpdate(['B', 'C'], { shiftStartBy: 5 });
    const b = calc('B');
    expect(task('B').constraint.date).toBeTruthy();
    expect(b.earlyStart >= task('B').constraint.date!).toBe(true);
    // A summary shifts its work tasks. Zero changes nothing.
    expect(bulkUpdate(['P2'], { shiftStartBy: 0 }, { quiet: true }).ok).toBe(false);
    bulkUpdate(['P2'], { shiftStartBy: 1 });
    expect(task('D').constraint.type).toBe('SNET');
    expect(task('E').constraint.type).toBe('SNET');
  });

  it('adds text to the notes of every selected task', () => {
    bulkUpdate(['A', 'P1'], { appendNotes: ' Check permit ' });
    expect(task('A').notes).toBe('Check permit');
    expect(task('P1').notes).toBe('Check permit');
    bulkUpdate(['A'], { appendNotes: 'Second line' });
    expect(task('A').notes).toBe('Check permit\nSecond line');
    expect(task('B').notes).toBe('');
  });

  it('describes the whole edit in one history entry', () => {
    const before = steps();
    bulkUpdate(['A', 'B', 'C', 'D', 'E'], {
      status: 'blocked',
      responsible: 'GC',
      duration: 4,
      appendNotes: 'x',
    });
    expect(steps()).toBe(before + 1);
    expect(lastLabel()).toBe(
      'Edited 5 tasks: status Blocked, responsible “GC”, duration 4 working days, notes added',
    );
  });

  it('refuses an empty edit', () => {
    const before = steps();
    expect(bulkUpdate(['A'], {}, { quiet: true }).ok).toBe(false);
    expect(bulkUpdate([], { duration: 1 }, { quiet: true }).ok).toBe(false);
    expect(steps()).toBe(before);
  });

  it('undoes in one step and redoes', () => {
    const snapshot = JSON.stringify(P().tasks);
    bulkUpdate(['P1', 'P2'], { status: 'inProgress', duration: 3, shiftStartBy: 2 });
    expect(JSON.stringify(P().tasks)).not.toBe(snapshot);
    S().undo();
    expect(JSON.stringify(P().tasks)).toBe(snapshot);
    S().redo();
    expect(task('A').duration).toBe(3);
  });
});

describe('links between selected tasks', () => {
  it('links the work tasks in outline order, skipping existing links and summaries', () => {
    const before = steps();
    // A to B and B to C exist; C to E and E to F (D is not selected) are new. P1 is ignored.
    expect(linkInSequence(['F', 'C', 'P1', 'A', 'B', 'E']).ok).toBe(true);
    expect(steps()).toBe(before + 1);
    const has = (a: string, b: string) =>
      P().dependencies.filter((d) => d.predecessorId === a && d.successorId === b);
    expect(has('A', 'B')).toHaveLength(1);
    expect(has('B', 'C')).toHaveLength(1);
    expect(has('C', 'E')).toHaveLength(1);
    expect(has('E', 'F')).toHaveLength(1);
    expect(has('C', 'E')[0]).toMatchObject({ type: 'FS', lag: 0, lagUnit: 'wd' });
    expect(P().dependencies).toHaveLength(5);
    S().undo();
    expect(P().dependencies).toHaveLength(4);
  });

  it('does nothing when everything is linked already or fewer than two work tasks are selected', () => {
    const before = steps();
    expect(linkInSequence(['A', 'B', 'C']).ok).toBe(false);
    expect(linkInSequence(['A']).ok).toBe(false);
    expect(linkInSequence(['P1', 'P2']).ok).toBe(false);
    expect(steps()).toBe(before);
  });

  it('rejects the whole operation if a cycle would result, with the cycle message', () => {
    // F already leads back to D, so adding D to E (and E to F) would close a loop.
    S().commit('Add link', (d) => {
      d.dependencies.push({
        id: 'y',
        predecessorId: 'F',
        successorId: 'D',
        type: 'FS',
        lag: 0,
        lagUnit: 'wd',
      });
    });
    const before = steps();
    const res = linkInSequence(['D', 'E', 'F']);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/\S/);
    expect(steps()).toBe(before);
    expect(P().dependencies.some((d) => d.predecessorId === 'D' && d.successorId === 'E')).toBe(
      false,
    );
  });

  it('removes only the links with both ends in the selection', () => {
    const before = steps();
    expect(unlinkTasks(['A', 'B', 'D']).ok).toBe(true); // only A to B
    expect(steps()).toBe(before + 1);
    expect(P().dependencies.map((d) => d.id)).toEqual(['B-C-FS', 'C-D-FS', 'E-F-FS']);
    expect(lastLabel()).toBe('Removed 1 link between 3 tasks');
    expect(unlinkTasks(['A', 'F']).ok).toBe(false);
    expect(steps()).toBe(before + 1);
    S().undo();
    expect(P().dependencies).toHaveLength(4);
  });
});

describe('read-only project', () => {
  it('refuses every bulk action and changes nothing', () => {
    S().setReadOnly(true);
    const snapshot = JSON.stringify(P());
    const before = steps();
    const results = [
      deleteTasks(['A', 'B']),
      indentTasks(['B', 'C']),
      outdentTasks(['B', 'C']),
      moveTasksBy(['A', 'B'], 1),
      bulkUpdate(['A', 'B'], { duration: 9 }, { quiet: true }),
      linkInSequence(['A', 'C', 'F']),
      unlinkTasks(['A', 'B']),
    ];
    expect(results.map((r) => r.ok)).toEqual(results.map(() => false));
    expect(results[4].error).toMatch(/read-only/);
    expect(JSON.stringify(P())).toBe(snapshot);
    expect(steps()).toBe(before);
    S().setReadOnly(false);
  });
});
