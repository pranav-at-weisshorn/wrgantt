const PATHS: Record<string, string> = {
  chevRight: 'M9 6l6 6-6 6',
  up: 'M12 19V5M6 11l6-6 6 6',
  down: 'M12 5v14M6 13l6 6 6-6',
  chevDown: 'M6 9l6 6 6-6',
  warn: 'M12 3l10 18H2L12 3zm0 7v5m0 3v.01',
  pin: 'M8 3h8l-1 7 3 3H6l3-3-1-7zm4 10v8',
  check: 'M5 12l5 5L20 7',
  note: 'M6 3h9l4 4v14H6V3zm9 0v4h4M9 12h7M9 16h7',
  undo: 'M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3',
  redo: 'M15 14l5-5-5-5M20 9H10a6 6 0 000 12h3',
  plus: 'M12 5v14M5 12h14',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  indent: 'M3 6h18M11 12h10M11 18h10M3 10l4 3-4 3z',
  outdent: 'M3 6h18M11 12h10M11 18h10M7 10l-4 3 4 3z',
  zoomIn: 'M11 4a7 7 0 100 14 7 7 0 000-14zM21 21l-5-5M8 11h6M11 8v6',
  zoomOut: 'M11 4a7 7 0 100 14 7 7 0 000-14zM21 21l-5-5M8 11h6',
  today: 'M4 5h16v16H4zM4 9h16M8 3v4M16 3v4M12 13v4',
  target: 'M12 3a9 9 0 100 18 9 9 0 000-18zm0 5a4 4 0 100 8 4 4 0 000-8z',
  settings:
    'M12 9a3 3 0 100 6 3 3 0 000-6zM19 12l2-1-1-3-2 .3-1.4-1.4.3-2-3-1-1 2h-2l-1-2-3 1 .3 2L6.8 7.3 4.8 7 4 10l2 1v2l-2 1 1 3 2-.3 1.4 1.4-.3 2 3 1 1-2h2l1 2 3-1-.3-2 1.4-1.4 2 .3 1-3-2-1z',
  health: 'M3 12h4l3-7 4 14 3-7h4',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  download: 'M12 4v12M7 11l5 5 5-5M4 20h16',
  upload: 'M12 20V8M7 13l5-5 5 5M4 4h16',
  print: 'M7 8V3h10v5M5 8h14a2 2 0 012 2v6h-4v4H7v-4H3v-6a2 2 0 012-2z',
  sun: 'M12 8a4 4 0 100 8 4 4 0 000-8zM12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5',
  moon: 'M20 14A8 8 0 019.5 3.5 8 8 0 1020 14z',
  columns: 'M4 4h16v16H4zM10 4v16M16 4v16',
  back: 'M15 6l-6 6 6 6',
  filter: 'M3 5h18l-7 8v6l-4 2v-8L3 5z',
  x: 'M6 6l12 12M18 6L6 18',
  flag: 'M5 21V4h11l-2 4 2 4H5',
  collapse: 'M4 6h16M4 12h10M4 18h16',
  expand: 'M4 6h16M4 12h16M4 18h16',
  link: 'M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1',
  calendar: 'M4 5h16v16H4zM4 9h16M8 3v4M16 3v4',
  progress: 'M4 12h6M14 12h6M4 6h16M4 18h9',
  critical: 'M3 17l6-6 4 4 8-8M15 7h6v6',
  baseline: 'M3 8h12M3 14h18M3 18h8',
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
