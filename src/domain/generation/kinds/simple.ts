import { z } from "zod";
import { cronMatchesDate, cronMinutesOfDay, parseCron } from "../cron";
import { parseClock } from "../tz";
import { clockSchema, matchesWeekdays, weekdayKeySchema } from "../weekdays";
import type { KindModule } from "../registry";
import type { Candidate } from "../types";

/* Spec1.1 sections 4.7, 4.9 and 4.10. Three kinds that need no world state
   beyond a single day, kept together because each is a dozen lines and a file
   apiece would be filing rather than structure. */

const MS_PER_MINUTE = 60_000;

/* ---- cron, section 4.7 ---- */

export const cronSchema = z.object({
  expression: z.string().min(1),
});

export type CronConfig = z.infer<typeof cronSchema>;

export const cron: KindModule<CronConfig> = {
  kind: "cron",
  schema: cronSchema,
  lookbackDays: 0,

  emit(config, context) {
    const parsed = parseCron(config.expression);
    if (!parsed.ok) {
      context.notice("cron-invalid", parsed.error);
      return [];
    }

    const candidates: Candidate[] = [];
    const durationMs = context.generator.emits.durationMinutes * MS_PER_MINUTE;
    const minutes = cronMinutesOfDay(parsed.fields);

    for (const localDate of context.dates) {
      if (!cronMatchesDate(parsed.fields, localDate)) continue;
      for (const minute of minutes) {
        for (const startUtc of context.resolve(localDate, minute).instants) {
          candidates.push({ localDate, startUtc, endUtc: startUtc + durationMs });
        }
      }
    }

    return candidates;
  },

  describe(config) {
    const parsed = parseCron(config.expression);
    return parsed.ok ? config.expression : `Invalid: ${parsed.error}`;
  },
};

/* ---- pattern, section 4.9 ---- */

export const patternSchema = z.object({
  pattern: z.array(z.enum(["on", "off"])).min(1),
  anchorDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  onConfig: z.object({ times: z.array(clockSchema).default([]) }).default({ times: [] }),
});

export type PatternConfig = z.infer<typeof patternSchema>;

function daysSince(anchorDate: string, localDate: string): number {
  const parse = (text: string): number => {
    const [year, month, day] = text.split("-").map(Number);
    return Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1);
  };
  return Math.round((parse(localDate) - parse(anchorDate)) / 86_400_000);
}

export const pattern: KindModule<PatternConfig> = {
  kind: "pattern",
  schema: patternSchema,
  lookbackDays: 0,

  emit(config, context) {
    const candidates: Candidate[] = [];
    const durationMs = context.generator.emits.durationMinutes * MS_PER_MINUTE;

    const minutes = config.onConfig.times
      .map(parseClock)
      .filter((value): value is number => value !== null)
      .sort((left, right) => left - right);
    if (minutes.length === 0) return candidates;

    for (const localDate of context.dates) {
      /* Modulo that stays positive for dates before the anchor, so the pattern
         is defined in both directions rather than only forwards. */
      const offset = daysSince(config.anchorDate, localDate);
      const index =
        ((offset % config.pattern.length) + config.pattern.length) % config.pattern.length;
      if (config.pattern[index] !== "on") continue;

      for (const minute of minutes) {
        for (const startUtc of context.resolve(localDate, minute).instants) {
          candidates.push({ localDate, startUtc, endUtc: startUtc + durationMs });
        }
      }
    }

    return candidates;
  },

  describe(config) {
    return `${config.pattern.join(", ")} from ${config.anchorDate}`;
  },
};

/* ---- relative, section 4.10 ---- */

export const relativeSchema = z.object({
  anchor: z.enum([
    "first-block-of-day",
    "last-block-of-day",
    "day-start",
    "day-end",
    "first-block-with-tag",
    "largest-gap-start",
  ]),
  offsetMinutes: z.number().int().min(-1440).max(1440).default(0),
  fallbackTime: clockSchema.default("10:00"),
  tag: z.string().optional(),
  weekdays: z.array(weekdayKeySchema).optional(),
});

export type RelativeConfig = z.infer<typeof relativeSchema>;

export const relative: KindModule<RelativeConfig> = {
  kind: "relative",
  schema: relativeSchema,
  // Positioned off what is already in the day, so one day of lookback.
  lookbackDays: 1,

  emit(config, context) {
    const candidates: Candidate[] = [];
    const durationMs = context.generator.emits.durationMinutes * MS_PER_MINUTE;
    const fallback = parseClock(config.fallbackTime) ?? 600;

    for (const localDate of context.dates) {
      if (!matchesWeekdays(localDate, config.weekdays)) continue;

      const midnight = context.midnightUtc(localDate);
      const dayEnd = midnight + 86_400_000;

      const inDay = context.world.blocks
        .filter(
          (block): block is typeof block & { startUtc: number; endUtc: number } =>
            block.startUtc !== null &&
            block.endUtc !== null &&
            block.startUtc >= midnight &&
            block.startUtc < dayEnd,
        )
        .sort((left, right) => left.startUtc - right.startUtc);

      let anchorUtc: number | null = null;

      switch (config.anchor) {
        case "day-start":
          anchorUtc = midnight;
          break;
        case "day-end":
          anchorUtc = dayEnd;
          break;
        case "first-block-of-day":
          anchorUtc = inDay[0]?.startUtc ?? null;
          break;
        case "last-block-of-day":
          anchorUtc = inDay[inDay.length - 1]?.endUtc ?? null;
          break;
        case "first-block-with-tag":
          anchorUtc =
            inDay.find((block) =>
              config.tag === undefined ? false : block.tags.includes(config.tag),
            )?.startUtc ?? null;
          break;
        case "largest-gap-start": {
          let best: { start: number; size: number } = { start: midnight, size: 0 };
          let cursor = midnight;
          for (const block of inDay) {
            if (block.startUtc > cursor && block.startUtc - cursor > best.size) {
              best = { start: cursor, size: block.startUtc - cursor };
            }
            cursor = Math.max(cursor, block.endUtc);
          }
          if (dayEnd - cursor > best.size) best = { start: cursor, size: dayEnd - cursor };
          anchorUtc = best.size > 0 ? best.start : null;
          break;
        }
      }

      /* An absent anchor falls back to a fixed time rather than emitting
         nothing, so a day with an empty calendar still gets its slot. */
      const startUtc =
        anchorUtc === null
          ? midnight + fallback * MS_PER_MINUTE
          : anchorUtc + config.offsetMinutes * MS_PER_MINUTE;

      candidates.push({ localDate, startUtc, endUtc: startUtc + durationMs });
    }

    return candidates;
  },

  describe(config) {
    const sign = config.offsetMinutes >= 0 ? "+" : "";
    return `${sign}${config.offsetMinutes}m from ${config.anchor}`;
  },
};
