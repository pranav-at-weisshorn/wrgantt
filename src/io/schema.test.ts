import { describe, expect, it } from 'vitest';
import { scheduleProject } from '../engine';
import { projectFromTemplate } from '../template/load';
import { readProjectFile, SCHEMA_VERSION, toProjectFile } from './schema';

describe('project file format', () => {
  const project = projectFromTemplate('Round trip', '2026-11-02');

  it('round-trips through JSON with identical schedule', () => {
    const json = JSON.stringify(toProjectFile(project));
    const back = readProjectFile(JSON.parse(json));
    expect(back.tasks).toEqual(project.tasks);
    expect(back.dependencies).toEqual(project.dependencies);
    expect(scheduleProject(back).projectFinish).toBe(scheduleProject(project).projectFinish);
  });

  it('is versioned', () => {
    expect(toProjectFile(project).schemaVersion).toBe(SCHEMA_VERSION);
    expect(() => readProjectFile({ schemaVersion: SCHEMA_VERSION + 1, project })).toThrow(
      /newer version/,
    );
  });

  it('accepts a bare project object and repairs bad data', () => {
    const raw = JSON.parse(JSON.stringify(project));
    raw.tasks[3].duration = -4;
    raw.tasks[3].constraint = { type: 'BOGUS' };
    raw.tasks[4].parentId = 'missing';
    raw.dependencies.push({
      id: 'x',
      predecessorId: 'nope',
      successorId: raw.tasks[1].id,
      type: 'FS',
      lag: 0,
    });
    raw.tasks[0].calc = { es: 1 };
    const p = readProjectFile(raw);
    expect(p.tasks[3].duration).toBe(0);
    expect(p.tasks[3].constraint).toEqual({ type: 'ASAP' });
    expect(p.tasks.find((t) => t.id === raw.tasks[4].id)!.parentId).toBeNull();
    expect(p.dependencies).toHaveLength(project.dependencies.length);
    expect('calc' in p.tasks[0]).toBe(false);
  });

  it('rejects non-projects', () => {
    expect(() => readProjectFile(null)).toThrow();
    expect(() => readProjectFile({ schemaVersion: 1, project: { name: 'x' } })).toThrow(
      /no task list/,
    );
  });
});
