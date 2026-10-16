import { derive } from '../store/derive';
import { deleteTasks, inOutlineOrder } from '../store/ops';
import { useStore } from '../store/store';

/**
 * Delete tasks, asking first when they have children or links, or when there are several
 * (then once for the whole selection).
 */
export function confirmDeleteTasks(requested: string[]) {
  const s = useStore.getState();
  const p = s.project;
  if (!p) return;
  const ids = inOutlineOrder(p, requested);
  if (!ids.length) return;
  const { outline } = derive(p);
  const chosen = new Set(ids);
  // Everything that goes: the chosen tasks and all their subtasks.
  const doomed = new Set(
    outline.flat.filter(
      (id) => chosen.has(id) || outline.ancestorsOf(id).some((a) => chosen.has(a)),
    ),
  );
  const subtasks = doomed.size - ids.length;
  const linkCount = p.dependencies.filter(
    (d) => doomed.has(d.predecessorId) || doomed.has(d.successorId),
  ).length;
  const doDelete = () => {
    const idx = outline.flat.indexOf(ids[0]);
    deleteTasks(ids);
    // Select the row that took its place.
    const after = useStore.getState().project;
    if (after) {
      const flat = derive(after).outline.flat;
      s.select(flat[Math.min(idx, flat.length - 1)] ?? null);
    }
  };
  if (ids.length === 1 && !subtasks && linkCount === 0) {
    doDelete();
    return;
  }
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const extras: string[] = [];
  if (subtasks) extras.push(plural(subtasks, 'subtask'));
  if (linkCount) extras.push(plural(linkCount, 'link'));
  let message: string;
  if (ids.length === 1) {
    const t = outline.byId.get(ids[0])!;
    message = `Delete ${t.rowId} ${t.name}, together with ${
      subtasks ? `its ${plural(subtasks, 'subtask')}` : ''
    }${subtasks && linkCount ? ' and ' : ''}${linkCount ? plural(linkCount, 'link') : ''}? You can undo this.`;
  } else {
    message = `Delete ${plural(ids.length, 'selected task')}${
      extras.length ? `, together with ${extras.join(' and ')}` : ''
    }? You can undo this.`;
  }
  s.setDialog({
    kind: 'confirm',
    title: ids.length === 1 ? 'Delete task?' : `Delete ${ids.length} tasks?`,
    message,
    confirmLabel: ids.length === 1 ? 'Delete' : `Delete ${ids.length} tasks`,
    onConfirm: doDelete,
  });
}
