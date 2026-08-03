import { z } from "zod";
import { parseClock } from "../tz";
import { periodKeyOf, periodSchema } from "../scope";
import { clockSchema, matchesWeekdays, weekdayKeySchema } from "../weekdays";
import type { EmitContext, KindModule } from "../registry";
import type { Candidate, Period } from "../types";

/* Spec1.1 section 4.5. N slots a period, for when the count matters and the
   exact time does not. */

export const quotaSchema = z.object({
  count: z.number().int().min(1).max(200),
  period: periodSchema.default("week"),
  weekdays: z.array(weekdayKeySchema).optional(),
  window: z.tuple([clockSchema, clockSchema]).default(["09:00", "17:00"]),
  placement: z
    .enum(["spread-days", "earliest", "latest", "free-space", "balanced"])
    .default("spread-days"),
  minGapHours: z.number().min(0).max(720).default(0),
});

export type QuotaConfig = z.infer<typeof quotaSchema>;

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;

/* Every date in the period a local date belongs to, derived from the period
   itself rather than from the generation window.

   This is what keeps a quota deterministic. Placing across only the dates the
   window happens to cover would put a weekly quota in different places
   depending on where the viewport starts, and the same slot would get a
   different key in a narrow window than in a wide one. */
function datesInPeriodOf(localDate: string, period: Period): string[] {
  const [year, month, day] = localDate.split("-").map(Number);
  const anchor = Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1);
  const pad = (value: number, width = 2): string => String(value).padStart(width, "0");
  const asString = (ms: number): string => {
    const date = new Date(ms);
    return `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-${pad(
      date.getUTCDate(),
    )}`;
  };

  if (period === "day") return [localDate];

  if (period === "week") {
    const weekday = new Date(anchor).getUTCDay();
    // ISO weeks start on Monday; getUTCDay puts Sunday at 0.
    const offsetToMonday = weekday === 0 ? -6 : 1 - weekday;
    const monday = anchor + offsetToMonday * 86_400_000;
    return Array.from({ length: 7 }, (_, index) => asString(monday + index * 86_400_000));
  }

  const daysInMonth = new Date(Date.UTC(year ?? 1970, month ?? 1, 0)).getUTCDate();
  return Array.from({ length: daysInMonth }, (_, index) =>
    asString(Date.UTC(year ?? 1970, (month ?? 1) - 1, index + 1)),
  );
}

/* Evenly spaced indices into a list, endpoints included where they fit. */
function pickIndices(total: number, wanted: number): number[] {
  if (wanted >= total) return Array.from({ length: total }, (_, index) => index);
  if (wanted === 1) return [Math.floor((total - 1) / 2)];
  const picked: number[] = [];
  for (let index = 0; index < wanted; index += 1) {
    picked.push(Math.round((index * (total - 1)) / (wanted - 1)));
  }
  return [...new Set(picked)];
}

/* The largest free stretch inside the window on one day, given what is already
   on the calendar. The only quota mode that reads world state. */
function largestGap(
  dayStartUtc: number,
  dayEndUtc: number,
  blocks: readonly { startUtc: number | null; endUtc: number | null }[],
): { startUtc: number; ms: number } {
  const busy = blocks
    .filter(
      (block): block is { startUtc: number; endUtc: number } =>
        block.startUtc !== null &&
        block.endUtc !== null &&
        block.endUtc > dayStartUtc &&
        block.startUtc < dayEndUtc,
    )
    .sort((left, right) => left.startUtc - right.startUtc);

  let best = { startUtc: dayStartUtc, ms: 0 };
  let cursor = dayStartUtc;

  for (const block of busy) {
    if (block.startUtc > cursor) {
      const gap = block.startUtc - cursor;
      if (gap > best.ms) best = { startUtc: cursor, ms: gap };
    }
    cursor = Math.max(cursor, block.endUtc);
  }

  if (dayEndUtc > cursor && dayEndUtc - cursor > best.ms) {
    best = { startUtc: cursor, ms: dayEndUtc - cursor };
  }

  return best;
}

type Placed = { localDate: string; startUtc: number };

function place(
  config: QuotaConfig,
  eligible: readonly string[],
  fromMinute: number,
  toMinute: number,
  durationMs: number,
  context: EmitContext,
): Placed[] {
  const startOf = (localDate: string): number =>
    context.midnightUtc(localDate) + fromMinute * MS_PER_MINUTE;

  if (config.placement === "free-space") {
    const scored = eligible
      .map((localDate) => {
        const dayStart = startOf(localDate);
        const dayEnd = context.midnightUtc(localDate) + toMinute * MS_PER_MINUTE;
        return { localDate, gap: largestGap(dayStart, dayEnd, context.world.blocks) };
      })
      .filter((entry) => entry.gap.ms >= durationMs)
      /* Largest gap first, then by date so two equal days never swap between
         runs. */
      .sort(
        (left, right) =>
          right.gap.ms - left.gap.ms ||
          (left.localDate < right.localDate ? -1 : 1),
      );

    if (scored.length === 0) {
      context.notice(
        "quota-unplaceable",
        `No day in this ${config.period} has ${Math.round(durationMs / 60000)} free minutes between ${config.window[0]} and ${config.window[1]}`,
      );
      return [];
    }

    return scored
      .slice(0, config.count)
      .map((entry) => ({ localDate: entry.localDate, startUtc: entry.gap.startUtc }))
      .sort((left, right) => left.startUtc - right.startUtc);
  }

  const indices =
    config.placement === "earliest"
      ? Array.from({ length: Math.min(config.count, eligible.length) }, (_, i) => i)
      : config.placement === "latest"
        ? Array.from(
            { length: Math.min(config.count, eligible.length) },
            (_, i) => eligible.length - 1 - i,
          ).reverse()
        : pickIndices(eligible.length, config.count);

  const span = toMinute - fromMinute;

  return indices.map((index, position) => {
    const localDate = eligible[index] ?? eligible[0] ?? "";
    /* balanced also moves the time across the window, so a three a week quota
       does not land at exactly nine every time. */
    const minute =
      config.placement === "balanced" && indices.length > 1
        ? Math.round(fromMinute + (position / (indices.length - 1)) * span)
        : fromMinute;
    return { localDate, startUtc: context.midnightUtc(localDate) + minute * MS_PER_MINUTE };
  });
}

export const quota: KindModule<QuotaConfig> = {
  kind: "quota",
  schema: quotaSchema,
  lookbackDays: 0,

  emit(config, context) {
    const candidates: Candidate[] = [];
    const durationMs = context.generator.emits.durationMinutes * 60_000;

    const fromMinute = parseClock(config.window[0]);
    const toMinute = parseClock(config.window[1]);
    if (fromMinute === null || toMinute === null || toMinute <= fromMinute) {
      return candidates;
    }

    /* One placement per period, computed over the period's own dates, then
       filtered to what the window actually asked for. */
    const wanted = new Set(context.dates);
    const periods = new Set(
      context.dates.map((localDate) => periodKeyOf(localDate, config.period)),
    );
    const seenPeriods = new Set<string>();

    for (const localDate of context.dates) {
      const key = periodKeyOf(localDate, config.period);
      if (seenPeriods.has(key)) continue;
      seenPeriods.add(key);
      if (!periods.has(key)) continue;

      const eligible = datesInPeriodOf(localDate, config.period).filter((date) =>
        matchesWeekdays(date, config.weekdays),
      );
      if (eligible.length === 0) continue;

      let placed = place(config, eligible, fromMinute, toMinute, durationMs, context);

      if (config.minGapHours > 0) {
        const minGapMs = config.minGapHours * MS_PER_HOUR;
        const kept: Placed[] = [];
        for (const entry of placed) {
          const previous = kept[kept.length - 1];
          if (previous === undefined || entry.startUtc - previous.startUtc >= minGapMs) {
            kept.push(entry);
          }
        }
        placed = kept;
      }

      for (const entry of placed) {
        if (!wanted.has(entry.localDate)) continue;
        candidates.push({
          localDate: entry.localDate,
          startUtc: entry.startUtc,
          endUtc: entry.startUtc + durationMs,
        });
      }
    }

    return candidates;
  },

  describe(config) {
    return `${config.count} a ${config.period}, ${config.placement}`;
  },
};

export { datesInPeriodOf, largestGap, pickIndices };
