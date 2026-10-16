import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
  type UIEvent,
} from 'react';
import {
  activeBaseline,
  CONSTRAINT_LABEL,
  STATUS_LABEL,
  TASK_STATUSES,
  type Project,
  type TaskStatus,
} from '../../engine';
import { getWorkCalendar, workingDaysPerWeek } from '../../engine';
import { DatePicker } from './DatePicker';
import { criticalSummaries, type Derived } from '../../store/derive';
import {
  indentTask,
  indentTasks,
  insertTask,
  moveBlockedReason,
  moveTasks,
  moveTasksBy,
  outdentTask,
  outdentTasks,
  quoted,
  renameTask,
  setDuration,
  setFinishDate,
  setPercentComplete,
  setPredecessorsText,
  setStartDate,
  setStatus,
  setWorstCase,
  updateTask,
} from '../../store/ops';
import type { ColumnKey } from '../../store/prefs';
import { useStore, type CommitResult } from '../../store/store';
import { editValue, rowSignal, rowStatus, type ColumnCtx, type ColumnDef } from '../columns';
import { fmtIso, parseDateInput, parseDuration } from '../format';
import { Icon } from '../icons';
import { HEADER_H, ROW_H, type Row } from '../rows';
import { confirmDeleteTasks } from '../actions';
import { SignalChip, StatusChip } from '../StatusChip';
import './grid-selection.css';

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
  /** Tasks being moved: the selection when the dragged row is part of it. */
  ids: string[];
  startY: number;
  x: number;
  y: number;
  active: boolean;
  target?: { id: string; pos: 'before' | 'after' | 'inside'; blocked: string | null };
}

/** Cells that start a row drag (the name cell is for clicking and editing). */
const DRAG_HANDLE_COLS = new Set(['id', 'wbs', 'indicators']);

export function Grid(props: Props) {
  const { project, rows, rowIndex, columns, width, first, last, bodyRef, onBodyScroll } = props;
  const selectedId = useStore((s) => s.selectedId);
  const selectedIds = useStore((s) => s.selectedIds);
  const select = useStore((s) => s.select);
  const toggleSelect = useStore((s) => s.toggleSelect);
  const selectRange = useStore((s) => s.selectRange);
  const setSelection = useStore((s) => s.setSelection);
  const toggleCollapsed = useStore((s) => s.toggleCollapsed);
  const showCritical = useStore((s) => s.prefs.showCritical);
  const critSummaries = useMemo(
    () => (showCritical ? criticalSummaries(props.derived) : new Set<string>()),
    [props.derived, showCritical],
  );
  const setDialog = useStore((s) => s.setDialog);
  const openContextMenu = useStore((s) => s.openContextMenu);
  const [activeCol, setActiveCol] = useState<ColumnKey>('name');
  const [editing, setEditing] = useState<Editing | null>(null);
  const [rowDrag, setRowDrag] = useState<RowDrag | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement & HTMLSelectElement>(null);
  /** True while a status select is being driven by the keyboard (arrows, type-ahead). */
  const selectByKey = useRef(false);
  const dragRef = useRef<RowDrag | null>(null);
  dragRef.current = rowDrag;

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const ctx: ColumnCtx = { project, baseline: activeBaseline(project) };
  const totalW = columns.reduce((s, c) => s + c.width, 0);
  const editableCols = columns.filter((c) => c.key !== 'indicators');

  // Keep the editor input focused and (optionally) its text selected when it opens.
  useLayoutEffect(() => {
    if (editing && inputRef.current && document.activeElement !== inputRef.current) {
      inputRef.current.focus();
      if (inputRef.current instanceof HTMLInputElement) {
        if (editing.selectAll) inputRef.current.select();
        else {
          const n = inputRef.current.value.length;
          inputRef.current.setSelectionRange(n, n);
        }
      }
    }
  }, [editing]);

  // Drop the editor if its row disappears (undo, delete, filter).
  useEffect(() => {
    if (editing && !rowIndex.has(editing.id)) setEditing(null);
  }, [rowIndex, editing]);

  const focusGrid = () => rootRef.current?.focus({ preventScroll: true });

  /**
   * The editor was closed on purpose (Enter, Esc, a committed edit): the blur that follows
   * must not commit again, least of all after Esc. Cleared when the next editor opens.
   */
  const skipBlur = useRef(false);
  const closeEditor = () => {
    skipBlur.current = true;
    setEditing(null);
  };
  useEffect(() => {
    if (editing) skipBlur.current = false;
  }, [editing]);
  const onEditorBlur = () => {
    if (skipBlur.current) {
      skipBlur.current = false;
      return;
    }
    // Commit when focus leaves (e.g. clicking elsewhere); keep the editor if invalid.
    if (editing?.error) return;
    commitEdit();
  };

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
    // Right-clicking a selected row keeps the selection (the menu then acts on all of it).
    if (!selectedSet.has(row.id)) select(row.id);
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

  /** Move the focus one row and extend the selection from the anchor to it (Shift+arrows). */
  const extendSelection = (delta: number) => {
    if (!rows.length) return;
    const cur = selectedId ? (rowIndex.get(selectedId) ?? -1) : -1;
    const next = Math.max(0, Math.min(rows.length - 1, cur + delta));
    selectRange(
      rows[next].id,
      rows.map((r) => r.id),
    );
    ensureVisible(next);
  };

  const canEdit = (col: ColumnDef, row: Row) => !!col.edit && !(col.leafOnly && row.isSummary);

  const startEdit = (row: Row, col: ColumnDef, initial?: string) => {
    if (!canEdit(col, row)) return;
    // Editing one cell leaves a multi-selection as it is.
    if (row.id !== selectedId) select(row.id);
    setActiveCol(col.key);
    let value = initial ?? editValue(col, row, ctx);
    if (col.edit === 'status' && initial !== undefined) {
      // Typing a letter picks the first status starting with it.
      const typed = initial.toLowerCase();
      value = TASK_STATUSES.find((s) => STATUS_LABEL[s].toLowerCase().startsWith(typed)) ?? value;
    }
    setEditing({
      id: row.id,
      col: col.key,
      value,
      selectAll: initial === undefined || col.edit === 'status',
    });
  };

  const commitEdit = (override?: string): boolean => {
    if (!editing) return true;
    const col = columns.find((c) => c.key === editing.col);
    const row = rows[rowIndex.get(editing.id) ?? -1];
    if (!col || !row) {
      closeEditor();
      return true;
    }
    const v = override ?? editing.value;
    const original = editValue(col, row, ctx);
    if (v === original) {
      closeEditor();
      return true;
    }
    let res: CommitResult = { ok: true };
    switch (col.edit) {
      case 'text':
        res =
          col.key === 'name'
            ? renameTask(row.id, v)
            : updateTask(
                row.id,
                { responsible: v.trim() },
                `Responsible of ${quoted(row.task.name)}: ${v.trim() || 'none'}`,
              );
        break;
      case 'notes':
        res = updateTask(row.id, { notes: v }, `Notes of ${quoted(row.task.name)} edited`);
        break;
      case 'status':
        res = setStatus(row.id, v as TaskStatus);
        break;
      case 'worstCase': {
        const d = v.trim() === '' ? 0 : parseDuration(v, workingDaysPerWeek(project));
        res =
          d === null
            ? { ok: false, error: 'Enter extra working days, such as 5, 2 weeks, or 0 for none' }
            : setWorstCase(row.id, d);
        break;
      }
      case 'duration': {
        const d = parseDuration(v, workingDaysPerWeek(project));
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
        if (iso && iso === parseDateInput(original)) {
          // Same date as shown: nothing to change (no constraint is added).
          closeEditor();
          return true;
        }
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
    closeEditor();
    return true;
  };

  const doInsert = () => {
    const id = insertTask(selectedId);
    if (!id) return;
    select(id);
    setActiveCol('name');
    setEditing({ id, col: 'name', value: 'New task', selectAll: true });
  };

  const onEditorKey = (e: KeyboardEvent<HTMLInputElement | HTMLSelectElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (commitEdit()) {
        moveSelection(1);
        focusGrid();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeEditor();
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
      moveTasksBy(selectedIds.length > 1 ? selectedIds : [row.id], e.key === 'ArrowUp' ? -1 : 1);
      return;
    }
    if (mod && !e.altKey && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      setSelection(
        rows.map((r) => r.id),
        selectedId ?? undefined,
      );
      return;
    }
    if (e.shiftKey && !mod && !e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      extendSelection(e.key === 'ArrowUp' ? -1 : 1);
      return;
    }
    if (e.key === 'Escape' && selectedIds.length > 1) {
      e.preventDefault();
      select(selectedId);
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
        if (row)
          (e.shiftKey ? outdentTasks : indentTasks)(
            selectedIds.length > 1 ? selectedIds : [row.id],
          );
        return;
      case 'Insert':
        e.preventDefault();
        doInsert();
        return;
      case 'Delete':
        e.preventDefault();
        if (row) confirmDeleteTasks(selectedIds.length > 1 ? selectedIds : [row.id]);
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
      if (!d.active && !selectedSet.has(d.id)) select(d.id);
      const rect = el.getBoundingClientRect();
      if (e.clientY < rect.top + 24) el.scrollTop -= 12;
      else if (e.clientY > rect.bottom - 24) el.scrollTop += 12;
      const y = e.clientY - rect.top + el.scrollTop;
      const idx = Math.floor(y / ROW_H);
      const target = rows[Math.max(0, Math.min(rows.length - 1, idx))];
      const off = (y - idx * ROW_H) / ROW_H;
      const pos = off < 0.3 ? 'before' : off > 0.7 ? 'after' : 'inside';
      const blocked = target && project ? moveBlockedReason(project, d.ids, target.id) : null;
      setRowDrag({
        ...d,
        active: true,
        x: e.clientX,
        y: e.clientY,
        target: target ? { id: target.id, pos, blocked } : undefined,
      });
    };
    const onUp = () => {
      const d = dragRef.current;
      setRowDrag(null);
      if (!d?.active || !d.target || d.target.blocked) return;
      if (d.ids.length === 1 && d.ids[0] === d.target.id) return;
      moveTasks(d.ids, d.target.id, d.target.pos);
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
    if (
      col.key === 'name' &&
      showCritical &&
      (row.isSummary ? critSummaries.has(row.id) : row.calc?.critical)
    )
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
    } else if (col.key === 'status') {
      content = <StatusChip status={rowStatus(row, project)} />;
    } else if (col.key === 'signal') {
      content = <SignalChip signal={rowSignal(row, ctx)} />;
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
          if (
            DRAG_HANDLE_COLS.has(col.key) &&
            e.button === 0 &&
            !e.shiftKey &&
            !e.ctrlKey &&
            !e.metaKey
          ) {
            const ids = selectedSet.has(row.id) && selectedIds.length > 1 ? selectedIds : [row.id];
            setRowDrag({
              id: row.id,
              ids,
              startY: e.clientY,
              x: e.clientX,
              y: e.clientY,
              active: false,
            });
          }
        }}
        onClick={(e) => {
          if (editing && !(editing.id === row.id && editing.col === col.key)) {
            if (!commitEdit()) return;
          }
          if (e.ctrlKey || e.metaKey) toggleSelect(row.id);
          else if (e.shiftKey) {
            selectRange(
              row.id,
              rows.map((r) => r.id),
            );
          } else select(row.id);
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
        {isEditing && editing && col.edit === 'status' && (
          <select
            ref={inputRef}
            className="cell-editor"
            value={editing.value}
            onChange={(e) => {
              const v = e.target.value;
              if (selectByKey.current) {
                setEditing({ ...editing, value: v, error: undefined, selectAll: false });
              } else if (commitEdit(v)) {
                // Picked with the mouse: apply straight away.
                focusGrid();
              }
            }}
            onPointerDown={(e) => {
              e.stopPropagation();
              selectByKey.current = false;
            }}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              selectByKey.current = e.key.startsWith('Arrow') || e.key.length === 1;
              onEditorKey(e);
            }}
            onBlur={onEditorBlur}
            aria-label={col.label}
            data-testid={`editor-${col.key}`}
          >
            {TASK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        )}
        {isEditing && editing && col.edit !== 'status' && (
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
              onBlur={onEditorBlur}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
              onContextMenu={(e) => e.stopPropagation()}
              aria-label={col.label}
              data-testid={`editor-${col.key}`}
            />
            {(col.edit === 'date' || col.edit === 'finishDate') && (
              <DatePicker
                anchorRef={inputRef}
                value={parseDateInput(editing.value)}
                isWorking={(d) => {
                  const cal =
                    project.calendars.find((c) => c.id === row.task.calendarId) ??
                    project.calendars[0];
                  return cal ? getWorkCalendar(cal).isWorking(d) : true;
                }}
                onPick={(iso) => {
                  if (commitEdit(iso)) focusGrid();
                }}
              />
            )}
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
      {rowDrag?.active && <DragLabel drag={rowDrag} project={project} />}
      <div className="pane-body grid-body" ref={bodyRef} onScroll={onBody} data-testid="grid-body">
        <div style={{ height: rows.length * ROW_H, width: totalW, position: 'relative' }}>
          {rows.slice(first, last + 1).map((row, k) => {
            const idx = first + k;
            const cls = ['grid-row'];
            if (selectedSet.has(row.id)) cls.push('selected');
            if (row.isSummary) cls.push('summary');
            if (row.isSummary && row.depth === 0) cls.push('phase');
            if (rowDrag?.active && rowDrag.target?.id === row.id && !rowDrag.ids.includes(row.id)) {
              cls.push(rowDrag.target.blocked ? 'drop-blocked' : `drop-${rowDrag.target.pos}`);
            }
            if (rowDrag?.active && rowDrag.ids.includes(row.id)) cls.push('dragging');
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

function DragLabel({ drag, project }: { drag: RowDrag; project: Project }) {
  const name = (id: string) => project.tasks.find((t) => t.id === id)?.name ?? 'task';
  const what = drag.ids.length === 1 ? `“${name(drag.ids[0])}”` : `${drag.ids.length} tasks`;
  let where = 'Drop on a row';
  if (drag.target?.blocked) where = drag.target.blocked;
  else if (drag.target && drag.ids.includes(drag.target.id)) where = 'Drop on another row';
  else if (drag.target) {
    const t = `“${name(drag.target.id)}”`;
    where =
      drag.target.pos === 'inside'
        ? `as subtasks of ${t}`
        : drag.target.pos === 'before'
          ? `above ${t}`
          : `below ${t}`;
  }
  return (
    <div
      className={`row-drag-label${drag.target?.blocked ? ' blocked' : ''}`}
      style={{ left: drag.x + 14, top: drag.y + 12 }}
      data-testid="row-drag-label"
    >
      Moving {what} · {where}
    </div>
  );
}
