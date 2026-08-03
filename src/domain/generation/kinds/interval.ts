import { z } from "zod";
import { parseClock } from "../tz";
import { clockSchema, matchesWeekdays, weekdayKeySchema } from "../weekdays";
import type { KindModule } from "../registry";
import type { Candidate } from "../types";

/* Spec1.1 section 4.3. Every N minutes inside a window. */

export const intervalSchema = z.object({
  everyMinutes: z.number().int().min(1).max(1440),
  window: z.tuple([clockSchema, clockSchema]),
  weekdays: z.array(weekdayKeySchema).optional(),
  alignTo: z.enum(["window-start", "midnight", "hour"]).default("window-start"),
});

export type IntervalConfig = z.infer<typeof intervalSchema>;

export const interval: KindModule<IntervalConfig> = {
  kind: "interval",
  schema: intervalSchema,
  lookbackDays: 0,

  emit(config, context) {
    const candidates: Candidate[] = [];
    const durationMs = context.generator.emits.durationMinutes * 60_000;

    const from = parseClock(config.window[0]);
    const to = parseClock(config.window[1]);
    if (from === null || to === null || to <= from) return candidates;

    /* Where the first slot of the day sits. Aligning to midnight or the hour
       makes the times read the same on every day regardless of where the
       window happens to open. */
    const firstOf = (): number => {
      if (config.alignTo === "window-start") return from;
      const base = config.alignTo === "hour" ? Math.floor(from / 60) * 60 : 0;
      if (base >= from) return base;
      const steps = Math.ceil((from - base) / config.everyMinutes);
      return base + steps * config.everyMinutes;
    };

    for (const localDate of context.dates) {
      if (!matchesWeekdays(localDate, config.weekdays)) continue;

      for (
        let minute = firstOf();
        minute <= to;
        minute += config.everyMinutes
      ) {
        for (const startUtc of context.resolve(localDate, minute).instants) {
          candidates.push({ localDate, startUtc, endUtc: startUtc + durationMs });
        }
      }
    }

    return candidates;
  },

  describe(config) {
    const every =
      config.everyMinutes % 60 === 0
        ? `${config.everyMinutes / 60}h`
        : `${config.everyMinutes}m`;
    return `Every ${every} from ${config.window[0]} to ${config.window[1]}`;
  },
};
