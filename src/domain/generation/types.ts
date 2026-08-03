import type { BlockCategory, BlockKind, Platform } from "../block";

/* Spec1.1 sections 2 and 4. Nothing in this directory may import React, the
   DOM, Tauri or SQL, read the wall clock, or draw unseeded randomness:
   generation is pure, the current time arrives in WorldState, and every draw
   is seeded by its own coordinates. Invariant 17.

   Stated without naming the two forbidden calls, so the grep that enforces
   this does not match the sentence describing it. */

export type GeneratorKind =
  | "weekly-grid"
  | "daily-times"
  | "interval"
  | "spread"
  | "quota"
  | "rrule"
  | "cron"
  | "rotation"
  | "pattern"
  | "relative"
  | "derived"
  | "deadline-backfill"
  | "gap-fill"
  | "batch-production"
  | "conditional"
  | "manual-set";

export type ModifierStage = "transform" | "filter" | "constrain" | "resolve";

/* Spec1.1 section 9. A generator carries its own policy, because a rule at
   02:30 has three defensible behaviours and the right one depends on what the
   rule is for. */
export type NonexistentPolicy = "shift-forward" | "shift-back" | "skip";
export type AmbiguousPolicy = "first" | "second" | "both";

export type DstPolicy = {
  nonexistent: NonexistentPolicy;
  ambiguous: AmbiguousPolicy;
};

export const DEFAULT_DST_POLICY: DstPolicy = {
  nonexistent: "shift-forward",
  ambiguous: "first",
};

export type SlotIntent = {
  kind: BlockKind;
  platform?: Platform;
  category: BlockCategory;
  durationMinutes: number;
  titleTemplate?: string;
  payloadDefaults?: Record<string, unknown>;
};

export type Generator = {
  id: string;
  version: number;
  name: string;
  kind: GeneratorKind;
  enabled: boolean;
  /* 0 lowest, 100 highest. Decides conflict resolution and sort order. */
  layer: number;
  validFrom: number | null;
  validTo: number | null;
  timezone: string;
  emits: SlotIntent;
  config: unknown;
  dst?: DstPolicy;
  color?: string;
};

export type SlotState =
  | "virtual"
  | "assigned"
  | "materialized"
  | "skipped"
  | "moved"
  | "pinned";

export type TraceEntry = {
  stage: string;
  detail: string;
  /* The instant after this stage ran, so the explainer can show a slot moving
     through the pipeline rather than only where it ended up. */
  startUtc?: number;
};

export type Slot = {
  key: string;
  generatorId: string;
  generatorVersion: number;
  /* YYYY-MM-DD in the generator's timezone, not the app's. */
  localDate: string;
  ordinal: number;
  startUtc: number;
  endUtc: number;
  intent: SlotIntent;
  state: SlotState;
  contentId?: string;
  blockId?: string;
  layer: number;
  trace?: TraceEntry[];
};

/* A candidate, before it has an identity or a place in the ordering. A kind
   module returns these; the engine numbers them and assigns keys, so no kind
   can invent its own ordinal scheme. */
export type Candidate = {
  localDate: string;
  startUtc: number;
  endUtc: number;
  /* Set only where the kind genuinely varies its intent per slot, as rotation
     will. Merged over the generator's own emits. */
  intent?: Partial<SlotIntent>;
  trace?: TraceEntry[];
};

export type BlockLike = {
  id: string;
  startUtc: number | null;
  endUtc: number | null;
  kind: BlockKind;
  tags: readonly string[];
};

export type ContentLike = {
  id: string;
  platform: string;
  status: string;
};

export type WorldState = {
  /* Passed in rather than read, which is what keeps generation pure. */
  now: number;
  blocks: readonly BlockLike[];
  contentItems: readonly ContentLike[];
  momentum: readonly { date: string; value: number }[];
  holidays: readonly string[];
};

export const EMPTY_WORLD: WorldState = {
  now: 0,
  blocks: [],
  contentItems: [],
  momentum: [],
  holidays: [],
};

export type GenerationWindow = {
  startUtc: number;
  endUtc: number;
};

export type SlotOverride = {
  slotKey: string;
  action: "skip" | "move" | "pin" | "unskip";
  movedStartUtc?: number | null;
  movedEndUtc?: number | null;
};

export type SlotBinding = {
  slotKey: string;
  contentId?: string | null;
  blockId?: string | null;
};

export type ResolvedRuleset = {
  id: string;
  name: string;
  generators: readonly Generator[];
};

export type GenerateOptions = {
  /* Trace collection is off by default. Spec1.1 section 6 calls it a
     development build feature, and carrying it always would double the work
     the 40ms budget has to fit. */
  trace?: boolean;
};
