import { dailyTimesSchema } from "./kinds/dailyTimes";
import { weeklyGridSchema } from "./kinds/weeklyGrid";
import { rekeyByNearestTime, slotKeyOf } from "./slotKey";
import { parseClock } from "./tz";
import { weekdayKeyOf, type WeekdayKey } from "./weekdays";
import type { GeneratorKind } from "./types";

/* Spec1.1 section 7, the failure case it names outright.

   Slot identity is (generator, local date, ordinal), which is right almost
   always: moving a time from 08:00 to 09:00 keeps the slot's identity, so a
   skip applied to it still applies. The exception is inserting a time at the
   start of a day, which shifts every later ordinal and would silently
   misalign every override after the insertion point. A skip on the evening
   post would come back as a skip on the afternoon one.

   So this is never done silently. The mapping is computed, reported, applied
   in one transaction, and kept so it can be undone. */

export type RekeyPair = {
  fromKey: string;
  toKey: string;
  localDate: string;
  fromOrdinal: number;
  toOrdinal: number;
};

export type RekeyPlan = {
  generatorId: string;
  pairs: RekeyPair[];
  /* Overrides with nowhere to go, because the time they were attached to was
     removed. Reported rather than dropped on the floor. */
  orphaned: { key: string; localDate: string; ordinal: number }[];
};

function minutesOf(times: readonly string[]): number[] {
  return times
    .map(parseClock)
    .filter((value): value is number => value !== null)
    .sort((left, right) => left - right);
}

function timesForKind(
  kind: GeneratorKind,
  config: unknown,
  weekday: WeekdayKey,
): number[] | null {
  if (kind === "daily-times") {
    const parsed = dailyTimesSchema.safeParse(config);
    if (!parsed.success) return null;
    const weekdays = parsed.data.weekdays;
    if (weekdays !== undefined && weekdays.length > 0 && !weekdays.includes(weekday)) {
      return [];
    }
    return minutesOf(parsed.data.times);
  }

  if (kind === "weekly-grid") {
    const parsed = weeklyGridSchema.safeParse(config);
    if (!parsed.success) return null;
    return minutesOf(parsed.data.times[weekday] ?? []);
  }

  return null;
}

export type OverrideRef = { slotKey: string; localDate: string; ordinal: number };

/* Only the two kinds whose editor is a list of times can shift ordinals this
   way. Everything else derives its times from a rule, where editing changes
   what is emitted rather than renumbering what already was. */
export function planRekey(
  generatorId: string,
  kind: GeneratorKind,
  oldConfig: unknown,
  newConfig: unknown,
  overrides: readonly OverrideRef[],
): RekeyPlan {
  const plan: RekeyPlan = { generatorId, pairs: [], orphaned: [] };
  if (kind !== "daily-times" && kind !== "weekly-grid") return plan;

  /* One mapping per weekday, computed once, because every date sharing a
     weekday shares its ordinals. */
  const mappings = new Map<WeekdayKey, Map<number, number>>();

  for (const override of overrides) {
    const weekday = weekdayKeyOf(override.localDate);

    let mapping = mappings.get(weekday);
    if (mapping === undefined) {
      const before = timesForKind(kind, oldConfig, weekday);
      const after = timesForKind(kind, newConfig, weekday);
      if (before === null || after === null) continue;
      mapping = rekeyByNearestTime(before, after);
      mappings.set(weekday, mapping);
    }

    const next = mapping.get(override.ordinal);

    if (next === undefined) {
      plan.orphaned.push({
        key: override.slotKey,
        localDate: override.localDate,
        ordinal: override.ordinal,
      });
      continue;
    }

    if (next === override.ordinal) continue;

    plan.pairs.push({
      fromKey: override.slotKey,
      toKey: slotKeyOf(generatorId, override.localDate, next),
      localDate: override.localDate,
      fromOrdinal: override.ordinal,
      toOrdinal: next,
    });
  }

  plan.pairs.sort((left, right) =>
    left.localDate < right.localDate
      ? -1
      : left.localDate > right.localDate
        ? 1
        : left.fromOrdinal - right.fromOrdinal,
  );

  return plan;
}

/* The plan reversed, which is the undo. Kept as data rather than as a stored
   procedure so the caller can show it and apply it with the same code. */
export function invertRekey(plan: RekeyPlan): RekeyPlan {
  return {
    generatorId: plan.generatorId,
    orphaned: [],
    pairs: plan.pairs.map((pair) => ({
      fromKey: pair.toKey,
      toKey: pair.fromKey,
      localDate: pair.localDate,
      fromOrdinal: pair.toOrdinal,
      toOrdinal: pair.fromOrdinal,
    })),
  };
}

export function describeRekey(plan: RekeyPlan): string {
  if (plan.pairs.length === 0 && plan.orphaned.length === 0) {
    return "No overrides needed moving";
  }
  const moved = `${plan.pairs.length} ${plan.pairs.length === 1 ? "override" : "overrides"} remapped`;
  if (plan.orphaned.length === 0) return moved;
  return `${moved}, ${plan.orphaned.length} left without a matching time`;
}
