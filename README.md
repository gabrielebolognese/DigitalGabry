# DigitalGabry

A local-first desktop planner: a calendar with a timeline of blocks, plus a momentum score of everything actually completed.

A block is any unit of committed time or work: a task, a post to publish, an event, a focus session, a deadline or a note. It is built for one user, and the data stays on disk with no cloud dependency.

## Goals

1. Capturing something takes under 3 seconds.
2. The week is legible at a glance, at high density, without scrolling.
3. Data belongs to the user, on disk, with no hosted database.
4. Momentum is deterministic, recomputable and honest: a weighted, decaying score, so output over time shows as a curve.

## Stack

| Concern | Choice |
| --- | --- |
| Shell | Tauri v2 |
| Frontend | React 19, TypeScript (strict) |
| Build | Vite |
| Styling | Tailwind v4 |
| Database | SQLite through `tauri-plugin-sql` |
| Charts | Hand-written SVG |
| Dates and recurrence | `date-fns`, `date-fns-tz`, `rrule` |
| Tests | Vitest |

## Running it

You need Node and the [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/) (Rust and the platform build tools).

```bash
npm install
npm run tauri dev      # desktop app with hot reload
npm run tauri build    # installable build
```

## Code

```
src/domain/     blocks, momentum and content generation rules
src/db/         SQLite repositories and migrations
src/views/      calendar, schedule, momentum, content and settings screens
src/capture/    quick capture
src/scheduler/  reminders and scheduling
src/backup/     backups
src/vault/      vault storage
src-tauri/      the Tauri shell
```

## Documentation

- [`SPEC.md`](SPEC.md): the product specification and the source of truth, with later revisions in `Spec1.1.md` and `Spec2.md`
- [`PLAN.md`](PLAN.md): the build plan
- [`GUIDE.md`](GUIDE.md): how to use the app
