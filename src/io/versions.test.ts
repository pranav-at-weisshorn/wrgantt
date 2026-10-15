import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { newId, type Project } from '../engine';
import { projectFromTemplate } from '../template/load';
import { readProjectFile, toProjectFile } from './schema';
import {
  defaultVersionName,
  diffProjects,
  summarise,
  versionFileName,
  versionsToPrune,
} from './versions';

const base = projectFromTemplate('Versions test', '2026-11-02');
const key = (p: Project, k: string) => p.tasks.find((t) => t.templateKey === k)!;

describe('summarise', () => {
  it('counts tasks, finds the latest finish and weights progress by duration', () => {
    const s = summarise(base);
    expect(s.taskCount).toBe(base.tasks.length);
    expect(s.finish).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(s.percentComplete).toBe(0);
    const done = produce(base, (d) => {
      for (const t of d.tasks) t.percentComplete = 100;
    });
    expect(summarise(done).percentComplete).toBe(100);
  });
});

describe('versionFileName', () => {
  it('uses local date and time, then a file-safe name', () => {
    const d = new Date(2026, 9, 15, 16, 42);
    expect(versionFileName(d, 'Before loading: new/old?')).toBe(
      '2026-10-15 1642 Before loading- new-old-.gantt.json',
    );
    expect(versionFileName(new Date(2026, 0, 5, 7, 3), '  ')).toBe(
      '2026-01-05 0703 project.gantt.json',
    );
  });
  it('names a default version after the date', () => {
    expect(defaultVersionName(new Date(2026, 9, 15, 16, 42))).toBe('Version 15 Oct 2026');
  });
});

describe('versionsToPrune', () => {
  const now = new Date(2026, 9, 15, 12, 0);
  const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).toISOString();
  const v = (id: string, kind: 'manual' | 'auto', createdAt: string) => ({ id, kind, createdAt });

  it('keeps everything from the last 30 days and all manual versions', () => {
    const list = [
      v('recent1', 'auto', at(2026, 10, 14)),
      v('recent2', 'auto', at(2026, 10, 2)),
      v('manual-old', 'manual', at(2024, 1, 3)),
    ];
    expect(versionsToPrune(list, now)).toEqual([]);
  });

  it('thins older automatic versions to the newest one per month', () => {
    const list = [
      v('sep-early', 'auto', at(2026, 9, 1)),
      v('sep-late', 'auto', at(2026, 9, 12)),
      v('aug-a', 'auto', at(2026, 8, 3)),
      v('aug-b', 'auto', at(2026, 8, 20, 9)),
      v('aug-c', 'auto', at(2026, 8, 20, 18)),
      v('jul-manual', 'manual', at(2026, 7, 4)),
      v('jul-auto', 'auto', at(2026, 7, 4, 13)),
      v('today', 'auto', at(2026, 10, 15, 8)),
    ];
    expect(versionsToPrune(list, now).sort()).toEqual(['aug-a', 'aug-b', 'sep-early'].sort());
  });

  it('treats exactly 30 days as recent', () => {
    const edge = new Date(now.getTime() - 30 * 86_400_000).toISOString();
    expect(versionsToPrune([v('edge', 'auto', edge), v('x', 'auto', edge)], now)).toEqual([]);
  });
});

describe('diffProjects', () => {
  it('reports no differences for the same project', () => {
    const d = diffProjects(base, base);
    expect(d.added).toEqual([]);
    expect(d.removed).toEqual([]);
    expect(d.renamed).toEqual([]);
    expect(d.changed).toEqual([]);
    expect(d.linksAdded).toEqual([]);
    expect(d.linksRemoved).toEqual([]);
    expect(d.finishChange).toBe(0);
    expect(d.finishOld).toBe(d.finishNew);
  });

  it('finds tasks added, removed and renamed', () => {
    const a03 = key(base, 'A03').id;
    const a05 = key(base, 'A05');
    const newer = produce(base, (d) => {
      d.tasks = d.tasks.filter((t) => t.id !== a05.id);
      d.dependencies = d.dependencies.filter(
        (l) => l.predecessorId !== a05.id && l.successorId !== a05.id,
      );
      d.tasks.find((t) => t.id === a03)!.name = 'Letter of intent signed';
      d.tasks.push({
        ...d.tasks[1],
        id: newId(),
        name: 'Extra task',
        rowId: 999,
        templateKey: undefined,
      });
    });
    const d = diffProjects(base, newer);
    expect(d.added.map((t) => t.name)).toEqual(['Extra task']);
    expect(d.removed.map((t) => t.name)).toEqual([a05.name]);
    expect(d.renamed).toEqual([
      { id: a03, oldName: key(base, 'A03').name, newName: 'Letter of intent signed' },
    ]);
    // Links to the removed task disappear with it.
    expect(d.linksRemoved.length).toBeGreaterThan(0);
    expect(
      d.linksRemoved.every((l) => l.predecessorId === a05.id || l.successorId === a05.id),
    ).toBe(true);
  });

  it('reports date and duration changes and the finish change in working days', () => {
    const a03 = key(base, 'A03');
    const a04 = key(base, 'A04');
    const newer = produce(base, (d) => {
      d.tasks.find((t) => t.id === a03.id)!.duration += 10;
    });
    const d = diffProjects(base, newer);
    const c03 = d.changed.find((t) => t.id === a03.id)!;
    expect(c03.durationOld).toBe(a03.duration);
    expect(c03.durationNew).toBe(a03.duration + 10);
    expect(c03.finishNew > c03.finishOld).toBe(true);
    // The successor moves later but keeps its duration.
    const c04 = d.changed.find((t) => t.id === a04.id)!;
    expect(c04.durationOld).toBe(c04.durationNew);
    expect(c04.startNew > c04.startOld).toBe(true);
    // A03 is on the critical path: the project finish moves by the same 10 working days.
    expect(d.finishChange).toBe(10);
    expect(d.finishChangeCalendarDays).toBeGreaterThanOrEqual(10);
    expect(d.finishNew! > d.finishOld!).toBe(true);
    // Summaries are not listed as changed tasks.
    const summaryIds = new Set(
      base.tasks.filter((t) => base.tasks.some((x) => x.parentId === t.id)).map((t) => t.id),
    );
    expect(d.changed.some((t) => summaryIds.has(t.id))).toBe(false);
    // Reversing the comparison gives the opposite sign.
    expect(diffProjects(newer, base).finishChange).toBe(-10);
  });

  it('treats a changed link lag as one removed and one added link', () => {
    const link = base.dependencies[5];
    const newer = produce(base, (d) => {
      const l = d.dependencies.find((x) => x.id === link.id)!;
      l.lag = l.lag + 3;
    });
    const d = diffProjects(base, newer);
    expect(d.linksAdded).toHaveLength(1);
    expect(d.linksRemoved).toHaveLength(1);
    expect(d.linksAdded[0].lag).toBe(link.lag + 3);
    expect(d.linksRemoved[0].lag).toBe(link.lag);
  });
});

describe('snapshots', () => {
  it('a snapshot file imports with readProjectFile and keeps the project', () => {
    const file = JSON.parse(JSON.stringify(toProjectFile(base)));
    const back = readProjectFile(file);
    expect(back.id).toBe(base.id);
    expect(back.tasks).toEqual(base.tasks);
    expect(diffProjects(base, back).changed).toEqual([]);
  });
});
