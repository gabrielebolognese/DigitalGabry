import { z } from "zod";
import { MINUTES_PER_HOUR } from "../../time";
import type { KindModule } from "../registry";
import type { Candidate } from "../types";

/* Spec1.1 section 4.16. An explicit list of local datetimes, so imported
   schedules and one-off campaigns live in the same system as everything else
   rather than as loose blocks outside it. */

const LOCAL_DATETIME = /^(\d{4}-\d{2}-\d{2})T([01]?\d|2[0-3]):([0-5]\d)$/;

export const manualSetSchema = z.object({
  datetimes: z
    .array(
      z
        .string()
        .regex(LOCAL_DATETIME, "must look like 2026-09-01T09:00, with no zone"),
    )
    .default([]),
});

export type ManualSetConfig = z.infer<typeof manualSetSchema>;

export const manualSet: KindModule<ManualSetConfig> = {
  kind: "manual-set",
  schema: manualSetSchema,
  lookbackDays: 0,

  emit(config, context) {
    const candidates: Candidate[] = [];
    const durationMs = context.generator.emits.durationMinutes * 60_000;
    /* The listed dates need not fall inside the window; a Set makes the
       membership test one lookup rather than a scan per entry. */
    const wanted = new Set(context.dates);

    for (const entry of config.datetimes) {
      const match = LOCAL_DATETIME.exec(entry);
      if (match === null) continue;

      const localDate = match[1] ?? "";
      if (!wanted.has(localDate)) continue;

      const minutes = Number(match[2]) * MINUTES_PER_HOUR + Number(match[3]);
      for (const startUtc of context.resolve(localDate, minutes).instants) {
        candidates.push({ localDate, startUtc, endUtc: startUtc + durationMs });
      }
    }

    return candidates;
  },

  describe(config) {
    return config.datetimes.length === 0
      ? "No dates listed"
      : `${config.datetimes.length} listed ${config.datetimes.length === 1 ? "date" : "dates"}`;
  },
};
