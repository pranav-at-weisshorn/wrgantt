import { useState } from 'react';
import { deleteBaseline, renameBaseline, saveBaseline, setActiveBaseline } from '../../store/ops';
import { useStore } from '../../store/store';
import { Modal } from './Modal';

export function BaselineDialog() {
  const project = useStore((s) => s.project)!;
  const setDialog = useStore((s) => s.setDialog);
  const toast = useStore((s) => s.toast);
  const [name, setName] = useState(`Baseline ${project.baselines.length + 1}`);
  const close = () => setDialog(null);
  return (
    <Modal
      title="Baselines"
      onClose={close}
      testId="baseline-dialog"
      footer={
        <button className="btn" onClick={close}>
          Close
        </button>
      }
    >
      <div className="modal-body">
        <p className="hint" style={{ marginTop: 0 }}>
          A baseline is a snapshot of every task's start, finish and duration. The active baseline
          is drawn as grey bars and used for the variance column and summary.
        </p>
        <div className="row-inline" style={{ marginBottom: 14 }}>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label="Baseline name"
            style={{ flex: 1 }}
          />
          <button
            className="btn primary"
            onClick={() => {
              const r = saveBaseline(name.trim() || 'Baseline');
              if (r.ok) {
                toast(`Saved baseline “${name}”`);
                setName(`Baseline ${project.baselines.length + 2}`);
              }
            }}
            data-testid="save-baseline"
          >
            Save current schedule as baseline
          </button>
        </div>
        <table className="simple">
          <thead>
            <tr>
              <th style={{ width: 60 }}>Active</th>
              <th>Name</th>
              <th>Saved</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {project.baselines.length === 0 && (
              <tr>
                <td colSpan={4} className="hint">
                  No baselines yet.
                </td>
              </tr>
            )}
            {project.baselines.map((b) => (
              <tr key={b.id}>
                <td>
                  <input
                    type="radio"
                    name="active-baseline"
                    checked={project.activeBaselineId === b.id}
                    onChange={() => setActiveBaseline(b.id)}
                    aria-label={`Make ${b.name} active`}
                  />
                </td>
                <td>
                  <input
                    className="input"
                    defaultValue={b.name}
                    onBlur={(e) =>
                      e.target.value !== b.name && renameBaseline(b.id, e.target.value)
                    }
                    aria-label="Baseline name"
                  />
                </td>
                <td>{b.savedAt ? new Date(b.savedAt).toLocaleString() : ''}</td>
                <td style={{ textAlign: 'right' }}>
                  <button className="btn small ghost danger" onClick={() => deleteBaseline(b.id)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {project.activeBaselineId && (
          <button
            className="btn small"
            style={{ marginTop: 10 }}
            onClick={() => setActiveBaseline(undefined)}
          >
            Compare against no baseline
          </button>
        )}
      </div>
    </Modal>
  );
}
