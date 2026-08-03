# DigitalGabry, specification 1.1: the generation layer

Extends `SPEC.md`. Sits between `SPEC.md` (the calendar and data core) and `Spec2.md` (content surfaces). Where documents conflict, `SPEC.md` wins on tokens and invariants, this document wins on scheduling semantics.

Build after Phase 11 of `PLAN.md`, since the assignment engine binds generated slots to content items.

---

## 1. Why this layer exists

A calendar stores what you decided. A schedule expresses what you always do. Storing "X post at 08:00, 12:00, 18:00, 22:00 every Monday" as four recurring blocks is technically possible and structurally wrong, for four reasons.

1. **Blocks are commitments, slots are intentions.** An empty 18:00 Monday slot is not a thing you owe anyone. It is a container waiting for content. Rendering it as a real block makes every unfilled slot look like a missed obligation.
2. **Rules change, history should not.** Moving your Monday slot from 08:00 to 09:00 must not retroactively rewrite what last month looked like.
3. **Storage.** Ten generators over ten years is roughly 150,000 rows of pure derivation. All of it is recomputable from a few dozen bytes of rule definition.
4. **Composition.** Real schedules are layered: a base weekly grid, minus a school-hours blackout, minus holidays, capped at four posts a day, with a promo rule that fires off the back of a video upload. Recurrence rules cannot compose. Generators can.

So: **generators produce slots, slots bind to content, binding materializes a block.** Only deviations are persisted.

---

## 2. Vocabulary

| Term | Definition |
| --- | --- |
| **Generator** | A rule that emits candidate slots over a time window. Pure and deterministic. |
| **Slot** | A generated time container with a platform or kind intent. Virtual by default. |
| **Slot key** | A stable identity for a slot across regenerations. |
| **Override** | A persisted deviation on one slot: skipped, moved, pinned, or bound. |
| **Binding** | A link from a slot to a content item or a block. |
| **Ruleset** | An ordered, named collection of generators and modifiers. |
| **Layer** | A generator's priority band, used for conflict resolution. |
| **Materialize** | Convert a slot into a real row in `blocks`. |
| **Window** | The `[start, end)` range currently being generated. |

### 2.1 Slot lifecycle

```
   virtual ──bind──▶ assigned ──commit──▶ materialized ──publish──▶ posted
      │                  │                     │
      ├──skip──▶ skipped │                     └──unbind──▶ virtual
      ├──move──▶ moved   │
      └──pin───▶ pinned ─┘
```

- **virtual**: generated, empty, not persisted anywhere.
- **assigned**: bound to a content item, persisted as a binding row.
- **materialized**: a real block exists. Happens automatically on binding, or manually via pin.
- **skipped**: dismissed for this occurrence only, persisted as an override.
- **moved**: shifted from its generated time, persisted as an override with the new time.
- **pinned**: frozen to a real block, so it stops tracking rule changes.

---

## 3. The determinism contract

This is the load-bearing property of the entire layer.

```
generate(ruleset, window, overrides, worldState) → Slot[]
```

must be **pure** and **stable**. Called twice with the same inputs, it returns byte-identical output in the same order. Consequences and requirements:

- No `Date.now()`, no `Math.random()`, no locale-dependent formatting inside generation. The current time is passed in as part of `worldState` when a rule needs it.
- Randomness comes only from a seeded PRNG keyed by `(generatorId, localDate, ordinal)`, so jitter is reproducible forever.
- Ordering is defined: sort by `startUtc`, then `layer` descending, then `generatorId`, then `ordinal`. Never rely on insertion or map iteration order.
- Generation for a window must not depend on data outside that window plus a bounded lookback. Declare the lookback per generator kind (`derived` needs 30 days, `deadline-backfill` needs 180). Unbounded lookback is forbidden, because it makes viewport generation impossible.

If a generator cannot be made deterministic, it does not belong in this layer. Put it behind a manual action instead.

---

## 4. Generator taxonomy

Every generator shares an envelope:

```ts
type Generator = {
  id: string;
  name: string;
  kind: GeneratorKind;
  enabled: boolean;
  layer: number;               // 0 = lowest priority, 100 = highest
  validFrom: number | null;    // UTC ms, null = always
  validTo: number | null;
  timezone: string;            // IANA, defaults to Europe/Rome
  emits: SlotIntent;           // what the produced slots mean
  config: unknown;             // kind specific, validated by zod
  color?: string;              // overrides the category color
};

type SlotIntent = {
  kind: BlockKind;             // post | focus | task | event | deadline | note
  platform?: Platform;         // x | linkedin | instagram | youtube | tiktok | blog
  category: Category;
  durationMinutes: number;
  titleTemplate?: string;      // "{platform} post {ordinal}/{dayTotal}"
  payloadDefaults?: Record<string, unknown>;
};
```

`titleTemplate` supports the tokens `{platform}`, `{ordinal}`, `{dayTotal}`, `{weekday}`, `{date}`, `{time}`, `{generator}`, `{project}`.

### 4.1 `weekly-grid`

Explicit times per weekday. This is the primary case, so its editor gets the best UI.

```json
{
  "kind": "weekly-grid",
  "emits": { "kind": "post", "platform": "x", "category": "content", "durationMinutes": 10 },
  "config": {
    "times": {
      "mon": ["08:00", "12:00", "18:00", "22:00"],
      "tue": ["09:00", "13:00", "19:00"],
      "wed": ["08:00", "12:00", "18:00", "22:00"],
      "thu": ["09:00", "13:00", "19:00"],
      "fri": ["08:00", "12:00", "17:00"],
      "sat": ["11:00", "20:00"],
      "sun": []
    }
  }
}
```

Times are local wall clock in the generator's timezone. An empty array means no slots that day. Times need not be sorted in storage, but generation always emits them sorted.

### 4.2 `daily-times`

Shorthand for the same list on every day, with optional weekday filtering.

```json
{ "kind": "daily-times",
  "config": { "times": ["09:00", "18:00"], "weekdays": ["mon","tue","wed","thu","fri"] } }
```

### 4.3 `interval`

Every N minutes inside a window.

```json
{ "kind": "interval",
  "config": { "everyMinutes": 180, "window": ["08:00", "22:00"],
              "weekdays": ["mon","wed","fri"], "alignTo": "window-start" } }
```

`alignTo`: `window-start | midnight | hour`.

### 4.4 `spread`

N slots per day, evenly distributed across a window. Distinct from `interval` in that the count is fixed and the gap is derived.

```json
{ "kind": "spread",
  "config": { "perDay": 4, "window": ["08:00", "22:00"],
              "distribution": "even", "includeEndpoints": true } }
```

`distribution`: `even | front-loaded | back-loaded | golden`. Front and back loaded use a quadratic easing over the window, which places posts denser at one end. `golden` places them at golden-ratio intervals, which reads as less mechanical.

### 4.5 `quota`

N slots per period, with eligibility rules and a placement strategy. Use this when the count matters and the exact time does not.

```json
{ "kind": "quota",
  "config": { "count": 3, "period": "week", "weekdays": ["mon","tue","wed","thu","fri"],
              "window": ["09:00", "17:00"], "placement": "spread-days",
              "minGapHours": 24 } }
```

`period`: `day | week | month`. `placement`: `spread-days | earliest | latest | free-space | balanced`. `free-space` inspects existing blocks and places slots in the largest gaps, which makes it the only quota mode requiring `worldState`.

### 4.6 `rrule`

Full RFC 5545 for anything calendar-shaped that the simpler kinds cannot express.

```json
{ "kind": "rrule",
  "config": { "rrule": "FREQ=MONTHLY;BYDAY=2TU;BYHOUR=10;BYMINUTE=0" } }
```

### 4.7 `cron`

For users who think in cron. Five-field standard syntax, evaluated in the generator's timezone.

```json
{ "kind": "cron", "config": { "expression": "0 8,12,18,22 * * 1" } }
```

### 4.8 `rotation`

Wraps another generator and cycles a list of intents across the slots it produces. This is how one time grid feeds several platforms.

```json
{ "kind": "rotation",
  "config": {
    "sourceGeneratorId": "gen_daily_slots",
    "cycle": [
      { "platform": "x" },
      { "platform": "x" },
      { "platform": "linkedin" },
      { "platform": "instagram" }
    ],
    "resetOn": "week"
  } }
```

`resetOn`: `never | day | week | month`. `never` means the cycle position derives from the absolute slot ordinal since `validFrom`, which stays deterministic across any window.

### 4.9 `pattern`

A repeating multi-day pattern, for on and off cycles.

```json
{ "kind": "pattern",
  "config": { "pattern": ["on","on","on","off"], "anchorDate": "2026-08-03",
              "onConfig": { "times": ["09:00","18:00"] } } }
```

The pattern index for any date is `floor(daysSince(anchorDate)) mod pattern.length`, which is deterministic for all dates including those before the anchor.

### 4.10 `relative`

Slots positioned by offset from an anchor found in the day, rather than by absolute time.

```json
{ "kind": "relative",
  "config": { "anchor": "first-block-of-day", "offsetMinutes": 120,
              "fallbackTime": "10:00", "weekdays": ["mon","tue","wed","thu","fri"] } }
```

`anchor`: `first-block-of-day | last-block-of-day | day-start | day-end | first-block-with-tag | largest-gap-start`. `fallbackTime` applies when the anchor is absent. Requires a one-day lookback.

### 4.11 `derived`

Fires off another item's existence. This is the most powerful kind and the reason the layer is worth building.

```json
{ "kind": "derived",
  "config": {
    "trigger": { "kind": "post", "platform": "youtube", "status": "posted" },
    "offsets": [
      { "minutes": 120,    "emits": { "platform": "x", "titleTemplate": "Promo: {trigger.title}" } },
      { "minutes": 1440,   "emits": { "platform": "linkedin" } },
      { "minutes": 10080,  "emits": { "platform": "x", "titleTemplate": "Resurface: {trigger.title}" } }
    ],
    "lookbackDays": 30
  } }
```

Negative offsets are legal and produce pre-promotion. Offsets resolve against the trigger's `startUtc` and are then subject to the same modifier pipeline as any other slot. `{trigger.*}` tokens are available in templates.

### 4.12 `deadline-backfill`

Works backwards from a deadline block, distributing preparation sessions.

```json
{ "kind": "deadline-backfill",
  "config": { "triggerTag": "exam", "sessions": 6, "sessionMinutes": 90,
              "spanDays": 14, "distribution": "back-loaded",
              "window": ["15:00","20:00"], "excludeWeekends": false } }
```

`back-loaded` concentrates sessions nearer the deadline, which matches how preparation actually works.

### 4.13 `gap-fill`

Fills free space up to a daily budget. The only generator that is inherently a function of the rest of the calendar.

```json
{ "kind": "gap-fill",
  "config": { "budgetMinutes": 240, "minChunkMinutes": 45, "maxChunkMinutes": 120,
              "window": ["09:00","19:00"], "weekdays": ["mon","tue","wed","thu","fri"],
              "strategy": "largest-first" } }
```

`strategy`: `largest-first | earliest-first | balanced`. Never fills a gap smaller than `minChunkMinutes`, so it does not produce useless fifteen minute fragments.

### 4.14 `batch-production`

For every N content slots in a period, emit one production block ahead of them.

```json
{ "kind": "batch-production",
  "config": { "perSlots": 6, "leadDays": 2, "durationMinutes": 180,
              "preferredWeekdays": ["sun"], "preferredTime": "14:00",
              "countScope": { "platform": "instagram" } } }
```

This closes the loop that most content calendars miss: the posts are scheduled but the time to make them is not.

### 4.15 `conditional`

A wrapper emitting the inner generator's slots only when a predicate holds.

```json
{ "kind": "conditional",
  "config": {
    "inner": { "kind": "daily-times", "config": { "times": ["20:00"] } },
    "predicate": { "all": [
      { "type": "no-block-with-tag", "tag": "travel" },
      { "type": "free-minutes-at-least", "window": ["18:00","23:00"], "minutes": 90 },
      { "type": "momentum-below", "value": 300 }
    ] }
  } }
```

Predicate types: `weekday-in`, `date-range`, `has-block-with-tag`, `no-block-with-tag`, `free-minutes-at-least`, `block-count-below`, `momentum-above`, `momentum-below`, `streak-at-least`, `content-ready-at-least`, `is-holiday`, `nth-week-of-month`, `parity` (odd or even weeks). Combinators: `all`, `any`, `not`.

`momentum-*` and `content-ready-*` predicates read `worldState`, which must be snapshotted once per generation pass so the result stays stable within a pass.

### 4.16 `manual-set`

An explicit list of datetimes. Exists so imported schedules and one-off campaigns live in the same system rather than as loose blocks.

```json
{ "kind": "manual-set",
  "config": { "datetimes": ["2026-09-01T09:00", "2026-09-03T18:30"] } }
```

---

## 5. Modifiers

Modifiers do not emit slots. They transform, filter, or constrain the emitted set. They carry a `stage` determining where they run in the pipeline.

### 5.1 `blackout` (stage: filter)

Removes any slot intersecting a window.

```json
{ "kind": "blackout",
  "config": {
    "windows": [
      { "weekdays": ["mon","tue","wed","thu","fri"], "range": ["08:00","14:00"], "label": "school" },
      { "weekdays": ["mon","tue","wed","thu","fri","sat","sun"], "range": ["23:30","07:00"], "label": "sleep" }
    ],
    "dateRanges": [{ "from": "2026-12-24", "to": "2027-01-06", "label": "holidays" }],
    "sourceCalendarTag": "school-ics",
    "mode": "remove",
    "appliesTo": { "platforms": ["x","linkedin"] }
  } }
```

`mode`: `remove | shift-out | shrink`. `shift-out` pushes the slot to the nearest edge of the blackout, which is often better than losing it. Windows crossing midnight are legal and split correctly.

### 5.2 `capacity` (stage: constrain)

Caps how many slots may exist in a scope, with a defined eviction policy.

```json
{ "kind": "capacity",
  "config": { "max": 4, "period": "day", "scope": { "platform": "x" },
              "eviction": "drop-lowest-layer" } }
```

`eviction`: `drop-lowest-layer | drop-latest | drop-earliest | drop-closest-pair | compress`. `compress` redistributes the surviving slots evenly across the day rather than leaving a gap where an evicted one was. Bound and pinned slots are never evicted.

### 5.3 `spacing` (stage: constrain)

Minimum gap between slots in a scope.

```json
{ "kind": "spacing",
  "config": { "minMinutes": 90, "scope": { "platform": "x" },
              "resolution": "shift-later", "maxShiftMinutes": 60 } }
```

`resolution`: `shift-later | shift-earlier | drop | allow`. If shifting would exceed `maxShiftMinutes`, fall back to `drop` and record the reason, which surfaces in the preview.

### 5.4 `jitter` (stage: transform)

Deterministic randomization, so a schedule does not look robotic.

```json
{ "kind": "jitter",
  "config": { "rangeMinutes": 20, "seed": "gabry-2026",
              "appliesTo": { "platforms": ["x"] }, "distribution": "uniform" } }
```

Seeded by `hash(seed, generatorId, localDate, ordinal)`. `distribution`: `uniform | normal`. Normal clusters near the nominal time with occasional larger deviations, which reads more human.

### 5.5 `snap` (stage: transform)

```json
{ "kind": "snap", "config": { "toMinutes": 15, "direction": "nearest" } }
```

`direction`: `nearest | up | down`. Runs after jitter, so jittered times still land on the grid if desired.

### 5.6 `collision` (stage: resolve)

How a slot behaves when it overlaps a real block.

```json
{ "kind": "collision",
  "config": { "against": { "kinds": ["event","deadline"] },
              "policy": "shift-later", "maxShiftMinutes": 120,
              "appliesTo": { "platforms": ["x","linkedin"] } } }
```

`policy`: `skip | shift-later | shift-earlier | shrink | allow | replace`. `replace` is only legal against other generated slots, never against a user-created block. A generator may never destroy manual work.

---

## 6. The resolution pipeline

Fixed order. Every stage is pure. The output of each stage is fully inspectable, which is what makes the preview and the "why is this slot here" explainer possible.

```
1. SELECT      enabled generators whose validity range intersects the window,
               sorted by layer descending, then id
2. EMIT        each generator produces candidate slots for
               [window.start - lookback, window.end + lookahead]
3. TRANSFORM   jitter, then snap
4. FILTER      blackouts
5. CONSTRAIN   spacing, then capacity
6. RESOLVE     collisions against real blocks, then against other slots
7. OVERRIDE    apply persisted per-slot overrides: skip, move, pin
8. BIND        attach bindings to content items and materialized blocks
9. CLIP        drop anything outside the requested window
10. SORT       startUtc, then layer desc, then generatorId, then ordinal
```

Two rules that fall out of the ordering and must not be violated:

- **Overrides are applied after constraints, not before.** A slot you manually moved stays where you put it even if a spacing rule would have moved it elsewhere. Human decisions outrank rules.
- **Bound and pinned slots are immune to stages 3 through 6.** Once content is attached, the schedule stops rearranging it under you.

Every slot carries a `trace` array in development builds, recording which stage touched it and why. This powers the explainer popover and cuts debugging time enormously.

---

## 7. Slot identity

A slot needs an identity stable enough that "skip this one" survives a regeneration, and an unrelated rule edit does not resurrect it.

```
slotKey = base58(sha256(generatorId + "|" + localDate + "|" + ordinal).slice(0, 10))
```

Identity is `(generator, local date, ordinal within that day)`, deliberately **not** the timestamp.

The tradeoff, stated plainly. Keying by ordinal means changing a time from 08:00 to 09:00 keeps the slot's identity, so a skip you applied still applies. Keying by timestamp would mean the skip evaporates and the slot returns. Ordinal keying is right most of the time, because editing a time is far more common than reordering the day.

The failure case is inserting a new time at the start of a day, which shifts every subsequent ordinal and misaligns existing overrides. Handle this explicitly: when a `weekly-grid` or `daily-times` config changes in a way that alters ordinals, run a **rekey migration** that maps old ordinals to new by nearest time, shows the user what it did, and offers an undo. Never do this silently.

`derived` slots key on the trigger instead: `sha256(generatorId + "|" + triggerId + "|" + offsetIndex)`, which is stable even when the trigger moves.

---

## 8. Temporal versioning

Rules have history. Changing your Monday schedule must not rewrite the past.

Every generator edit that changes emitted output creates a **new version** rather than mutating the existing row:

```
gen_x_grid  v1  validFrom 2026-01-01  validTo 2026-08-15   (times: 08,12,18,22)
gen_x_grid  v2  validFrom 2026-08-15  validTo null          (times: 09,13,19)
```

Generation selects the version whose validity range contains the date being generated, so August 14 renders with v1 and August 16 with v2. The editor offers three modes on save, mirroring the recurring-block edit prompt:

- **From today forward**: closes v1 at today, opens v2. The default and almost always correct.
- **All time**: mutates in place, rewriting history. Requires an explicit confirmation naming how many past slots change.
- **Date range only**: creates a bounded version, leaving earlier and later versions intact.

Versions are never deleted, only closed. Disk cost is trivial and the audit value is real.

---

## 9. Time zones and DST

Generation is defined in **local wall clock time** and resolved to UTC per occurrence. An 08:00 rule fires at 08:00 local on every side of every transition.

Two edge cases must be handled explicitly, because they are the classic silent failures.

**Nonexistent times (spring forward).** In Europe/Rome, 02:00 to 03:00 does not exist on the transition day. A rule at 02:30 has three legal behaviors, selected per generator: `shift-forward` (fires at 03:30, the default), `shift-back` (01:30), or `skip`.

**Ambiguous times (fall back).** 02:30 happens twice. Options: `first` (default), `second`, or `both`. `both` is legal and occasionally what a broadcaster actually wants.

A generator's `timezone` is its own, not the app's. This matters when scheduling posts for an audience in a different zone: a rule can target `America/New_York` while the app displays `Europe/Rome`, and the slot lands correctly in both views. Display always shows the app timezone, with the generator's zone as a `--fs-micro` annotation when the two differ.

---

## 10. Schema

Migration 003.

```sql
CREATE TABLE rulesets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  sort_order REAL NOT NULL DEFAULT 0,
  created_utc INTEGER NOT NULL, updated_utc INTEGER NOT NULL,
  deleted_utc INTEGER, hlc TEXT NOT NULL, device_id TEXT NOT NULL
);

CREATE TABLE generators (
  id           TEXT NOT NULL,          -- stable across versions
  version      INTEGER NOT NULL,
  ruleset_id   TEXT NOT NULL REFERENCES rulesets(id),
  name         TEXT NOT NULL,
  kind         TEXT NOT NULL,
  role         TEXT NOT NULL DEFAULT 'generator',  -- generator | modifier
  stage        TEXT,                   -- transform | filter | constrain | resolve
  enabled      INTEGER NOT NULL DEFAULT 1,
  layer        INTEGER NOT NULL DEFAULT 50,
  valid_from   INTEGER,
  valid_to     INTEGER,
  timezone     TEXT NOT NULL DEFAULT 'Europe/Rome',
  emits        TEXT NOT NULL DEFAULT '{}',
  config       TEXT NOT NULL DEFAULT '{}',
  created_utc  INTEGER NOT NULL, updated_utc INTEGER NOT NULL,
  deleted_utc  INTEGER, hlc TEXT NOT NULL, device_id TEXT NOT NULL,
  PRIMARY KEY (id, version)
);
CREATE INDEX idx_gen_active ON generators(ruleset_id, enabled, valid_from, valid_to)
  WHERE deleted_utc IS NULL;

CREATE TABLE slot_overrides (
  slot_key     TEXT PRIMARY KEY,
  generator_id TEXT NOT NULL,
  local_date   TEXT NOT NULL,
  ordinal      INTEGER NOT NULL,
  action       TEXT NOT NULL,          -- skip | move | pin | unskip
  moved_start_utc INTEGER,
  moved_end_utc   INTEGER,
  reason       TEXT,
  created_utc  INTEGER NOT NULL, updated_utc INTEGER NOT NULL,
  deleted_utc  INTEGER, hlc TEXT NOT NULL, device_id TEXT NOT NULL
);
CREATE INDEX idx_override_date ON slot_overrides(local_date) WHERE deleted_utc IS NULL;

CREATE TABLE slot_bindings (
  slot_key     TEXT PRIMARY KEY,
  generator_id TEXT NOT NULL,
  content_id   TEXT REFERENCES content_items(id),
  block_id     TEXT REFERENCES blocks(id),
  bound_utc    INTEGER NOT NULL,
  created_utc  INTEGER NOT NULL, updated_utc INTEGER NOT NULL,
  deleted_utc  INTEGER, hlc TEXT NOT NULL, device_id TEXT NOT NULL
);
CREATE INDEX idx_binding_content ON slot_bindings(content_id) WHERE deleted_utc IS NULL;
```

Three tables, all sparse. A year of a busy schedule with active use produces a few hundred override rows, against the 150,000 block rows the naive approach would have written.

Blocks created by materialization carry `payload.generatedBy = { generatorId, slotKey, version }`, so a block always knows its origin and can be traced back.

---

## 11. Engine interface

```ts
// src/domain/generation/engine.ts, pure, no React, no SQL, no Tauri

export type Slot = {
  key: string;
  generatorId: string;
  generatorVersion: number;
  localDate: string;          // YYYY-MM-DD in the generator timezone
  ordinal: number;
  startUtc: number;
  endUtc: number;
  intent: SlotIntent;
  state: 'virtual' | 'assigned' | 'materialized' | 'skipped' | 'moved' | 'pinned';
  contentId?: string;
  blockId?: string;
  layer: number;
  trace?: TraceEntry[];       // development builds only
};

export type WorldState = {
  now: number;
  blocks: Block[];            // within window plus lookback
  contentItems: ContentItem[];
  momentum: { date: string; value: number }[];
  holidays: string[];         // YYYY-MM-DD
};

export function generate(
  ruleset: ResolvedRuleset,
  window: { startUtc: number; endUtc: number },
  overrides: SlotOverride[],
  bindings: SlotBinding[],
  world: WorldState
): Slot[];

export function explain(slot: Slot): TraceEntry[];
export function simulate(ruleset: ResolvedRuleset, days: number, world: WorldState): SimulationReport;
export function diffRulesets(a: ResolvedRuleset, b: ResolvedRuleset, window: Window, world: WorldState): RulesetDiff;
```

`generate` is memoized on `hash(rulesetVersion, windowStart, windowEnd, worldStateHash)`. Invalidated on any generator, override, binding, or block change intersecting the window.

Every generator kind is a module exporting `{ kind, schema, emit, lookbackDays, describe }`, registered in one place. Adding a seventeenth kind means writing one file and one registry line, with no changes to the pipeline. That extensibility is what makes this sellable.

---

## 12. Rendering

### 12.1 Slot appearance

Virtual slots render as **ghost blocks**, visually subordinate to real blocks in every way:

- 1px dashed `--border` border, no background fill.
- The platform icon at 14px, at 40 percent opacity.
- Title at `--fs-micro` in `--text-tertiary`, showing the intent, for example "X post".
- Overall 70 percent opacity.
- No hover elevation. Hover reveals a `plus` affordance and the explainer trigger.

Assigned slots render as normal blocks per `SPEC.md` section 5.1, with a 10px `sparkles` glyph in the top-right corner of the icon slot marking generated origin. Pinned slots drop the glyph, because they are no longer tracking a rule.

### 12.2 Layer visibility

The calendar header gains a `layers` icon opening a popover listing rulesets and generators, each with a visibility toggle and a color dot. Toggling affects display only, never generation. A "hide all slots" master toggle returns the calendar to a pure manual view instantly, which is important on days when the schedule is noise.

### 12.3 The explainer

Right-clicking any slot, or clicking the `info` glyph on hover, opens a popover answering "why is this here":

```
X post, 18:00
Generated by "X weekly grid" v2, layer 50
  emitted        18:00  weekly-grid, mon ordinal 3
  jittered       18:07  seed gabry-2026
  snapped        18:00  nearest 15
  spacing ok     gap 6h from previous X slot
  capacity ok    3 of 4 used today
Actions: skip once · skip all future · pin · edit rule
```

This turns an opaque system into a legible one, and it is the single feature that makes a rule engine usable by someone who did not write it.

### 12.4 Editor surfaces

**Weekly grid editor**, the primary surface, since it covers the common case:

```
        MON      TUE      WED      THU      FRI      SAT      SUN
      ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐
      │08:00×│ │09:00×│ │08:00×│ │09:00×│ │08:00×│ │11:00×│ │      │
      │12:00×│ │13:00×│ │12:00×│ │13:00×│ │12:00×│ │20:00×│ │  +   │
      │18:00×│ │19:00×│ │18:00×│ │19:00×│ │17:00×│ │  +   │ │      │
      │22:00×│ │  +   │ │22:00×│ │  +   │ │  +   │ └──────┘ └──────┘
      │  +   │ └──────┘ │  +   │ └──────┘ └──────┘
      └──────┘          └──────┘
       4 slots  3 slots  4 slots  3 slots  3 slots  2 slots  0
```

Time chips at `--fs-micro`, tabular, with a hover `×`. Click `+` for an inline time input accepting `8`, `08`, `8:30`, `20:00`. Drag a chip between columns to move it. Copy a column to another with a modifier-drag. A total per column at the bottom, and a week total in the header.

**Rule list**, showing each generator as a dense row: enabled toggle, name, kind badge, a one-line natural language `describe()` output ("4 times on Mon, 3 on Tue, at layer 50"), slots per week, and version indicator. Drag to reorder layers.

**Preview strip**, pinned beneath any editor, showing the next 14 days as a compact horizontal timeline with the slots the current draft would produce. Updates live as you type, with no save required. Changes versus the saved rule are highlighted: additions in `--cat-admin`, removals in `--cat-deadline`.

**Impact dialog on save.** Before committing an edit: "This change affects 47 future slots. 3 are already filled with content: [list]. 2 have manual overrides that will be rekeyed." Never save a schedule change blind.

---

## 13. Assignment engine

Slots are useless empty. The assignment engine fills them.

**Manual**: drag a content card from the Content view onto a slot. Drop is only legal when the platforms match, or with a confirmation when they do not.

**Slot-initiated**: click an empty slot to open a compact picker listing `ready` content for that platform, sorted by age, with inline search and a "create new" row.

**Auto-fill**, the interesting one. `autoFill(window, options)` greedily assigns ready content to empty slots:

```ts
type AutoFillOptions = {
  strategy: 'oldest-first' | 'newest-first' | 'round-robin-project' | 'priority';
  respectCooldown: boolean;      // do not reuse a project within N slots
  cooldownSlots: number;
  dryRun: boolean;
  maxAssignments: number;
};
```

Always shows a dry-run diff first, listing every proposed assignment, with the whole set applied or rejected as one transaction. Never silently assigns.

**Starvation reporting.** The capacity report compares slot demand against content supply:

```
Next 14 days
  X            28 slots     11 ready     17 short     ▁▁▃▃▅▅▇
  LinkedIn      6 slots      8 ready      2 spare     ▇▇▅▅▃▃▁
  Instagram     4 slots      1 ready      3 short     ▁▁▁▂▂▃▃
```

This is the number that tells him whether the schedule is realistic, and it is the reason the whole layer earns its keep. A schedule you cannot feed is worse than no schedule.

---

## 14. Portability

Rulesets export and import as a single JSON document with a version field, a checksum, and no ids tied to the local install. This gives three things worth having: backup, sharing, and shipped presets.

Bundled presets, seeded but not enabled:

| Preset | Shape |
| --- | --- |
| Creator daily | 4 X, 1 LinkedIn, 1 Reel per day, blackout 23:30 to 07:00 |
| Build in public | 3 X, 1 LinkedIn on weekdays, batch production Sunday, derived promos on ship |
| Student schedule | School blackout weekdays 08:00 to 14:00, evening study gap-fill, weekend batch |
| Minimal | 1 post per weekday at 09:00 |
| Agency | Quota-based, 12 per week across 4 platforms, spacing 120 minutes, capacity 4 per day |

Import validates against the current schema version and migrates forward, refusing rather than guessing on unknown generator kinds.

---

## 15. Performance

| Operation | Target |
| --- | --- |
| Generate 7 days, 20 generators | under 4ms |
| Generate 90 days, 20 generators | under 40ms |
| Generate 365 days, 20 generators | under 200ms |
| Live preview keystroke to repaint | under 16ms |
| `simulate` over 90 days | under 100ms |

Generation runs synchronously on the main thread up to a 90 day window. Beyond that, or for `simulate` and `diffRulesets`, move it to a Web Worker, which is possible precisely because the engine is pure and has no Tauri or DOM dependency.

Never generate outside the viewport plus one screen of buffer. The rules in `SPEC.md` section 7 apply unchanged to slots.

---

## 16. Edge case catalogue

Each of these must have a test.

1. A generator with an empty config emits nothing and does not throw.
2. Two generators emitting an identical time produce two distinct slots, not one merged slot.
3. A slot straddling midnight belongs to the local date of its start.
4. A blackout window crossing midnight splits correctly across two days.
5. A capacity rule with more bound slots than the maximum evicts nothing and reports the overage.
6. Spacing that cannot be satisfied within `maxShiftMinutes` drops the slot and records the reason.
7. A `derived` generator whose trigger is deleted removes its derived slots, unless they were bound, in which case they are pinned and orphaned with a visible warning.
8. Circular derivation (A triggers B triggers A) is detected at save time and rejected.
9. A skip override on a slot whose generator was deleted is garbage collected after 90 days.
10. Editing a generator's times rekeys overrides by nearest time and reports the mapping.
11. A slot moved by the user is immune to later rule changes until explicitly reset.
12. DST spring forward: a 02:30 rule follows the configured policy and never silently vanishes.
13. DST fall back: a 02:30 rule fires once by default, and `both` yields exactly two.
14. A generator in a foreign timezone lands at the correct local instant in the display timezone.
15. `validFrom` equal to `validTo` produces zero slots rather than an error.
16. Overlapping generator versions are impossible: saving one closes the other at the same instant.
17. A `quota` with `free-space` placement and a fully booked day emits nothing and reports the reason.
18. `gap-fill` never emits a chunk below `minChunkMinutes`, even when budget remains.
19. `rotation` with `resetOn: never` yields the same cycle position regardless of the generated window.
20. Jitter with a fixed seed produces identical output across app restarts and across devices.
21. Generating the same window twice returns byte-identical results, including trace order.
22. A window of zero length returns an empty array.
23. 500 generators over 7 days stays within the performance budget or degrades with a clear warning, never silently.
24. Importing a ruleset with an unknown generator kind is refused with a named error, not partially applied.
25. A materialized block deleted by the user does not regenerate; the slot returns to virtual and the binding is removed.

---

## 17. Build phases

Insert as phases 11.5A through 11.5D, after Phase 11 (content foundations) and before Phase 12.

### Phase 11.5A, engine core

```
Read Spec1.1.md sections 2, 3, 4, 5, 6, 7, and 16.

Implement Phase 11.5A only: the pure generation engine. No UI, no SQL.

Build in src/domain/generation/:
1. types.ts: Generator, SlotIntent, Slot, WorldState, TraceEntry, and the
   zod schemas for every generator and modifier config in sections 4
   and 5.
2. registry.ts: a registry mapping kind to a module exporting
   { kind, schema, emit, lookbackDays, describe }. Adding a kind must
   require exactly one new file and one registry line.
3. kinds/: one file per generator kind. Implement these seven first:
   weekly-grid, daily-times, interval, spread, quota, rrule, manual-set.
4. modifiers/: blackout, capacity, spacing, jitter, snap, collision.
5. prng.ts: a seeded deterministic PRNG keyed by
   hash(seed, generatorId, localDate, ordinal).
6. slotKey.ts: identity per section 7, including the derived variant.
7. engine.ts: the ten-stage pipeline from section 6, in exactly that
   order, with trace collection behind a dev flag.
8. tz.ts: local wall clock to UTC resolution with the nonexistent and
   ambiguous time policies from section 9.

Nothing in this directory may import React, the DOM, Tauri, or SQL.

Acceptance criteria:
- Generating the same window twice returns byte-identical output.
- Every edge case 1 through 23 in section 16 that applies to these kinds
  has a passing test.
- Generating 90 days with 20 generators completes in under 40ms,
  measured in a benchmark test committed to the repo.
- DST tests pass for both Europe/Rome transitions in both directions.
```

### Phase 11.5B, persistence and remaining kinds

```
Implement Phase 11.5B only.

Build:
1. Migration 003: rulesets, generators, slot_overrides, slot_bindings
   per section 10.
2. Repository functions, including version-aware generator loading that
   selects the correct version per generated date.
3. Version-on-edit per section 8, with the three save modes, and the
   guarantee that versions never overlap.
4. Rekey migration per section 7, with a reported mapping and undo.
5. The remaining generator kinds: rotation, pattern, relative, derived,
   deadline-backfill, gap-fill, batch-production, conditional, cron.
6. Circular derivation detection at save time.
7. Garbage collection of orphaned overrides after 90 days.
8. Memoization keyed on the ruleset version, window, and world state
   hash, invalidated on any relevant change.

Acceptance criteria:
- August 14 renders with v1 and August 16 with v2 of an edited generator.
- Edge cases 7, 8, 9, 10, 16, 24, and 25 pass.
- A ruleset round-trips through export and import with identical
  generated output.
```

### Phase 11.5C, calendar rendering and editors

```
Implement Phase 11.5C only.

Build:
1. Ghost slot rendering per section 12.1, and the generated-origin glyph
   on assigned slots.
2. The layers popover per section 12.2, display-only.
3. The explainer popover per section 12.3, reading the trace.
4. The weekly grid editor per section 12.4, including drag between
   columns, modifier-drag to copy a column, flexible time input parsing,
   and per-column totals.
5. The rule list with enable toggles, kind badges, describe() output,
   slots per week, and drag-to-reorder layers.
6. The live preview strip, updating on keystroke with no save, and
   highlighting additions and removals against the saved version.
7. The impact dialog on save per section 12.4.
8. Slot interactions: click to assign, skip once, skip all future, pin,
   move by drag, and reset to rule.

Acceptance criteria:
- Preview repaints in under 16ms per keystroke.
- Toggling all slot visibility off restores a pure manual calendar
  instantly.
- A moved slot survives a rule edit unchanged, per edge case 11.
- The explainer lists every pipeline stage that touched the slot.
```

### Phase 11.5D, assignment and reporting

```
Implement Phase 11.5D only.

Build:
1. Drag a content card onto a slot, with platform matching and a
   confirmation on mismatch.
2. The slot picker on click: ready content for that platform, sorted by
   age, with search and a create-new row.
3. autoFill per section 13, always dry-run first, applied or rejected as
   one transaction.
4. The capacity and starvation report per section 13, with sparklines.
5. Ruleset export and import per section 14, with version checking and
   refusal on unknown kinds.
6. The five bundled presets, seeded and disabled.
7. Binding a slot materializes a block carrying
   payload.generatedBy = { generatorId, slotKey, version }.

Acceptance criteria:
- Auto-fill over 30 days is a single undoable transaction.
- The starvation report numbers match a manual count on seeded data.
- Deleting a materialized block returns the slot to virtual and removes
  the binding, without regenerating the block.
- Importing a preset produces the documented slot count for a known week.
```

---

## 18. Invariants, added

Extending `SPEC.md` section 13 and `Spec2.md` section 8.

21. Generation is pure. No `Date.now()`, no `Math.random()`, no locale-dependent formatting inside `src/domain/generation/`.
22. Slots are computed, never stored. Only overrides and bindings persist.
23. A generator may never modify or delete a user-created block. `replace` applies to generated slots only.
24. Human decisions outrank rules. Overrides apply after constraints, and bound or pinned slots are immune to transformation.
25. Rules are versioned. Editing a schedule never rewrites the past unless explicitly confirmed.
26. Every materialized block records its origin in `payload.generatedBy`.
27. Adding a generator kind requires one new file and one registry line, with no change to the pipeline.
28. No schedule change is saved without an impact preview when it affects filled or overridden slots.
