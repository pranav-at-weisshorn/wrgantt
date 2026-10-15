import { useState } from 'react';
import { useStore } from '../../store/store';
import { printNow } from '../print/PrintView';
import { Modal } from './Modal';

export function PrintDialog() {
  const setDialog = useStore((s) => s.setDialog);
  const [collapsed, setCollapsed] = useState(false);
  const close = () => setDialog(null);
  return (
    <Modal
      title="Print / save as PDF"
      onClose={close}
      testId="print-dialog"
      footer={
        <>
          <button className="btn" onClick={close}>
            Cancel
          </button>
          <button
            className="btn primary"
            onClick={() => {
              close();
              printNow(collapsed);
            }}
          >
            Print…
          </button>
        </>
      }
    >
      <div className="modal-body">
        <p className="hint" style={{ marginTop: 0 }}>
          Prints landscape, scaled to the page width, with the column headers repeated on every
          page. Choose “Save as PDF” in the print dialog for a PDF.
        </p>
        <label className="row-inline">
          <input
            type="checkbox"
            checked={collapsed}
            onChange={(e) => setCollapsed(e.target.checked)}
          />
          Collapse to phases (executive summary)
        </label>
      </div>
    </Modal>
  );
}
