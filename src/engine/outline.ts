import type { Task } from './types';

export interface Outline {
  byId: Map<string, Task>;
  /** Children ids per parent id (`null` key = top level), sorted by `order`. */
  children: Map<string | null, string[]>;
  /** All task ids in outline (display) order. */
  flat: string[];
  depth: Map<string, number>;
  wbs: Map<string, string>;
  isSummary: (id: string) => boolean;
  /** Leaf descendants of a task (the task itself if it is a leaf). Memoised. */
  leavesOf: (id: string) => string[];
  /** Ancestors from parent up to the top-level phase. */
  ancestorsOf: (id: string) => string[];
  /** Top-level ancestor (phase) of a task; the task itself if it is top-level. */
  phaseOf: (id: string) => string;
}

export function buildOutline(tasks: Task[]): Outline {
  const byId = new Map<string, Task>();
  for (const t of tasks) byId.set(t.id, t);

  const children = new Map<string | null, string[]>();
  for (const t of tasks) {
    // Orphans (parent missing) are treated as top level.
    const p = t.parentId && byId.has(t.parentId) ? t.parentId : null;
    let list = children.get(p);
    if (!list) children.set(p, (list = []));
    list.push(t.id);
  }
  for (const list of children.values()) {
    list.sort((a, b) => byId.get(a)!.order - byId.get(b)!.order);
  }

  const flat: string[] = [];
  const depth = new Map<string, number>();
  const wbs = new Map<string, string>();
  const visited = new Set<string>();
  const walk = (parent: string | null, d: number, prefix: string) => {
    const list = children.get(parent) ?? [];
    list.forEach((id, i) => {
      if (visited.has(id)) return; // defensive against parent loops
      visited.add(id);
      const code = prefix ? `${prefix}.${i + 1}` : `${i + 1}`;
      flat.push(id);
      depth.set(id, d);
      wbs.set(id, code);
      walk(id, d + 1, code);
    });
  };
  walk(null, 0, '');
  // Tasks caught in a parent loop are appended at top level so nothing disappears.
  for (const t of tasks) {
    if (!visited.has(t.id)) {
      flat.push(t.id);
      depth.set(t.id, 0);
      wbs.set(t.id, '?');
    }
  }

  const isSummary = (id: string) => (children.get(id)?.length ?? 0) > 0;

  const leafMemo = new Map<string, string[]>();
  const leavesOf = (id: string): string[] => {
    const cached = leafMemo.get(id);
    if (cached) return cached;
    const kids = children.get(id);
    let result: string[];
    if (!kids || kids.length === 0) result = [id];
    else {
      result = [];
      for (const k of kids) {
        if (k === id) continue;
        result.push(...leavesOf(k));
      }
    }
    leafMemo.set(id, result);
    return result;
  };

  const ancestorsOf = (id: string): string[] => {
    const out: string[] = [];
    let cur = byId.get(id)?.parentId ?? null;
    const seen = new Set<string>();
    while (cur && byId.has(cur) && !seen.has(cur)) {
      seen.add(cur);
      out.push(cur);
      cur = byId.get(cur)!.parentId;
    }
    return out;
  };

  const phaseOf = (id: string): string => {
    const anc = ancestorsOf(id);
    return anc.length ? anc[anc.length - 1] : id;
  };

  return { byId, children, flat, depth, wbs, isSummary, leavesOf, ancestorsOf, phaseOf };
}

/**
 * Normalise sibling `order` to 0..n-1 and assign `rowId` = 1-based outline position.
 * Mutates the given tasks (works on Immer drafts).
 */
export function renumber(tasks: Task[]): void {
  const outline = buildOutline(tasks);
  for (const list of outline.children.values()) {
    list.forEach((id, i) => {
      outline.byId.get(id)!.order = i;
    });
  }
  outline.flat.forEach((id, i) => {
    outline.byId.get(id)!.rowId = i + 1;
  });
}

/** True if `ancestorId` is `id` itself or one of its ancestors. */
export function isSelfOrAncestor(tasks: Map<string, Task>, ancestorId: string, id: string) {
  let cur: string | null = id;
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) {
    if (cur === ancestorId) return true;
    seen.add(cur);
    cur = tasks.get(cur)?.parentId ?? null;
  }
  return false;
}
