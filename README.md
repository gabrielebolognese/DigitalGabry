# DigitalGabry

DigitalGabry is a local-first desktop planner for one person. It combines a week calendar of time blocks, a content workspace for drafting X, LinkedIn, Instagram and YouTube posts, a rule-based schedule generator that lays out posting slots, and a momentum score computed from the work that was actually completed. Everything is stored in a SQLite file on your own machine: there is no account, no sync and no hosted database, and the app works offline. An Anthropic API key is optional and only powers the assistant panel and LinkedIn image generation.

A block is any unit of committed time or work: a `task`, `post`, `event`, `focus` session, `deadline` or `note`.

## Features

### Calendar

- Week grid with a time gutter and a "now" line; drag on empty space to create a block, drag to move, drag an edge to resize, Ctrl + scroll to zoom the hour height.
- Blocks have a kind (sets the icon), a category (`build`, `content`, `admin`, `personal`, `deadline`, sets the tint) and a status (`open`, `in progress`, `done`, `cancelled`). A post can carry a platform (`x`, `linkedin`, `youtube`, `instagram`, `tiktok`, `github`, `blog`).
- Inspector panel for editing the selected block, inline rename, keyboard navigation and an undo toast on delete.
- Recurring blocks from an iCalendar RRULE typed as text, materialized over a rolling 18 month window. Editing or deleting an instance asks whether it applies to this occurrence, this and future, or the whole series.
- Layers popover and ghost slots that show generated schedule slots on the calendar, with a slot picker and an explainer for why a slot is where it is.

### Quick capture and command palette

- Global shortcut `Ctrl/Cmd + Shift + Space` opens a small always-on-top capture window, even when the app is unfocused. One line is parsed as you type: `#tag`, `@project`, `!low|!normal|!high`, a leading kind keyword, a platform name, a day (`today`, `tomorrow`, `friday`) and a time (`14:30`, `9am`).
- `Ctrl/Cmd + K` command palette with fuzzy search across blocks, views and actions (go to today, toggle assistant panel, undo, redo, back up now, export now).
- Undo and redo walk a field-level change log stored in the database, so they survive a restart.

### Content workspace

- One Content view with a tab per platform (X, LinkedIn, Instagram, YouTube) and a shared status pipeline: idea, draft, ready, scheduled, posted, archived, plus scripted, filmed and edited for produced formats.
- X editor with a live character counter: a hard limit of 280 and a configurable soft target (default 150).
- LinkedIn editor that sends the post text to the Anthropic Messages API, validates the returned image spec with zod, and renders it locally through React templates (headline, headline and bullets, code, metric, split) to a 1080 x 1350 PNG. The system prompt is editable in Settings.
- Instagram editor for reels, carousels and stories: a script split into hook, context, body, payoff and CTA sections with duration estimates, b-roll notes and references, and a "send to phone" action that writes the script to the outbox and the clipboard.
- YouTube is a deliberate shell that uses only the shared editor; no YouTube-specific fields exist yet.
- "Post this" copies the text to the clipboard, stages the image in an outbox folder under a readable name, reveals it in the file manager and opens the X composer or the LinkedIn feed. It does not call any platform's posting API.
- Images live in a content-addressed asset vault (sha256 file names) on disk, never in SQLite. Content items link to calendar blocks instead of duplicating them, and marking an item as posted logs momentum once.

### Schedule generation

- Schedule view for defining rules that generate posting slots, with a weekly grid editor, a preview strip, an impact dialog shown before a change that affects filled or overridden slots, and a fill panel that assigns ready content to open slots.
- A pure, deterministic generation engine with a registry of rule kinds: weekly grid, daily times, interval, spread, quota, rrule, cron, pattern, relative, rotation, derived, deadline backfill, gap fill, batch production, conditional and manual set.
- Modifiers applied on top of the rules: blackout, capacity, spacing, jitter, snap and collision.
- Rules are versioned, slots are computed rather than stored (only overrides and bindings persist), and generators never modify user-created blocks.
- Starter presets that are seeded disabled: Creator daily, Build in public, Student schedule, Minimal and Agency.

### Momentum

- A weighted score that decays daily, with a streak multiplier and named levels, folded from an activity log by a pure function so it can always be recomputed.
- Chart over 30, 90 or 365 days, breakdown by activity type, daily heatmap and a quick-log bar.
- Activity types, their weights and the momentum constants are editable in Settings; changing them recomputes the whole curve.

### Assistant panel

- Resizable side panel (`Ctrl/Cmd + .`) that shows a summary of the week and a streaming chat about your calendar, using the Anthropic Messages API directly from the app. Without an API key it shows an empty state and the rest of the app is unaffected.

### Backups, export and import

- Nightly jobs after 03:00 local time, also runnable on demand: a dated SQLite snapshot in the backup folder (30 kept by default, configurable) and an export of one Markdown file per month plus `projects.json`, `activity.json` and `momentum.json`.
- If the export folder is a git repository, the app stages and commits the export; otherwise that step is skipped.
- Import blocks from a Markdown or CSV file; bad rows are reported and skipped.

### Desktop integration

- System tray with Open, Quick capture and Quit. Closing the main window hides it to the tray so the global shortcut keeps working.
- Reminders through native notifications.

## Getting started

### Prerequisites

- Node.js and npm
- The [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/): the Rust toolchain and the build tools for your platform
- `git` on the PATH only if you want the export folder to be committed automatically

### Download

```bash
git clone https://github.com/gabrielebolognese/DigitalGabry.git
cd DigitalGabry
```

### Install dependencies

```bash
npm install
```

The Rust crates are fetched by Cargo the first time the desktop app is built.

### Configuration

There is no `.env` file and no required environment variable. The optional Anthropic API key is entered in the app under Settings and is kept in the Tauri store in the OS application data folder, not in the database or the repository. Backup, export and outbox folders, the X soft limit, the LinkedIn system prompt, activity types and momentum constants are also set in Settings.

### Run in development

```bash
npm run tauri dev
```

This starts Vite on `http://localhost:1420` and opens the desktop window with hot reload. `npm run dev` starts the frontend alone in a browser, without Rust; the features that depend on Tauri (database, tray, global shortcut, file access) are not available there.

## Build and install

```bash
npm run tauri build
```

This runs `npm run build` (TypeScript check, then a Vite build into `dist/`) and bundles the app for the current platform. Bundle targets are set to `all`, so Tauri produces the installer formats available on the platform you build on, under `src-tauri/target/release/bundle/`. Install the app by running the generated installer. No prebuilt releases are published in this repository.

The database (`digitalgabry.db`), the asset vault and the default backup, export and outbox folders live in the OS application data directory for the identifier `com.digitalgabry.app`. Do not move the live database into a cloud-synced folder; point the backup folder at cloud storage instead.

## Usage

The rail on the left switches between five views: Calendar, Content, Schedule, Momentum and Settings.

| Shortcut | Action |
| --- | --- |
| `Ctrl/Cmd + Shift + Space` | Open quick capture from anywhere |
| `Ctrl/Cmd + K` | Command palette |
| `Ctrl/Cmd + .` | Show or hide the assistant panel |
| `T` | Jump to today |
| Left / Right arrow | Previous or next week when nothing is selected |
| `Enter` | Toggle the selected block between open and done |
| `Delete` | Delete the selected block, with undo |
| `Escape` | Cancel a rename or close the inspector |

### Scripts and commands

| Command | What it does |
| --- | --- |
| `npm run tauri dev` | Run the desktop app with hot reload |
| `npm run tauri build` | Build the installable desktop app |
| `npm run dev` | Run the frontend only, in a browser |
| `npm run build` | Typecheck and build the frontend into `dist/` |
| `npm run preview` | Serve the built frontend with Vite |
| `npx tsc --noEmit` | Typecheck only |
| `npx vitest run` | Run the unit tests once |
| `npx vitest` | Run the unit tests in watch mode |
| `node scripts/seed.mjs [count] [outfile]` | Write a deterministic SQL fixture of blocks (50,000 by default, to `scripts/seed-blocks.sql`) for benchmarking range queries |

## Project structure

```
src/domain/             pure rules: blocks, time, recurrence, momentum, content, ids
src/domain/generation/  schedule generation engine, rule kinds, modifiers, presets
src/db/                 SQLite client, repository (the only SQL), change log, migrations
src/store/              React hooks over the repository
src/views/              calendar, content, schedule, momentum and settings screens
src/components/         app shell, rail, inspector, command palette, shared UI
src/capture/            quick capture window and its line parser
src/content/            "post this" flow and the LinkedIn image pipeline
src/panel/              assistant panel and the Anthropic API client
src/scheduler/          reminders, nightly jobs, recurrence materialization
src/backup/             backup, export and import
src/vault/              content-addressed asset vault and outbox
src/styles/             design tokens and global CSS
src-tauri/              Tauri shell: windows, tray, file and git commands
scripts/seed.mjs        benchmark fixture generator
```

## Tech stack

| Concern | Choice |
| --- | --- |
| Shell | Tauri v2 (Rust) |
| Frontend | React 19, TypeScript (strict) |
| Build | Vite 7 |
| Styling | Tailwind CSS v4 |
| Database | SQLite through `tauri-plugin-sql` |
| Tauri plugins | sql, store, dialog, notification, global-shortcut, clipboard-manager, opener |
| Validation | zod |
| Dates and recurrence | `date-fns`, `date-fns-tz`, `rrule` |
| Image rendering | `modern-screenshot` |
| Icons | `lucide-react`, `@icons-pack/react-simple-icons` |
| Charts | Hand-written SVG |
| AI | Anthropic Messages API over `fetch`, no SDK |
| Tests | Vitest |

## Further documentation

- [`SPEC.md`](SPEC.md): the original product specification
- [`Spec2.md`](Spec2.md): the content surfaces (X, LinkedIn, Instagram, YouTube)
- [`Spec1.1.md`](Spec1.1.md): the schedule generation layer
- [`PLAN.md`](PLAN.md): the phase-by-phase build plan, including corrections to the specs
- [`GUIDE.md`](GUIDE.md): user guide for the calendar, quick capture, command palette, momentum, settings and backups. It predates the Content and Schedule views and does not cover them.
- [`CLAUDE.md`](CLAUDE.md): working rules and the style and architecture invariants for contributors

## Status

A personal tool built for a single user, at version 0.1.0. All phases in `PLAN.md` are merged; the YouTube surface is intentionally a shell awaiting its own specification. There is no CI, no published release and no license file in this repository.
