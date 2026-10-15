# Condo Gantt — build plan

Browser-only Gantt scheduler for a for-sale condominium development. Vite + React + TypeScript
(strict), Zustand + Immer, a pure TypeScript CPM engine in `src/engine/`, hand-built SVG timeline,
date-fns, SheetJS, IndexedDB (idb-keyval), Vitest + one Playwright smoke test.

## Layout

```
src/
  engine/        pure TS, no React: types, calendar maths, CPM scheduler, cycles, links parser,
                 health check, variance. Fully unit-tested.
  template/      the section-6 condo template (data) + loader (keys -> uuids/rowIds)
  store/         Zustand+Immer store: project, derived schedule, undo/redo, UI state, autosave
  io/            JSON / Excel / CSV / MS Project XML import-export, IndexedDB persistence
  ui/            React components (project list, toolbar, grid, timeline, dialogs, panels, print)
e2e/             Playwright smoke test
```

## Phases

0. Plan, scaffold, lint/format/Vitest. 1. Engine. 2. Read-only grid + timeline. 3. Editing + undo.
1. Template, project list, autosave. 5. Progress, baselines, variance, health check.
2. Import/export, print. 7. Verification (all tests, Playwright, perf, README).
   Each phase ends with `npm test` green and a git commit.

## Engine conventions (decisions)

**Time model.** Dates are integer _day numbers_ (days since 1970-01-01, UTC, no time zones).
A day number used as a _point_ means 00:00 of that day. A working day `d` occupies `[d, d+1)`.

- **Start points** are always the start of a working day in the task's calendar. Any start that
  lands on a non-working day snaps forward.
- **Finish is exclusive**: `EF = (last working day) + 1`. The grid shows the inclusive finish
  `EF − 1`. Milestones have `ES = EF` (a start point) and show that date for both.
- Each calendar precomputes `workDay[k]` (the k-th working day) and `cum(t)` (number of working
  days before point `t`), so all arithmetic is O(1) array lookups. Ranges grow on demand.

**Lags.** `shift(t, lag)`:

- `wd` (working days, project calendar): `workDay[cum(t) + lag]` — the start of the lag-th working
  day after `t` (or before it, for a negative lead). Lag 0 = snap forward.
- `ed` (elapsed days): `t + lag`, then the successor's start snaps forward.

**Elapsed-lag convention (test 6).** An elapsed lag is counted from the exclusive finish point,
i.e. from 00:00 of the day _after_ the predecessor's last working day. A(5) Mon 2027-01-04 →
last working day Fri Jan 8 → finish point Sat Jan 9 00:00 → +3 elapsed days = Tue Jan 12 00:00,
a working day, so **B starts Tue 2027-01-12**. (The brief's "Mon 2027-01-11" contradicts its own
arithmetic; counting from the inclusive finish would make an elapsed lag of 1 over a weekend
cost nothing while 0 cost a day, which is inconsistent. The test asserts Tue Jan 12.)

**Forward pass** (Kahn topological order over leaf tasks), ES = max of project start, status
date (not-started tasks), SNET/FNET/MSO/MFO, and per link:
FS `shift(EFp)`, SS `shift(ESp)`, FF/SF: the successor must finish no earlier than
`shift(EFp|ESp)`, so `ES = workDay_s[cum_s(F) − dur]`.

**Backward pass** inverts each link exactly: `invShift(X, lag) = workDay[cum(X+1) − 1 − lag]`
(wd) or `X − lag` (ed) gives the latest predecessor point that still satisfies the link; it is
then normalised to the predecessor's calendar (latest finish point / latest start point).
LF = min(project finish, FNLT/MFO, SNLT/MSO-derived, links). LS = LF − duration.

**Float.** TF = `cum(LF) − cum(EF)` in the task's calendar (equals LS − ES for normal tasks, and
is correct for in-progress tasks whose start is an actual). Free float = min over outgoing links
of the same inverse computed against the successors' _early_ dates (tasks without successors
use the project finish), clamped to `[0, TF]` (0 when TF < 0). Critical = TF ≤ threshold and not
complete.

**Constraints.** Dates entered for constraints are calendar dates; finish-type dates are
inclusive (FNET Jan 15 = finish point Jan 16 00:00; for milestones the point is the date itself).

- SNET/FNET push early dates. SNLT/FNLT limit late dates → negative float if logic pushes past
  them, and `constraintViolated` is set.
- MSO/MFO hold the date. If logic wants a later date, the task keeps the constraint date,
  `constraintViolated` is set and its float is measured against the logic-driven date, so the
  task _and_ its driving chain show negative float (test 7: B float −5, A float −5).
- Constraints on summary tasks are ignored by the engine; the UI does not offer them.

**Summary tasks.** Links on a summary are expanded to every leaf descendant (the brief: "apply to
all their children"). So `S FS X` means every leaf of S FS X; `P FS S` pushes every leaf of S.
A link between a task and its own ancestor therefore becomes a cycle and is rejected. Summary
ES = min child ES, EF = max child EF, TF = min child TF, critical if TF ≤ threshold, % complete =
duration-weighted over leaf descendants (simple average if all are milestones).

**Progress (status date).**

- Complete (100 %, or actualFinish set): fixed at actualStart..actualFinish.
- In progress (actualStart, < 100 %): ES = actualStart; remaining = ceil(dur × (1 − pct)),
  min 1; remaining work starts at max(status date, link logic computed with the remaining
  duration) — retained logic.
- Not started: ES ≥ status date.
- % > 0 without an actualStart: the store fills in actuals when % complete is edited; the engine
  falls back to treating the logic early start as the actual start.

**Cycles.** Kahn's algorithm; leftover nodes are searched with a DFS that returns one concrete
loop, reported with row IDs: "Circular dependency: 12 → 18 → 25 → 12". Edits are validated
before they are committed and rejected with that message. If a cycle arrives through import,
the engine drops one link of each loop, schedules the rest and reports the cycle as an error.

**Performance.** Typed arrays, adjacency lists built once per recalculation, calendars cached by
content. Target < 100 ms for 500 tasks / 800 links (tested).

## Data decisions

- `Task.calc` is derived. The store keeps it in a separate `schedule` map, never in undo history
  or IndexedDB; JSON export attaches it for consumers and import ignores it.
- `rowId` = 1-based position in the full (unfiltered, uncollapsed) outline; renumbered after
  every structural edit. Links always reference uuids.
- `Baseline.tasks[id].finish` stores the **inclusive** finish date (what the grid shows).
- Finish variance = working days (project calendar) between baseline finish and current finish;
  positive = late.
- Typing a Start date sets SNET (as in MS Project); typing a Finish date sets FNET.
- Durations accept `10`, `10d`, `2w` (= 10 wd), `1mo` (= 20 wd); `0` makes a milestone.
- Date display format: `EEE dd MMM yy` (e.g. "Mon 04 Jan 27") — unambiguous for non-US users.
  Date input accepts ISO, `dd.mm.yyyy`, `dd/mm/yyyy`, `dd.mm.yy` and the display format.
- Calendars: "Standard" (Mon–Fri, empty holiday list) and "7-day". Template task E10 uses 7-day.
- New projects start on the next Monday after today.

## Predecessor syntax

Comma-separated row IDs: `12, 18SS+10d, 23FF-2d, 30SF, 41FS+30ed`. Type defaults to FS; `d` or
`wd` = working days, `ed` = elapsed days; a lag without a type (`12+3d`) is FS.

## UI decisions

- Two scroll containers (grid, timeline) with synchronised vertical scroll; hand-rolled row
  virtualisation (fixed 28 px rows). Timeline header and weekend shading are also windowed
  horizontally.
- Keyboard per brief. Tab/Shift+Tab indent/outdent even while a cell is being edited (the edit is
  committed first).
- Filters show matching tasks plus their ancestor summary rows for context.
- Links are drawn only when both ends are visible rows.
- Bar drag sets SNET; right-edge drag sets duration; the end connector drags an FS link.
  Summary bars cannot be dragged.
- Print uses a dedicated non-virtualised print view (HTML table with a repeating `<thead>`,
  one scaled SVG per row) so every row prints; arrows are omitted in print.
- UI preferences (columns, theme, splitter) live in localStorage; project data in IndexedDB.

## Excel export

SheetJS Community Edition cannot write cell fills. Sheet 2 cells use per-phase custom number
formats (`"";"";"";"Pnn"`) that render blank; after writing, the zip is opened with SheetJS's own
`CFB` module and `xl/styles.xml` is patched to give those formats solid fills. No extra dependency.

## Template changes

The template checks (no cycles, A01 the only start, H08 the only finish, no open ends) passed
as given. The critical-path check did not: with the brief's data the path ran
D04 → L02 → L04 → L05 (regulator) → S06 sales launch → S07 pre-sales → F07 loan closing, so
entitlements and permitting had 7 days of float.

Change (data only, durations untouched): **L02 "Draft declaration / CC&Rs & bylaws" and L03
"Association budget & reserve study" now follow `D04 SS+20d` instead of `D04` (FS)**, i.e. condo
counsel and the reserve consultant start once design development is 20 days in, which is common
practice. The critical path now runs A01–A04 → A09 → D01 → D02 → E04–E09 (entitlements) → D06/D07
→ P01–P05 (permitting) → F07/F08 (loan closing) → C01–C25 (construction) → X02/X03 (C of O) → L09
→ H04/H05 (closings) → H07/H08 (closeout). Sales launch keeps 22 working days of float.

E10's name is "Appeal period (30 calendar days)" and it uses the 7-day calendar.

## Persistence

IndexedDB database `condo-gantt`, store `projects`: `project:<id>` holds a versioned
`{ schemaVersion, app, project }` record (same shape as the `.gantt.json` export) and `index`
holds the list metadata. Autosave runs 500 ms after the last change and is flushed on `pagehide`
and when leaving a project. All loads go through `readProjectFile`, which validates, repairs and
migrates. URL hash routing: `#/` = list, `#/p/<id>` = project (so a reload reopens it).

## Dependencies

As in the brief. SheetJS is installed from the official SheetJS CDN tarball (0.20.3), because
the npm registry copy (0.18.5) is unmaintained. Playwright runs against the installed Microsoft
Edge (`channel: 'msedge'`) to avoid downloading a browser.
