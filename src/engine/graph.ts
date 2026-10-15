import type { Outline } from './outline';
import type { CycleInfo, Dependency, Project } from './types';

/** A link between two leaf tasks, after expanding links on summary tasks. */
export interface Edge {
  from: number;
  to: number;
  dep: Dependency;
}

export interface LeafGraph {
  leafIds: string[];
  index: Map<string, number>;
  edges: Edge[];
  inEdges: Edge[][];
  outEdges: Edge[][];
  /** Topological order (indices into leafIds). */
  order: number[];
  cycles: CycleInfo[];
}

export function expandEdges(project: Project, outline: Outline, index: Map<string, number>) {
  const edges: Edge[] = [];
  for (const dep of project.dependencies) {
    if (!outline.byId.has(dep.predecessorId) || !outline.byId.has(dep.successorId)) continue;
    const preds = outline.leavesOf(dep.predecessorId);
    const succs = outline.leavesOf(dep.successorId);
    for (const p of preds) {
      for (const s of succs) {
        const from = index.get(p);
        const to = index.get(s);
        if (from === undefined || to === undefined) continue;
        edges.push({ from, to, dep });
      }
    }
  }
  return edges;
}

function adjacency(n: number, edges: Edge[]) {
  const inEdges: Edge[][] = Array.from({ length: n }, () => []);
  const outEdges: Edge[][] = Array.from({ length: n }, () => []);
  for (const e of edges) {
    outEdges[e.from].push(e);
    inEdges[e.to].push(e);
  }
  return { inEdges, outEdges };
}

/** Kahn's algorithm. Returns the order and the nodes left over (which lie on or behind cycles). */
function kahn(n: number, edges: Edge[], outEdges: Edge[][]) {
  const indeg = new Int32Array(n);
  for (const e of edges) indeg[e.to]++;
  const queue: number[] = [];
  for (let i = 0; i < n; i++) if (indeg[i] === 0) queue.push(i);
  const order: number[] = [];
  for (let qi = 0; qi < queue.length; qi++) {
    const v = queue[qi];
    order.push(v);
    for (const e of outEdges[v]) if (--indeg[e.to] === 0) queue.push(e.to);
  }
  const remaining: number[] = [];
  if (order.length < n) for (let i = 0; i < n; i++) if (indeg[i] > 0) remaining.push(i);
  return { order, remaining };
}

/** Find one concrete loop among `nodes` (iterative DFS). Returns the edges along it. */
function findLoop(nodes: number[], outEdges: Edge[][]): Edge[] | null {
  const inSet = new Set(nodes);
  const state = new Map<number, 1 | 2>(); // 1 = on stack, 2 = done
  for (const start of nodes) {
    if (state.has(start)) continue;
    const stack: { v: number; i: number; via: Edge | null }[] = [{ v: start, i: 0, via: null }];
    state.set(start, 1);
    while (stack.length) {
      const top = stack[stack.length - 1];
      const outs = outEdges[top.v];
      if (top.i < outs.length) {
        const e = outs[top.i++];
        if (!inSet.has(e.to)) continue;
        const st = state.get(e.to);
        if (st === 1) {
          // Back edge: unwind the stack to e.to.
          const loop: Edge[] = [e];
          for (let k = stack.length - 1; k > 0 && stack[k].v !== e.to; k--) {
            loop.unshift(stack[k].via!);
          }
          return loop;
        }
        if (st === undefined) {
          state.set(e.to, 1);
          stack.push({ v: e.to, i: 0, via: e });
        }
      } else {
        state.set(top.v, 2);
        stack.pop();
      }
    }
  }
  return null;
}

export function cycleMessage(loopTaskIds: string[], outline: Outline, summaryIds: string[] = []) {
  const ids = loopTaskIds.map((id) => outline.byId.get(id)?.rowId ?? '?');
  let msg = `Circular dependency: ${ids.join(' → ')}`;
  if (summaryIds.length) {
    const s = [...new Set(summaryIds)].map((id) => outline.byId.get(id)?.rowId ?? '?');
    msg += ` (via link on summary task ${s.join(', ')})`;
  }
  return msg;
}

function loopInfo(loop: Edge[], leafIds: string[], outline: Outline): CycleInfo {
  const taskIds = [leafIds[loop[0].from], ...loop.map((e) => leafIds[e.to])];
  const summaries: string[] = [];
  for (const e of loop) {
    if (outline.isSummary(e.dep.predecessorId)) summaries.push(e.dep.predecessorId);
    if (outline.isSummary(e.dep.successorId)) summaries.push(e.dep.successorId);
  }
  return { taskIds, message: cycleMessage(taskIds, outline, summaries) };
}

/**
 * Build the leaf-level dependency graph. If there are cycles, one link of each loop is dropped
 * (so a schedule can still be produced) and the loops are reported.
 */
export function buildLeafGraph(project: Project, outline: Outline): LeafGraph {
  const leafIds = outline.flat.filter((id) => !outline.isSummary(id));
  const index = new Map<string, number>();
  leafIds.forEach((id, i) => index.set(id, i));
  let edges = expandEdges(project, outline, index);
  const n = leafIds.length;
  const cycles: CycleInfo[] = [];

  for (let guard = 0; guard < 1000; guard++) {
    const { inEdges, outEdges } = adjacency(n, edges);
    const { order, remaining } = kahn(n, edges, outEdges);
    if (remaining.length === 0) {
      return { leafIds, index, edges, inEdges, outEdges, order, cycles };
    }
    const loop = findLoop(remaining, outEdges);
    if (!loop) break;
    cycles.push(loopInfo(loop, leafIds, outline));
    // Drop every expanded edge that came from the closing link of the loop.
    const drop = loop[loop.length - 1].dep;
    edges = edges.filter((e) => e.dep !== drop);
  }
  // Fallback (should not happen): no edges.
  const { inEdges, outEdges } = adjacency(n, []);
  return { leafIds, index, edges: [], inEdges, outEdges, order: leafIds.map((_, i) => i), cycles };
}

/** Returns the first cycle in the project, or null. Used to validate edits before committing. */
export function detectCycle(project: Project, outline: Outline): CycleInfo | null {
  const leafIds = outline.flat.filter((id) => !outline.isSummary(id));
  const index = new Map<string, number>();
  leafIds.forEach((id, i) => index.set(id, i));
  const edges = expandEdges(project, outline, index);
  const { outEdges } = adjacency(leafIds.length, edges);
  const { remaining } = kahn(leafIds.length, edges, outEdges);
  if (!remaining.length) return null;
  const loop = findLoop(remaining, outEdges);
  return loop ? loopInfo(loop, leafIds, outline) : null;
}
