# DigitalGabry

A local-first desktop calendar and momentum tracker. Tauri v2, React, TypeScript, SQLite.

`SPEC.md` is the contract. `PLAN.md` is the phase sequence. Read both before writing code. If something is not defined in `SPEC.md`, stop and ask rather than inventing it.

**Current phase: 8, AI panel.** Update this line when a phase merges. One branch per phase named `phase-NN-slug`, one commit, and a cleared context before the next one.

## Commands

```bash
npm run tauri dev        # run the app, requires the Rust toolchain
npm run dev              # frontend only in a browser, no Rust needed
npm run build            # typecheck and build the frontend
npx tsc --noEmit         # typecheck only
npx vitest run           # every unit test
npx vitest run src/domain/momentum.test.ts   # one file
npx vitest run -t "streak multiplier"        # one test by name
npx vitest                                   # watch mode
```

## Working rules

- Implement only the current phase from `PLAN.md`. Never build ahead.
- Prefer editing existing files over creating new ones.
- No new dependency without asking first. The stack in `SPEC.md` section 2 is fixed.
- No comments explaining what code does. Comments only for why a non-obvious decision was made.
- Strict TypeScript. No `any`, no `@ts-ignore`, no non-null assertions without a comment justifying them.
- When a value is not specified in `SPEC.md`, that is a spec gap. Say so, propose a value, and wait.

## Style invariants

These are absolute. A change that violates one is wrong regardless of whether it works.

1. **No raw color values in components.** No hex, no `rgb()`, no `rgba()`, no arbitrary Tailwind values. Only tokens from `src/styles/tokens.css`.
2. **Font sizes:** only 10, 11, 12, 13, 15px, via the `--fs-*` tokens. Never larger.
3. **Font weights:** only 400 and 500. Never 600 or 700.
4. **Spacing:** every margin, padding, gap, and fixed dimension is a multiple of 4.
5. **Radius:** only 4px (blocks, chips), 6px (controls), 8px (panels). No other value.
6. **Borders:** 1px, alpha-white tokens only, never solid grey. No `box-shadow` anywhere except the focus ring.
7. **Icons:** lucide or simple-icons, stroke width 1.5, size 14px in content or 16px in the rail. No other size or weight.
8. **Numerals:** all time, duration, count, and score text uses tabular numerals.
9. **Motion:** 140ms `cubic-bezier(0.2, 0, 0, 1)` standard, 80ms hover, nothing over 200ms. No springs, no entrance animations.
10. **Blocks are boxes with a leading icon.** No left accent border. Not anywhere, not on any element.
11. **Icons replace words, they do not decorate them.** Density is the goal, clutter is not.
12. **Copy:** sentence case, no terminal punctuation on labels, verb first on actions.

## How it fits together

```
views/ + components/  →  store/ hooks (useBlocks, useMomentum, useUiStore)
                      →  db/repository.ts (the only SQL)  →  SQLite
                              └─ db/ops.ts writes field-level ops in the same transaction
domain/   pure. Imported by everything, imports nothing from the app.
```

- Reads are viewport driven. `useBlocks(range)` fetches the visible range plus one screen of buffer. At month, quarter, and year zoom the app fetches SQL aggregates, never blocks.
- Recurrence: `domain/recurrence.ts` generates, `scheduler/materialize.ts` writes the `occurrences` table over a rolling 18 month window. An exception is a real `blocks` row with `recurrence_parent_id` set and `is_exception = 1`, excluded from the generated set.
- Momentum: `activity_log` is the truth, `momentum_daily` is a cache produced by the pure fold in `domain/momentum.ts`. Any weight or constant change means a full recompute.
- Undo and redo walk the `ops` table, not a React state stack.

## Architecture invariants

1. Nothing in `src/domain/` imports React, the DOM, or Tauri. It must stay portable to a future mobile client.
2. No SQL outside `src/db/repository.ts`.
3. All IDs are UUIDv7. Never autoincrement integers.
4. All timestamps are UTC epoch milliseconds plus a separate IANA zone column. Never local time strings.
5. No hard `DELETE`. Set `deleted_utc` and filter on read.
6. Every mutation writes field-level rows to the `ops` table inside the same transaction.
7. Every calendar read is range bounded. No unbounded queries, ever.
8. Recurrence is materialized into the `occurrences` table, never expanded at query time.
9. `momentum_daily` is a cache. It must always be reproducible from `activity_log` by a pure function.
10. The app must work fully offline, and must work with no API key configured.

## Self-check before saying a phase is done

```bash
rg -n '#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(' src --glob '!**/tokens.css'  # must be empty
rg -n 'box-shadow' src --glob '!**/tokens.css' --glob '!**/global.css'   # must be empty
rg -n 'font-weight:\s*[67]00|font-(semibold|bold)' src                   # must be empty
rg -ni 'select .*from|insert into|update .*set |delete from' src --glob '!src/db/**'  # must be empty
rg -n "from 'react'" src/domain                                          # must be empty
npx tsc --noEmit                                                         # must pass
npx vitest run                                                           # must pass
```

Then confirm every acceptance criterion in the phase is met, and say which ones you verified and how.
