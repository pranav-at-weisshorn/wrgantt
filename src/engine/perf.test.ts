import { describe, expect, it } from 'vitest';
import { scheduleProject } from './schedule';
import { ProjectBuilder } from './testkit';
import type { DepType, Project } from './types';

/** Deterministic pseudo-random generator so the test is repeatable. */
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

export function generateProject(taskCount = 500, linkCount = 800): Project {
  const rand = rng(42);
  const b = new ProjectBuilder({ calendar: 'standard', start: '2027-01-04' });
  b.project.tasks = [];
  // 25 phases of 19 leaves each = 500 tasks.
  const phases = 25;
  const perPhase = Math.floor(taskCount / phases) - 1;
  let order = 0;
  const leaves: string[] = [];
  for (let p = 0; p < phases; p++) {
    const pid = `P${p}`;
    b.project.tasks.push({
      id: pid,
      rowId: 0,
      name: pid,
      parentId: null,
      order: order++,
      duration: 0,
      calendarId: 'standard',
      constraint: { type: 'ASAP' },
      responsible: '',
      notes: '',
      percentComplete: 0,
    });
    for (let i = 0; i < perPhase; i++) {
      const id = `T${p}_${i}`;
      leaves.push(id);
      b.project.tasks.push({
        id,
        rowId: 0,
        name: id,
        parentId: pid,
        order: i,
        duration: 1 + Math.floor(rand() * 30),
        calendarId: 'standard',
        constraint: { type: 'ASAP' },
        responsible: '',
        notes: '',
        percentComplete: 0,
      });
    }
  }
  const types: DepType[] = ['FS', 'FS', 'FS', 'SS', 'FF', 'SF'];
  const seen = new Set<string>();
  while (b.project.dependencies.length < linkCount) {
    // Only link forwards so the network is acyclic.
    const i = Math.floor(rand() * (leaves.length - 1));
    const j = i + 1 + Math.floor(rand() * Math.min(40, leaves.length - i - 1));
    const key = `${i}-${j}`;
    if (seen.has(key)) continue;
    seen.add(key);
    b.link(
      leaves[i],
      leaves[j],
      types[Math.floor(rand() * types.length)],
      Math.floor(rand() * 7) - 2,
    );
  }
  return b.project;
}

describe('performance', () => {
  it('recalculates 500 tasks / 800 links in under 100 ms', () => {
    const project = generateProject();
    expect(project.tasks.length).toBe(500);
    expect(project.dependencies.length).toBe(800);
    scheduleProject(project); // warm-up (JIT, calendar cache)
    const runs = 5;
    let worst = 0;
    for (let k = 0; k < runs; k++) {
      const t0 = performance.now();
      const r = scheduleProject(project);
      worst = Math.max(worst, performance.now() - t0);
      expect(r.cycles).toHaveLength(0);
    }
    expect(worst).toBeLessThan(100);
  });
});
