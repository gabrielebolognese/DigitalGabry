import { z } from "zod";
import { generateOccurrences } from "../../recurrence";
import { parseClock } from "../tz";
import { clockSchema } from "../weekdays";
import type { KindModule } from "../registry";
import type { Candidate } from "../types";

/* Spec1.1 section 4.6. Full RFC 5545 for anything calendar shaped that the
   simpler kinds cannot express.

   Delegates to domain/recurrence.ts, which is the only file in the app allowed
   to import rrule and already carries the floating-mode discipline, the
   iteration guards and the UNTIL canonicalisation from phase 6. Parsing the
   rule again here would be a second implementation free to disagree with the
   one the calendar already uses. */

export const rruleSchema = z.object({
  rrule: z.string().min(1),
  /* Sets the phase of the rule. An every-other-week rule has to start counting
     somewhere, and it cannot be the generation window: anchoring there would
     make the output depend on which viewport asked for it, which breaks
     determinism outright. */
  anchorDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "must be a date like 2026-01-01")
    .default("2020-01-01"),
  time: clockSchema.default("09:00"),
});

export type RruleConfig = z.infer<typeof rruleSchema>;

export const rruleKind: KindModule<RruleConfig> = {
  kind: "rrule",
  schema: rruleSchema,
  lookbackDays: 0,

  emit(config, context) {
    const durationMs = context.generator.emits.durationMinutes * 60_000;
    const minute = parseClock(config.time) ?? 540;

    const anchorInstants = context.resolve(config.anchorDate, minute).instants;
    const anchorStart = anchorInstants[0];
    if (anchorStart === undefined) return [];

    const first = context.dates[0];
    const last = context.dates[context.dates.length - 1];
    if (first === undefined || last === undefined) return [];

    const result = generateOccurrences(
      {
        blockId: context.generator.id,
        startUtc: anchorStart,
        endUtc: anchorStart + durationMs,
        tz: context.generator.timezone,
        rrule: config.rrule,
      },
      {
        start: context.midnightUtc(first),
        end: context.midnightUtc(last) + 86_400_000,
      },
    );

    if (result.truncated) {
      context.notice(
        "rrule-truncated",
        "The rule produced more occurrences than the cap allows; later ones were dropped",
      );
    }

    return result.occurrences.map<Candidate>((occurrence) => ({
      localDate: context.localDateOf(occurrence.startUtc),
      startUtc: occurrence.startUtc,
      endUtc: occurrence.endUtc,
    }));
  },

  describe(config) {
    return `${config.rrule} at ${config.time}`;
  },
};
