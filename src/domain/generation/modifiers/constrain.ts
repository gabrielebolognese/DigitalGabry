import { z } from "zod";
import {
  byStart,
  groupBy,
  isProtected,
  matchesScope,
  periodKeyOf,
  periodSchema,
  scopeSchema,
} from "../scope";
import type { ModifierModule } from "./index";
import type { Slot } from "../types";

/* Stage 5, in this order: spacing then capacity. Spacing can move slots
   together or apart, so the count capacity is enforcing has to be counted
   after that has settled. */

const MS_PER_MINUTE = 60_000;

export const spacingSchema = z.object({
  minMinutes: z.number().int().min(0).max(10080),
  scope: scopeSchema,
  resolution: z.enum(["shift-later", "shift-earlier", "drop", "allow"]).default("shift-later"),
  maxShiftMinutes: z.number().int().min(0).max(1440).default(60),
});

export type SpacingConfig = z.infer<typeof spacingSchema>;

export const spacing: ModifierModule<SpacingConfig> = {
  kind: "spacing",
  stage: "constrain",
  schema: spacingSchema,

  apply(config, slots, context) {
    if (config.minMinutes === 0 || config.resolution === "allow") return slots;

    const minGap = config.minMinutes * MS_PER_MINUTE;
    const maxShift = config.maxShiftMinutes * MS_PER_MINUTE;

    const inScope = slots.filter((slot) => matchesScope(slot, config.scope));
    const others = slots.filter((slot) => !matchesScope(slot, config.scope));
    inScope.sort(byStart);

    const kept: Slot[] = [];
    let previousStart: number | null = null;

    for (const slot of inScope) {
      if (previousStart === null || slot.startUtc - previousStart >= minGap) {
        kept.push(slot);
        previousStart = slot.startUtc;
        continue;
      }

      /* A protected slot is never moved to satisfy a rule, so it sets the new
         reference and whatever follows has to work around it. */
      if (isProtected(slot)) {
        kept.push(slot);
        previousStart = slot.startUtc;
        continue;
      }

      const target =
        config.resolution === "shift-earlier"
          ? previousStart - minGap
          : previousStart + minGap;
      const distance = Math.abs(target - slot.startUtc);

      /* Shifting further than allowed is not silently accepted. The slot goes,
         and the reason travels with it to the preview. Edge case 6. */
      if (config.resolution === "drop" || distance > maxShift) {
        context.drop(
          slot,
          config.resolution === "drop"
            ? `closer than ${config.minMinutes}m to the previous slot`
            : `needed ${Math.round(distance / MS_PER_MINUTE)}m of shift to clear ${config.minMinutes}m spacing, limit is ${config.maxShiftMinutes}m`,
        );
        continue;
      }

      const duration = slot.endUtc - slot.startUtc;
      slot.startUtc = target;
      slot.endUtc = target + duration;
      context.note(slot, `shifted to clear ${config.minMinutes}m spacing`);
      kept.push(slot);
      previousStart = slot.startUtc;
    }

    return [...kept, ...others];
  },

  describe(config) {
    return `At least ${config.minMinutes}m apart, ${config.resolution}`;
  },
};

export const capacitySchema = z.object({
  max: z.number().int().min(0).max(1000),
  period: periodSchema.default("day"),
  scope: scopeSchema,
  eviction: z
    .enum([
      "drop-lowest-layer",
      "drop-latest",
      "drop-earliest",
      "drop-closest-pair",
      "compress",
    ])
    .default("drop-lowest-layer"),
});

export type CapacityConfig = z.infer<typeof capacitySchema>;

/* Which slots to evict, given how many have to go. Pure and separately
   testable, which matters because the policies are easy to get subtly wrong
   and impossible to see going wrong. */
function chooseEvictions(
  candidates: readonly Slot[],
  excess: number,
  eviction: CapacityConfig["eviction"],
): Slot[] {
  if (excess <= 0) return [];

  if (eviction === "drop-closest-pair") {
    /* Repeatedly drop the later of whichever adjacent pair sits closest,
       which thins a cluster rather than trimming an end. */
    const remaining = [...candidates].sort(byStart);
    const dropped: Slot[] = [];

    while (dropped.length < excess && remaining.length > 1) {
      let bestIndex = 1;
      let bestGap = Infinity;
      for (let index = 1; index < remaining.length; index += 1) {
        const gap =
          (remaining[index]?.startUtc ?? 0) - (remaining[index - 1]?.startUtc ?? 0);
        if (gap < bestGap) {
          bestGap = gap;
          bestIndex = index;
        }
      }
      const [removed] = remaining.splice(bestIndex, 1);
      if (removed !== undefined) dropped.push(removed);
    }
    return dropped;
  }

  const ordered = [...candidates];
  switch (eviction) {
    case "drop-lowest-layer":
      ordered.sort((left, right) => left.layer - right.layer || byStart(right, left));
      break;
    case "drop-latest":
      ordered.sort((left, right) => byStart(right, left));
      break;
    case "drop-earliest":
      ordered.sort(byStart);
      break;
    default:
      break;
  }
  return ordered.slice(0, excess);
}

export const capacity: ModifierModule<CapacityConfig> = {
  kind: "capacity",
  stage: "constrain",
  schema: capacitySchema,

  apply(config, slots, context) {
    const inScope = slots.filter((slot) => matchesScope(slot, config.scope));
    if (inScope.length === 0) return slots;

    const evicted = new Set<Slot>();
    const buckets = groupBy(inScope, (slot) => periodKeyOf(slot.localDate, config.period));

    for (const [key, bucket] of buckets) {
      if (bucket.length <= config.max) continue;

      /* Bound and pinned slots are never evicted. If they alone exceed the
         cap, nothing is dropped and the overage is reported rather than
         quietly enforced against work someone has already committed to.
         Edge case 5. */
      const protectedSlots = bucket.filter(isProtected);
      const evictable = bucket.filter((slot) => !isProtected(slot));

      if (protectedSlots.length >= config.max) {
        context.notice(
          "capacity-exceeded",
          `${protectedSlots.length} committed slots in ${key} already meet or exceed the limit of ${config.max}; nothing was evicted`,
        );
        continue;
      }

      const excess = bucket.length - config.max;

      if (config.eviction === "compress") {
        /* Keeps them all and redistributes evenly across the span they
           occupied, rather than leaving a hole where an evicted one was. */
        const ordered = [...bucket].sort(byStart);
        const first = ordered[0];
        const last = ordered[ordered.length - 1];
        if (first === undefined || last === undefined || ordered.length < 2) continue;

        const span = last.startUtc - first.startUtc;
        const step = span / (ordered.length - 1);
        for (const [index, slot] of ordered.entries()) {
          if (isProtected(slot)) continue;
          const duration = slot.endUtc - slot.startUtc;
          slot.startUtc = Math.round(first.startUtc + index * step);
          slot.endUtc = slot.startUtc + duration;
          context.note(slot, `compressed into ${key}`);
        }
        continue;
      }

      for (const slot of chooseEvictions(evictable, excess, config.eviction)) {
        evicted.add(slot);
        context.drop(slot, `over the limit of ${config.max} per ${config.period}`);
      }
    }

    return evicted.size === 0 ? slots : slots.filter((slot) => !evicted.has(slot));
  },

  describe(config) {
    return `At most ${config.max} per ${config.period}, ${config.eviction}`;
  },
};

export { chooseEvictions };
