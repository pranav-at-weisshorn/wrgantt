import { useMemo } from 'react';
import { todayDay } from '../engine';
import { indentTask, insertTask, outdentTask } from '../store/ops';
import { ZOOMS, type ColumnKey } from '../store/prefs';
import { EMPTY_FILTERS, useDerived, useStore } from '../store/store';
import { confirmDeleteTasks } from './actions';
import { COLUMNS } from './columns';
import { fmtIso } from './format';
import { Icon } from './icons';
import { Menu } from './Menu';
import { filtersActive, responsibleParties } from './rows';
import type { Scale } from './timeline/scale';

const ZOOM_LABEL = { day: 'Day', week: 'Week', month: 'Month', quarter: 'Quarter' } as const;

export function Toolbar({ scale }: { scale: Scale }) {
  const project = useStore((s) => s.project)!;
  const derived = useDerived()!;
  const s = useStore();
  const { prefs, filters, selectedId } = s;
  const parties = useMemo(() => responsibleParties(project), [project]);
  const phases = derived.outline.children.get(null) ?? [];
  const errors = derived.health.filter((h) => h.severity === 'error').length;

  return (
    <div className="toolbar" role="toolbar">
      <button
        className="btn icon"
        title="Undo (Ctrl+Z)"
        disabled={!s.past.length}
        onClick={s.undo}
        data-testid="undo"
      >
        <Icon name="undo" />
      </button>
      <button
        className="btn icon"
        title="Redo (Ctrl+Shift+Z)"
        disabled={!s.future.length}
        onClick={s.redo}
        data-testid="redo"
      >
        <Icon name="redo" />
      </button>
      <span className="sep" />
      <button
        className="btn icon"
        title="Insert task (Insert)"
        onClick={() => {
          const id = insertTask(selectedId);
          if (id) s.select(id, true);
        }}
      >
        <Icon name="plus" />
      </button>
      <button
        className="btn icon"
        title="Delete task (Delete)"
        disabled={!selectedId}
        onClick={() => selectedId && confirmDeleteTasks([selectedId])}
      >
        <Icon name="trash" />
      </button>
      <button
        className="btn icon"
        title="Outdent (Shift+Tab)"
        disabled={!selectedId}
        onClick={() => selectedId && outdentTask(selectedId)}
      >
        <Icon name="outdent" />
      </button>
      <button
        className="btn icon"
        title="Indent (Tab)"
        disabled={!selectedId}
        onClick={() => selectedId && indentTask(selectedId)}
      >
        <Icon name="indent" />
      </button>
      <span className="sep" />
      <input
        className="input search"
        placeholder="Search tasks…"
        value={filters.search}
        onChange={(e) => s.setFilters({ search: e.target.value })}
        aria-label="Search by name"
      />
      <Menu
        label={
          <>
            <Icon name="filter" size={14} /> Filter
            {filtersActive({ ...filters, search: '' }) ? ' •' : ''}
          </>
        }
        className={filtersActive({ ...filters, search: '' }) ? 'active' : ''}
      >
        {() => (
          <div style={{ padding: 4, display: 'grid', gap: 6, minWidth: 240 }}>
            <div className="menu-title">Phase</div>
            <select
              className="select"
              value={filters.phaseId}
              onChange={(e) => s.setFilters({ phaseId: e.target.value })}
            >
              <option value="">All phases</option>
              {phases.map((id) => (
                <option key={id} value={id}>
                  {derived.outline.byId.get(id)?.name}
                </option>
              ))}
            </select>
            <div className="menu-title">Responsible</div>
            <select
              className="select"
              value={filters.responsible}
              onChange={(e) => s.setFilters({ responsible: e.target.value })}
            >
              <option value="">Anyone</option>
              {parties.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
            <hr />
            {(
              [
                ['criticalOnly', 'Critical only'],
                ['slipped', 'Slipped vs. baseline'],
                ['inProgress', 'In progress'],
                ['milestones', 'Milestones only'],
              ] as const
            ).map(([k, label]) => (
              <label key={k}>
                <input
                  type="checkbox"
                  checked={filters[k]}
                  onChange={(e) => s.setFilters({ [k]: e.target.checked })}
                />
                {label}
              </label>
            ))}
            <hr />
            <button onClick={() => s.setFilters(EMPTY_FILTERS)}>Clear all filters</button>
          </div>
        )}
      </Menu>
      <span className="sep" />
      <div className="seg" role="group" aria-label="Zoom">
        {ZOOMS.map((z) => (
          <button
            key={z}
            className={`btn small${prefs.zoom === z ? ' active' : ''}`}
            onClick={() => s.setPrefs({ zoom: z })}
          >
            {ZOOM_LABEL[z]}
          </button>
        ))}
      </div>
      <button
        className="btn small"
        title="Scroll to today"
        onClick={() => s.requestScroll({ day: todayDay() })}
      >
        <Icon name="today" size={14} /> Today
      </button>
      <button
        className="btn small"
        title="Scroll to the selected task"
        disabled={!selectedId}
        onClick={() => selectedId && s.requestScroll({ taskId: selectedId })}
      >
        <Icon name="target" size={14} /> To task
      </button>
      <span className="sep" />
      <Menu
        label={<>Critical{prefs.showCritical ? ' ✓' : ''}</>}
        className={prefs.showCritical ? 'active small' : 'small'}
      >
        {(close) => (
          <>
            <label>
              <input
                type="checkbox"
                checked={prefs.showCritical}
                onChange={(e) => s.setPrefs({ showCritical: e.target.checked })}
              />
              Highlight critical path
            </label>
            <hr />
            <button
              onClick={() => (s.setPrefs({ criticalStyle: 'fill', showCritical: true }), close())}
            >
              {prefs.criticalStyle === 'fill' ? '●' : '○'} Red bars
            </button>
            <button
              onClick={() => (
                s.setPrefs({ criticalStyle: 'outline', showCritical: true }),
                close()
              )}
            >
              {prefs.criticalStyle === 'outline' ? '●' : '○'} Red outline (keep phase colours)
            </button>
          </>
        )}
      </Menu>
      <button
        className={`btn small${prefs.showBaseline ? ' active' : ''}`}
        title={project.activeBaselineId ? 'Show baseline bars' : 'No baseline saved yet'}
        onClick={() => s.setPrefs({ showBaseline: !prefs.showBaseline })}
      >
        <Icon name="baseline" size={14} /> Baseline
      </button>
      <button
        className="btn small"
        onClick={s.collapseToPhases}
        title="Collapse to phases (executive view)"
      >
        <Icon name="collapse" size={14} /> Phases
      </button>
      <button className="btn small" onClick={s.expandAll} title="Expand all">
        <Icon name="expand" size={14} /> All
      </button>
      <Menu label={<Icon name="columns" size={14} />} title="Columns" className="small">
        {() => (
          <>
            <div className="menu-title">Show columns</div>
            {COLUMNS.filter((c) => c.hideable).map((c) => (
              <label key={c.key}>
                <input
                  type="checkbox"
                  checked={prefs.columns[c.key]}
                  onChange={(e) =>
                    s.setPrefs({
                      columns: { ...prefs.columns, [c.key as ColumnKey]: e.target.checked },
                    })
                  }
                />
                {c.label || 'Indicators'}
              </label>
            ))}
            <hr />
            <label>
              <input
                type="checkbox"
                checked={prefs.showLabels}
                onChange={(e) => s.setPrefs({ showLabels: e.target.checked })}
              />
              Task names next to bars
            </label>
          </>
        )}
      </Menu>
      <span className="sep" />
      <button
        className="btn small"
        title="Status date — click to change"
        onClick={() => s.setDialog({ kind: 'progress' })}
      >
        <Icon name="progress" size={14} /> Status {fmtIso(project.statusDate)}
      </button>
      <button className="btn small" onClick={() => s.setDialog({ kind: 'baselines' })}>
        <Icon name="flag" size={14} /> Baselines
      </button>
      <button
        className={`btn small${s.panel === 'variance' ? ' active' : ''}`}
        onClick={() => s.setPanel(s.panel === 'variance' ? null : 'variance')}
      >
        <Icon name="chart" size={14} /> Variance
      </button>
      <button
        className={`btn small${s.panel === 'health' ? ' active' : ''}`}
        onClick={() => s.setPanel(s.panel === 'health' ? null : 'health')}
        data-testid="health-button"
      >
        <Icon name="health" size={14} /> Health
        {derived.health.length > 0 && (
          <span className={`badge${errors ? ' error' : ''}`}>{derived.health.length}</span>
        )}
      </button>
      <span className="spacer" />
      <span className="hint" title="Scale">
        {scale.zoom}
      </span>
    </div>
  );
}
