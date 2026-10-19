# Condo Gantt

A browser-based Gantt scheduler for for-sale condominium developments, with a real critical-path
engine (FS/SS/FF/SF links with working-day or elapsed lags, constraints, float, progress against a
status date), baselines and variance, a schedule health check, and a preloaded template covering
the whole lifecycle from site acquisition to handover to the owners' association.

Everything runs in the browser. Projects are stored in the browser's IndexedDB; nothing is sent
to a server. Export to `.gantt.json` to back up or share a project.

## Look and feel

The interface follows the Villa Felstead brand guidelines: GT Standard (Regular) throughout,
the Interior warmth / Sandstone / Glacier white palette with Dark wood rules, uppercase tracked
labels and pill-shaped buttons. GT Standard is used **from the fonts installed on the computer**
(no font file is bundled, so no web licence is needed); a computer without it falls back to
Helvetica or Arial. Bars are drawn in soft pastels; the critical path stays red.

- **Colours**: right-click a task (or a selection) and pick one of 16 pastel colours, or set it
  in the task dialog. Subtasks take their parent's colour automatically; colouring a parent
  resets the colours of everything under it, and a subtask can then be given its own colour.
  _Automatic (same as the parent)_ removes a task's own colour. One undo step.
- **Critical summaries**: when every unfinished subtask of a phase or summary is on the critical
  path, its bar (also when collapsed) and its name are drawn red instead of black.

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

## Online version

The app is published at **https://villa-felstead-planner.vercel.app** (Vercel project
`villa-felstead-planner`). Only the app's code is published; projects stay in your browser and
your project folder. To use your projects there, open the site in Edge or Chrome, click
**Save projects to a folder…** and choose the same folder: its `.gantt.json` files are imported.
Edit a project in one place only (the site or `localhost`), as the two do not lock each other.

To publish a new version: `npx vercel deploy --prod` in this folder (signed in once with
`npx vercel login`). `.vercelignore` keeps local files (`.env*`, project files) out of the upload.

## Using it

- **Projects**: the start page lists saved projects. _New project from template_ creates the
  condo development schedule (121 tasks in 11 phases) from a start date you choose.
- **Right-click** any row or bar for its options: edit the task, its predecessors or successors,
  insert a task above/below or a subtask, move up/down, indent/outdent, mark complete, turn into a
  milestone, or delete. (The Menu key or Shift+F10 opens it from the keyboard.)
- **Select several tasks**: Ctrl+click to add or remove, Shift+click (or Shift+arrow keys) for
  a range, Ctrl+A for all visible rows, Esc to go back to one. Works on bars too. Then press
  Delete, use the toolbar (indent, outdent, move, **Edit N tasks…**), or right-click for the
  bulk menu: set status, link in sequence (Finish-to-Start), remove links between them, move,
  delete. The bulk edit dialog changes status, % complete, responsible, duration, calendar,
  constraint, shifts starts by working days and adds to notes; every field defaults to
  "Leave unchanged". Each bulk action is one undo step.
- **Drag tasks** by their ID, WBS or icon cell. Drag a selection of several tasks the same way:
  drop on the top or bottom edge of a row to place them above or below it, or on the middle of a
  row to make them its subtasks. A label shows what will happen; a drop into a task's own
  subtasks is refused. One undo step.
- **Worst case**: give a task extra working days in the Worst case column (or the task dialog /
  bulk edit). The extra time is drawn hatched after the bar and in the tooltip; the plan itself
  does not move. The top bar shows the worst-case project finish (every task overrunning, with
  knock-on delays), drawn as a dotted red line on the timeline. Toggle with the Worst case button. Work tasks show their own extra time; phases, summaries and
  milestones show how late they could finish if every task overruns. The PDF, Excel and web-page
  exports include the same hatching, a worst-case finish key figure, a worst-case column for
  milestones (and, in Excel, for every task); untick "Show worst-case extra time" in the export
  dialog to leave it out.
- **Move tasks** up or down with the arrow buttons in the toolbar or Alt+Shift+↑ / ↓. A task
  moves with its subtasks and stays within its parent; use indent/outdent or drag the ID cell to
  move it to another phase.
- **Grid**: double-click a cell, press F2, or just start typing to edit. Enter commits and moves
  down, Esc cancels. Tab / Shift+Tab indent / outdent, Insert adds a row above, Delete deletes
  (asks first if the task has subtasks or links), Ctrl+Z / Ctrl+Shift+Z undo / redo. Drag the ID
  cell to move a row (drop on the top or bottom edge of a row to place it before/after, on the
  middle to make it a subtask).
- **Dates**: double-click a Start or Finish cell to open a calendar under it: click a day, or
  type a date (2027-01-04, 04.01.2027, …) and press Enter. Picking the date already shown
  changes nothing. Choosing a Start date sets a _Start No Earlier Than_ constraint, typing a Finish date a
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
- **Status**: every task has a status (Not started, In progress, On hold, Blocked, Complete),
  kept in step with % complete, plus a schedule signal (On track, At risk, Late). Set it in the
  Status column, the right-click menu or the task dialog; filter by it in Filter.
- **History**: every change is kept (across reloads) and listed in the History panel; click
  any entry to go back to that point. Ctrl+Z / Ctrl+Shift+Z step through it.
- **Versions**: save named versions of the project; the app also keeps a daily snapshot and one
  before any restore. Compare a version with the current plan, restore it (undoable) or
  download it.
- **Links** button: show or hide the link arrows.
- **Critical path only** button: shows exactly the tasks on the critical path, in order, and
  hides everything else (phases, summaries and tasks with float). Click again to show all
  tasks. It only changes the view, never the plan. (Also in Filter → Critical path only.)
- **File → Export for review…**: PDF, Excel or a web page for phones, with a choice of rows
  (all tasks, phases, phases and milestones, milestones), date range (whole project, custom,
  or a look-ahead of 6/12/26 weeks), time scale, and for PDF whether the timeline fits one page
  width or is split across pages (task names repeated). Summary pages show key dates, finish
  against the baseline, milestones, phases and a watch list. Also: `.gantt.json` and Microsoft
  Project XML export, and import of a `.gantt.json` or CSV as a new project.

## Old design comparison

`tools/compare/` compares the old Excel schedule (its "Schedule" tab, Actual / Forecast dates)
with a planner project. Both inputs are only read. Run from this folder:

```bash
node tools/compare/run.mjs tools/compare/main.ts --old "<old schedule.xlsx>" --plan "../<project>.gantt.json"
```

It writes to `../Comparison/`:

- `Old vs new design - matching.xlsx`: which old activity is which new task. Drafted on the
  first run, then **only read** (never overwritten), so edit it freely; see its "How to edit"
  tab. Delete it to get a fresh draft.
- `Old vs new design - comparison.xlsx`: key dates, by phase, all lines, a two-bar Gantt (old
  vs new) and notes, regenerated on every run.

## Keeping your data safe

- Click **Not saved to a folder** (top right) or **Save projects to a folder…** on the start
  page and choose a folder, for example your Villa Felstead OneDrive folder. From then on every
  project is also written there as `<project name>.gantt.json` (a few seconds after each
  change), and versions go to `Versions/<project name>/`. OneDrive then backs them up.
- Edge or Chrome is needed for folder saving. The browser may ask once per visit to allow
  editing the folder — choose "Allow on every visit".
- A project file changed outside the app (e.g. restored from OneDrive) is picked up when you
  open the project; the browser copy is kept as a version first.
- Deleting a project moves its file to `Deleted/` in the folder.
- Opening the same project in a second tab makes that tab read-only, so tabs never overwrite
  each other.

## Day counts

Durations, lags and float are counted in working days of the calendar. If every day of the week
is a working day (Settings → Calendars), a working day is simply a calendar day. When you type a
duration, "1 week" means one week of the project calendar (7 days on a seven-day calendar, 5 on
Monday to Friday) and "1 month" means 30 calendar days (30 days on a seven-day calendar, 21 on
Monday to Friday). A phase's duration counts from its start to its displayed finish, inclusive.

A task with an actual start (set when its status or % complete is changed) is drawn from that
date even if its predecessors finish later; its remaining work waits for them. Clear the actual
start in the task dialog if the task has not really started.

## Predecessor syntax

The _Predecessors_ and _Successors_ columns show links in full, by row ID (the ID column):

```
12 Finish-to-Start, 18 Start-to-Start +10 working days, 23 Finish-to-Finish -2 working days, 41 Finish-to-Start +30 calendar days
```

You can type exactly that, or the short forms below (they are converted to the full wording):

| You type                                                                                            | Meaning                                                                                     |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `12`                                                                                                | Finish-to-Start from task 12 (this task starts after 12 finishes), no lag                   |
| `Finish-to-Start`, `Start-to-Start`, `Finish-to-Finish`, `Start-to-Finish` (or `FS` `SS` `FF` `SF`) | Link type; Finish-to-Start if omitted                                                       |
| `+10 working days` (or `+10d`) / `-2 working days`                                                  | Lag, or a lead if negative, in working days of the project calendar                         |
| `+30 calendar days` (or `+30ed`)                                                                    | Lag in calendar days (weekends and holidays count)                                          |
| `+2 weeks`                                                                                          | Two weeks of the project calendar (14 days on a seven-day calendar, 10 on Monday to Friday) |

Row IDs renumber automatically when tasks are inserted, moved or deleted (including a whole
parent task with its subtasks); links always follow the tasks, so the predecessor text updates
by itself. Unknown IDs, a task linked to itself or to its own summary, and links that would
create a loop are rejected with a message naming the loop, e.g.
`Circular dependency: 12 → 18 → 25 → 12`.

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
