import { useStore } from '../store/store';
import { Icon } from './icons';
import { Menu } from './Menu';

/** Export / print menu. Import/export items are added in the import/export phase. */
export function FileMenu() {
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
