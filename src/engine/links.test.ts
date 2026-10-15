import { describe, expect, it } from 'vitest';
import { formatLink, parseLinkList, resolvePredecessorText } from './links';
import { ProjectBuilder } from './testkit';

let n = 0;
const newId = () => `new-${++n}`;

describe('parseLinkList', () => {
  it('parses the documented syntax', () => {
    const { links, errors } = parseLinkList('12, 18SS+10d, 23FF-2d, 30SF, 41FS+30ed');
    expect(errors).toEqual([]);
    expect(links).toEqual([
      { rowId: 12, type: 'FS', lag: 0, lagUnit: 'wd' },
      { rowId: 18, type: 'SS', lag: 10, lagUnit: 'wd' },
      { rowId: 23, type: 'FF', lag: -2, lagUnit: 'wd' },
      { rowId: 30, type: 'SF', lag: 0, lagUnit: 'wd' },
      { rowId: 41, type: 'FS', lag: 30, lagUnit: 'ed' },
    ]);
  });
  it('accepts lower case, spaces, a lag without a type and weeks', () => {
    const { links } = parseLinkList('5 ss + 2 d; 6+3d, 7fs+1w');
    expect(links.map((l) => [l.rowId, l.type, l.lag, l.lagUnit])).toEqual([
      [5, 'SS', 2, 'wd'],
      [6, 'FS', 3, 'wd'],
      [7, 'FS', 5, 'wd'],
    ]);
  });
  it('reports garbage', () => {
    expect(parseLinkList('12XX').errors).toHaveLength(1);
    expect(parseLinkList('abc').errors).toHaveLength(1);
  });
  it('formats links in full, without abbreviations', () => {
    expect(formatLink(12, 'FS', 0, 'wd')).toBe('12 Finish-to-Start');
    expect(formatLink(18, 'SS', 10, 'wd')).toBe('18 Start-to-Start +10 working days');
    expect(formatLink(23, 'FF', -2, 'wd')).toBe('23 Finish-to-Finish -2 working days');
    expect(formatLink(30, 'SF', 0, 'wd')).toBe('30 Start-to-Finish');
    expect(formatLink(41, 'FS', 30, 'ed')).toBe('41 Finish-to-Start +30 calendar days');
    expect(formatLink(5, 'FS', 1, 'wd')).toBe('5 Finish-to-Start +1 working day');
  });
  it('parses the full forms back (round trip)', () => {
    const shown = [
      formatLink(12, 'FS', 0, 'wd'),
      formatLink(18, 'SS', 10, 'wd'),
      formatLink(23, 'FF', -2, 'wd'),
      formatLink(30, 'SF', 0, 'wd'),
      formatLink(41, 'FS', 30, 'ed'),
    ].join(', ');
    const { links, errors } = parseLinkList(shown);
    expect(errors).toEqual([]);
    expect(links).toEqual(parseLinkList('12, 18SS+10d, 23FF-2d, 30SF, 41FS+30ed').links);
  });
  it('accepts free-form spacing and wording', () => {
    const { links, errors } = parseLinkList(
      '7 start to start + 3 working days; 8 finish-to-finish − 1 day, 9 + 2 calendar weeks',
    );
    expect(errors).toEqual([]);
    expect(links.map((l) => [l.rowId, l.type, l.lag, l.lagUnit])).toEqual([
      [7, 'SS', 3, 'wd'],
      [8, 'FF', -1, 'wd'],
      [9, 'FS', 14, 'ed'],
    ]);
  });
});

describe('resolvePredecessorText', () => {
  const b = new ProjectBuilder()
    .task('A', 1)
    .task('B', 1)
    .task('C', 1)
    .link('A', 'B')
    .link('B', 'C');
  it('replaces the predecessors of a task', () => {
    const r = resolvePredecessorText(b.project, 'C', '1SS+2d', newId);
    expect(r.ok).toBe(true);
    const preds = r.dependencies!.filter((d) => d.successorId === 'C');
    expect(preds).toHaveLength(1);
    expect(preds[0]).toMatchObject({ predecessorId: 'A', type: 'SS', lag: 2 });
  });
  it('rejects unknown IDs', () => {
    expect(resolvePredecessorText(b.project, 'C', '99', newId).error).toMatch(/Unknown task ID 99/);
  });
  it('rejects cycles naming the loop', () => {
    const r = resolvePredecessorText(b.project, 'A', '3', newId);
    expect(r.ok).toBe(false);
    expect(r.error).toBe('Circular dependency: 1 → 2 → 3 → 1');
  });
  it('rejects self links', () => {
    expect(resolvePredecessorText(b.project, 'A', '1', newId).ok).toBe(false);
  });
});
