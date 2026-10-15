import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { statusOf, STATUS_LABEL, TASK_STATUSES, type TaskStatus } from '../engine';
import { derive } from '../store/derive';
import {
  canMoveTask,
  indentTask,
  insertTaskAt,
  moveTaskBy,
  outdentTask,
  setDuration,
  setStatus,
  type InsertPosition,
} from '../store/ops';
import { useStore } from '../store/store';
import { confirmDeleteTasks } from './actions';
import { Icon, type IconName } from './icons';
import { StatusChip } from './StatusChip';

interface Item {
  label: string;
  icon?: IconName;
  shortcut?: string;
  disabled?: boolean;
  danger?: boolean;
  run: () => void;
  /** A status choice: which status, and whether it is the current one. */
  status?: { value: TaskStatus; checked: boolean };
  /** Section title shown above this item. */
  heading?: string;
}

/** Right-click menu for a task row or bar. */
export function ContextMenu() {
  const menu = useStore((s) => s.contextMenu);
  const project = useStore((s) => s.project);
  const close = useStore((s) => s.openContextMenu);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  // Keep the menu on screen.
  useLayoutEffect(() => {
    if (!menu || !ref.current) return setPos(null);
    const r = ref.current.getBoundingClientRect();
    setPos({
      x: Math.max(4, Math.min(menu.x, window.innerWidth - r.width - 4)),
      y: Math.max(4, Math.min(menu.y, window.innerHeight - r.height - 4)),
    });
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close(null);
    const onAway = () => close(null);
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', onAway);
    window.addEventListener('resize', onAway);
    window.addEventListener('wheel', onAway, { passive: true });
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', onAway);
      window.removeEventListener('resize', onAway);
      window.removeEventListener('wheel', onAway);
    };
  }, [menu, close]);

  if (!menu || !project) return null;
  const { outline, schedule } = derive(project);
  const task = outline.byId.get(menu.taskId);
  if (!task) return null;
  const id = task.id;
  const s = useStore.getState();
  const isSummary = outline.isSummary(id);
  const c = schedule.calc.get(id);
  const siblings = outline.children.get(task.parentId ?? null) ?? [];
  const isFirstSibling = siblings[0] === id;

  const insert = (position: InsertPosition) => {
    const nid = insertTaskAt(id, position);
    if (nid) {
      s.select(nid, true);
      s.requestEdit(nid);
    }
  };

  const groups: Item[][] = [
    [
      {
        label: 'Edit task…',
        icon: 'settings',
        run: () => s.setDialog({ kind: 'task', taskId: id }),
      },
      {
        label: 'Predecessors…',
        icon: 'link',
        run: () => s.setDialog({ kind: 'task', taskId: id, tab: 'predecessors' }),
      },
      {
        label: 'Successors…',
        icon: 'link',
        run: () => s.setDialog({ kind: 'task', taskId: id, tab: 'successors' }),
      },
    ],
    [
      { label: 'Insert task above', icon: 'plus', shortcut: 'Insert', run: () => insert('above') },
      { label: 'Insert task below', icon: 'plus', run: () => insert('below') },
      { label: 'Insert subtask', icon: 'indent', run: () => insert('inside') },
    ],
    [
      {
        label: 'Move up',
        icon: 'up',
        shortcut: 'Alt+Shift+↑',
        disabled: !canMoveTask(project, id, -1),
        run: () => moveTaskBy(id, -1),
      },
      {
        label: 'Move down',
        icon: 'down',
        shortcut: 'Alt+Shift+↓',
        disabled: !canMoveTask(project, id, 1),
        run: () => moveTaskBy(id, 1),
      },
      {
        label: 'Indent',
        icon: 'indent',
        shortcut: 'Tab',
        disabled: isFirstSibling,
        run: () => indentTask(id),
      },
      {
        label: 'Outdent',
        icon: 'outdent',
        shortcut: 'Shift+Tab',
        disabled: !task.parentId,
        run: () => outdentTask(id),
      },
    ],
  ];
  if (!isSummary && c) {
    const current = statusOf(task);
    groups.push(
      TASK_STATUSES.map((value, i) => ({
        label: STATUS_LABEL[value],
        heading: i === 0 ? 'Status' : undefined,
        status: { value, checked: value === current },
        run: () => setStatus(id, value),
      })),
    );
    groups.push([
      task.duration === 0
        ? { label: 'Turn into a 1-day task', icon: 'calendar', run: () => setDuration(id, 1) }
        : { label: 'Turn into a milestone', icon: 'flag', run: () => setDuration(id, 0) },
    ]);
  }
  groups.push([
    {
      label: isSummary ? 'Delete task and subtasks' : 'Delete task',
      icon: 'trash',
      shortcut: 'Delete',
      danger: true,
      run: () => confirmDeleteTasks([id]),
    },
  ]);

  return (
    <div
      ref={ref}
      className="menu context-menu"
      role="menu"
      aria-label={`Options for ${task.name}`}
      style={{
        transform: `translate(${pos?.x ?? menu.x}px, ${pos?.y ?? menu.y}px)`,
        visibility: pos ? 'visible' : 'hidden',
      }}
      onContextMenu={(e) => e.preventDefault()}
      data-testid="context-menu"
    >
      <div className="menu-title" title={task.name}>
        {task.rowId} · {task.name.length > 34 ? `${task.name.slice(0, 33)}…` : task.name}
      </div>
      {groups.map((g, gi) => (
        <div key={gi}>
          {gi > 0 && <hr />}
          {g.map((it) => (
            <Fragment key={it.label}>
              {it.heading && <div className="menu-title">{it.heading}</div>}
              <button
                role={it.status ? 'menuitemradio' : 'menuitem'}
                aria-checked={it.status ? it.status.checked : undefined}
                disabled={it.disabled}
                className={[it.danger ? 'danger' : '', it.status ? 'status-item' : '']
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => {
                  close(null);
                  it.run();
                }}
                data-status={it.status?.value}
              >
                {it.status ? (
                  <>
                    <span className="check">
                      {it.status.checked && <Icon name="check" size={14} />}
                    </span>
                    <StatusChip status={it.status.value} />
                  </>
                ) : (
                  <>
                    {it.icon ? <Icon name={it.icon} size={14} /> : <span style={{ width: 14 }} />}
                    {it.label}
                  </>
                )}
                {it.shortcut && <span className="shortcut">{it.shortcut}</span>}
              </button>
            </Fragment>
          ))}
        </div>
      ))}
    </div>
  );
}
