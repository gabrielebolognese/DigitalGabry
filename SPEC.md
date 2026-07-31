# DigitalGabry, specification

Single source of truth for the product. Every implementation decision must trace back to this document. If something is not defined here, stop and ask rather than inventing it.

---

## 1. What this is

A local-first desktop app for one user (Gabriele). It is a calendar with a timeline of blocks, where a block is any unit of committed time or work: a task, a post to publish, an event, a focus session, a deadline, a note.

Its second job is momentum tracking: a weighted, decaying score of everything actually completed, so output over time is visible as a curve rather than a feeling.

**Primary goals**
1. Capturing something takes under 3 seconds.
2. The week is legible at a glance, at high density, without scrolling.
3. Data belongs to the user, on disk, forever, with no cloud dependency.
4. Momentum is deterministic, recomputable, and honest.

**Non-goals for v1**
- Multi-user, sharing, collaboration.
- Mobile client (the architecture must allow it, v1 does not ship it).
- Cloud sync (the schema must allow it, v1 does not ship it).
- Any hosted database.
- Email, browsing, or generic assistant features.

---

## 2. Stack, fixed

| Concern | Choice | Notes |
| --- | --- | --- |
| Shell | Tauri v2 | Custom Rust kept near zero |
| Frontend | React 19 + TypeScript, strict | |
| Build | Vite | |
| Styling | Tailwind v4 with CSS-native `@theme` | All values from tokens |
| Icons | `lucide-react`, plus `@icons-pack/react-simple-icons` for brand marks | |
| Database | SQLite via `tauri-plugin-sql` | WAL mode |
| Charts | Hand-written SVG | No chart library |
| Date math | `date-fns` plus `date-fns-tz` | |
| Recurrence | `rrule` npm package | |

Verify at Phase 4 that the bundled SQLite has FTS5 compiled in. If it does not, replace `tauri-plugin-sql` with a thin `rusqlite` command layer and keep the same TypeScript repository interface.

Plugins: `sql`, `notification`, `global-shortcut`, `autostart`, `store`, `fs`, `dialog`, `os`.

---

## 3. Design system

The visual direction is fixed. Do not improvise on it.

### 3.1 Color tokens

```css
--bg-app:        #0B0B0C;
--bg-rail:       #0E0E10;
--bg-surface:    #121214;
--bg-elevated:   #17171A;
--bg-hover:      rgba(255,255,255,0.045);
--bg-selected:   rgba(255,255,255,0.075);

--border-hair:   rgba(255,255,255,0.055);
--border:        rgba(255,255,255,0.09);
--border-strong: rgba(255,255,255,0.14);

--text-primary:   #EDEDEC;
--text-secondary: #8E8E8C;
--text-tertiary:  #5C5C5A;
--text-disabled:  #3E3E3C;

--accent:        #C96442;
--accent-weak:   rgba(201,100,66,0.13);
--accent-border: rgba(201,100,66,0.40);
```

Three rules that are not negotiable. The app background is never `#000000`, because pure black flattens elevation and turns hairlines into artifacts. Text is never `#FFFFFF`, because it halates on near-black over long sessions. Borders are always alpha white, never solid grey, so they compose correctly over any surface level.

### 3.2 Category colors

Exactly five, all desaturated. Used for the block icon tint and the momentum chart, never as a solid fill.

```css
--cat-build:    #C96442;   /* FlashFX, code, shipping */
--cat-content:  #5C86AE;   /* posts, video, writing */
--cat-admin:    #6F9B6F;   /* school, legal, finance */
--cat-personal: #8E7BA8;   /* training, rest, personal */
--cat-deadline: #B08A4A;   /* hard dates */
```

Each has a `-weak` variant at 13 percent alpha and a `-border` variant at 40 percent alpha.

### 3.3 Typography

```css
--font-sans: "Geist", "Inter", -apple-system, system-ui, sans-serif;
--font-mono: "Geist Mono", "JetBrains Mono", monospace;
```

Anthropic's own face is a custom typeface and is not licensable, so Geist is the stand-in. Bundle the woff2 files locally in `src/assets/fonts`, do not load from a CDN, because the app must work offline.

The complete scale. Nothing outside this list may appear anywhere in the app.

| Token | Size | Weight | Tracking | Use |
| --- | --- | --- | --- | --- |
| `--fs-micro` | 10px | 500 | 0.06em, uppercase | Section labels, day headers, time gutter, axis labels |
| `--fs-meta` | 11px | 400 | 0 | Block titles, chat body, list rows, most of the app |
| `--fs-body` | 12px | 400 | 0 | Inputs, inspector fields, settings |
| `--fs-title` | 13px | 500 | 0 | Panel headers, current month, view titles |
| `--fs-display` | 15px | 500 | 0 | Momentum score readout only |

Weights: 400 and 500 only. Never 600, never 700.
Line height: 1.25 inside blocks and dense rows, 1.5 for chat and paragraph text.
`font-variant-numeric: tabular-nums` is applied globally on `:root`. Every time, duration, count, and score must sit on the same vertical rhythm.

### 3.4 Geometry

- 4px base grid. Every margin, padding, gap, and fixed height is a multiple of 4.
- Radius: 4px on blocks and chips, 6px on controls and inputs, 8px on panels and popovers. Never any other value.
- Borders 1px, using the alpha tokens. No `box-shadow` anywhere except a focus ring.
- Focus ring: `box-shadow: 0 0 0 1px var(--accent-border)`, never a browser default outline.

### 3.5 Motion

- Standard transition: 140ms `cubic-bezier(0.2, 0, 0, 1)`.
- Hover states: 80ms.
- Nothing animates longer than 200ms. No spring physics, no bounce, no entrance animations on mount.
- `@media (prefers-reduced-motion: reduce)` disables all transitions.

### 3.6 Icons

- Lucide for UI, `simple-icons` for platform brand marks.
- Stroke width 1.5 everywhere, with no exceptions. Mixed stroke weights are the single fastest way to make a dense dark interface look amateur.
- Size 14px inside the calendar, block boxes, chat, and lists. 16px in the sidebar rail. Never any other size.
- An icon may only exist where it replaces a word, never where it decorates a word that is already there. Density is the goal, clutter is not.

### 3.7 Copy rules

Sentence case everywhere. No terminal punctuation on labels or buttons. Verb first on actions ("Add block", not "New block dialog"). Errors say what happened and what to do, in one sentence, with no "Error:" prefix. Empty states are an invitation, not an apology.

---

## 4. Layout

```
┌──────┬───────────────────────────────────────┬──────────────┐
│ rail │ view header (38px)                    │ panel header │
│ 52px ├───────────────────────────────────────┤   (38px)     │
│      │                                       ├──────────────┤
│      │              main view                │   AI panel   │
│      │                                       │  300-360px   │
│      │                                       │  resizable   │
│      │                                       ├──────────────┤
│      │                                       │  input (36px)│
└──────┴───────────────────────────────────────┴──────────────┘
```

**Rail**, 52px fixed, `--bg-rail`. Top to bottom: a 26px avatar square using `--accent` with the letter G, then icon buttons at 34x30px with 6px radius, then a spacer, then settings pinned to the bottom. Active item has `--bg-selected` and `--text-primary`, inactive is `--text-tertiary`. Tooltip on hover after 400ms, positioned right.

Rail items for v1, in order: Calendar (`calendar`), Momentum (`trending-up`), Settings (`settings`). Backlog, Content, and Analytics are reserved slots, do not build them.

**Main view**, fills remaining width. Contains the active view.

**AI panel**, right side, default 320px, resizable between 280 and 480px by dragging its left edge, width persisted to the store. Collapsible with `Cmd/Ctrl+.`.

Window minimum 1100x700. Below 1300px width the AI panel auto-collapses.

---

## 5. Blocks

### 5.1 Visual specification

A block is a **self-contained box**, not a bar with a colored edge. Structure:

```
┌────────────────────────────────┐
│ [icon]  Title text             │
│         09:00 - 10:30  ·  meta │
└────────────────────────────────┘
```

- Container: `--bg-surface` background, 1px `--border-hair`, 4px radius, 4px inset from the column edges.
- Icon slot: 20px wide, left aligned, containing a 14px icon tinted with the category color at full saturation. The icon is the platform mark when the block has one (X, LinkedIn, YouTube, Instagram, GitHub), otherwise the kind icon.
- Title: `--fs-meta`, `--text-primary`, single line, ellipsis on overflow.
- Meta line: `--fs-micro` without uppercase, `--text-secondary`, showing time range and up to one extra token.
- Category is expressed through the icon tint and a 13 percent alpha background wash of the category color, not through a left border. There is no left accent line anywhere in this app.

**Density tiers**, chosen by rendered height:

| Height | Layout |
| --- | --- |
| under 28px | Icon and title on one line, no meta |
| 28 to 56px | Icon left, title and meta stacked |
| over 56px | Icon left, title, meta, plus two lines of description |

**States**

| State | Treatment |
| --- | --- |
| Default | As above |
| Hover | Border to `--border`, background lightens by the `--bg-hover` overlay, cursor pointer |
| Selected | Border to `--accent-border`, background `--bg-selected` |
| Completed | Title `--text-tertiary` with strikethrough, icon at 50 percent opacity, whole box at 70 percent opacity |
| Overdue | Meta line switches to `--cat-deadline` |
| Dragging | 80 percent opacity, border `--border-strong` |

Every block is clickable. A single click selects it and opens the inspector. A double click enters inline title editing. `Enter` on a selected block toggles completion. `Delete` soft-deletes with a 5 second undo toast.

### 5.2 Block kinds and icons

| Kind | Default icon | Default category |
| --- | --- | --- |
| `task` | `circle-check` | build |
| `post` | platform mark, fallback `send` | content |
| `event` | `calendar` | admin |
| `focus` | `target` | build |
| `deadline` | `flag` | deadline |
| `note` | `file-text` | personal |

Platform marks for `post`, resolved from `payload.platform`: `x`, `linkedin`, `youtube`, `instagram`, `tiktok`, `github`, `blog` (falls back to `pen-line`).

### 5.3 Inspector

A right-side overlay panel inside the main view, 320px, `--bg-elevated`, appearing when a block is selected. Fields: title, kind, category, platform (only when kind is `post`), start, end, project, tags, status, description, recurrence rule, and a raw JSON editor collapsed behind a "Raw" disclosure. Closes on `Escape`.

---

## 6. Data model

All identifiers are UUIDv7 strings. All timestamps are integer milliseconds since the Unix epoch, in UTC. No local time strings are ever stored.

### 6.1 Core tables

```sql
CREATE TABLE blocks (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL,
  title         TEXT NOT NULL,
  description   TEXT,
  start_utc     INTEGER,
  end_utc       INTEGER,
  tz            TEXT NOT NULL DEFAULT 'Europe/Rome',
  all_day       INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'open',
  category      TEXT NOT NULL DEFAULT 'build',
  project_id    TEXT REFERENCES projects(id),
  parent_id     TEXT REFERENCES blocks(id),
  rrule         TEXT,
  recurrence_parent_id TEXT REFERENCES blocks(id),
  is_exception  INTEGER NOT NULL DEFAULT 0,
  payload       TEXT NOT NULL DEFAULT '{}',
  sort_order    REAL NOT NULL DEFAULT 0,
  created_utc   INTEGER NOT NULL,
  updated_utc   INTEGER NOT NULL,
  completed_utc INTEGER,
  deleted_utc   INTEGER,
  hlc           TEXT NOT NULL,
  device_id     TEXT NOT NULL
);

CREATE INDEX idx_blocks_range ON blocks(start_utc, end_utc) WHERE deleted_utc IS NULL;
CREATE INDEX idx_blocks_status ON blocks(status) WHERE deleted_utc IS NULL;
CREATE INDEX idx_blocks_project ON blocks(project_id) WHERE deleted_utc IS NULL;
```

`kind` is one of `task | post | event | focus | deadline | note`.
`status` is one of `open | in_progress | done | cancelled`.
`category` is one of `build | content | admin | personal | deadline`.
`payload` is JSON, holding kind-specific fields such as `platform`, `url`, `assetPath`, `publishState`.
A block with `start_utc IS NULL` is unscheduled and lives in the backlog.

```sql
CREATE TABLE projects (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0, sort_order REAL NOT NULL DEFAULT 0,
  created_utc INTEGER NOT NULL, updated_utc INTEGER NOT NULL,
  deleted_utc INTEGER, hlc TEXT NOT NULL, device_id TEXT NOT NULL
);

CREATE TABLE tags (
  id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE,
  created_utc INTEGER NOT NULL, deleted_utc INTEGER,
  hlc TEXT NOT NULL, device_id TEXT NOT NULL
);

CREATE TABLE block_tags (
  block_id TEXT NOT NULL, tag_id TEXT NOT NULL,
  PRIMARY KEY (block_id, tag_id)
);
```

### 6.2 Occurrence cache

Recurrence is never expanded at query time. A background job materializes occurrences for a rolling 18 month window and rebuilds whenever an rrule changes.

```sql
CREATE TABLE occurrences (
  id TEXT PRIMARY KEY,
  block_id  TEXT NOT NULL REFERENCES blocks(id),
  start_utc INTEGER NOT NULL,
  end_utc   INTEGER NOT NULL,
  generated_utc INTEGER NOT NULL
);
CREATE INDEX idx_occ_range ON occurrences(start_utc, end_utc);
```

A moved or skipped instance becomes a real row in `blocks` with `recurrence_parent_id` set and `is_exception = 1`, and is excluded from the generated set.

### 6.3 Operation log

Every mutation appends one row per changed field. This gives undo, an honest activity history, and the substrate for future device sync, at a cost of a few hours of work now.

```sql
CREATE TABLE ops (
  id         TEXT PRIMARY KEY,
  entity     TEXT NOT NULL,
  entity_id  TEXT NOT NULL,
  field      TEXT NOT NULL,
  old_value  TEXT,
  new_value  TEXT,
  hlc        TEXT NOT NULL,
  device_id  TEXT NOT NULL,
  created_utc INTEGER NOT NULL,
  synced     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_ops_unsynced ON ops(synced, hlc);
```

Field level, not row level. Row level logging means an edit to a title on one device and an edit to a time on another loses one of the two.

### 6.4 Sync-ready primitives

These cost nothing now and are expensive to retrofit, so they exist from migration 001.

- **UUIDv7** primary keys. Time sortable, so index locality is preserved.
- **Hybrid logical clock** stored as `hlc` in the form `{wallMs}:{counter}:{deviceId}`, monotonic, never moving backwards even when the system clock does.
- **Tombstones**. `deleted_utc` is set, rows are never physically removed. Every read goes through a view or a helper that filters them out.
- **`devices`** and **`sync_state`** tables exist and stay empty in v1.

```sql
CREATE TABLE devices (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, platform TEXT NOT NULL,
  last_seen_utc INTEGER NOT NULL
);
CREATE TABLE sync_state (
  device_id TEXT PRIMARY KEY, last_acked_hlc TEXT, last_sync_utc INTEGER
);
```

### 6.5 Search

```sql
CREATE VIRTUAL TABLE blocks_fts USING fts5(
  title, description, content='blocks', content_rowid='rowid'
);
```

Kept in sync by `AFTER INSERT`, `AFTER UPDATE`, and `AFTER DELETE` triggers on `blocks`.

---

## 7. Query discipline

**The frontend never loads the whole dataset. It loads a viewport.**

Every calendar read is bounded:

```sql
SELECT * FROM blocks
WHERE deleted_utc IS NULL
  AND start_utc < :window_end
  AND end_utc   > :window_start;
```

The visible range is fetched plus one screen of buffer on each side. Adjacent ranges are prefetched on idle. Everything outside is evicted.

At month, quarter, and year zoom the app does not fetch blocks at all. It fetches aggregates (count and total minutes grouped by day) computed in SQL. A year of individual blocks is unreadable anyway, so the visual design and the performance strategy agree.

All data access goes through `src/db/repository.ts`. No component ever issues SQL. The repository exposes typed functions returning domain objects, and it is the only place that knows SQL exists.

---

## 8. Momentum

### 8.1 Concept

Momentum is a single number measuring sustained output. It rises with weighted completed activity, decays without it, and compounds with consistency. It is deterministic and fully recomputable from the activity log, so changing a weight retroactively rewrites the whole curve.

### 8.2 Math

Daily raw score, where `count` is the number of units logged that local day and `cap` prevents gaming:

```
S(d) = Σ  min(count_i(d), cap_i) × weight_i
```

Streak, in consecutive local days where `S(d) >= 3`:

```
K(d) = 1 + min(streak(d), 60) × 0.005      capped at 1.30
```

Momentum, an exponentially weighted accumulation with daily decay `λ = 0.92`:

```
M(d) = λ × M(d-1) + S(d) × K(d)
M(first day) = S × K
```

Consequences worth knowing, because they are what makes the number meaningful:

- Half-life of inactivity is `ln(0.5) / ln(0.92) ≈ 8.3 days`. Stop for a week and you lose roughly half.
- Steady state under a constant daily score is `M∞ = S / (1 - λ) = 12.5 × S`. A sustained 16 points a day converges to a momentum of 200.
- The compounding is real but bounded. The streak multiplier tops out at 30 percent, so consistency is rewarded without letting the number run away.

`λ`, the streak cap, the streak increment, and the `S >= 3` threshold are all stored in settings and editable.

### 8.3 Levels

| Band | Range | Label |
| --- | --- | --- |
| 0 | under 25 | Dormant |
| 1 | 25 to 74 | Warming |
| 2 | 75 to 199 | Steady |
| 3 | 200 to 449 | Building |
| 4 | 450 to 899 | Compounding |
| 5 | 900 and above | Peak |

### 8.4 Schema

```sql
CREATE TABLE activity_types (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  icon TEXT NOT NULL,
  category TEXT NOT NULL,
  weight REAL NOT NULL,
  daily_cap INTEGER NOT NULL DEFAULT 999,
  unit TEXT NOT NULL DEFAULT 'count',
  archived INTEGER NOT NULL DEFAULT 0,
  sort_order REAL NOT NULL DEFAULT 0,
  created_utc INTEGER NOT NULL, updated_utc INTEGER NOT NULL,
  deleted_utc INTEGER, hlc TEXT NOT NULL, device_id TEXT NOT NULL
);

CREATE TABLE activity_log (
  id TEXT PRIMARY KEY,
  activity_type_id TEXT NOT NULL REFERENCES activity_types(id),
  local_date TEXT NOT NULL,          -- 'YYYY-MM-DD' in the user's zone
  count REAL NOT NULL DEFAULT 1,
  source TEXT NOT NULL DEFAULT 'manual',   -- manual | block | import
  block_id TEXT REFERENCES blocks(id),
  note TEXT,
  created_utc INTEGER NOT NULL, updated_utc INTEGER NOT NULL,
  deleted_utc INTEGER, hlc TEXT NOT NULL, device_id TEXT NOT NULL
);
CREATE INDEX idx_activity_date ON activity_log(local_date) WHERE deleted_utc IS NULL;

CREATE TABLE momentum_daily (
  local_date TEXT PRIMARY KEY,
  raw_score REAL NOT NULL,
  multiplier REAL NOT NULL,
  momentum REAL NOT NULL,
  streak INTEGER NOT NULL,
  computed_utc INTEGER NOT NULL
);
```

`momentum_daily` is a pure cache. It is rebuilt from `activity_log` by a single deterministic function, and it is fully invalidated whenever any weight, cap, or constant changes. Never treat it as a source of truth.

### 8.5 Default activity types

Seeded on first run. All values user-editable afterwards.

| Name | Icon | Category | Weight | Daily cap |
| --- | --- | --- | --- | --- |
| X reply | `x` (brand) | content | 1 | 20 |
| X post | `x` (brand) | content | 3 | 10 |
| LinkedIn comment | `linkedin` | content | 2 | 15 |
| LinkedIn post | `linkedin` | content | 8 | 5 |
| Instagram story | `instagram` | content | 3 | 10 |
| Instagram reel | `instagram` | content | 12 | 5 |
| TikTok post | `tiktok` | content | 10 | 5 |
| YouTube short | `youtube` | content | 20 | 5 |
| YouTube long form | `youtube` | content | 45 | 3 |
| Blog or Render Journal article | `pen-line` | content | 30 | 3 |
| GitHub commit | `github` | build | 2 | 10 |
| Feature shipped | `package` | build | 25 | 5 |
| App or product launched | `rocket` | build | 100 | 2 |
| Bug fixed | `bug` | build | 3 | 10 |
| Cold outreach or DM | `send` | admin | 2 | 20 |
| Resume or portfolio update | `file-user` | admin | 10 | 2 |
| Study session | `book-open` | admin | 5 | 4 |
| Training session | `dumbbell` | personal | 5 | 2 |

Calibration check with these defaults: a normal day of one LinkedIn post, three commits, and two X replies scores 16, converging to a momentum near 200, which is the bottom of "Building". A day with a long form video, a post, and commits scores about 60, converging near 750. That is the intended shape.

### 8.6 Auto-logging

Completing a block with `kind = 'post'` and a `payload.platform` automatically inserts an `activity_log` row with `source = 'block'` and `block_id` set, matching the activity type by platform and format. Un-completing it soft-deletes that row. Auto-logged rows are visually marked in the log and can be manually overridden.

### 8.7 Momentum view

Rail item two. Composed of, top to bottom:

1. **Header strip.** Current momentum at `--fs-display`, level label, delta versus 7 days ago with an up or down arrow tinted `--cat-admin` or `--cat-deadline`, current streak in days.
2. **Momentum curve.** Hand-written SVG, last 90 days by default with 30 / 90 / 365 toggles. A 1.5px `--accent` line over a 13 percent alpha fill, daily raw score as faint 1px bars behind it in `--border`, hairline horizontal gridlines at the level thresholds labelled at `--fs-micro`. Hover shows a vertical hairline and a small `--bg-elevated` readout with date, raw score, and momentum.
3. **Contribution breakdown.** Horizontal stacked bar of the last 30 days by category, plus a table of activity types sorted by total points contributed, with count, weight, and points columns.
4. **Consistency heatmap.** 52 weeks by 7 days, 9px cells with 2px gaps, 5 opacity steps of `--accent` keyed to raw score quintiles. Empty days are `--bg-surface`.
5. **Quick log strip.** Pinned at the bottom. A row of the eight most-used activity types as icon buttons. One click logs one unit for today with a brief count animation. This is the primary logging path and must be fast.

### 8.8 Momentum settings

Inside the Settings view. A dense editable table of activity types: name, icon picker, category, weight, daily cap, archive toggle, plus an add row. Below it, the constants `λ`, streak increment, streak cap, and streak threshold. Any change triggers a full deterministic recompute of `momentum_daily` with a progress indicator. Recompute over ten years of data must complete in under two seconds.

---

## 9. AI panel

Right panel, two modes sharing one surface.

**Summary mode**, default. Sections at `--fs-micro` uppercase labels with `--fs-meta` body: Today, At risk, Momentum. Regenerated on demand via the refresh icon and automatically once per app launch. Cached with a timestamp, never regenerated on every render.

**Chat mode**, entered by typing in the input. Message list with user turns right-aligned in `--bg-elevated` and assistant turns left-aligned with no bubble. Streaming responses.

Context contract: the panel serializes the current visible range plus today's blocks, the last 7 days of momentum, and open overdue items into a compact JSON payload under 4000 tokens, sent as the system context. It never sends the whole database.

The API key is stored via `tauri-plugin-store` in the OS app data directory, entered in Settings, never committed and never hardcoded. Calls go to `api.anthropic.com` with `claude-sonnet-4-6`. If no key is present, the panel shows an empty state pointing at Settings, and the rest of the app works normally.

---

## 10. Keyboard

| Shortcut | Action |
| --- | --- |
| `Ctrl+Shift+Space` | Global quick capture (works when app is unfocused) |
| `Ctrl+K` | Command palette |
| `Ctrl+F` | Search |
| `Ctrl+.` | Toggle AI panel |
| `T` | Jump to today |
| `1` `2` `3` | Day, week, month |
| `←` `→` | Previous, next period |
| `Enter` | Toggle completion on selected block |
| `Delete` | Soft-delete selected block |
| `Escape` | Close inspector or overlay |
| `Ctrl+Z` / `Ctrl+Shift+Z` | Undo, redo via the ops log |

Quick capture parses natural language: `post friday 9am linkedin parenting DAG` produces a scheduled LinkedIn post block. Tokens: `#tag`, `@project`, `!high`, plus date and time phrases. Unparsed text becomes the title.

---

## 11. Backups

- WAL mode on, `synchronous = NORMAL`.
- Nightly at 03:00 local and on demand: `VACUUM INTO` a dated snapshot in `backups/`, keeping the last 30.
- Nightly export to `export/` as one Markdown file per month plus `projects.json`, `activity.json`, and `momentum.json`. If the folder is a git repository, commit with the date as the message.
- The export is one-directional. Markdown is never read back in as a source of truth. Manual edits happen in the app, in the raw JSON editor, or in a SQLite browser.
- Never place the live database in a cloud-synced folder. That corrupts WAL databases.

---

## 12. File structure

```
src/
  main.tsx
  App.tsx
  styles/
    tokens.css            all custom properties, the only place values are defined
    global.css
  domain/                 pure TypeScript, no React, no Tauri, no DOM imports
    block.ts              types, factories, invariants
    recurrence.ts         rrule wrapping, occurrence generation
    time.ts               utc, zone, range math
    momentum.ts           scoring engine, fully pure and unit tested
    hlc.ts                hybrid logical clock
    id.ts                 uuidv7
  db/
    client.ts             connection, WAL pragma
    migrations/001_init.sql
    repository.ts         the only file containing SQL
    ops.ts                op log writer, undo and redo
  components/
    AppShell.tsx  Rail.tsx  Splitter.tsx
    Block.tsx  Inspector.tsx  Toast.tsx
    ui/                   Button, Input, Select, Tooltip, Popover
  views/
    calendar/  WeekView.tsx  DayView.tsx  MonthView.tsx  TimeGutter.tsx  NowLine.tsx
    momentum/  MomentumView.tsx  MomentumChart.tsx  Heatmap.tsx  QuickLog.tsx  Breakdown.tsx
    settings/  SettingsView.tsx  ActivityTypeTable.tsx
  panel/      AiPanel.tsx  Summary.tsx  Chat.tsx  context.ts
  capture/    QuickCapture.tsx  parser.ts
  scheduler/  tick.ts  reminders.ts  materialize.ts
  store/      useUiStore.ts  useBlocks.ts  useMomentum.ts
src-tauri/
  src/main.rs             plugin registration, tray, windows, only
```

`domain/` must stay importable by a future mobile client. If a file in `domain/` imports React, the DOM, or Tauri, that is a bug.

---

## 13. Invariants

A change that violates any of these is wrong, regardless of how well it works.

1. No raw hex, `rgb()`, or arbitrary Tailwind value in any component. Tokens only.
2. Font sizes are only 10, 11, 12, 13, 15px. Weights are only 400 and 500.
3. All spacing is a multiple of 4.
4. Radii are only 4, 6, 8.
5. No `box-shadow` except the focus ring. Hairline borders instead.
6. Icons are stroke 1.5, size 14 or 16 only.
7. All numeric and time text uses tabular numerals.
8. No component contains SQL. Everything goes through the repository.
9. Nothing in `domain/` imports React, DOM, or Tauri.
10. No hard `DELETE`. Tombstones only.
11. No autoincrement integer keys. UUIDv7 only.
12. No unbounded query. Every calendar read is range bounded.
13. Blocks are boxes with a leading icon. No left accent border anywhere in the app.
14. Momentum is always recomputable from `activity_log`. The cache is never authoritative.
