import { useStore } from '../../store/store';
import { BaselineDialog } from './BaselineDialog';
import { BulkEditDialog } from './BulkEditDialog';
import { LinkDialog } from './LinkDialog';
import { Modal } from './Modal';
import { ExportDialog } from './ExportDialog';
import { ProgressDialog } from './ProgressDialog';
import { SettingsDialog } from './SettingsDialog';
import { TaskDialog } from './TaskDialog';

export function DialogHost() {
  const dialog = useStore((s) => s.dialog);
  const setDialog = useStore((s) => s.setDialog);
  if (!dialog) return null;
  switch (dialog.kind) {
    case 'task':
      return <TaskDialog key={dialog.taskId} taskId={dialog.taskId} tab={dialog.tab} />;
    case 'link':
      return <LinkDialog key={dialog.depId} depId={dialog.depId} />;
    case 'settings':
      return <SettingsDialog />;
    case 'baselines':
      return <BaselineDialog />;
    case 'progress':
      return <ProgressDialog />;
    case 'bulk':
      return <BulkEditDialog taskIds={dialog.taskIds} />;
    case 'print':
      return <ExportDialog />;
    case 'confirm':
      return (
        <Modal
          title={dialog.title}
          onClose={() => setDialog(null)}
          testId="confirm-dialog"
          footer={
            <>
              <button className="btn" onClick={() => setDialog(null)}>
                Cancel
              </button>
              <button
                className="btn primary"
                onClick={() => {
                  setDialog(null);
                  dialog.onConfirm();
                }}
              >
                {dialog.confirmLabel ?? 'OK'}
              </button>
            </>
          }
        >
          <div className="modal-body">{dialog.message}</div>
        </Modal>
      );
    default:
      return null;
  }
}
