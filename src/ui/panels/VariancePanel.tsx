import { varianceSummary } from '../../engine';
import { useDerived, useStore } from '../../store/store';
import { fmtDay, fmtSigned } from '../format';

export function VariancePanel() {
  const project = useStore((s) => s.project)!;
  const derived = useDerived()!;
  const select = useStore((s) => s.select);
  const setDialog = useStore((s) => s.setDialog);
  const v = varianceSummary(project, derived.schedule, derived.outline);
  if (!v) {
    return (
      <>
        <p className="hint">
          No active baseline. Save a baseline to compare the current schedule against it.
        </p>
        <button className="btn" onClick={() => setDialog({ kind: 'baselines' })}>
          Save a baseline…
        </button>
      </>
    );
  }
  const late = (v.finishVariance ?? 0) > 0;
  return (
    <>
      <p className="hint">Compared with baseline “{v.baselineName}”.</p>
      <div className="kpi">
        <div>
          <small>Current finish</small>
          <strong>{fmtDay(v.projectFinish)}</strong>
        </div>
        <div>
          <small>Baseline finish</small>
          <strong>{v.baselineFinish === null ? '—' : fmtDay(v.baselineFinish)}</strong>
        </div>
        <div>
          <small>Finish variance</small>
          <strong
            style={{ color: late ? 'var(--danger)' : 'var(--ok)' }}
            data-testid="finish-variance"
          >
            {v.finishVariance === null ? '—' : fmtSigned(v.finishVariance)}
          </strong>
        </div>
        <div>
          <small>Slipped tasks</small>
          <strong>{v.slippedCount}</strong>
        </div>
      </div>
      <h4 style={{ margin: '8px 0 4px', fontSize: 12, color: 'var(--fg-muted)' }}>
        Top slipping critical tasks
      </h4>
      {v.topSlippingCritical.length === 0 && <p className="hint">No critical task has slipped.</p>}
      {v.topSlippingCritical.map(({ id, variance }) => {
        const t = derived.outline.byId.get(id)!;
        return (
          <button key={id} className="issue error" onClick={() => select(id, true)}>
            {fmtSigned(variance)} · {t.rowId} {t.name}
          </button>
        );
      })}
    </>
  );
}
