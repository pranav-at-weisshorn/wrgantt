import { flushAutosave, saveProject } from '../io/persist';
import { useStore } from '../store/store';
import { Icon } from './icons';
import { exportExcel, exportJson, exportMsProject, importProjectFile } from './importExport';
import { Menu } from './Menu';

export function FileMenu() {
  const project = useStore((s) => s.project)!;
  const setDialog = useStore((s) => s.setDialog);
  return (
    <Menu
      label={
        <>
          <Icon name="download" size={14} /> File
        </>
      }
      align="right"
      className="small"
      testId="file-menu"
    >
      {(close) => (
        <>
          <div className="menu-title">Export</div>
          <button onClick={() => (close(), exportJson(project))}>Project file (.gantt.json)</button>
          <button onClick={() => (close(), exportExcel(project))}>
            Excel (.xlsx): tasks + weekly Gantt
          </button>
          <button onClick={() => (close(), exportMsProject(project))}>Microsoft Project XML</button>
          <hr />
          <button
            onClick={async () => {
              close();
              const p = await importProjectFile();
              if (!p) return;
              await flushAutosave();
              await saveProject(p);
              window.location.hash = `#/p/${p.id}`;
            }}
          >
            <Icon name="upload" size={14} /> Import as new project…
          </button>
          <hr />
          <button
            onClick={() => {
              close();
              setDialog({ kind: 'print' });
            }}
          >
            <Icon name="print" size={14} /> Print / PDF…
          </button>
        </>
      )}
    </Menu>
  );
}
