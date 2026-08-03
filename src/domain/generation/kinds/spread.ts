import { z } from "zod";
import { parseClock } from "../tz";
import { clockSchema, matchesWeekdays, weekdayKeySchema } from "../weekdays";
import type { KindModule } from "../registry";
import type { Candidate } from "../types";

/* Spec1.1 section 4.4. N slots a day across a window. Distinct from interval
   in that the count is fixed and the gap follows from it, rather than the
   other way round. */

export const spreadSchema = z.object({
  perDay: z.number().int().min(1).max(96),
  window: z.tuple([clockSchema, clockSchema]),
  distribution: z.enum(["even", "front-loaded", "back-loaded", "golden"]).default("even"),
  includeEndpoints: z.boolean().default(true),
  weekdays: z.array(weekdayKeySchema).optional(),
});

export type SpreadConfig = z.infer<typeof spreadSchema>;

const GOLDEN_RATIO_CONJUGATE = 0.618033988749895;

/* Positions in [0, 1] before the window is applied. Pure, so the shape of a
   distribution is testable without any dates involved. */
function positions(count: number, distribution: SpreadConfig["distribution"], includeEndpoints: boolean): number[] {
  const out: number[] = [];

  for (let index = 0; index < count; index += 1) {
    let fraction: number;

    if (count === 1) {
      fraction = includeEndpoints ? 0 : 0.5;
    } else if (includeEndpoints) {
      fraction = index / (count - 1);
    } else {
      // Cell centres, so the first and last keep a margin from the edges.
      fraction = (index + 0.5) / count;
    }

    switch (distribution) {
      case "even":
        out.push(fraction);
        break;
      /* Quadratic easing, which places them denser at one end. */
      case "front-loaded":
        out.push(fraction * fraction);
        break;
      case "back-loaded":
        out.push(1 - (1 - fraction) * (1 - fraction));
        break;
      /* Golden ratio steps read as less mechanical than an even grid, and are
         still completely deterministic. */
      case "golden":
        out.push((index * GOLDEN_RATIO_CONJUGATE) % 1);
        break;
    }
  }

  /* Golden positions come out unordered by construction; the engine assigns
     ordinals by time, so emitting them sorted keeps ordinal and clock order
     agreeing. */
  return out.sort((left, right) => left - right);
}

export const spread: KindModule<SpreadConfig> = {
  kind: "spread",
  schema: spreadSchema,
  lookbackDays: 0,

  emit(config, context) {
    const candidates: Candidate[] = [];
    const durationMs = context.generator.emits.durationMinutes * 60_000;

    const from = parseClock(config.window[0]);
    const to = parseClock(config.window[1]);
    if (from === null || to === null || to <= from) return candidates;

    const span = to - from;
    const fractions = positions(config.perDay, config.distribution, config.includeEndpoints);

    for (const localDate of context.dates) {
      if (!matchesWeekdays(localDate, config.weekdays)) continue;

      for (const fraction of fractions) {
        const minute = Math.round(from + fraction * span);
        for (const startUtc of context.resolve(localDate, minute).instants) {
          candidates.push({ localDate, startUtc, endUtc: startUtc + durationMs });
        }
      }
    }

    return candidates;
  },

  describe(config) {
    return `${config.perDay} a day, ${config.distribution}, ${config.window[0]} to ${config.window[1]}`;
  },
};

export { positions as spreadPositions };
