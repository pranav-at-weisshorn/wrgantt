# Condo Gantt

A browser-based Gantt scheduler for for-sale condominium developments, with a real critical-path
engine (FS/SS/FF/SF links with working-day or elapsed lags, constraints, float, progress against a
status date), baselines and variance, a schedule health check, and a preloaded template covering
the whole lifecycle from site acquisition to handover to the owners' association.

Everything runs in the browser. Projects are stored in the browser's IndexedDB; nothing is sent
to a server. Export to `.gantt.json` to back up or share a project.

## Running it

Requires Node.js 20+.

```bash
npm install
npm run dev          # http://localhost:5173
```

Other scripts:

| Command                           | What it does                                                   |
| --------------------------------- | -------------------------------------------------------------- |
| `npm test`                        | Engine, store and import/export tests (Vitest)                 |
| `npm run test:e2e`                | Playwright smoke test (starts its own dev server on port 5199) |
| `npm run build`                   | Type-check and build a static site into `dist/`                |
| `npm run preview`                 | Serve the production build                                     |
| `npm run lint` / `npm run format` | ESLint / Prettier                                              |

The Playwright test uses the installed Microsoft Edge (`channel: 'msedge'`), so no browser
download is needed on Windows. Elsewhere, run `npx playwright install chromium` and set
`PW_CHANNEL=chromium`.

## Using it

- **Projects**: the start page lists saved projects. _New project from template_ creates the
  condo development schedule (121 tasks in 11 phases) from a start date you choose.
- **Grid**: double-click a cell, press F2, or just start typing to edit. Enter commits and moves
  down, Esc cancels. Tab / Shift+Tab indent / outdent, Insert adds a row above, Delete deletes
  (asks first if the task has subtasks or links), Ctrl+Z / Ctrl+Shift+Z undo / redo. Drag the ID
  cell to move a row (drop on the top or bottom edge of a row to place it before/after, on the
  middle to make it a subtask).
- **Dates**: typing a Start date sets a _Start No Earlier Than_ constraint, typing a Finish date a
  _Finish No Earlier Than_ constraint (shown by the pin icon). Other constraints are set in the
  task dialog (double-click a bar or a read-only cell).
- **Timeline**: drag a bar to move it (sets SNET), drag its right edge to change the duration,
  drag from the round connector at its end onto another bar to add a finish-to-start link. Click
  a link to change its type or lag, or delete it. Ctrl+scroll zooms (Day / Week / Month / Quarter).
- **Progress**: _Status_ opens the update-progress dialog: set the status date and record %
  complete and actual dates (or mark tasks _on schedule_ / _complete_). _Baselines_ saves named
  snapshots; the active one is drawn as grey bars and drives the variance column and the
  _Variance_ panel. _Health_ lists open ends, negative float, constraint conflicts, links on
  summary tasks, lags over 60 days and actual starts after the status date.
- **Settings**: project name, start date, project calendar, critical float threshold, and the
  calendar editor (working weekdays and holidays — the Standard calendar ships with no holidays;
  paste your local list there).
- **File**: export `.gantt.json`, Excel (task table + cell-shaded weekly Gantt), Microsoft Project
  XML; import a `.gantt.json` or CSV as a new project; print / save as PDF (landscape, fit to
  width, headers repeated on every page, optionally collapsed to phases).

## Predecessor syntax

The _Predecessors_ column takes a comma-separated list of row IDs (the ID column):

```
12, 18SS+10d, 23FF-2d, 30SF, 41FS+30ed
```

| Part                | Meaning                                                                     |
| ------------------- | --------------------------------------------------------------------------- |
| `12`                | Finish-to-start from task 12, no lag                                        |
| `FS` `SS` `FF` `SF` | Link type (default FS)                                                      |
| `+10d` / `-2d`      | Lag / lead in **working days** of the project calendar (`wd` also accepted) |
| `+30ed`             | Lag in **elapsed** (calendar) days                                          |
| `+2w`               | Two working weeks (= 10 working days)                                       |
| `12+3d`             | A lag without a type means FS                                               |

Unknown IDs, a task linked to itself or to its own summary, and links that would create a loop
are rejected with a message naming the loop, e.g. `Circular dependency: 12 → 18 → 25 → 12`.

## CSV import

Columns (header names, any order, case-insensitive): **Name**, Duration, Predecessors, Parent
WBS, Responsible.

```csv
Name,Duration,Predecessors,Parent WBS,Responsible
Site works,,,,
Clear site,5,,1,GC
Pour slab,10,2,1,GC
Handover,0,3,,Owner
```

- _Predecessors_ use the syntax above but refer to **CSV data row numbers** (1 = first row
  after the header).
- _Parent WBS_ is the WBS number the parent row gets (`1`, `2.3`); parents must come first. Leave
  it empty for a top-level task.
- Duration `0` makes a milestone. Problem rows are reported and skipped; the rest is imported.

## Scheduling conventions

Durations are working days in the task's calendar; finish dates are shown inclusive (the last
working day). An elapsed lag counts from the end of the predecessor's last working day, so a
5-day task starting Mon 2027-01-04 followed by `FS+3ed` starts on Tue 2027-01-12. See
[PLAN.md](PLAN.md) for the full set of engine conventions and design decisions, including the one
change made to the template data.

## Project layout

```
src/engine/    scheduling engine (pure TypeScript, no React) + tests
src/template/  condo development template
src/store/     Zustand + Immer store, edit operations, undo/redo
src/io/        IndexedDB persistence, JSON / Excel / CSV / MS Project XML
src/ui/        React components (grid, SVG timeline, dialogs, panels, print view)
e2e/           Playwright smoke test
```
