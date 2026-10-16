import { beforeEach, describe, expect, it } from 'vitest';
import { ProjectBuilder } from '../engine/testkit';
import { phaseColorOf } from '../ui/rows';
import { pastel, TASK_COLOURS } from '../ui/palette';
import { criticalSummaries, derive } from './derive';
import { setTaskColour } from './ops';
import { useStore } from './store';

const S = () => useStore.getState();
const P = () => S().project!;
const task = (id: string) => P().tasks.find((t) => t.id === id)!;
const colourOf = (id: string) => phaseColorOf(P(), derive(P()), id);

/** P1 (A, B (B1)), P2 (D, E), F. Links: A to B1, B1 to D, E to F. */
function open() {
  const b = new ProjectBuilder({ calendar: 'standard' })
    .task('P1', 0)
    .task('A', 5, { parentId: 'P1' })
    .task('B', 0, { parentId: 'P1' })
    .task('B1', 3, { parentId: 'B' })
    .task('P2', 0)
    .task('D', 4, { parentId: 'P2' })
    .task('E', 2, { parentId: 'P2' })
    .task('F', 1)
    .link('A', 'B1')
    .link('B1', 'D')
    .link('E', 'F');
  S().openProject(b.project);
}

beforeEach(open);

describe('task colours', () => {
  const rose = TASK_COLOURS.find((c) => c.name === 'Rose')!.hex;
  const sky = TASK_COLOURS.find((c) => c.name === 'Sky')!.hex;

  it('subtasks take the colour of their parent', () => {
    setTaskColour(['P1'], rose, 'Rose');
    expect(task('P1').phaseColor).toBe(rose);
    for (const id of ['A', 'B', 'B1']) {
      expect(task(id).phaseColor).toBeUndefined();
      expect(colourOf(id)).toBe(rose);
    }
    expect(colourOf('D')).not.toBe(rose);
  });

  it('colouring a parent replaces the colours its subtasks had', () => {
    setTaskColour(['B1'], sky, 'Sky');
    expect(colourOf('B1')).toBe(sky);
    setTaskColour(['P1'], rose, 'Rose');
    expect(task('B1').phaseColor).toBeUndefined();
    expect(colourOf('B1')).toBe(rose);
  });

  it('a subtask can then be given its own colour, and set back to automatic', () => {
    setTaskColour(['P1'], rose, 'Rose');
    setTaskColour(['B'], sky, 'Sky');
    expect(colourOf('B1')).toBe(sky);
    expect(colourOf('A')).toBe(rose);
    setTaskColour(['B'], null, 'Automatic');
    expect(task('B').phaseColor).toBeUndefined();
    expect(colourOf('B1')).toBe(rose);
  });

  it('is one undo step and changes nothing else', () => {
    const before = JSON.stringify(P().tasks.map(({ phaseColor: _c, ...rest }) => rest));
    const steps = S().past.length;
    setTaskColour(['P1', 'A', 'P2'], rose, 'Rose'); // A is inside P1: only the roots are coloured
    expect(S().past.length).toBe(steps + 1);
    expect(task('A').phaseColor).toBeUndefined();
    expect(JSON.stringify(P().tasks.map(({ phaseColor: _c, ...rest }) => rest))).toBe(before);
    S().undo();
    expect(task('P1').phaseColor).toBeUndefined();
    expect(task('P2').phaseColor).toBeUndefined();
  });

  it('every colour is drawn as a light pastel', () => {
    for (const c of TASK_COLOURS) {
      const [r, g, b] = pastel(c.hex).match(/\d+/g)!.map(Number);
      expect(Math.min(r, g, b)).toBeGreaterThanOrEqual(140);
    }
  });
});

describe('collapsed summaries on the critical path', () => {
  it('is red only when every unfinished subtask is critical', () => {
    const red = criticalSummaries(derive(P()));
    expect(red.has('P1')).toBe(true); // A, B1 critical
    expect(red.has('B')).toBe(true); // nested summary
    expect(red.has('P2')).toBe(false); // E is not critical
  });
});
