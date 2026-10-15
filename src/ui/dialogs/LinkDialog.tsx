import { useState } from 'react';
import type { DepType, LagUnit } from '../../engine';
import { deleteLink, updateLink } from '../../store/ops';
import { useStore } from '../../store/store';
import { Modal } from './Modal';

export function LinkDialog({ depId }: { depId: string }) {
  const project = useStore((s) => s.project)!;
  const setDialog = useStore((s) => s.setDialog);
  const dep = project.dependencies.find((d) => d.id === depId);
  const [type, setType] = useState<DepType>(dep?.type ?? 'FS');
  const [lag, setLag] = useState(String(dep?.lag ?? 0));
  const [unit, setUnit] = useState<LagUnit>(dep?.lagUnit ?? 'wd');
  if (!dep) return null;
  const pred = project.tasks.find((t) => t.id === dep.predecessorId);
  const succ = project.tasks.find((t) => t.id === dep.successorId);
  const close = () => setDialog(null);
  return (
    <Modal
      title="Edit link"
      onClose={close}
      testId="link-dialog"
      footer={
        <>
          <button
            className="btn danger"
            style={{ marginRight: 'auto' }}
            onClick={() => {
              deleteLink(dep.id);
              close();
            }}
          >
            Delete link
          </button>
          <button className="btn" onClick={close}>
            Cancel
          </button>
          <button
            className="btn primary"
            onClick={() => {
              const r = updateLink(dep.id, {
                type,
                lag: Math.round(Number(lag) || 0),
                lagUnit: unit,
              });
              if (r.ok) close();
            }}
          >
            OK
          </button>
        </>
      }
    >
      <div className="modal-body">
        <div className="form">
          <label>From</label>
          <div>
            {pred?.rowId}. {pred?.name}
          </div>
          <label>To</label>
          <div>
            {succ?.rowId}. {succ?.name}
          </div>
          <label htmlFor="ld-type">Type</label>
          <select
            id="ld-type"
            className="select"
            value={type}
            onChange={(e) => setType(e.target.value as DepType)}
          >
            <option value="FS">Finish-to-Start (FS)</option>
            <option value="SS">Start-to-Start (SS)</option>
            <option value="FF">Finish-to-Finish (FF)</option>
            <option value="SF">Start-to-Finish (SF)</option>
          </select>
          <label htmlFor="ld-lag">Lag</label>
          <div className="row-inline">
            <input
              id="ld-lag"
              className="input"
              type="number"
              value={lag}
              onChange={(e) => setLag(e.target.value)}
              style={{ width: 90 }}
            />
            <select
              className="select"
              value={unit}
              onChange={(e) => setUnit(e.target.value as LagUnit)}
              aria-label="Lag unit"
            >
              <option value="wd">working days</option>
              <option value="ed">elapsed days</option>
            </select>
            <span className="hint">Negative = lead</span>
          </div>
        </div>
      </div>
    </Modal>
  );
}
