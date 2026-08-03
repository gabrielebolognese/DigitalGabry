import { dailyTimes } from "./kinds/dailyTimes";
import { manualSet } from "./kinds/manualSet";
import { weeklyGrid } from "./kinds/weeklyGrid";
import { moduleFor, parseConfig, register } from "./registry";
import { slotKeyOf } from "./slotKey";
import { TzContext, makeResolver } from "./tz";
import {
  DEFAULT_DST_POLICY,
  type Candidate,
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

const MS_PER_DAY = 86_400_000;
const LOOKAHEAD_DAYS = 1;

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
   never depends on how the ruleset happened to be stored. */
function selectGenerators(
  ruleset: ResolvedRuleset,
  window: GenerationWindow,
): Generator[] {
  return ruleset.generators
    .filter((generator) => isActive(generator, window))
    .sort(
      (left, right) =>
        right.layer - left.layer ||
        (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
    );
}

function mergeIntent(base: SlotIntent, patch: Partial<SlotIntent> | undefined): SlotIntent {
  return patch === undefined ? base : { ...base, ...patch };
}

/* Stage 2. Emitted wide, in local dates, then clipped exactly in UTC at stage
   9. Generating only the requested window would lose a slot whose local day
   starts before it and whose instant falls inside it. */
function emitFor(
  generator: Generator,
  window: GenerationWindow,
  world: WorldState,
  collectTrace: boolean,
  contexts: Map<string, TzContext>,
): Slot[] {
  const module = moduleFor(generator.kind);
  if (module === null) return [];

  const parsed = parseConfig(generator);
  if (!parsed.ok) return [];

  /* One context per timezone for the whole pass, so twenty generators over the
     same zone resolve each date once between them rather than twenty times. */
  let context = contexts.get(generator.timezone);
  if (context === undefined) {
    context = new TzContext(generator.timezone);
    contexts.set(generator.timezone, context);
  }

  const dates = context.datesBetween(
    window.startUtc - (module.lookbackDays + 1) * MS_PER_DAY,
    window.endUtc + LOOKAHEAD_DAYS * MS_PER_DAY,
  );

  const resolve = makeResolver(context, generator.dst ?? DEFAULT_DST_POLICY);

  let candidates: Candidate[];
  try {
    candidates = module.emit(parsed.config, {
      generator,
      dates,
      resolve,
      world,
      window,
    });
  } catch {
    /* A kind that throws loses its own slots and nothing else. One broken
       generator must not empty the calendar. */
    return [];
  }

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

/* Bound and pinned slots skip stages 3 through 6 entirely. */
function isImmutable(slot: Slot): boolean {
  return slot.state === "assigned" || slot.state === "pinned" || slot.state === "materialized";
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
    if (slot.state === "virtual") {
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

export function generate(
  ruleset: ResolvedRuleset,
  window: GenerationWindow,
  overrides: readonly SlotOverride[] = [],
  bindings: readonly SlotBinding[] = [],
  world: WorldState = { now: 0, blocks: [], contentItems: [], momentum: [], holidays: [] },
  options: GenerateOptions = {},
): Slot[] {
  // A window of zero length returns an empty array. Edge case 22.
  if (window.endUtc <= window.startUtc) return [];

  const collectTrace = options.trace === true;

  // 1. SELECT
  const generators = selectGenerators(ruleset, window);

  // 2. EMIT
  const contexts = new Map<string, TzContext>();
  let slots: Slot[] = [];
  for (const generator of generators) {
    slots.push(...emitFor(generator, window, world, collectTrace, contexts));
  }

  /* 3 TRANSFORM, 4 FILTER, 5 CONSTRAIN, 6 RESOLVE.
     Phase 11.5A1 registers no modifiers, so these are identity. The stage
     boundaries exist now rather than later so that adding a modifier in
     11.5A2 changes one function and not the shape of the pipeline. */
  const mutable = slots.filter((slot) => !isImmutable(slot));
  for (const slot of mutable) {
    note(slot, "transform", "no transform modifiers");
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
  return sortSlots(slots);
}

export function explain(slot: Slot): TraceEntry[] {
  return slot.trace ?? [];
}
