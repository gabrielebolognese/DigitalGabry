import { z } from "zod";
import { parseClock } from "../tz";
import { clockSchema, matchesWeekdays, weekdayKeySchema } from "../weekdays";
import type { KindModule } from "../registry";
import type { Candidate } from "../types";

/* Spec1.1 section 4.2. The same list every day, with optional weekday
   filtering. Shorthand for weekly-grid, not a special case of it: keeping it
   separate is what lets its editor stay one list rather than seven. */

export const dailyTimesSchema = z.object({
  times: z.array(clockSchema).default([]),
  weekdays: z.array(weekdayKeySchema).optional(),
});

export type DailyTimesConfig = z.infer<typeof dailyTimesSchema>;

export const dailyTimes: KindModule<DailyTimesConfig> = {
  kind: "daily-times",
  schema: dailyTimesSchema,
  lookbackDays: 0,

  emit(config, context) {
    const candidates: Candidate[] = [];
    const durationMs = context.generator.emits.durationMinutes * 60_000;

    const minutes = config.times
      .map(parseClock)
      .filter((value): value is number => value !== null)
      .sort((left, right) => left - right);
    if (minutes.length === 0) return candidates;

    for (const localDate of context.dates) {
      if (!matchesWeekdays(localDate, config.weekdays)) continue;

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
    if (config.times.length === 0) return "No times set";
    const days =
      config.weekdays === undefined || config.weekdays.length === 0
        ? "every day"
        : config.weekdays.join(", ");
    return `${config.times.length} a day, ${days}`;
  },
};
