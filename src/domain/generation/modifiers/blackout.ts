import { z } from "zod";
import { parseClock } from "../tz";
import { isProtected, matchesScope, scopeSchema } from "../scope";
import { clockSchema, matchesWeekdays, weekdayKeySchema } from "../weekdays";
import type { ModifierModule } from "./index";
import type { Slot } from "../types";

/* Stage 4. Spec1.1 section 5.1. Removes, moves or truncates any slot that
   intersects a window. */

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;

export const blackoutSchema = z.object({
  windows: z
    .array(
      z.object({
        weekdays: z.array(weekdayKeySchema).optional(),
        range: z.tuple([clockSchema, clockSchema]),
        label: z.string().optional(),
      }),
    )
    .default([]),
  dateRanges: z
    .array(
      z.object({
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        label: z.string().optional(),
      }),
    )
    .default([]),
  mode: z.enum(["remove", "shift-out", "shrink"]).default("remove"),
  appliesTo: scopeSchema,
});

export type BlackoutConfig = z.infer<typeof blackoutSchema>;

type Interval = { startUtc: number; endUtc: number; label: string };

/* A window whose end reads earlier than its start crosses midnight, and is one
   interval running into the next day rather than two clipped at 24:00. Modelled
   that way so a slot at 00:30 is caught by the window that opened at 23:30 the
   evening before. Edge case 4. */
function intervalsFor(
  config: BlackoutConfig,
  dates: readonly string[],
  midnightUtc: (localDate: string) => number,
): Interval[] {
  const intervals: Interval[] = [];

  for (const window of config.windows) {
    const from = parseClock(window.range[0]);
    const to = parseClock(window.range[1]);
    if (from === null || to === null) continue;

    for (const localDate of dates) {
      if (!matchesWeekdays(localDate, window.weekdays)) continue;
      const midnight = midnightUtc(localDate);
      const startUtc = midnight + from * MS_PER_MINUTE;
      const endUtc =
        to > from
          ? midnight + to * MS_PER_MINUTE
          : midnight + MS_PER_DAY + to * MS_PER_MINUTE;
      if (endUtc <= startUtc) continue;
      intervals.push({ startUtc, endUtc, label: window.label ?? "blackout" });
    }
  }

  for (const range of config.dateRanges) {
    for (const localDate of dates) {
      if (localDate < range.from || localDate > range.to) continue;
      const midnight = midnightUtc(localDate);
      intervals.push({
        startUtc: midnight,
        endUtc: midnight + MS_PER_DAY,
        label: range.label ?? "blackout",
      });
    }
  }

  return intervals.sort((left, right) => left.startUtc - right.startUtc);
}

function overlaps(slot: Slot, interval: Interval): boolean {
  return slot.startUtc < interval.endUtc && slot.endUtc > interval.startUtc;
}

export const blackout: ModifierModule<BlackoutConfig> = {
  kind: "blackout",
  stage: "filter",
  schema: blackoutSchema,

  apply(config, slots, context) {
    if (slots.length === 0) return slots;
    if (config.windows.length === 0 && config.dateRanges.length === 0) return slots;

    /* The dates the slots actually occupy, plus the day before, so a window
       that opened yesterday evening is present when a slot lands after
       midnight. */
    const dates = new Set<string>();
    for (const slot of slots) {
      dates.add(slot.localDate);
      dates.add(context.tz.localDateOf(slot.startUtc - MS_PER_DAY));
    }

    const intervals = intervalsFor(config, [...dates].sort(), (localDate) =>
      context.tz.midnightUtc(localDate),
    );
    if (intervals.length === 0) return slots;

    const kept: Slot[] = [];

    for (const slot of slots) {
      if (isProtected(slot) || !matchesScope(slot, config.appliesTo)) {
        kept.push(slot);
        continue;
      }

      const hit = intervals.find((interval) => overlaps(slot, interval));
      if (hit === undefined) {
        kept.push(slot);
        continue;
      }

      if (config.mode === "remove") {
        context.drop(slot, `inside ${hit.label}`);
        continue;
      }

      const duration = slot.endUtc - slot.startUtc;

      if (config.mode === "shift-out") {
        /* To whichever edge is nearer, which is usually better than losing the
           slot altogether. */
        const before = hit.startUtc - duration;
        const after = hit.endUtc;
        const toBefore = Math.abs(slot.startUtc - before);
        const toAfter = Math.abs(after - slot.startUtc);
        slot.startUtc = toBefore <= toAfter ? before : after;
        slot.endUtc = slot.startUtc + duration;
        context.note(slot, `shifted out of ${hit.label}`);
        kept.push(slot);
        continue;
      }

      // shrink
      if (slot.startUtc < hit.startUtc) {
        slot.endUtc = hit.startUtc;
      } else if (slot.endUtc > hit.endUtc) {
        slot.startUtc = hit.endUtc;
      } else {
        /* Wholly inside, so there is nothing left to shrink to. */
        context.drop(slot, `wholly inside ${hit.label}, nothing left to shrink`);
        continue;
      }
      context.note(slot, `shrunk around ${hit.label}`);
      kept.push(slot);
    }

    return kept;
  },

  describe(config) {
    const count = config.windows.length + config.dateRanges.length;
    return `${count} blackout ${count === 1 ? "window" : "windows"}, ${config.mode}`;
  },
};
