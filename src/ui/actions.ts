import { derive } from '../store/derive';
import { deleteTasks } from '../store/ops';
import { useStore } from '../store/store';

/** Delete tasks, asking first when they have children or links. */
export function confirmDeleteTasks(ids: string[]) {
  const s = useStore.getState();
  const p = s.project;
  if (!p || !ids.length) return;
  const { outline } = derive(p);
  const hasKids = ids.some((id) => outline.isSummary(id));
  const linkCount = p.dependencies.filter(
    (d) => ids.includes(d.predecessorId) || ids.includes(d.successorId),
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
  if (!hasKids && linkCount === 0) {
    doDelete();
    return;
  }
  const names = ids
    .map((id) => `${outline.byId.get(id)?.rowId} ${outline.byId.get(id)?.name}`)
    .join(', ');
  const parts: string[] = [];
  if (hasKids) {
    const n = ids.reduce((acc, id) => acc + outline.leavesOf(id).length, 0);
    parts.push(`its ${n} subtask${n === 1 ? '' : 's'}`);
  }
  if (linkCount) parts.push(`${linkCount} link${linkCount === 1 ? '' : 's'}`);
  s.setDialog({
    kind: 'confirm',
    title: 'Delete task?',
    message: `Delete ${names}, together with ${parts.join(' and ')}? You can undo this.`,
    confirmLabel: 'Delete',
    onConfirm: doDelete,
  });
}
