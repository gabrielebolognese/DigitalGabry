import { dailyTimes } from "./kinds/dailyTimes";
import { interval } from "./kinds/interval";
import { manualSet } from "./kinds/manualSet";
import { quota } from "./kinds/quota";
import { rruleKind } from "./kinds/rruleKind";
import { spread } from "./kinds/spread";
import { weeklyGrid } from "./kinds/weeklyGrid";
import { cron, pattern, relative } from "./kinds/simple";
import {
  batchProduction,
  conditional,
  deadlineBackfill,
  derived,
  gapFill,
  rotation,
} from "./kinds/composite";
import { blackout } from "./modifiers/blackout";
import { collision } from "./modifiers/collision";
import { capacity, spacing } from "./modifiers/constrain";
import { jitter, snap } from "./modifiers/transform";
import { modifierModuleFor, registerModifier } from "./modifiers/index";
import { moduleFor, parseConfig, register } from "./registry";
import { slotKeyOf } from "./slotKey";
import { TzContext, makeResolver } from "./tz";
import { versionAt } from "./versioning";
import {
  DEFAULT_DST_POLICY,
  type Candidate,
  type Drop,
  type GenerationReport,
  type Modifier,
  type ModifierKind,
  type ModifierStage,
  type Notice,
  type GenerateOptions,
  type GenerationWindow,
  type Generator,
  type ResolvedRuleset,
  type Slot,
  type SlotBinding,
  type SlotIntent,
  type SlotOverride,
  type TraceEntry,
  type WorldState,
} from "./types";

/* The pipeline from Spec1.1 section 6, in exactly that order. Every stage is
   pure and its output is inspectable, which is what makes the explainer and the
   preview possible at all.

   Two rules fall out of the ordering and must not be violated:
   overrides apply after constraints, so a slot a person moved stays where they
   put it even when a rule would have moved it elsewhere; and bound or pinned
   slots are immune to stages 3 through 6, so attaching content stops the
   schedule rearranging it underneath. Invariant 20. */

/* One registry line per kind. Adding the seventeenth changes nothing below. */
register(weeklyGrid);
register(dailyTimes);
register(manualSet);
register(interval);
register(spread);
register(quota);
register(rruleKind);
register(cron);
register(pattern);
register(relative);
register(rotation);
register(derived);
register(deadlineBackfill);
register(gapFill);
register(batchProduction);
register(conditional);

registerModifier(jitter);
registerModifier(snap);
registerModifier(blackout);
registerModifier(spacing);
registerModifier(capacity);
registerModifier(collision);

/* Within a stage, this is the order the modifiers run in. Spec1.1 5.5 puts
   snap after jitter on purpose, and capacity after spacing because spacing can
   move slots into or out of a period before the count is taken. */
const STAGE_ORDER: Record<ModifierStage, readonly ModifierKind[]> = {
  transform: ["jitter", "snap"],
  filter: ["blackout"],
  constrain: ["spacing", "capacity"],
  resolve: ["collision"],
};

const MS_PER_DAY = 86_400_000;
const LOOKAHEAD_DAYS = 1;

function contextFor(contexts: Map<string, TzContext>, tz: string): TzContext {
  let context = contexts.get(tz);
  if (context === undefined) {
    context = new TzContext(tz);
    contexts.set(tz, context);
  }
  return context;
}

function isActive(generator: Generator, window: GenerationWindow): boolean {
  if (!generator.enabled) return false;
  /* An empty validity range produces zero slots rather than an error.
     Edge case 15. */
  if (
    generator.validFrom !== null &&
    generator.validTo !== null &&
    generator.validFrom >= generator.validTo
  ) {
    return false;
  }
  if (generator.validTo !== null && generator.validTo <= window.startUtc) return false;
  if (generator.validFrom !== null && generator.validFrom >= window.endUtc) return false;
  return true;
}

/* Stage 1. Layer descending then id, so the order a generator is processed in
   never depends on how the ruleset happened to be stored.

   Every version whose range intersects the window is selected; which one
   actually emits on a given date is decided per date in emitFor, so a window
   spanning an edit renders the days before it with the old rule and the days
   after it with the new one. Spec1.1 section 8. */
function selectGenerators(
  ruleset: ResolvedRuleset,
  window: GenerationWindow,
): Generator[] {
  return ruleset.generators
    .filter((generator) => isActive(generator, window))
    .sort(
      (left, right) =>
        right.layer - left.layer ||
        (left.id < right.id ? -1 : left.id > right.id ? 1 : 0) ||
        left.version - right.version,
    );
}

/* The dates this version is the one in force for. Two versions of the same
   generator therefore never both emit on the same date, which is what makes
   ordinals, and so slot keys, unambiguous across an edit. */
function datesForVersion(
  generator: Generator,
  siblings: readonly Generator[],
  dates: readonly string[],
  midnightUtc: (localDate: string) => number,
): string[] {
  if (siblings.length <= 1) return [...dates];

  return dates.filter((localDate) => {
    const at = midnightUtc(localDate);
    const winner = versionAt(siblings, at);
    return winner !== null && winner.version === generator.version;
  });
}

function mergeIntent(base: SlotIntent, patch: Partial<SlotIntent> | undefined): SlotIntent {
  return patch === undefined ? base : { ...base, ...patch };
}

/* Stage 2. Emitted wide, in local dates, then clipped exactly in UTC at stage
   9. Generating only the requested window would lose a slot whose local day
   starts before it and whose instant falls inside it. */
const MAX_WRAP_DEPTH = 4;

/* Emits one generator's candidates without giving it an identity. Used both by
   emitFor and, through the context, by rotation and conditional when they wrap
   another generator. Depth guarded: a rotation whose source is itself, or a
   pair pointing at each other, would otherwise recurse until the stack gave
   out, and a config can say that. */
function emitCandidates(
  generator: Generator,
  dates: readonly string[],
  context: {
    world: WorldState;
    window: GenerationWindow;
    tz: TzContext;
    notices: Notice[];
    byId: ReadonlyMap<string, Generator>;
    depth: number;
  },
): Candidate[] {
  const module = moduleFor(generator.kind);
  if (module === null) return [];

  const parsed = parseConfig(generator);
  if (!parsed.ok) return [];

  if (context.depth > MAX_WRAP_DEPTH) {
    context.notices.push({
      sourceId: generator.id,
      kind: "wrap-too-deep",
      message: "Generators wrap each other more deeply than is allowed",
    });
    return [];
  }

  const resolve = makeResolver(context.tz, generator.dst ?? DEFAULT_DST_POLICY);

  try {
    return module.emit(parsed.config, {
      generator,
      dates,
      resolve,
      world: context.world,
      window: context.window,
      notice: (kind, message) =>
        context.notices.push({ sourceId: generator.id, kind, message }),
      midnightUtc: (localDate) => context.tz.midnightUtc(localDate),
      localDateOf: (utcMs) => context.tz.localDateOf(utcMs),
      generatorById: (id) => context.byId.get(id) ?? null,
      emitInline: (inner, innerDates) =>
        emitCandidates(inner, innerDates ?? dates, {
          ...context,
          depth: context.depth + 1,
        }),
    });
  } catch {
    /* A kind that throws loses its own slots and nothing else. One broken
       generator must not empty the calendar. */
    return [];
  }
}

function emitFor(
  generator: Generator,
  window: GenerationWindow,
  world: WorldState,
  collectTrace: boolean,
  contexts: Map<string, TzContext>,
  notices: Notice[],
  byId: ReadonlyMap<string, Generator>,
  siblings: readonly Generator[],
): Slot[] {
  const module = moduleFor(generator.kind);
  if (module === null) return [];

  /* One context per timezone for the whole pass, so twenty generators over the
     same zone resolve each date once between them rather than twenty times. */
  const context = contextFor(contexts, generator.timezone);

  const allDates = context.datesBetween(
    window.startUtc - (module.lookbackDays + 1) * MS_PER_DAY,
    window.endUtc + LOOKAHEAD_DAYS * MS_PER_DAY,
  );

  const dates = datesForVersion(generator, siblings, allDates, (localDate) =>
    context.midnightUtc(localDate),
  );
  if (dates.length === 0) return [];

  const candidates = emitCandidates(generator, dates, {
    world,
    window,
    tz: context,
    notices,
    byId,
    depth: 0,
  });

  /* Ordinals are assigned here, never by a kind, and always over the emitted
     order within a local date. Two generators emitting the same instant
     therefore produce two distinct slots rather than one merged slot, because
     the key carries the generator id. Edge case 2. */
  const byDate = new Map<string, Candidate[]>();
  for (const candidate of candidates) {
    const bucket = byDate.get(candidate.localDate);
    if (bucket === undefined) byDate.set(candidate.localDate, [candidate]);
    else bucket.push(candidate);
  }

  const slots: Slot[] = [];
  for (const [localDate, bucket] of byDate) {
    bucket.sort((left, right) => left.startUtc - right.startUtc);
    for (const [ordinal, candidate] of bucket.entries()) {
      const trace: TraceEntry[] | undefined = collectTrace
        ? [
            ...(candidate.trace ?? []),
            {
              stage: "emit",
              detail: `${generator.kind}, ${localDate} ordinal ${ordinal}`,
              startUtc: candidate.startUtc,
            },
          ]
        : undefined;

      slots.push({
        key: slotKeyOf(generator.id, localDate, ordinal),
        generatorId: generator.id,
        generatorVersion: generator.version,
        localDate,
        ordinal,
        startUtc: candidate.startUtc,
        endUtc: candidate.endUtc,
        intent: mergeIntent(generator.emits, candidate.intent),
        state: "virtual",
        layer: generator.layer,
        ...(trace === undefined ? {} : { trace }),
      });
    }
  }

  return slots;
}

function note(slot: Slot, stage: string, detail: string): void {
  if (slot.trace === undefined) return;
  slot.trace.push({ stage, detail, startUtc: slot.startUtc });
}

/* Bound and pinned slots are immune to stages 3 through 6. Their state has to
   be known before those stages run, but a binding's own data is not applied
   until stage 8, so every slot would still read "virtual" while the modifiers
   were deciding what they were allowed to touch, and the immunity would not
   exist. Marked here, filled in at stage 8. */
function markProtected(
  slots: readonly Slot[],
  overrides: readonly SlotOverride[],
  bindings: readonly SlotBinding[],
): void {
  const pinned = new Set(
    overrides.filter((override) => override.action === "pin").map((o) => o.slotKey),
  );
  const bound = new Set(bindings.map((binding) => binding.slotKey));
  if (pinned.size === 0 && bound.size === 0) return;

  for (const slot of slots) {
    if (pinned.has(slot.key)) slot.state = "pinned";
    else if (bound.has(slot.key)) slot.state = "assigned";
  }
}

/* Stage 7. After the constraints, not before: a human decision outranks a
   rule. Invariant 20. */
function applyOverrides(slots: Slot[], overrides: readonly SlotOverride[]): Slot[] {
  if (overrides.length === 0) return slots;

  const byKey = new Map(overrides.map((override) => [override.slotKey, override]));
  const kept: Slot[] = [];

  for (const slot of slots) {
    const override = byKey.get(slot.key);
    if (override === undefined) {
      kept.push(slot);
      continue;
    }

    if (override.action === "skip") {
      note(slot, "override", "skipped by hand");
      continue;
    }

    if (override.action === "move") {
      const movedStart = override.movedStartUtc ?? slot.startUtc;
      const movedEnd =
        override.movedEndUtc ?? movedStart + (slot.endUtc - slot.startUtc);
      slot.startUtc = movedStart;
      slot.endUtc = movedEnd;
      slot.state = "moved";
      note(slot, "override", "moved by hand");
    } else if (override.action === "pin") {
      slot.state = "pinned";
      note(slot, "override", "pinned, no longer tracking the rule");
    }

    kept.push(slot);
  }

  return kept;
}

/* Stage 8. */
function applyBindings(slots: Slot[], bindings: readonly SlotBinding[]): void {
  if (bindings.length === 0) return;
  const byKey = new Map(bindings.map((binding) => [binding.slotKey, binding]));

  for (const slot of slots) {
    const binding = byKey.get(slot.key);
    if (binding === undefined) continue;

    if (binding.contentId != null) slot.contentId = binding.contentId;
    if (binding.blockId != null) slot.blockId = binding.blockId;
    /* Pinned and hand-moved states are decisions; a binding refines the rest. */
    if (slot.state !== "pinned" && slot.state !== "moved") {
      slot.state = binding.blockId != null ? "materialized" : "assigned";
    }
    note(slot, "bind", binding.blockId != null ? "materialized" : "assigned");
  }
}

/* Stage 10. Fully defined, so the same window twice is byte identical and
   nothing ever depends on map iteration order. Spec1.1 section 3. */
function sortSlots(slots: Slot[]): Slot[] {
  return slots.sort(
    (left, right) =>
      left.startUtc - right.startUtc ||
      right.layer - left.layer ||
      (left.generatorId < right.generatorId
        ? -1
        : left.generatorId > right.generatorId
          ? 1
          : 0) ||
      left.ordinal - right.ordinal,
  );
}

function activeModifiers(
  ruleset: ResolvedRuleset,
  stage: ModifierStage,
  window: GenerationWindow,
): Modifier[] {
  const order = STAGE_ORDER[stage];
  return (ruleset.modifiers ?? [])
    .filter((modifier) => {
      if (!modifier.enabled) return false;
      if (!order.includes(modifier.kind)) return false;
      if (modifier.validTo !== null && modifier.validTo <= window.startUtc) return false;
      if (modifier.validFrom !== null && modifier.validFrom >= window.endUtc) return false;
      return true;
    })
    .sort(
      (left, right) =>
        order.indexOf(left.kind) - order.indexOf(right.kind) ||
        left.order - right.order ||
        (left.id < right.id ? -1 : 1),
    );
}

export function generateDetailed(
  ruleset: ResolvedRuleset,
  window: GenerationWindow,
  overrides: readonly SlotOverride[] = [],
  bindings: readonly SlotBinding[] = [],
  world: WorldState = { now: 0, blocks: [], contentItems: [], momentum: [], holidays: [] },
  options: GenerateOptions = {},
): GenerationReport {
  // A window of zero length returns an empty array. Edge case 22.
  if (window.endUtc <= window.startUtc) return { slots: [], dropped: [], notices: [] };

  const collectTrace = options.trace === true;
  const dropped: Drop[] = [];
  const notices: Notice[] = [];

  // 1. SELECT
  const generators = selectGenerators(ruleset, window);

  // 2. EMIT
  const contexts = new Map<string, TzContext>();
  /* Latest version per id, for the wrapped-generator lookups. A rotation names
     a generator, not a version of one. */
  const byId = new Map<string, Generator>();
  const byIdAll = new Map<string, Generator[]>();
  for (const generator of ruleset.generators) {
    const bucket = byIdAll.get(generator.id);
    if (bucket === undefined) byIdAll.set(generator.id, [generator]);
    else bucket.push(generator);
    const current = byId.get(generator.id);
    if (current === undefined || generator.version > current.version) {
      byId.set(generator.id, generator);
    }
  }

  let slots: Slot[] = [];
  for (const generator of generators) {
    slots.push(
      ...emitFor(
        generator,
        window,
        world,
        collectTrace,
        contexts,
        notices,
        byId,
        byIdAll.get(generator.id) ?? [generator],
      ),
    );
  }

  markProtected(slots, overrides, bindings);

  /* 3 TRANSFORM, 4 FILTER, 5 CONSTRAIN, 6 RESOLVE. Every stage runs the same
     way; only which modifiers belong to it differs, so adding a seventh
     modifier is a registry line and a name in STAGE_ORDER. */
  for (const stage of ["transform", "filter", "constrain", "resolve"] as const) {
    for (const modifier of activeModifiers(ruleset, stage, window)) {
      const module = modifierModuleFor(modifier.kind);
      if (module === null) continue;

      const parsed = module.parse(modifier.config);
      if (!parsed.ok) {
        notices.push({
          sourceId: modifier.id,
          kind: "invalid-config",
          message: `${modifier.name}: ${parsed.error}`,
        });
        continue;
      }

      try {
        slots = module.apply(parsed.config, slots, {
          modifier,
          world,
          tz: contextFor(contexts, modifier.timezone),
          drop: (slot, reason) => {
            dropped.push({
              key: slot.key,
              generatorId: slot.generatorId,
              startUtc: slot.startUtc,
              stage,
              reason,
            });
          },
          notice: (kind, message) =>
            notices.push({ sourceId: modifier.id, kind, message }),
          note: (slot, detail) => note(slot, modifier.kind, detail),
        });
      } catch {
        /* One broken modifier loses its own effect, not the whole schedule. */
        notices.push({
          sourceId: modifier.id,
          kind: "modifier-failed",
          message: `${modifier.name} could not be applied`,
        });
      }
    }
  }

  // 7. OVERRIDE
  slots = applyOverrides(slots, overrides);

  // 8. BIND
  applyBindings(slots, bindings);

  /* 9. CLIP. Exact, in UTC, after everything that could have moved a slot.
     A slot starting inside the window is kept even if it ends outside it. */
  slots = slots.filter(
    (slot) => slot.startUtc >= window.startUtc && slot.startUtc < window.endUtc,
  );

  // 10. SORT
  /* Drops are clipped to the same window as the slots. Generation runs a day
     either side so a slot can move into view, and without this the preview
     would report removals for slots the user was never going to see. */
  const visibleDrops = dropped
    .filter((drop) => drop.startUtc >= window.startUtc && drop.startUtc < window.endUtc)
    .sort(
      (left, right) => left.startUtc - right.startUtc || (left.key < right.key ? -1 : 1),
    );

  return { slots: sortSlots(slots), dropped: visibleDrops, notices };
}

/* Spec1.1 section 11 gives generate this signature. The report is the same
   pass with its bookkeeping kept, for the preview and the explainer. */
export function generate(
  ruleset: ResolvedRuleset,
  window: GenerationWindow,
  overrides: readonly SlotOverride[] = [],
  bindings: readonly SlotBinding[] = [],
  world: WorldState = { now: 0, blocks: [], contentItems: [], momentum: [], holidays: [] },
  options: GenerateOptions = {},
): Slot[] {
  return generateDetailed(ruleset, window, overrides, bindings, world, options).slots;
}

export function explain(slot: Slot): TraceEntry[] {
  return slot.trace ?? [];
}
