import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
  type UIEvent,
} from 'react';
import { activeBaseline, CONSTRAINT_LABEL, type Project } from '../../engine';
import type { Derived } from '../../store/derive';
import {
  indentTask,
  insertTask,
  moveTask,
  moveTaskBy,
  outdentTask,
  renameTask,
  setDuration,
  setFinishDate,
  setPercentComplete,
  setPredecessorsText,
  setStartDate,
  updateTask,
} from '../../store/ops';
import type { ColumnKey } from '../../store/prefs';
import { useStore, type CommitResult } from '../../store/store';
import { editValue, type ColumnCtx, type ColumnDef } from '../columns';
import { fmtIso, parseDateInput, parseDuration } from '../format';
import { Icon } from '../icons';
import { HEADER_H, ROW_H, type Row } from '../rows';
import { confirmDeleteTasks } from '../actions';

interface Props {
  project: Project;
  derived: Derived;
  rows: Row[];
  rowIndex: Map<string, number>;
  columns: ColumnDef[];
  width: number;
  first: number;
  last: number;
  bodyRef: RefObject<HTMLDivElement | null>;
  onBodyScroll: (e: UIEvent<HTMLDivElement>) => void;
}

interface Editing {
  id: string;
  col: ColumnKey;
  value: string;
  error?: string;
  selectAll: boolean;
}

interface RowDrag {
  id: string;
  startY: number;
  active: boolean;
  target?: { id: string; pos: 'before' | 'after' | 'inside' };
}

export function Grid(props: Props) {
  const { project, rows, rowIndex, columns, width, first, last, bodyRef, onBodyScroll } = props;
  const selectedId = useStore((s) => s.selectedId);
  const select = useStore((s) => s.select);
  const toggleCollapsed = useStore((s) => s.toggleCollapsed);
  const showCritical = useStore((s) => s.prefs.showCritical);
  const setDialog = useStore((s) => s.setDialog);
  const openContextMenu = useStore((s) => s.openContextMenu);
  const [activeCol, setActiveCol] = useState<ColumnKey>('name');
  const [editing, setEditing] = useState<Editing | null>(null);
  const [rowDrag, setRowDrag] = useState<RowDrag | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dragRef = useRef<RowDrag | null>(null);
  dragRef.current = rowDrag;

  const ctx: ColumnCtx = { project, baseline: activeBaseline(project) };
  const totalW = columns.reduce((s, c) => s + c.width, 0);
  const editableCols = columns.filter((c) => c.key !== 'indicators');

  // Keep the editor input focused and (optionally) its text selected when it opens.
  useLayoutEffect(() => {
    if (editing && inputRef.current && document.activeElement !== inputRef.current) {
      inputRef.current.focus();
      if (editing.selectAll) inputRef.current.select();
      else {
        const n = inputRef.current.value.length;
        inputRef.current.setSelectionRange(n, n);
      }
    }
  }, [editing]);

  // Drop the editor if its row disappears (undo, delete, filter).
  useEffect(() => {
    if (editing && !rowIndex.has(editing.id)) setEditing(null);
  }, [rowIndex, editing]);

  const focusGrid = () => rootRef.current?.focus({ preventScroll: true });

  // Open the name editor when asked from outside (context menu "Insert task…").
  const editRequest = useStore((s) => s.editRequest);
  useEffect(() => {
    if (!editRequest) return;
    const row = rows[rowIndex.get(editRequest.taskId) ?? -1];
    if (!row) return;
    setActiveCol('name');
    setEditing({ id: row.id, col: 'name', value: row.task.name, selectAll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editRequest]);

  // Keep a moved row in view once the rows have been recomputed.
  const keepVisible = useRef<string | null>(null);
  useEffect(() => {
    const id = keepVisible.current;
    if (!id) return;
    keepVisible.current = null;
    const idx = rowIndex.get(id);
    if (idx !== undefined) ensureVisible(idx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowIndex]);

  const openMenuFor = (row: Row, x: number, y: number) => {
    if (editing && !commitEdit()) return;
    select(row.id);
    openContextMenu({ taskId: row.id, x, y });
  };

  const ensureVisible = (idx: number) => {
    const el = bodyRef.current;
    if (!el) return;
    const top = idx * ROW_H;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + ROW_H > el.scrollTop + el.clientHeight)
      el.scrollTop = top + ROW_H - el.clientHeight;
  };

  const moveSelection = (delta: number) => {
    if (!rows.length) return;
    const cur = selectedId ? (rowIndex.get(selectedId) ?? -1) : -1;
    const next = Math.max(0, Math.min(rows.length - 1, cur + delta));
    select(rows[next].id);
    ensureVisible(next);
  };

  const canEdit = (col: ColumnDef, row: Row) => !!col.edit && !(col.leafOnly && row.isSummary);

  const startEdit = (row: Row, col: ColumnDef, initial?: string) => {
    if (!canEdit(col, row)) return;
    select(row.id);
    setActiveCol(col.key);
    setEditing({
      id: row.id,
      col: col.key,
      value: initial ?? editValue(col, row, ctx),
      selectAll: initial === undefined,
    });
  };

  const commitEdit = (): boolean => {
    if (!editing) return true;
    const col = columns.find((c) => c.key === editing.col);
    const row = rows[rowIndex.get(editing.id) ?? -1];
    if (!col || !row) {
      setEditing(null);
      return true;
    }
    const v = editing.value;
    const original = editValue(col, row, ctx);
    if (v === original) {
      setEditing(null);
      return true;
    }
    let res: CommitResult = { ok: true };
    switch (col.edit) {
      case 'text':
        res =
          col.key === 'name'
            ? renameTask(row.id, v)
            : updateTask(row.id, { responsible: v.trim() }, 'Edit responsible');
        break;
      case 'notes':
        res = updateTask(row.id, { notes: v }, 'Edit notes');
        break;
      case 'duration': {
        const d = parseDuration(v);
        res =
          d === null
            ? {
                ok: false,
                error: 'Enter a duration such as 10, 10 days, 2 weeks, or 0 for a milestone',
              }
            : setDuration(row.id, d);
        break;
      }
      case 'date':
      case 'finishDate': {
        const iso = parseDateInput(v);
        if (!iso) res = { ok: false, error: 'Enter a date such as 2027-01-04 or 04.01.2027' };
        else res = col.edit === 'date' ? setStartDate(row.id, iso) : setFinishDate(row.id, iso);
        break;
      }
      case 'percent': {
        const n = Number(v.replace('%', '').trim());
        res =
          Number.isFinite(n) && n >= 0 && n <= 100
            ? setPercentComplete(row.id, n)
            : { ok: false, error: 'Enter 0–100' };
        break;
      }
      case 'preds':
        res = setPredecessorsText(row.id, v);
        break;
    }
    if (!res.ok) {
      setEditing({ ...editing, error: res.error ?? 'Invalid value', selectAll: false });
      return false;
    }
    setEditing(null);
    return true;
  };

  const doInsert = () => {
    const id = insertTask(selectedId);
    if (!id) return;
    select(id);
    setActiveCol('name');
    setEditing({ id, col: 'name', value: 'New task', selectAll: true });
  };

  const onEditorKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (commitEdit()) {
        moveSelection(1);
        focusGrid();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setEditing(null);
      focusGrid();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const id = editing?.id;
      if (commitEdit() && id) {
        if (e.shiftKey) outdentTask(id);
        else indentTask(id);
        focusGrid();
      }
    }
    e.stopPropagation();
  };

  const onGridKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (editing) return;
    const row = selectedId ? rows[rowIndex.get(selectedId) ?? -1] : undefined;
    const colIdx = editableCols.findIndex((c) => c.key === activeCol);
    const mod = e.ctrlKey || e.metaKey;
    if (row && e.altKey && e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      keepVisible.current = row.id;
      moveTaskBy(row.id, e.key === 'ArrowUp' ? -1 : 1);
      return;
    }
    if (row && (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10'))) {
      e.preventDefault();
      const cell = rootRef.current?.querySelector(
        `[data-row-id="${row.task.rowId}"] [data-col="name"]`,
      );
      const r = cell?.getBoundingClientRect();
      openMenuFor(row, r ? r.left + 24 : 100, r ? r.bottom : 100);
      return;
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        moveSelection(1);
        return;
      case 'ArrowUp':
        e.preventDefault();
        moveSelection(-1);
        return;
      case 'ArrowLeft':
        e.preventDefault();
        if (colIdx > 0) setActiveCol(editableCols[colIdx - 1].key);
        return;
      case 'ArrowRight':
        e.preventDefault();
        if (colIdx < editableCols.length - 1) setActiveCol(editableCols[colIdx + 1].key);
        return;
      case 'Enter':
        e.preventDefault();
        moveSelection(1);
        return;
      case 'F2': {
        e.preventDefault();
        const col = columns.find((c) => c.key === activeCol);
        if (row && col) startEdit(row, col);
        return;
      }
      case 'Tab':
        e.preventDefault();
        if (row) (e.shiftKey ? outdentTask : indentTask)(row.id);
        return;
      case 'Insert':
        e.preventDefault();
        doInsert();
        return;
      case 'Delete':
        e.preventDefault();
        if (row) confirmDeleteTasks([row.id]);
        return;
    }
    if (!mod && !e.altKey && e.key.length === 1 && row) {
      const col = columns.find((c) => c.key === activeCol);
      if (col && canEdit(col, row)) {
        e.preventDefault();
        startEdit(row, col, e.key);
      }
    }
  };

  // ------------------------------------------------------------------ row drag & drop
  useEffect(() => {
    if (!rowDrag) return;
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      const el = bodyRef.current;
      if (!d || !el) return;
      if (!d.active && Math.abs(e.clientY - d.startY) < 5) return;
      const rect = el.getBoundingClientRect();
      if (e.clientY < rect.top + 24) el.scrollTop -= 12;
      else if (e.clientY > rect.bottom - 24) el.scrollTop += 12;
      const y = e.clientY - rect.top + el.scrollTop;
      const idx = Math.floor(y / ROW_H);
      const target = rows[Math.max(0, Math.min(rows.length - 1, idx))];
      const off = (y - idx * ROW_H) / ROW_H;
      const pos = off < 0.3 ? 'before' : off > 0.7 ? 'after' : 'inside';
      setRowDrag({ ...d, active: true, target: target ? { id: target.id, pos } : undefined });
    };
    const onUp = () => {
      const d = dragRef.current;
      setRowDrag(null);
      if (d?.active && d.target && d.target.id !== d.id) moveTask(d.id, d.target.id, d.target.pos);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowDrag !== null, rows]);

  const onBody = (e: UIEvent<HTMLDivElement>) => {
    if (headerRef.current) headerRef.current.scrollLeft = e.currentTarget.scrollLeft;
    onBodyScroll(e);
  };

  // ------------------------------------------------------------------ render
  const renderCell = (row: Row, col: ColumnDef) => {
    const isActive = row.id === selectedId && col.key === activeCol;
    const isEditing = editing && editing.id === row.id && editing.col === col.key;
    const cls = ['cell'];
    if (col.align === 'right') cls.push('right');
    if (col.align === 'center') cls.push('center');
    if (isActive && !isEditing) cls.push('active');
    if (!canEdit(col, row) && col.key !== 'name' && col.key !== 'id' && col.key !== 'indicators')
      cls.push('readonly');
    if (col.key === 'id') cls.push('id');
    if (col.key === 'totalFloat' && row.calc && row.calc.totalFloat < 0) cls.push('neg');
    if (col.key === 'name' && showCritical && row.calc?.critical && !row.isSummary)
      cls.push('crit-name');

    let content: React.ReactNode;
    if (col.key === 'name') {
      content = (
        <>
          <span style={{ width: row.depth * 16, flex: 'none' }} />
          {row.isSummary ? (
            <button
              className="chev"
              aria-label={row.collapsed ? 'Expand' : 'Collapse'}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                toggleCollapsed(row.id);
              }}
            >
              <Icon name={row.collapsed ? 'chevRight' : 'chevDown'} size={12} />
            </button>
          ) : (
            <span style={{ width: 18, flex: 'none' }} />
          )}
          <span className="swatch" style={{ background: row.color }} />
          <span className="txt">{row.task.name}</span>
        </>
      );
    } else if (col.key === 'indicators') {
      content = <Indicators row={row} />;
    } else {
      content = <span className="txt">{col.text(row, ctx)}</span>;
    }

    return (
      <div
        key={col.key}
        className={cls.join(' ')}
        style={{ width: col.width }}
        data-col={col.key}
        onPointerDown={(e) => {
          if (col.key === 'id' && e.button === 0) {
            setRowDrag({ id: row.id, startY: e.clientY, active: false });
          }
        }}
        onClick={() => {
          if (editing && !(editing.id === row.id && editing.col === col.key)) {
            if (!commitEdit()) return;
          }
          select(row.id);
          if (col.key !== 'indicators' && col.key !== 'id') setActiveCol(col.key);
          focusGrid();
        }}
        onDoubleClick={() => {
          if (canEdit(col, row)) startEdit(row, col);
          else setDialog({ kind: 'task', taskId: row.id });
        }}
        title={col.key === 'name' ? row.task.name : undefined}
      >
        {content}
        {isEditing && editing && (
          <>
            <input
              ref={inputRef}
              className={`cell-editor${editing.error ? ' invalid' : ''}`}
              value={editing.value}
              onChange={(e) =>
                setEditing({
                  ...editing,
                  value: e.target.value,
                  error: undefined,
                  selectAll: false,
                })
              }
              onKeyDown={onEditorKey}
              onBlur={() => {
                // Commit when focus leaves (e.g. clicking elsewhere); keep the editor if invalid.
                if (editing.error) return;
                commitEdit();
              }}
              aria-label={col.label}
              data-testid={`editor-${col.key}`}
            />
          </>
        )}
      </div>
    );
  };

  const editingRowIdx = editing ? rowIndex.get(editing.id) : undefined;
  const errorCol = editing?.error ? columns.find((c) => c.key === editing.col) : undefined;
  const errorLeft = errorCol
    ? columns.slice(0, columns.indexOf(errorCol)).reduce((s, c) => s + c.width, 0)
    : 0;

  return (
    <div
      className="pane pane-grid"
      style={{ width }}
      ref={rootRef}
      tabIndex={0}
      onKeyDown={onGridKey}
      data-testid="grid"
    >
      <div className="pane-header" ref={headerRef} style={{ height: HEADER_H }}>
        <div className="grid-header-row" style={{ width: totalW + 20 }}>
          {columns.map((c) => (
            <div
              key={c.key}
              className={`grid-hcell${c.align === 'right' ? ' right' : ''}`}
              style={{ width: c.width }}
            >
              {c.label}
            </div>
          ))}
        </div>
      </div>
      <div className="pane-body grid-body" ref={bodyRef} onScroll={onBody} data-testid="grid-body">
        <div style={{ height: rows.length * ROW_H, width: totalW, position: 'relative' }}>
          {rows.slice(first, last + 1).map((row, k) => {
            const idx = first + k;
            const cls = ['grid-row'];
            if (row.id === selectedId) cls.push('selected');
            if (row.isSummary) cls.push('summary');
            if (row.isSummary && row.depth === 0) cls.push('phase');
            if (rowDrag?.active && rowDrag.target?.id === row.id && rowDrag.id !== row.id) {
              cls.push(`drop-${rowDrag.target.pos}`);
            }
            return (
              <div
                key={row.id}
                className={cls.join(' ')}
                style={{
                  top: idx * ROW_H,
                  width: totalW,
                  background: idx % 2 ? undefined : undefined,
                }}
                data-row-id={row.task.rowId}
                data-testid="grid-row"
                onContextMenu={(e) => {
                  e.preventDefault();
                  openMenuFor(row, e.clientX, e.clientY);
                }}
              >
                {columns.map((c) => renderCell(row, c))}
              </div>
            );
          })}
          {editing?.error && editingRowIdx !== undefined && (
            <div
              className="cell-error"
              style={{ top: (editingRowIdx + 1) * ROW_H + 2, left: errorLeft + 4 }}
              role="alert"
            >
              {editing.error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Indicators({ row }: { row: Row }) {
  const t = row.task;
  const c = row.calc;
  const items: React.ReactNode[] = [];
  if (c?.constraintViolated) {
    items.push(
      <span
        key="v"
        className="warn"
        title={`${CONSTRAINT_LABEL[t.constraint.type]} ${fmtIso(t.constraint.date)} conflicts with the links`}
      >
        <Icon name="warn" size={13} />
      </span>,
    );
  } else if (!row.isSummary && t.constraint.type !== 'ASAP') {
    items.push(
      <span
        key="c"
        title={`${CONSTRAINT_LABEL[t.constraint.type]} ${fmtIso(t.constraint.date)}`}
        data-testid="constraint-icon"
      >
        <Icon name="pin" size={13} />
      </span>,
    );
  }
  if (c && c.percentComplete >= 100) {
    items.push(
      <span key="d" className="done" title="Complete">
        <Icon name="check" size={13} />
      </span>,
    );
  }
  if (t.notes.trim() && items.length < 2) {
    items.push(
      <span key="n" title={t.notes}>
        <Icon name="note" size={13} />
      </span>,
    );
  }
  return <span className="ind">{items}</span>;
}
