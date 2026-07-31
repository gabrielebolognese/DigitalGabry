# DigitalGabry, build plan

Eleven phases. Each is one Claude Code session, one branch, one commit. Do not merge two phases into one session, because context bloat is what makes agent output drift.

`SPEC.md` is the contract. This file is the sequence.

**Rule for every phase:** read `SPEC.md` and `CLAUDE.md` first, implement only the listed scope, satisfy every acceptance criterion, and stop. Do not build ahead.

---

## How to run this

### One time setup

```bash
npm create tauri-app@latest digitalgabry -- --template react-ts
cd digitalgabry
git init && git add -A && git commit -m "scaffold"
```

Copy `SPEC.md`, `PLAN.md`, and `CLAUDE.md` into the repository root and commit them.

```bash
npm i -D tailwindcss @tailwindcss/vite vitest
npm i lucide-react @icons-pack/react-simple-icons date-fns date-fns-tz rrule uuid
npm i @tauri-apps/plugin-sql @tauri-apps/plugin-notification @tauri-apps/plugin-global-shortcut @tauri-apps/plugin-store @tauri-apps/plugin-autostart @tauri-apps/plugin-fs @tauri-apps/plugin-dialog
```

Download the Geist and Geist Mono woff2 files into `src/assets/fonts/` before Phase 1, since the app must render correctly offline.

### The loop, per phase

```bash
git checkout -b phase-01-shell
claude
```

Then paste the phase prompt. Work through it, and when Claude says it is done:

```bash
npm run tauri dev
```

Look at it. If it is wrong, describe the specific deviation and let it fix it in the same session, because the context is still warm. When it is right:

```bash
git add -A && git commit -m "phase 01: app shell and tokens"
git checkout main && git merge phase-01-shell
```

Then `/clear` before the next phase, or quit and restart. **Always clear between phases.** A session carrying three phases of history writes worse code than a fresh one.

### Session hygiene

- Use plan mode (`Shift+Tab` twice) for phases 4, 6, and 7. They involve real design decisions, and reviewing the plan before the code is cheaper than reviewing the code.
- If Claude proposes a value not in `SPEC.md`, that is a spec gap. Decide it, write it into `SPEC.md`, then continue. Never let it be decided implicitly in a component.
- After every phase, run `rg -n '#[0-9a-fA-F]{6}' src/components src/views` and confirm the only hits are in `tokens.css`. This one grep catches most style drift.
- Keep phases under roughly 400 lines of new code each. If a phase is ballooning, split it.

---

## Phase 0, foundation files

Do this by hand, not with the agent. Create `CLAUDE.md` in the repo root from the provided file. Confirm `SPEC.md` and `PLAN.md` are committed.

---

## Phase 1, tokens and app shell

**Prompt**

```
Read SPEC.md and CLAUDE.md fully before writing anything.

Implement Phase 1 only: the design token system and the static app shell.

Build:
1. src/styles/tokens.css containing every color, typography, spacing,
   radius, and motion token from SPEC.md section 3, as CSS custom
   properties on :root, plus a Tailwind v4 @theme block mapping them to
   utility names. This file is the only place a literal value may appear.
2. src/styles/global.css: reset, Geist font-face declarations pointing at
   src/assets/fonts, tabular-nums on :root, app background, custom
   scrollbar styled with --border tokens, focus-visible ring.
3. src/components/AppShell.tsx implementing the three pane layout from
   SPEC.md section 4: 52px rail, main area, right AI panel.
4. src/components/Rail.tsx with the avatar square and three items
   (Calendar, Momentum, Settings) using lucide icons at 16px stroke 1.5,
   active and inactive states, and a tooltip on hover after 400ms.
5. src/components/Splitter.tsx: drag the AI panel's left edge between
   280 and 480px, persist the width to localStorage for now, cursor
   col-resize, 1px hairline that brightens to --border-strong on hover.
6. Simple view switching in App.tsx via useState. No router.
7. Placeholder content in each pane: the view name at --fs-title,
   centered, --text-tertiary. Nothing else.

Do NOT build: any calendar, any block, any database, any AI, any state
management library.

Acceptance criteria:
- rg -n '#[0-9a-fA-F]{6}' src/components returns zero results.
- Every font-size in the app resolves to 10, 11, 12, 13, or 15px.
- The splitter drag is smooth and the width survives a reload.
- Rail active state is visually obvious without color alone.
- npm run tauri dev opens a window with no console errors or warnings.
```

---

## Phase 2, week view and block component

**Prompt**

```
Read SPEC.md sections 3, 4, and 5 before writing anything.

Implement Phase 2 only: the week calendar view and the Block component,
rendering from mock data.

Build:
1. src/domain/time.ts: pure UTC and zone helpers. Week and day range
   computation, minute-to-pixel and pixel-to-minute conversion for a
   given zoom, snapping to a 15 minute grid. No React, no Tauri imports.
2. src/views/calendar/WeekView.tsx: 34px time gutter plus 7 day columns.
   Hour rows 44px at default zoom, zoom steps 28 / 44 / 72 / 120 driven
   by Ctrl+scroll. Day headers at --fs-micro, today's header at
   --text-primary and all others at --text-secondary.
3. src/views/calendar/NowLine.tsx: 1px --accent line across today's
   column with a 5px dot at the left edge, updating every 30 seconds.
4. src/components/Block.tsx implementing SPEC.md section 5.1 exactly.
   A self-contained box: --bg-surface, 1px --border-hair, 4px radius,
   a 20px icon slot on the left holding a 14px icon tinted with the
   category color, title, and meta line. A category color wash at 13%
   alpha as the background. There is NO left accent border. Implement
   the three density tiers by rendered height and all six states from
   the state table.
5. Icon resolution: a helper mapping kind and payload.platform to the
   right lucide or simple-icons component, per SPEC.md section 5.2.
6. Overlap layout: blocks sharing a time range split the column width
   evenly with a 2px gap, up to 3 across, then the fourth and beyond
   collapse into a "+N more" chip.
7. A src/mock/blocks.ts fixture of about 25 blocks across one week,
   covering every kind, every category, every platform, short and long
   durations, overlaps, and completed and overdue states.
8. useBlocks(range) hook in src/store/useBlocks.ts returning the mock
   data filtered by range. This is the exact interface the real
   repository will implement later, so design the signature accordingly.

Do NOT build: dragging, resizing, clicking behavior, the inspector, any
database.

Acceptance criteria:
- The week renders 25 mock blocks with correct vertical positions.
- A 15 minute block, a 45 minute block, and a 3 hour block each pick the
  right density tier and stay readable.
- Overlapping blocks do not visually collide.
- Zoom via Ctrl+scroll is smooth and keeps the viewport centered on the
  cursor's time position.
- No left border accent exists anywhere in Block.tsx.
```

---

## Phase 3, block interaction and inspector

**Prompt**

```
Implement Phase 3 only: block interaction and the inspector panel.
Continue using mock data held in React state.

Build:
1. Click a block to select it. Selection state lives in
   src/store/useUiStore.ts. Clicking empty space clears it.
2. Drag a block to move it. Snap to 15 minutes, allow moving across day
   columns, show an 80% opacity ghost while dragging, commit on release.
3. Drag the top or bottom edge to resize, with a 15 minute minimum
   duration, same snapping.
4. Drag on empty calendar space to create a new block, opening the
   inspector with the title field focused.
5. src/components/Inspector.tsx per SPEC.md section 5.3: a 320px
   --bg-elevated overlay on the right of the main view, with every listed
   field, and a collapsed "Raw" disclosure containing a JSON editor that
   validates on change and writes back on blur. Escape closes it.
6. Double click a block for inline title editing.
7. Keyboard: Enter toggles completion, Delete soft-deletes with a 5
   second undo toast, Escape closes the inspector, arrow keys move
   selection between blocks.
8. src/components/Toast.tsx: bottom-center, --bg-elevated, 1px --border,
   auto-dismiss after 5 seconds, with an action button.

Acceptance criteria:
- Dragging feels immediate with no visible lag at 60fps.
- Snapping is always exactly 15 minutes, never off by a pixel-rounded
  amount.
- The raw JSON editor rejects invalid JSON without losing the user's
  text.
- Every interaction is reachable by keyboard.
```

---

## Phase 4, data layer

Use plan mode for this one.

**Prompt**

```
Read SPEC.md sections 6 and 7 fully. Plan before implementing.

Implement Phase 4 only: the SQLite data layer. No UI changes.

Build:
1. src/domain/id.ts: UUIDv7 generation, time sortable, no dependency
   beyond crypto.getRandomValues.
2. src/domain/hlc.ts: hybrid logical clock as described in SPEC.md
   section 6.4. Format {wallMs}:{counter}:{deviceId}. Must be monotonic
   even if the system clock moves backwards. Unit tested.
3. src/db/client.ts: tauri-plugin-sql connection, WAL mode,
   synchronous=NORMAL, foreign_keys=ON, migration runner that applies
   numbered SQL files in order and records them in a migrations table.
4. src/db/migrations/001_init.sql: every table, index, view, and trigger
   from SPEC.md section 6, including the FTS5 virtual table and its sync
   triggers, plus seeds for the default projects and the 18 default
   activity types from section 8.5.
5. src/db/repository.ts: the only file in the codebase containing SQL.
   Typed CRUD for blocks, projects, tags, and activity, all range-bounded
   reads, all reads filtering deleted_utc IS NULL, aggregate queries for
   month and year zoom levels.
6. src/db/ops.ts: every mutation writes one ops row per changed field,
   inside the same transaction as the mutation. Implement undo and redo
   by walking the ops log.
7. Verify that the bundled SQLite has FTS5 available. If it does not,
   stop and report before proceeding, do not silently drop search.

Acceptance criteria:
- The migration runs on a fresh database and is idempotent on restart.
- Two rapid consecutive HLC calls produce strictly increasing values.
- A block update writes exactly one ops row per changed field, no more.
- Undo restores the previous field value and pushes a redo entry.
- A range query over 50,000 seeded blocks returns in under 20ms. Include
  the seed script used to verify this in scripts/.
```

---

## Phase 5, wire the calendar to the database

**Prompt**

```
Implement Phase 5 only: replace mock data with the real repository.

Build:
1. Rewrite useBlocks(range) to call the repository, keeping the exact
   same signature so no component changes shape.
2. Viewport-driven fetching: load the visible range plus one screen of
   buffer on each side, prefetch adjacent ranges on idle via
   requestIdleCallback, evict everything outside a three-screen window.
3. Optimistic updates: mutations apply to local state immediately and
   reconcile after the write resolves, rolling back on error with a toast.
4. Delete src/mock entirely.
5. An empty state for a week with no blocks: a single line at --fs-meta
   and --text-tertiary, centered, inviting the first block. No
   illustration.

Acceptance criteria:
- Scrolling four weeks forward issues bounded queries only, never a full
  table scan. Log query ranges in dev mode to prove it.
- Creating, moving, resizing, and deleting all persist across an app
  restart.
- A failed write rolls back the UI and surfaces a toast.
```

---

## Phase 6, recurrence, scheduler, quick capture

Use plan mode.

**Prompt**

```
Read SPEC.md sections 6.2 and 10.

Implement Phase 6 only.

Build:
1. src/domain/recurrence.ts: wrap the rrule package. Generate occurrences
   for a block over a range, honoring exceptions (blocks with
   recurrence_parent_id and is_exception = 1). Pure, unit tested against
   DST transitions in Europe/Rome in both directions.
2. src/scheduler/materialize.ts: maintain the occurrences table over a
   rolling 18 month window. Rebuild on app start and whenever an rrule
   changes. Never expand recurrence at query time.
3. Editing a recurring block prompts: this occurrence, this and future,
   or all. "This occurrence" creates an exception block.
4. src/scheduler/reminders.ts: a 60 second tick firing native
   notifications via tauri-plugin-notification for blocks with a reminder
   offset in payload. Never fire the same reminder twice, tracked in the
   store.
5. src/capture/QuickCapture.tsx: a 480x120 always-on-top frameless
   window opened by the Ctrl+Shift+Space global shortcut, working when
   the app is unfocused. A single input, live-parsed preview underneath
   at --fs-micro showing the interpreted kind, time, project, and tags.
   Enter saves and closes, Escape closes.
6. src/capture/parser.ts: pure parser for natural language dates and
   times plus #tag, @project, and !priority tokens. Unparsed remainder
   becomes the title. Unit tested with at least 20 cases including
   "post friday 9am linkedin parenting DAG", "tomorrow 14:30 gym",
   "!high fix render bug @flashfx".
7. System tray icon with a menu: open, quick capture, quit. Closing the
   window hides to tray rather than quitting.

Acceptance criteria:
- A daily 09:00 recurring block stays at 09:00 local across both DST
  transitions.
- Quick capture opens in under 200ms from a cold, unfocused app.
- The parser has 20 or more passing unit tests.
- Rebuilding 18 months of a daily rule completes in under 500ms.
```

---

## Phase 7, momentum

Use plan mode. This is the largest phase, and the scoring engine must be built and tested before any UI.

**Prompt**

```
Read SPEC.md section 8 in full, twice. The math must be implemented
exactly as specified.

Implement Phase 7 only: the momentum system.

Build in this order.

A. src/domain/momentum.ts, pure and fully unit tested, no React, no SQL:
   - dailyRawScore(entries, types): sum of min(count, cap) * weight
   - streakMultiplier(streak): 1 + min(streak, 60) * 0.005, capped 1.30
   - computeSeries(logsByDate, types, constants): fold over a date range
     applying M(d) = lambda * M(d-1) + S(d) * K(d), lambda default 0.92,
     returning per-day raw score, multiplier, momentum, and streak.
     Days with no activity still produce a row with S = 0, so decay
     applies on empty days.
   - levelFor(momentum): the six bands from section 8.3.
   Unit tests must verify: decay half-life is about 8.3 days; steady
   state under a constant daily score of 16 converges to about 200;
   the streak multiplier caps at 1.30; a gap of 30 days decays toward
   but never below zero; the whole series is deterministic, so computing
   it twice gives identical output.

B. Repository functions: activity type CRUD, activity log insert and
   soft delete, log queries by date range, and recomputeMomentum() which
   wipes and rebuilds momentum_daily from activity_log in a single
   transaction.

C. Auto-logging per SPEC.md section 8.6: completing a post block with a
   platform inserts an activity_log row with source='block'; un-completing
   soft-deletes it.

D. src/views/momentum/MomentumView.tsx and its children, per SPEC.md
   section 8.7, in this order:
   - Header strip with the score at --fs-display, level label, 7 day
     delta, and streak.
   - MomentumChart.tsx: hand-written SVG, no chart library. 30 / 90 / 365
     toggles. A 1.5px --accent line over a 13% alpha area fill, faint 1px
     raw score bars behind it in --border, hairline gridlines at the level
     thresholds labelled at --fs-micro. Hover shows a vertical hairline
     and a --bg-elevated readout with date, raw score, and momentum. The
     chart must handle 365 points without jank and must be responsive to
     container width via ResizeObserver.
   - Breakdown.tsx: a horizontal stacked bar of the last 30 days by
     category, plus a dense table of activity types sorted by total points
     with count, weight, and points columns.
   - Heatmap.tsx: 52 weeks by 7 days, 9px cells, 2px gaps, 5 opacity
     steps of --accent keyed to raw score quintiles, empty days
     --bg-surface, tooltip on hover.
   - QuickLog.tsx: pinned bottom strip, the 8 most-used activity types as
     icon buttons, one click logs one unit for today with a brief count
     animation. This is the primary logging path, so it must feel instant.

E. Settings: an ActivityTypeTable with editable name, icon, category,
   weight, daily cap, and archive toggle, plus an add row. Below it, the
   editable constants lambda, streak increment, streak cap, and streak
   threshold. Any change triggers recomputeMomentum() with a progress
   indicator.

Acceptance criteria:
- All momentum math unit tests pass, including the calibration cases
  named above.
- Changing one weight and recomputing over 10 years of seeded data
  completes in under 2 seconds.
- The chart renders 365 points smoothly and reflows on window resize.
- Quick log to visible score update takes under 100ms.
- momentum_daily is never read as a source of truth. Deleting the whole
  table and recomputing produces byte-identical results.
```

---

## Phase 8, AI panel

**Prompt**

```
Read SPEC.md section 9.

Implement Phase 8 only: the AI summary and chat panel.

Build:
1. src/panel/context.ts: serialize the current visible range, today's
   blocks, the last 7 days of momentum, and open overdue items into a
   compact JSON payload. Hard cap at 4000 tokens with a documented
   truncation strategy. Never send the whole database.
2. src/panel/Summary.tsx: the Today, At risk, and Momentum sections.
   Regenerate on the refresh icon and once per app launch. Cache the
   result with a timestamp shown at --fs-micro.
3. src/panel/Chat.tsx: message list, streaming responses, user turns
   right-aligned in --bg-elevated, assistant turns left-aligned with no
   bubble. Typing in the input switches from summary to chat mode, and a
   back control returns to summary.
4. API key stored via tauri-plugin-store, entered in Settings, masked in
   the input, never logged, never committed. Model claude-sonnet-4-6.
5. If no key is present, show an empty state pointing at Settings. Every
   other part of the app must work normally without a key.
6. Errors surface as one line in the panel, never as a modal, and never
   as a raw exception string.

Acceptance criteria:
- The app is fully usable with no API key configured.
- The context payload never exceeds 4000 tokens, verified with a test on
  a densely seeded week.
- Streaming text does not cause layout shift in the panel.
- The key never appears in any log, error message, or committed file.
```

---

## Phase 9, backups and export

**Prompt**

```
Read SPEC.md section 11.

Implement Phase 9 only.

Build:
1. A nightly 03:00 job plus a manual trigger performing VACUUM INTO a
   dated snapshot in backups/, retaining the last 30 and deleting older
   ones.
2. A nightly export to export/: one Markdown file per month of blocks in
   a stable, diff-friendly format, plus projects.json, activity.json, and
   momentum.json. Stable key ordering so unchanged data produces an empty
   diff.
3. If export/ is a git repository, stage and commit with the ISO date as
   the message. If it is not, skip silently.
4. A one-shot importer accepting a Markdown or CSV file and inserting
   blocks. One-directional, explicitly not sync.
5. Settings: backup folder pickers, retention count, run now buttons,
   and last run timestamps.

Acceptance criteria:
- A restore from a snapshot into a fresh install reproduces all data.
- Running the export twice with no changes produces an empty git diff.
- The import handles a malformed file without corrupting existing data.
```

---

## Phase 10, polish and audit

**Prompt**

```
Implement Phase 10: a full audit pass against SPEC.md section 13.
Change only what violates the invariants or the acceptance criteria below.

Do:
1. Grep the entire src tree for raw hex, rgb(), rgba() outside
   tokens.css, and arbitrary Tailwind values. Replace every hit with a
   token. Report the list of what you changed.
2. Audit every font-size, font-weight, border-radius, spacing value, and
   icon size against SPEC.md section 3. Fix every deviation.
3. Confirm no file in src/domain imports React, the DOM, or Tauri.
4. Confirm no component outside src/db contains SQL.
5. Add loading skeletons using --bg-surface blocks, never spinners.
6. Command palette (Ctrl+K): fuzzy search across blocks, views, and
   actions, styled per the token system.
7. Full keyboard pass. Every interactive element must be reachable and
   must show the focus ring.
8. prefers-reduced-motion disables all transitions.
9. Fix every console warning and TypeScript error. Strict mode, no any,
   no ts-ignore.

Acceptance criteria:
- rg -n '#[0-9a-fA-F]{6}|rgba?\(' src --glob '!**/tokens.css' returns
  zero results.
- tsc --noEmit passes clean under strict.
- The app opens with zero console output.
- Cold start to interactive is under 1.5 seconds.
```

---

## After the first draft

Live with it for a week before adding anything. The features most likely to be worth building next, in order: a backlog view for unscheduled blocks, GitHub commit import feeding momentum automatically, and the Tauri mobile target reusing `src/domain` unchanged.

Do not start device sync until you actually have a second device. The schema is ready, and readiness is the whole point.
