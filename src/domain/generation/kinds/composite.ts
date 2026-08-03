import { z } from "zod";
import { BLOCK_KINDS, PLATFORMS } from "../../block";
import { derivedSlotKeyOf } from "../slotKey";
import { parseClock } from "../tz";
import { clockSchema, matchesWeekdays, weekdayKeySchema } from "../weekdays";
import type { EmitContext, KindModule } from "../registry";
import type { Candidate, GeneratorKind, SlotIntent } from "../types";

/* Spec1.1 sections 4.8, 4.11 to 4.15. The kinds that read the rest of the
   world, or wrap another generator, rather than emitting from a clock alone. */

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;

const intentPatchSchema = z
  .object({
    kind: z.enum(BLOCK_KINDS).optional(),
    platform: z.enum(PLATFORMS).optional(),
    titleTemplate: z.string().optional(),
    durationMinutes: z.number().int().min(1).max(1440).optional(),
  })
  .default({});

/* ---- rotation, section 4.8 ---- */

export const rotationSchema = z.object({
  sourceGeneratorId: z.string().min(1),
  cycle: z.array(intentPatchSchema).min(1),
  resetOn: z.enum(["never", "day", "week", "month"]).default("week"),
  anchorDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).default("2020-01-01"),
});

export type RotationConfig = z.infer<typeof rotationSchema>;

function daysBetween(from: string, to: string): number {
  const parse = (text: string): number => {
    const [year, month, day] = text.split("-").map(Number);
    return Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1);
  };
  return Math.round((parse(to) - parse(from)) / MS_PER_DAY);
}

export const rotation: KindModule<RotationConfig> = {
  kind: "rotation",
  schema: rotationSchema,
  lookbackDays: 0,

  emit(config, context) {
    const source = context.generatorById(config.sourceGeneratorId);
    if (source === null) {
      context.notice("rotation-no-source", "The generator this rotates over is gone");
      return [];
    }

    const produced = context.emitInline(source);
    const byDate = new Map<string, Candidate[]>();
    for (const candidate of produced) {
      const bucket = byDate.get(candidate.localDate);
      if (bucket === undefined) byDate.set(candidate.localDate, [candidate]);
      else bucket.push(candidate);
    }

    const out: Candidate[] = [];

    for (const [localDate, bucket] of byDate) {
      bucket.sort((left, right) => left.startUtc - right.startUtc);
      const perDay = bucket.length;

      for (const [ordinal, candidate] of bucket.entries()) {
        let position: number;

        if (config.resetOn === "day") {
          position = ordinal;
        } else if (config.resetOn === "week" || config.resetOn === "month") {
          /* Days into the period, times the day's count, plus the ordinal.
             Exact whenever the source emits a steady number a day, which is
             what a time grid does. */
          const dayIndex =
            config.resetOn === "week"
              ? ((daysBetween(config.anchorDate, localDate) % 7) + 7) % 7
              : Number(localDate.slice(8)) - 1;
          position = dayIndex * perDay + ordinal;
        } else {
          const absoluteDay = daysBetween(config.anchorDate, localDate);
          position = absoluteDay * perDay + ordinal;
        }

        const patch = config.cycle[
          ((position % config.cycle.length) + config.cycle.length) % config.cycle.length
        ];

        out.push({
          localDate,
          startUtc: candidate.startUtc,
          endUtc: candidate.endUtc,
          intent: patch as Partial<SlotIntent>,
        });
      }
    }

    return out;
  },

  describe(config) {
    return `Cycles ${config.cycle.length} intents, resets ${config.resetOn}`;
  },
};

/* ---- derived, section 4.11 ---- */

export const derivedSchema = z.object({
  trigger: z
    .object({
      kind: z.enum(BLOCK_KINDS).optional(),
      platform: z.enum(PLATFORMS).optional(),
      status: z.string().optional(),
      tag: z.string().optional(),
    })
    .default({}),
  offsets: z
    .array(
      z.object({
        minutes: z.number().int().min(-100_000).max(100_000),
        emits: intentPatchSchema,
      }),
    )
    .min(1),
  lookbackDays: z.number().int().min(0).max(365).default(30),
});

export type DerivedConfig = z.infer<typeof derivedSchema>;

export const derived: KindModule<DerivedConfig> = {
  kind: "derived",
  schema: derivedSchema,
  lookbackDays: 30,

  emit(config, context) {
    const out: Candidate[] = [];
    const durationMs = context.generator.emits.durationMinutes * MS_PER_MINUTE;

    const triggers = context.world.blocks.filter((block) => {
      if (block.startUtc === null) return false;
      const { kind, platform, status, tag } = config.trigger;
      if (kind !== undefined && block.kind !== kind) return false;
      if (platform !== undefined && block.platform !== platform) return false;
      if (status !== undefined && block.status !== status) return false;
      if (tag !== undefined && !block.tags.includes(tag)) return false;
      return true;
    });

    for (const trigger of triggers) {
      const anchor = trigger.startUtc ?? 0;

      for (const [index, offset] of config.offsets.entries()) {
        /* Negative offsets are legal and produce pre-promotion. */
        const startUtc = anchor + offset.minutes * MS_PER_MINUTE;
        const patch = { ...offset.emits } as Partial<SlotIntent>;

        if (typeof patch.titleTemplate === "string") {
          patch.titleTemplate = patch.titleTemplate.replace(
            "{trigger.title}",
            trigger.title ?? "",
          );
        }

        out.push({
          localDate: context.localDateOf(startUtc),
          startUtc,
          endUtc: startUtc + (offset.emits.durationMinutes ?? 0) * MS_PER_MINUTE || startUtc + durationMs,
          intent: patch,
          /* Keyed on the trigger rather than the day, so the slot survives the
             trigger moving. Recorded here for the engine to prefer. */
          trace: [
            {
              stage: "derive",
              detail: derivedSlotKeyOf(context.generator.id, trigger.id, index),
              startUtc,
            },
          ],
        });
      }
    }

    return out;
  },

  describe(config) {
    return `${config.offsets.length} follow-ups off each trigger`;
  },
};

/* ---- deadline-backfill, section 4.12 ---- */

export const deadlineBackfillSchema = z.object({
  triggerTag: z.string().min(1),
  sessions: z.number().int().min(1).max(50),
  sessionMinutes: z.number().int().min(5).max(600).default(90),
  spanDays: z.number().int().min(1).max(180).default(14),
  distribution: z.enum(["even", "front-loaded", "back-loaded"]).default("back-loaded"),
  window: z.tuple([clockSchema, clockSchema]).default(["15:00", "20:00"]),
  excludeWeekends: z.boolean().default(false),
});

export type DeadlineBackfillConfig = z.infer<typeof deadlineBackfillSchema>;

export const deadlineBackfill: KindModule<DeadlineBackfillConfig> = {
  kind: "deadline-backfill",
  schema: deadlineBackfillSchema,
  lookbackDays: 180,

  emit(config, context) {
    const out: Candidate[] = [];
    const durationMs = config.sessionMinutes * MS_PER_MINUTE;
    const fromMinute = parseClock(config.window[0]) ?? 900;

    const deadlines = context.world.blocks.filter(
      (block) => block.startUtc !== null && block.tags.includes(config.triggerTag),
    );

    for (const deadline of deadlines) {
      const target = deadline.startUtc ?? 0;

      for (let index = 0; index < config.sessions; index += 1) {
        const fraction =
          config.sessions === 1 ? 0.5 : index / (config.sessions - 1);

        /* back-loaded concentrates sessions nearer the deadline, which is how
           preparation actually works. */
        const eased =
          config.distribution === "back-loaded"
            ? 1 - (1 - fraction) * (1 - fraction)
            : config.distribution === "front-loaded"
              ? fraction * fraction
              : fraction;

        const daysBefore = Math.round((1 - eased) * config.spanDays);
        const dayUtc = target - daysBefore * MS_PER_DAY;
        const localDate = context.localDateOf(dayUtc);

        if (config.excludeWeekends && !matchesWeekdays(localDate, ["mon", "tue", "wed", "thu", "fri"])) {
          continue;
        }

        const startUtc = context.midnightUtc(localDate) + fromMinute * MS_PER_MINUTE;
        if (startUtc >= target) continue;

        out.push({ localDate, startUtc, endUtc: startUtc + durationMs });
      }
    }

    return out;
  },

  describe(config) {
    return `${config.sessions} sessions before each "${config.triggerTag}"`;
  },
};

/* ---- gap-fill, section 4.13 ---- */

export const gapFillSchema = z.object({
  budgetMinutes: z.number().int().min(15).max(1440).default(240),
  minChunkMinutes: z.number().int().min(5).max(600).default(45),
  maxChunkMinutes: z.number().int().min(5).max(600).default(120),
  window: z.tuple([clockSchema, clockSchema]).default(["09:00", "19:00"]),
  weekdays: z.array(weekdayKeySchema).optional(),
  strategy: z.enum(["largest-first", "earliest-first", "balanced"]).default("largest-first"),
});

export type GapFillConfig = z.infer<typeof gapFillSchema>;

export const gapFill: KindModule<GapFillConfig> = {
  kind: "gap-fill",
  schema: gapFillSchema,
  lookbackDays: 1,

  emit(config, context) {
    const out: Candidate[] = [];
    const fromMinute = parseClock(config.window[0]);
    const toMinute = parseClock(config.window[1]);
    if (fromMinute === null || toMinute === null || toMinute <= fromMinute) return out;

    const minChunk = config.minChunkMinutes * MS_PER_MINUTE;
    const maxChunk = Math.max(config.maxChunkMinutes, config.minChunkMinutes) * MS_PER_MINUTE;

    for (const localDate of context.dates) {
      if (!matchesWeekdays(localDate, config.weekdays)) continue;

      const midnight = context.midnightUtc(localDate);
      const dayStart = midnight + fromMinute * MS_PER_MINUTE;
      const dayEnd = midnight + toMinute * MS_PER_MINUTE;

      const busy = context.world.blocks
        .filter(
          (block): block is typeof block & { startUtc: number; endUtc: number } =>
            block.startUtc !== null &&
            block.endUtc !== null &&
            block.endUtc > dayStart &&
            block.startUtc < dayEnd,
        )
        .sort((left, right) => left.startUtc - right.startUtc);

      const gaps: { startUtc: number; ms: number }[] = [];
      let cursor = dayStart;
      for (const block of busy) {
        if (block.startUtc > cursor) {
          gaps.push({ startUtc: cursor, ms: block.startUtc - cursor });
        }
        cursor = Math.max(cursor, block.endUtc);
      }
      if (dayEnd > cursor) gaps.push({ startUtc: cursor, ms: dayEnd - cursor });

      const ordered =
        config.strategy === "earliest-first"
          ? gaps.sort((left, right) => left.startUtc - right.startUtc)
          : gaps.sort((left, right) => right.ms - left.ms || left.startUtc - right.startUtc);

      let remaining = config.budgetMinutes * MS_PER_MINUTE;

      for (const gap of ordered) {
        if (remaining < minChunk) break;
        /* Never a chunk below the minimum, even when budget remains: a fifteen
           minute fragment is not usable time. Edge case 18. */
        if (gap.ms < minChunk) continue;

        const size = Math.min(gap.ms, maxChunk, remaining);
        if (size < minChunk) continue;

        out.push({
          localDate,
          startUtc: gap.startUtc,
          endUtc: gap.startUtc + size,
        });
        remaining -= size;
      }
    }

    return out;
  },

  describe(config) {
    return `Up to ${config.budgetMinutes}m of free time, ${config.strategy}`;
  },
};

/* ---- batch-production, section 4.14 ---- */

export const batchProductionSchema = z.object({
  perSlots: z.number().int().min(1).max(100).default(6),
  leadDays: z.number().int().min(0).max(60).default(2),
  durationMinutes: z.number().int().min(15).max(600).default(180),
  preferredWeekdays: z.array(weekdayKeySchema).default(["sun"]),
  preferredTime: clockSchema.default("14:00"),
  countScope: z
    .object({ platform: z.enum(PLATFORMS).optional(), kind: z.enum(BLOCK_KINDS).optional() })
    .default({}),
  sourceGeneratorIds: z.array(z.string()).default([]),
});

export type BatchProductionConfig = z.infer<typeof batchProductionSchema>;

export const batchProduction: KindModule<BatchProductionConfig> = {
  kind: "batch-production",
  schema: batchProductionSchema,
  lookbackDays: 7,

  emit(config, context) {
    /* Counts what the named generators will publish, then books the time to
       make it. This closes the loop most content calendars miss: the posts are
       scheduled and the work to produce them is not. */
    const counted: Candidate[] = [];
    for (const sourceId of config.sourceGeneratorIds) {
      const source = context.generatorById(sourceId);
      if (source === null) continue;
      if (
        config.countScope.platform !== undefined &&
        source.emits.platform !== config.countScope.platform
      ) {
        continue;
      }
      counted.push(...context.emitInline(source));
    }

    if (counted.length === 0) return [];
    counted.sort((left, right) => left.startUtc - right.startUtc);

    const preferredMinute = parseClock(config.preferredTime) ?? 840;
    const out: Candidate[] = [];
    const used = new Set<string>();

    for (let index = 0; index + config.perSlots <= counted.length; index += config.perSlots) {
      const batchHead = counted[index];
      if (batchHead === undefined) continue;

      /* Walk back from the first slot of the batch to a preferred weekday. */
      let cursor = batchHead.startUtc - config.leadDays * MS_PER_DAY;
      let localDate = context.localDateOf(cursor);
      for (let attempt = 0; attempt < 7; attempt += 1) {
        if (matchesWeekdays(localDate, config.preferredWeekdays)) break;
        cursor -= MS_PER_DAY;
        localDate = context.localDateOf(cursor);
      }

      if (used.has(localDate)) continue;
      used.add(localDate);

      const startUtc = context.midnightUtc(localDate) + preferredMinute * MS_PER_MINUTE;
      out.push({
        localDate,
        startUtc,
        endUtc: startUtc + config.durationMinutes * MS_PER_MINUTE,
      });
    }

    return out;
  },

  describe(config) {
    return `One production block per ${config.perSlots} slots, ${config.leadDays}d ahead`;
  },
};

/* ---- conditional, section 4.15 ---- */

const predicateSchema: z.ZodType<Predicate> = z.lazy(() =>
  z.union([
    z.object({ all: z.array(predicateSchema) }),
    z.object({ any: z.array(predicateSchema) }),
    z.object({ not: predicateSchema }),
    z.object({ type: z.literal("weekday-in"), weekdays: z.array(weekdayKeySchema) }),
    z.object({ type: z.literal("date-range"), from: z.string(), to: z.string() }),
    z.object({ type: z.literal("has-block-with-tag"), tag: z.string() }),
    z.object({ type: z.literal("no-block-with-tag"), tag: z.string() }),
    z.object({
      type: z.literal("free-minutes-at-least"),
      window: z.tuple([clockSchema, clockSchema]),
      minutes: z.number().int().min(0),
    }),
    z.object({ type: z.literal("block-count-below"), value: z.number().int().min(0) }),
    z.object({ type: z.literal("momentum-above"), value: z.number() }),
    z.object({ type: z.literal("momentum-below"), value: z.number() }),
    z.object({ type: z.literal("is-holiday") }),
    z.object({ type: z.literal("nth-week-of-month"), n: z.number().int().min(1).max(5) }),
    z.object({ type: z.literal("parity"), even: z.boolean() }),
  ]),
);

export type Predicate =
  | { all: Predicate[] }
  | { any: Predicate[] }
  | { not: Predicate }
  | { type: "weekday-in"; weekdays: string[] }
  | { type: "date-range"; from: string; to: string }
  | { type: "has-block-with-tag"; tag: string }
  | { type: "no-block-with-tag"; tag: string }
  | { type: "free-minutes-at-least"; window: [string, string]; minutes: number }
  | { type: "block-count-below"; value: number }
  | { type: "momentum-above"; value: number }
  | { type: "momentum-below"; value: number }
  | { type: "is-holiday" }
  | { type: "nth-week-of-month"; n: number }
  | { type: "parity"; even: boolean };

export const conditionalSchema = z.object({
  inner: z.object({ kind: z.string(), config: z.unknown() }),
  predicate: predicateSchema,
});

export type ConditionalConfig = z.infer<typeof conditionalSchema>;

function blocksOn(context: EmitContext, localDate: string) {
  const midnight = context.midnightUtc(localDate);
  const end = midnight + MS_PER_DAY;
  return context.world.blocks.filter(
    (block) => block.startUtc !== null && block.startUtc >= midnight && block.startUtc < end,
  );
}

export function evaluatePredicate(
  predicate: Predicate,
  localDate: string,
  context: EmitContext,
): boolean {
  if ("all" in predicate) {
    return predicate.all.every((child) => evaluatePredicate(child, localDate, context));
  }
  if ("any" in predicate) {
    return predicate.any.some((child) => evaluatePredicate(child, localDate, context));
  }
  if ("not" in predicate) {
    return !evaluatePredicate(predicate.not, localDate, context);
  }

  switch (predicate.type) {
    case "weekday-in":
      return matchesWeekdays(
        localDate,
        predicate.weekdays as Parameters<typeof matchesWeekdays>[1],
      );
    case "date-range":
      return localDate >= predicate.from && localDate <= predicate.to;
    case "has-block-with-tag":
      return blocksOn(context, localDate).some((block) =>
        block.tags.includes(predicate.tag),
      );
    case "no-block-with-tag":
      return !blocksOn(context, localDate).some((block) =>
        block.tags.includes(predicate.tag),
      );
    case "block-count-below":
      return blocksOn(context, localDate).length < predicate.value;
    case "free-minutes-at-least": {
      const from = parseClock(predicate.window[0]) ?? 0;
      const to = parseClock(predicate.window[1]) ?? 1440;
      const midnight = context.midnightUtc(localDate);
      const start = midnight + from * MS_PER_MINUTE;
      const end = midnight + to * MS_PER_MINUTE;
      let busy = 0;
      for (const block of blocksOn(context, localDate)) {
        if (block.startUtc === null || block.endUtc === null) continue;
        const overlap =
          Math.min(block.endUtc, end) - Math.max(block.startUtc, start);
        if (overlap > 0) busy += overlap;
      }
      return (end - start - busy) / MS_PER_MINUTE >= predicate.minutes;
    }
    case "momentum-above":
    case "momentum-below": {
      const entry = context.world.momentum.find((row) => row.date === localDate);
      if (entry === undefined) return false;
      return predicate.type === "momentum-above"
        ? entry.value > predicate.value
        : entry.value < predicate.value;
    }
    case "is-holiday":
      return context.world.holidays.includes(localDate);
    case "nth-week-of-month":
      return Math.ceil(Number(localDate.slice(8)) / 7) === predicate.n;
    case "parity": {
      const week = Math.floor(
        Date.UTC(
          Number(localDate.slice(0, 4)),
          Number(localDate.slice(5, 7)) - 1,
          Number(localDate.slice(8)),
        ) / (7 * MS_PER_DAY),
      );
      return predicate.even ? week % 2 === 0 : week % 2 !== 0;
    }
  }
}

export const conditional: KindModule<ConditionalConfig> = {
  kind: "conditional",
  schema: conditionalSchema,
  lookbackDays: 1,

  emit(config, context) {
    /* World state is read through the same snapshot for every date in the
       pass, so a predicate cannot see the calendar change under it. */
    const allowed = context.dates.filter((localDate) =>
      evaluatePredicate(config.predicate, localDate, context),
    );
    if (allowed.length === 0) return [];

    return context.emitInline(
      {
        ...context.generator,
        kind: config.inner.kind as GeneratorKind,
        config: config.inner.config,
      },
      allowed,
    );
  },

  describe() {
    return "Only when its condition holds";
  },
};
