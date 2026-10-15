import { produceWithPatches } from 'immer';
import { describe, expect, it } from 'vitest';
import type { Project } from '../engine';
import { ProjectBuilder } from '../engine/testkit';
import {
  adoptStored,
  deserialise,
  fingerprint,
  HISTORY_LIMIT,
  jumpTo,
  matchesProject,
  pushEntry,
  redoStep,
  serialise,
  timeline,
  undoStep,
  type HistoryEntry,
  type HistoryState,
} from './history';

const base = (): Project =>
  new ProjectBuilder().task('A', 5).task('B', 3).task('C', 4).link('A', 'B').project;

/** Apply a recipe the way the store's commit does and record the history entry. */
function edit(
  p: Project,
  h: HistoryState,
  label: string,
  recipe: (d: Project) => void,
  limit?: number,
): { project: Project; history: HistoryState } {
  const [project, patches, inversePatches] = produceWithPatches(p, recipe);
  const entry: HistoryEntry = { label, at: '2027-01-04T09:00:00.000Z', patches, inversePatches };
  return { project, history: pushEntry(h, entry, limit) };
}

const EMPTY: HistoryState = { past: [], future: [] };

/** Make n edits to task A's duration (1..n). */
function run(n: number, limit?: number) {
  let project = base();
  let history = EMPTY;
  const states: Project[] = [project];
  for (let i = 1; i <= n; i++) {
    ({ project, history } = edit(
      project,
      history,
      `Duration ${i}`,
      (d) => {
        d.tasks[0].duration = i;
      },
      limit,
    ));
    states.push(project);
  }
  return { project, history, states };
}

describe('patch history', () => {
  it('undo and redo apply the stored patches', () => {
    const { project, history, states } = run(3);
    expect(project.tasks[0].duration).toBe(3);
    const u = undoStep(history, project)!;
    expect(u.project).toEqual(states[2]);
    expect(u.history.past).toHaveLength(2);
    expect(u.history.future.map((e) => e.label)).toEqual(['Duration 3']);
    const r = redoStep(u.history, u.project)!;
    expect(r.project).toEqual(states[3]);
    expect(r.history.future).toHaveLength(0);
    expect(undoStep(EMPTY, project)).toBeNull();
    expect(redoStep(history, project)).toBeNull();
  });

  it('entries hold patches only, not project snapshots', () => {
    const { history } = run(2);
    expect(Object.keys(history.past[0]).sort()).toEqual([
      'at',
      'inversePatches',
      'label',
      'patches',
    ]);
    expect(history.past[0].patches).toEqual([
      { op: 'replace', path: ['tasks', 0, 'duration'], value: 1 },
    ]);
  });

  it('jumps back several steps in one go and forward again', () => {
    const { project, history, states } = run(6);
    const back = jumpTo(history, project, 1)!; // state right after the second edit
    expect(back.project).toEqual(states[2]);
    expect(back.history.past.map((e) => e.label)).toEqual(['Duration 1', 'Duration 2']);
    // The next redo is the oldest undone entry.
    expect(back.history.future.at(-1)!.label).toBe('Duration 3');
    expect(timeline(back.history).map((e) => e.label)).toEqual(
      timeline(history).map((e) => e.label),
    );
    const fwd = jumpTo(back.history, back.project, 4)!;
    expect(fwd.project).toEqual(states[5]);
    expect(fwd.history.past).toHaveLength(5);
    expect(fwd.history.future.map((e) => e.label)).toEqual(['Duration 6']);
  });

  it('can jump to before the first entry, and ignores bad indexes', () => {
    const { project, history, states } = run(4);
    const start = jumpTo(history, project, -1)!;
    expect(start.project).toEqual(states[0]);
    expect(start.history.past).toHaveLength(0);
    expect(start.history.future).toHaveLength(4);
    expect(jumpTo(history, project, 3)).toBeNull(); // already there
    expect(jumpTo(history, project, 4)).toBeNull();
    expect(jumpTo(history, project, -2)).toBeNull();
    expect(jumpTo(history, project, 1.5)).toBeNull();
  });

  it('a new edit after undoing clears redo', () => {
    const { project, history } = run(3);
    const u = undoStep(history, project)!;
    const next = edit(u.project, u.history, 'Other', (d) => {
      d.tasks[1].duration = 9;
    });
    expect(next.history.future).toHaveLength(0);
    expect(next.history.past.map((e) => e.label)).toEqual(['Duration 1', 'Duration 2', 'Other']);
  });

  it('undoes structural changes (add, remove, reorder)', () => {
    let project = base();
    let history = EMPTY;
    const original = project;
    ({ project, history } = edit(project, history, 'Delete B', (d) => {
      d.tasks = d.tasks.filter((t) => t.id !== 'B');
      d.dependencies = [];
    }));
    ({ project, history } = edit(project, history, 'Add D', (d) => {
      d.tasks.push({ ...d.tasks[0], id: 'D', name: 'D' });
    }));
    expect(project.tasks.map((t) => t.id)).toEqual(['A', 'C', 'D']);
    const back = jumpTo(history, project, -1)!;
    expect(back.project).toEqual(original);
    const again = jumpTo(back.history, back.project, 1)!;
    expect(again.project).toEqual(project);
  });

  it('removing an optional field is undone and redone', () => {
    let project = base();
    let history = EMPTY;
    ({ project, history } = edit(project, history, 'Start', (d) => {
      d.tasks[0].actualStart = '2027-01-04';
    }));
    ({ project, history } = edit(project, history, 'Clear', (d) => {
      delete d.tasks[0].actualStart;
    }));
    const u = undoStep(history, project)!;
    expect(u.project.tasks[0].actualStart).toBe('2027-01-04');
    const r = redoStep(u.history, u.project)!;
    expect(r.project.tasks[0].actualStart).toBeUndefined();
    expect('actualStart' in r.project.tasks[0]).toBe(false);
  });
});

describe('history cap', () => {
  it('drops the oldest entries beyond the limit', () => {
    const { history } = run(12, 5);
    expect(history.past).toHaveLength(5);
    expect(history.past[0].label).toBe('Duration 8');
    expect(history.past.at(-1)!.label).toBe('Duration 12');
  });

  it('is effectively unlimited (5,000 steps)', () => {
    expect(HISTORY_LIMIT).toBe(5000);
    let h = EMPTY;
    const e: HistoryEntry = {
      label: 'x',
      at: '2027-01-04T09:00:00.000Z',
      patches: [],
      inversePatches: [],
    };
    for (let i = 0; i < HISTORY_LIMIT + 10; i++) h = pushEntry(h, { ...e, label: `n${i}` });
    expect(h.past).toHaveLength(HISTORY_LIMIT);
    expect(h.past[0].label).toBe('n10');
  });
});

describe('fingerprint', () => {
  it('is stable across key order and ignores derived calc data', () => {
    const p = base();
    const reordered = JSON.parse(JSON.stringify(p)) as Project;
    reordered.tasks = reordered.tasks.map((t) => {
      const entries = Object.entries(t).reverse();
      return Object.fromEntries(entries) as typeof t;
    });
    reordered.tasks[0].calc = { es: 1 } as never;
    expect(fingerprint(reordered)).toBe(fingerprint(p));
  });

  it('changes when the content changes', () => {
    const p = base();
    const [q] = produceWithPatches(p, (d) => {
      d.tasks[2].name = 'Changed';
    });
    expect(fingerprint(q)).not.toBe(fingerprint(p));
  });

  it('matches only the project the history was saved against', () => {
    const { project, history } = run(3);
    const stored = serialise(history, project);
    expect(matchesProject(stored, project)).toBe(true);
    const u = undoStep(history, project)!;
    expect(matchesProject(stored, u.project)).toBe(false);
    expect(matchesProject({ ...stored, projectId: 'other' }, project)).toBe(false);
  });
});

describe('serialise', () => {
  it('round-trips through JSON and still undoes', () => {
    const { project, history, states } = run(4);
    const undone = undoStep(history, project)!;
    const stored = serialise(undone.history, undone.project, '2027-01-04T10:00:00.000Z');
    const back = deserialise(JSON.parse(JSON.stringify(stored)))!;
    expect(back.fingerprint).toBe(fingerprint(undone.project));
    expect(back.past).toHaveLength(3);
    expect(back.future).toHaveLength(1);
    // Fresh project object with the same content, as after a reload.
    const reloaded = JSON.parse(JSON.stringify(undone.project)) as Project;
    expect(matchesProject(back, reloaded)).toBe(true);
    const redone = redoStep(back, reloaded)!;
    expect(redone.project).toEqual(states[4]);
    const all = jumpTo(back, reloaded, -1)!;
    expect(all.project).toEqual(states[0]);
  });

  it('rejects malformed data', () => {
    expect(deserialise(null)).toBeNull();
    expect(deserialise({})).toBeNull();
    expect(
      deserialise({ version: 2, projectId: 'p', fingerprint: 'x', past: [], future: [] }),
    ).toBeNull();
    const { project, history } = run(1);
    const stored = serialise(history, project);
    expect(deserialise({ ...stored, past: [{ label: 'x' }] })).toBeNull();
    expect(
      deserialise({
        ...stored,
        past: [{ ...stored.past[0], patches: [{ op: 'nope', path: [] }] }],
      }),
    ).toBeNull();
  });

  it('applies the cap when reading', () => {
    const { project, history } = run(8);
    const stored = serialise(history, project);
    expect(deserialise(stored, 3)!.past.map((e) => e.label)).toEqual([
      'Duration 6',
      'Duration 7',
      'Duration 8',
    ]);
  });
});

describe('adopting stored history', () => {
  it('uses stored history as it is when nothing was edited meanwhile', () => {
    const { project, history } = run(3);
    const u = undoStep(history, project)!;
    const adopted = adoptStored(u.history, EMPTY);
    expect(adopted.past).toHaveLength(2);
    expect(adopted.future).toHaveLength(1);
  });

  it('continues stored history with edits made while it was loading (redo is dropped)', () => {
    const { project, history } = run(3);
    const u = undoStep(history, project)!;
    const meanwhile = edit(u.project, EMPTY, 'Meanwhile', (d) => {
      d.tasks[1].duration = 7;
    }).history;
    const adopted = adoptStored(u.history, meanwhile);
    expect(adopted.past.map((e) => e.label)).toEqual(['Duration 1', 'Duration 2', 'Meanwhile']);
    expect(adopted.future).toHaveLength(0);
  });
});
