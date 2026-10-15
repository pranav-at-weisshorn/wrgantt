import { HEALTH_LABELS, type HealthKind } from '../../engine';
import { useDerived, useStore } from '../../store/store';

const ORDER: HealthKind[] = [
  'cycle',
  'negativeFloat',
  'constraintConflict',
  'noPredecessor',
  'noSuccessor',
  'summaryLink',
  'longLag',
  'actualAfterStatus',
];

export function HealthPanel() {
  const derived = useDerived()!;
  const select = useStore((s) => s.select);
  const setFilters = useStore((s) => s.setFilters);
  const issues = derived.health;
  if (!issues.length) {
    return (
      <p className="hint">
        No issues found. Every task is linked, nothing has negative float and no constraint
        conflicts with the logic.
      </p>
    );
  }
  return (
    <>
      <p className="hint">Click an item to select the task.</p>
      {ORDER.map((kind) => {
        const list = issues.filter((i) => i.kind === kind);
        if (!list.length) return null;
        return (
          <div className="issue-group" key={kind}>
            <h4>
              {HEALTH_LABELS[kind]}{' '}
              <span className={`badge${list[0].severity === 'error' ? ' error' : ''}`}>
                {list.length}
              </span>
            </h4>
            {list.map((i, k) => (
              <button
                key={`${i.taskId}-${k}`}
                className={`issue ${i.severity}`}
                onClick={() => {
                  // Clear filters so the task is visible, then select and scroll to it.
                  setFilters({
                    search: '',
                    phaseId: '',
                    responsible: '',
                    criticalOnly: false,
                    slipped: false,
                    inProgress: false,
                    milestones: false,
                  });
                  select(i.taskId, true);
                }}
              >
                {i.message}
              </button>
            ))}
          </div>
        );
      })}
    </>
  );
}
