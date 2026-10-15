import { useState } from 'react';
import {
  chooseFolder,
  disconnectFolder,
  flushFolderSaves,
  reconnectFolder,
  useDisk,
  type DiskState,
} from '../io/diskStore';
import { downloadBlob, safeFileName } from '../io/files';
import { projectToJson } from '../io/json';
import { listProjects, loadProject, syncFromFolder } from '../io/persist';
import { derive } from '../store/derive';
import { useStore } from '../store/store';
import { Modal } from './dialogs/Modal';
import { exportJson } from './importExport';
import { Menu } from './Menu';
import './storage.css';

const toast = (text: string, kind: 'info' | 'error' = 'info') =>
  useStore.getState().toast(text, kind);
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ------------------------------------------------------------------ actions

/** After the folder changed: import what is only in the folder, write what the folder lacks. */
async function syncAndReport(): Promise<boolean> {
  try {
    const { imported } = await syncFromFolder();
    if (imported.length) {
      toast(
        `Imported ${imported.length} project${imported.length === 1 ? '' : 's'} from the folder: ${imported.slice(0, 3).join(', ')}${imported.length > 3 ? '…' : ''}`,
      );
    }
    return imported.length > 0;
  } catch (e) {
    toast(`Could not read the folder: ${message(e)}`, 'error');
    return false;
  }
}

/** Show the folder picker; `onChanged` runs when the list of projects may have changed. */
export async function connectFolder(onChanged?: () => void): Promise<void> {
  try {
    if (!(await chooseFolder())) return;
    toast(`Saving projects to the folder “${useDisk.getState().folderName}”`);
    await syncAndReport();
    onChanged?.();
  } catch (e) {
    toast(`Could not use that folder: ${message(e)}`, 'error');
  }
}

export async function reconnect(onChanged?: () => void): Promise<void> {
  if (!(await reconnectFolder())) return;
  await syncAndReport();
  await flushFolderSaves();
  onChanged?.();
}

export async function stopSavingToFolder(onChanged?: () => void): Promise<void> {
  try {
    await disconnectFolder();
    toast('Projects are no longer saved to a folder. Files already in the folder stay there.');
    onChanged?.();
  } catch (e) {
    toast(`Could not stop: ${message(e)}`, 'error');
  }
}

/** Download the open project, or every project when none is open, as .gantt.json files. */
export async function downloadBackup(): Promise<void> {
  const open = useStore.getState().project;
  if (open) {
    exportJson(open);
    return;
  }
  const metas = await listProjects();
  for (const m of metas) {
    const p = await loadProject(m.id);
    if (!p) continue;
    downloadBlob(
      projectToJson(p, derive(p).schedule),
      `${safeFileName(p.name)}.gantt.json`,
      'application/json',
    );
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!metas.length) toast('There are no projects to download');
}

// ------------------------------------------------------------------ status text

type Tone = 'ok' | 'warn' | 'err' | 'idle';

export function describeStorage(d: DiskState): { text: string; tone: Tone; title: string } {
  if (!d.connected) {
    return {
      text: 'Not saved to a folder',
      tone: 'idle',
      title: d.supported
        ? 'Projects are saved in this browser only. Click to also save them to a folder.'
        : 'Saving to a folder needs Microsoft Edge or Chrome.',
    };
  }
  const folder = `Folder: ${d.folderName}`;
  if (d.permission !== 'granted') {
    return {
      text: 'Reconnect folder',
      tone: 'warn',
      title: `${folder}. The browser needs your permission again to write to it.`,
    };
  }
  if (d.error) return { text: 'Folder save failed', tone: 'err', title: `${folder}. ${d.error}` };
  if (d.saving) return { text: 'Saving…', tone: 'idle', title: folder };
  if (d.lastSavedAt) {
    const t = new Date(d.lastSavedAt);
    const hhmm = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
    return { text: `Saved to folder · ${hhmm}`, tone: 'ok', title: folder };
  }
  return { text: 'Folder connected', tone: 'ok', title: folder };
}

// ------------------------------------------------------------------ components

function UnsupportedDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal
      title="Saving to a folder"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Close
          </button>
          <button
            className="btn primary"
            onClick={() => {
              void downloadBackup();
              onClose();
            }}
          >
            Download a backup
          </button>
        </>
      }
    >
      <div className="modal-body">
        <p>
          Saving projects to a folder needs Microsoft Edge or Chrome. This browser keeps projects in
          its own storage only, so clearing the browser’s data would remove them.
        </p>
        <p className="hint">
          Download a backup now to keep a copy as a .gantt.json file. You can import it again from
          the project list.
        </p>
      </div>
    </Modal>
  );
}

/** The storage indicator in the top bar. */
export function StorageStatus() {
  const d = useDisk();
  const [info, setInfo] = useState(false);
  if (!d.ready) return null;
  const s = describeStorage(d);
  const label = (
    <>
      <span className={`dot ${s.tone}`} aria-hidden="true" />
      <span>{s.text}</span>
    </>
  );

  if (d.connected && d.permission === 'granted') {
    return (
      <Menu
        label={label}
        title={s.title}
        align="right"
        className="small storage-pill"
        testId="storage-status"
      >
        {(close) => (
          <>
            <div className="menu-title">Folder: {d.folderName}</div>
            {d.error && <div className="storage-menu-error">{d.error}</div>}
            {d.error && (
              <button
                onClick={() => {
                  close();
                  void flushFolderSaves();
                }}
              >
                Try again
              </button>
            )}
            <button
              onClick={() => {
                close();
                void connectFolder();
              }}
            >
              Change folder…
            </button>
            <button
              onClick={() => {
                close();
                void stopSavingToFolder();
              }}
            >
              Stop saving to folder
            </button>
          </>
        )}
      </Menu>
    );
  }

  const onClick = () => {
    if (!d.supported) setInfo(true);
    else if (d.connected) void reconnect();
    else void connectFolder();
  };
  return (
    <>
      <button
        className="btn small storage-pill"
        title={s.title}
        onClick={onClick}
        data-testid="storage-status"
      >
        {label}
      </button>
      {info && <UnsupportedDialog onClose={() => setInfo(false)} />}
    </>
  );
}

/** The folder section of the project list. */
export function StorageBlock({ onChanged }: { onChanged: () => void }) {
  const d = useDisk();
  if (!d.ready) return null;
  const s = describeStorage(d);

  if (!d.supported) {
    return (
      <div className="storage-block" data-testid="storage-block">
        <p className="hint">
          Saving to a folder needs Microsoft Edge or Chrome. In this browser, projects are kept in
          the browser’s own storage only.
        </p>
        <button className="btn small" onClick={() => void downloadBackup()}>
          Download a backup
        </button>
      </div>
    );
  }
  if (!d.connected) {
    return (
      <div className="storage-block" data-testid="storage-block">
        <button
          className="btn"
          onClick={() => void connectFolder(onChanged)}
          data-testid="connect-folder"
        >
          Save projects to a folder…
        </button>
        <span className="hint">
          Keeps a copy of every project, and its versions, as files in a folder you choose, for
          example one that OneDrive synchronises.
        </span>
      </div>
    );
  }
  return (
    <div className="storage-block" data-testid="storage-block">
      <div className="row-inline">
        <span className="storage-state" title={s.title}>
          <span className={`dot ${s.tone}`} aria-hidden="true" />
          Folder “{d.folderName}” · {s.text}
        </span>
        {d.permission !== 'granted' && (
          <button className="btn small primary" onClick={() => void reconnect(onChanged)}>
            Reconnect folder
          </button>
        )}
        <button className="btn small" onClick={() => void connectFolder(onChanged)}>
          Change folder…
        </button>
        <button className="btn small ghost" onClick={() => void stopSavingToFolder(onChanged)}>
          Stop saving to folder
        </button>
      </div>
      {d.error && <p className="err">{d.error}</p>}
      {d.unreadable.length > 0 && (
        <p className="hint">
          {d.unreadable.length === 1 ? 'One file' : `${d.unreadable.length} files`} in the folder
          could not be read as a project: {d.unreadable.slice(0, 3).join(', ')}
          {d.unreadable.length > 3 ? '…' : ''}
        </p>
      )}
    </div>
  );
}
