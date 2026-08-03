import { z } from "zod";
import { parseClock } from "../tz";
import { WEEKDAY_KEYS, clockSchema, weekdayKeyOf } from "../weekdays";
import type { KindModule } from "../registry";
import type { Candidate } from "../types";

/* Spec1.1 section 4.1. Explicit times per weekday, the primary case. */

export const weeklyGridSchema = z.object({
  times: z
    .object({
      mon: z.array(clockSchema).default([]),
      tue: z.array(clockSchema).default([]),
      wed: z.array(clockSchema).default([]),
      thu: z.array(clockSchema).default([]),
      fri: z.array(clockSchema).default([]),
      sat: z.array(clockSchema).default([]),
      sun: z.array(clockSchema).default([]),
    })
    .partial()
    .default({}),
});

export type WeeklyGridConfig = z.infer<typeof weeklyGridSchema>;

export const weeklyGrid: KindModule<WeeklyGridConfig> = {
  kind: "weekly-grid",
  schema: weeklyGridSchema,
  lookbackDays: 0,

  emit(config, context) {
    const candidates: Candidate[] = [];
    const durationMs = context.generator.emits.durationMinutes * 60_000;

    for (const localDate of context.dates) {
      const times = config.times[weekdayKeyOf(localDate)] ?? [];
      if (times.length === 0) continue;

      /* Stored order is whatever the editor left behind; emitted order is
         always sorted, because the ordinal a slot gets is its position in the
         day and an override keyed to ordinal 2 must not move when the editor
         happens to append rather than insert. */
      const minutes = times
        .map(parseClock)
        .filter((value): value is number => value !== null)
        .sort((left, right) => left - right);

      for (const minute of minutes) {
        for (const startUtc of context.resolve(localDate, minute).instants) {
          candidates.push({
            localDate,
            startUtc,
            endUtc: startUtc + durationMs,
          });
        }
      }
    }

    return candidates;
  },

  describe(config) {
    const parts = WEEKDAY_KEYS.filter((key) => (config.times[key] ?? []).length > 0)
      .map((key) => `${(config.times[key] ?? []).length} on ${key}`)
      .join(", ");
    return parts === "" ? "No times set" : parts;
  },
};
