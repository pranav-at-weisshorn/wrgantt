import { beforeEach, describe, expect, it } from 'vitest';
import { isoToDay, worstCaseProject, buildOutline } from '../engine';
import { ProjectBuilder } from '../engine/testkit';
import { readProjectFile, toProjectFile } from '../io/schema';
import { derive } from './derive';
import { bulkUpdate, moveTasks, setWorstCase } from './ops';
import { useStore } from './store';

const S = () => useStore.getState();
const P = () => S().project!;
const task = (id: string) => P().tasks.find((t) => t.id === id)!;
const order = () => [...P().tasks].sort((a, b) => a.rowId - b.rowId).map((t) => t.id);

beforeEach(() => {
  // A, B, C, D, E unlinked; G is an empty group at the end.
  const b = new ProjectBuilder({ calendar: 'standard' })
    .task('A', 5)
    .task('B', 3)
    .task('C', 4)
    .task('D', 2)
    .task('E', 1)
    .task('G', 1);
  S().openProject(b.project);
});

describe('dragging several tasks', () => {
  it('reorders a selection before a target, keeping its order, as one undo step', () => {
    const before = S().past.length;
    expect(moveTasks(['D', 'B'], 'A', 'before').ok).toBe(true);
    expect(order()).toEqual(['B', 'D', 'A', 'C', 'E', 'G']);
    expect(S().past.length).toBe(before + 1);
    expect(S().past.at(-1)!.label).toBe('Moved 2 tasks before “A”');
    S().undo();
    expect(order()).toEqual(['A', 'B', 'C', 'D', 'E', 'G']);
  });

  it('places a selection after a target', () => {
    moveTasks(['A', 'B'], 'D', 'after');
    expect(order()).toEqual(['C', 'D', 'A', 'B', 'E', 'G']);
  });

  it('makes the selection subtasks of an existing task', () => {
    moveTasks(['B', 'D'], 'G', 'inside');
    expect(task('B').parentId).toBe('G');
    expect(task('D').parentId).toBe('G');
    expect(order()).toEqual(['A', 'C', 'E', 'G', 'B', 'D']);
    expect(derive(P()).outline.isSummary('G')).toBe(true);
    // Appending more keeps the existing subtasks first.
    moveTasks(['A'], 'G', 'inside');
    expect(order()).toEqual(['C', 'E', 'G', 'B', 'D', 'A']);
  });

  it('refuses to move tasks into themselves or their own subtasks', () => {
    moveTasks(['B'], 'G', 'inside');
    const r = moveTasks(['G'], 'B', 'inside');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/into itself/);
    expect(task('B').parentId).toBe('G');
  });

  it('moves a summary with its subtasks and ignores selected subtasks of it', () => {
    moveTasks(['B', 'C'], 'G', 'inside');
    moveTasks(['G', 'B'], 'A', 'before');
    expect(order()).toEqual(['G', 'B', 'C', 'A', 'D', 'E']);
    expect(task('B').parentId).toBe('G');
  });
});

describe('worst case', () => {
  it('is stored, edited and removed as undoable steps', () => {
    setWorstCase('A', 3);
    expect(task('A').worstCaseDays).toBe(3);
    expect(S().past.at(-1)!.label).toBe('Worst case of “A”: +3 working days');
    setWorstCase('A', 0);
    expect(task('A').worstCaseDays).toBeUndefined();
    S().undo();
    expect(task('A').worstCaseDays).toBe(3);
  });

  it('does not move the plan, but gives a worst-case schedule with knock-on delays', () => {
    const b = new ProjectBuilder({ calendar: 'standard' }).task('A', 5).task('B', 3).link('A', 'B');
    S().openProject(b.project);
    const planned = derive(P()).schedule.calc.get('B')!.ef;
    setWorstCase('A', 2);
    const d = derive(P());
    expect(d.schedule.calc.get('B')!.ef).toBe(planned);
    // B starts two working days later in the worst case.
    expect(d.worst!.calc.get('B')!.ef - planned).toBe(2);
    expect(d.worst!.projectFinish).toBeGreaterThan(d.schedule.projectFinish);
  });

  it('keeps the work already done when a task in progress gets extra time', () => {
    const b = new ProjectBuilder().task('A', 10);
    const t = b.project.tasks[0];
    Object.assign(t, { percentComplete: 50, actualStart: b.day(0), worstCaseDays: 10 });
    const wp = worstCaseProject(b.project, buildOutline(b.project.tasks));
    expect(wp.tasks[0].duration).toBe(20);
    expect(wp.tasks[0].percentComplete).toBe(25); // still 5 days done
  });

  it('can be set in bulk and survives saving and loading', () => {
    expect(bulkUpdate(['A', 'B'], { worstCaseDays: 4 }).ok).toBe(true);
    expect(task('B').worstCaseDays).toBe(4);
    const back = readProjectFile(JSON.parse(JSON.stringify(toProjectFile(P()))));
    expect(back.tasks.find((x) => x.id === 'A')!.worstCaseDays).toBe(4);
    bulkUpdate(['A'], { worstCaseDays: 0 });
    expect(task('A').worstCaseDays).toBeUndefined();
    expect(isoToDay(P().startDate)).toBeGreaterThan(0);
  });
});
