import { produce, produceWithPatches, type Draft, type Patch } from 'immer';
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { buildOutline, detectCycle, renumber, type Project, type TaskStatus } from '../engine';
import { derive } from './derive';
import {
  adoptStored,
  HISTORY_LIMIT,
  jumpTo as jumpHistory,
  loadStoredHistory,
  matchesProject,
  pushEntry,
  redoStep,
  saveStoredHistory,
  serialise,
  storageAvailable,
  undoStep,
  type HistoryEntry,
} from './history';
import { loadPrefs, savePrefs, type Prefs } from './prefs';

export { HISTORY_LIMIT };
export type { HistoryEntry };

/** How long after the last change the history is written to IndexedDB. */
export const HISTORY_SAVE_MS = 1000;

export interface Filters {
  search: string;
  phaseId: string;
  responsible: string;
  criticalOnly: boolean;
  slipped: boolean;
  inProgress: boolean;
  milestones: boolean;
  /** Show only tasks in these statuses (empty = any). */
  statuses: TaskStatus[];
  /** Show only tasks whose schedule signal is At risk or Late. */
  atRiskOrLate: boolean;
}

export const EMPTY_FILTERS: Filters = {
  search: '',
  phaseId: '',
  responsible: '',
  criticalOnly: false,
  slipped: false,
  inProgress: false,
  milestones: false,
  statuses: [],
  atRiskOrLate: false,
};

export type DialogState =
  | { kind: 'task'; taskId: string; tab?: 'general' | 'predecessors' | 'successors' | 'notes' }
  | { kind: 'link'; depId: string }
  | { kind: 'settings' }
  | { kind: 'baselines' }
  | { kind: 'progress' }
  | { kind: 'print' }
  | {
      kind: 'confirm';
      title: string;
      message: string;
      confirmLabel?: string;
      onConfirm: () => void;
    }
  | null;

export interface Toast {
  id: number;
  text: string;
  kind: 'error' | 'info';
}

export interface ScrollRequest {
  taskId?: string;
  day?: number;
  nonce: number;
}

export interface ContextMenuState {
  taskId: string;
  x: number;
  y: number;
}

/** Ask the grid to open the inline editor on a cell (e.g. after "Insert task"). */
export interface EditRequest {
  taskId: string;
  col: 'name';
  nonce: number;
}

export interface CommitResult {
  ok: boolean;
  error?: string;
}

export interface CommitOptions {
  /** Hierarchy or order changed: renumber row IDs. */
  structural?: boolean;
  /** Do not show a toast on failure (caller shows the error inline). */
  quiet?: boolean;
}

interface State {
  project: Project | null;
  /** Applied changes, oldest first. */
  past: HistoryEntry[];
  /** Undone changes; the next one to redo is last. */
  future: HistoryEntry[];
  selectedId: string | null;
  collapsed: Record<string, boolean>;
  filters: Filters;
  dialog: DialogState;
  panel: 'health' | 'variance' | 'history' | 'versions' | null;
  toasts: Toast[];
  prefs: Prefs;
  scrollRequest: ScrollRequest | null;
  printing: { collapsedToPhases: boolean } | null;
  contextMenu: ContextMenuState | null;
  /** True when the project is open in another tab: edits, undo and autosave are disabled. */
  readOnly: boolean;
  editRequest: EditRequest | null;

  openProject: (p: Project) => void;
  closeProject: () => void;
  commit: (
    label: string,
    recipe: (draft: Draft<Project>) => void,
    opts?: CommitOptions,
  ) => CommitResult;
  undo: () => void;
  redo: () => void;
  /**
   * Move to the state right after timeline entry `index` (applied entries oldest first, then
   * the undone ones; -1 = before the first entry).
   */
  jumpTo: (index: number) => void;
  /** Forget all undo and redo steps (the project itself is not changed). */
  clearHistory: () => void;
  select: (id: string | null, scroll?: boolean) => void;
  toggleCollapsed: (id: string) => void;
  collapseToPhases: () => void;
  expandAll: () => void;
  setFilters: (patch: Partial<Filters>) => void;
  setDialog: (d: DialogState) => void;
  setPanel: (p: State['panel']) => void;
  toast: (text: string, kind?: Toast['kind']) => void;
  dismissToast: (id: number) => void;
  setPrefs: (patch: Partial<Prefs>) => void;
  requestScroll: (r: Omit<ScrollRequest, 'nonce'>) => void;
  setPrinting: (p: State['printing']) => void;
  openContextMenu: (m: ContextMenuState | null) => void;
  requestEdit: (taskId: string) => void;
  setReadOnly: (readOnly: boolean) => void;
}

let toastSeq = 0;

export const useStore = create<State>()(
  immer((set, get) => ({
    project: null,
    past: [],
    future: [],
    selectedId: null,
    collapsed: {},
    filters: EMPTY_FILTERS,
    dialog: null,
    panel: null,
    toasts: [],
    prefs: loadPrefs(),
    scrollRequest: null,
    printing: null,
    contextMenu: null,
    readOnly: false,
    editRequest: null,

    openProject: (p) => {
      // Normalise row numbering on load (imported files may be out of order).
      const project = produce(p, (d) => renumber(d.tasks));
      void flushHistorySave(); // the project being left, if any
      historyLoadedFor = null;
      set({
        project,
        past: [],
        future: [],
        selectedId: null,
        collapsed: {},
        filters: EMPTY_FILTERS,
        dialog: null,
        readOnly: false,
      });
      void restoreHistory(project);
    },

    closeProject: () => {
      void flushHistorySave();
      historyLoadedFor = null;
      historySeq++;
      set({ project: null, past: [], future: [], selectedId: null, dialog: null });
    },

    commit: (label, recipe, opts = {}) => {
      const prev = get().project;
      if (!prev) return { ok: false, error: 'No project open' };
      if (get().readOnly) {
        const error = 'This project is open in another tab, so it is read-only here';
        if (!opts.quiet) get().toast(error, 'error');
        return { ok: false, error };
      }
      let next: Project;
      let patches: Patch[];
      let inversePatches: Patch[];
      try {
        [next, patches, inversePatches] = produceWithPatches(prev, (d) => {
          recipe(d);
          if (opts.structural) renumber(d.tasks);
        });
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        if (!opts.quiet) get().toast(error, 'error');
        return { ok: false, error };
      }
      if (next === prev) return { ok: true };
      // Reject edits that would create a cycle before they are committed.
      const outline = buildOutline(next.tasks);
      const cycle = detectCycle(next, outline);
      if (cycle) {
        if (!opts.quiet) get().toast(cycle.message, 'error');
        return { ok: false, error: cycle.message };
      }
      derive(next, outline); // recalculate now so the next render is instant
      const entry: HistoryEntry = { label, at: new Date().toISOString(), patches, inversePatches };
      const h = pushEntry({ past: get().past, future: get().future }, entry);
      set({ project: next, past: h.past, future: h.future });
      return { ok: true };
    },

    undo: () => {
      const { past, future, project, readOnly } = get();
      if (!past.length || !project || readOnly) return;
      const move = undoStep({ past, future }, project);
      if (move) set({ project: move.project, ...move.history });
    },

    redo: () => {
      const { past, future, project, readOnly } = get();
      if (!future.length || !project || readOnly) return;
      const move = redoStep({ past, future }, project);
      if (move) set({ project: move.project, ...move.history });
    },

    jumpTo: (index) => {
      const { past, future, project, readOnly } = get();
      if (!project || readOnly) return;
      const move = jumpHistory({ past, future }, project, index);
      if (move) set({ project: move.project, ...move.history });
    },

    clearHistory: () => {
      if (get().readOnly) return;
      set({ past: [], future: [] });
    },

    select: (id, scroll) => {
      set({ selectedId: id });
      if (id && scroll) get().requestScroll({ taskId: id });
    },

    toggleCollapsed: (id) =>
      set((s) => {
        if (s.collapsed[id]) delete s.collapsed[id];
        else s.collapsed[id] = true;
      }),

    collapseToPhases: () => {
      const p = get().project;
      if (!p) return;
      const { outline } = derive(p);
      const collapsed: Record<string, boolean> = {};
      for (const id of outline.children.get(null) ?? []) {
        if (outline.isSummary(id)) collapsed[id] = true;
      }
      set({ collapsed });
    },

    expandAll: () => set({ collapsed: {} }),

    setFilters: (patch) =>
      set((s) => {
        Object.assign(s.filters, patch);
      }),

    setDialog: (dialog) => set({ dialog }),
    setPanel: (panel) => set({ panel }),

    toast: (text, kind = 'info') => {
      const id = ++toastSeq;
      set((s) => {
        s.toasts.push({ id, text, kind });
      });
      setTimeout(() => get().dismissToast(id), kind === 'error' ? 7000 : 3500);
    },

    dismissToast: (id) =>
      set((s) => {
        s.toasts = s.toasts.filter((t) => t.id !== id);
      }),

    setPrefs: (patch) => {
      set((s) => {
        Object.assign(s.prefs, patch);
      });
      savePrefs(get().prefs);
    },

    requestScroll: (r) => set({ scrollRequest: { ...r, nonce: Date.now() + Math.random() } }),

    setPrinting: (printing) => set({ printing }),
    openContextMenu: (contextMenu) => set({ contextMenu }),
    setReadOnly: (readOnly) => set({ readOnly }),
    requestEdit: (taskId) =>
      set({ editRequest: { taskId, col: 'name', nonce: Date.now() + Math.random() } }),
  })),
);

// ------------------------------------------------------------------ history persistence

/** Id of the project whose stored history has been loaded (saving is held back until then). */
let historyLoadedFor: string | null = null;
/** Bumped whenever a project is opened or closed, to drop the results of stale loads. */
let historySeq = 0;
let historyTimer: ReturnType<typeof setTimeout> | null = null;

/** Write the open project's history now (no-op when read-only or not yet loaded). */
export function flushHistorySave(): Promise<void> {
  if (historyTimer) clearTimeout(historyTimer);
  historyTimer = null;
  const { project, past, future, readOnly } = useStore.getState();
  if (!project || readOnly || historyLoadedFor !== project.id || !storageAvailable()) {
    return Promise.resolve();
  }
  return saveStoredHistory(serialise({ past, future }, project)).catch(() => undefined);
}

function scheduleHistorySave() {
  if (historyTimer) clearTimeout(historyTimer);
  historyTimer = setTimeout(() => void flushHistorySave(), HISTORY_SAVE_MS);
}

/**
 * Load the stored history of a freshly opened project and adopt it if it was saved against
 * exactly this content (otherwise the file changed outside the app and the history is stale).
 */
async function restoreHistory(opened: Project) {
  const seq = ++historySeq;
  const stored = await loadStoredHistory(opened.id);
  const state = useStore.getState();
  if (seq !== historySeq || state.project?.id !== opened.id) return;
  const editedMeanwhile = state.past.length > 0 || state.future.length > 0;
  if (stored && matchesProject(stored, opened)) {
    const h = adoptStored(stored, { past: state.past, future: state.future });
    useStore.setState({ past: h.past, future: h.future });
  }
  historyLoadedFor = opened.id;
  if (editedMeanwhile) scheduleHistorySave();
}

useStore.subscribe((s, prev) => {
  if (s.past === prev.past && s.future === prev.future) return;
  if (!s.project || s.readOnly || historyLoadedFor !== s.project.id) return;
  scheduleHistorySave();
});

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => void flushHistorySave());
}

/** Derived data (outline, schedule, health) for the open project. */
export function useDerived() {
  const project = useStore((s) => s.project);
  return project ? derive(project) : null;
}
