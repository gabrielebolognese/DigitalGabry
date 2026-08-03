import {
  MINUTES_PER_HOUR,
  utcFromWallClock,
  wallClockOf,
  type WallClock,
} from "../time";
import type { AmbiguousPolicy, DstPolicy, NonexistentPolicy } from "./types";

/* Spec1.1 section 9. Generation is defined in local wall clock and resolved to
   UTC per occurrence, so an 08:00 rule fires at 08:00 on every side of every
   transition.

   Every conversion delegates to domain/time.ts rather than reaching for
   date-fns-tz directly. A second timezone authority that disagreed with the
   first by an hour twice a year is exactly the kind of bug that survives to
   production, because it is invisible on 363 days.

   Those conversions go through Intl and cost roughly fifty microseconds each,
   which is nothing once and everything when it is once per slot: the first
   version of this file spent 274ms on a 90 day window against a 40ms budget.
   The offset is constant within a local date, so the instant of a slot is
   local midnight plus its minutes, and midnight is computed once per date and
   shared across every generator in the pass. Transition days fall back to the
   careful path below, and there are two of them a year. */

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;

export type ResolutionNote =
  | "exact"
  | "shifted-forward"
  | "shifted-back"
  | "skipped"
  | "ambiguous-first"
  | "ambiguous-second"
  | "ambiguous-both";

export type Resolution = {
  /* Zero instants when the policy is skip, two when it is both. */
  instants: readonly number[];
  note: ResolutionNote;
};

function wallOf(localDate: string, minutes: number): WallClock {
  const [year, month, day] = localDate.split("-").map(Number);
  return {
    year: year ?? 1970,
    month: month ?? 1,
    day: day ?? 1,
    hour: Math.floor(minutes / MINUTES_PER_HOUR),
    minute: minutes % MINUTES_PER_HOUR,
    second: 0,
  };
}

function sameWall(left: WallClock, right: WallClock): boolean {
  return (
    left.year === right.year &&
    left.month === right.month &&
    left.day === right.day &&
    left.hour === right.hour &&
    left.minute === right.minute
  );
}

/* Calendar arithmetic on the date string, with no zone involved. Date.UTC is
   used purely as a civil calendar here, never as a conversion. */
function shiftLocalDate(localDate: string, days: number): string {
  const [year, month, day] = localDate.split("-").map(Number);
  const moved = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, (day ?? 1) + days));
  const pad = (value: number, width = 2): string => String(value).padStart(width, "0");
  return `${pad(moved.getUTCFullYear(), 4)}-${pad(moved.getUTCMonth() + 1)}-${pad(
    moved.getUTCDate(),
  )}`;
}

/* One timezone's civil calendar, memoised for the length of a generation pass.
   Shared across generators, so twenty rules over the same zone pay for each
   date once between them rather than twenty times each. */
export class TzContext {
  private readonly midnights = new Map<string, number>();

  constructor(readonly tz: string) {}

  midnightUtc(localDate: string): number {
    const cached = this.midnights.get(localDate);
    if (cached !== undefined) return cached;
    const computed = utcFromWallClock(wallOf(localDate, 0), this.tz);
    this.midnights.set(localDate, computed);
    return computed;
  }

  /* What the local date gained or lost, derived from the gap to the next
     midnight. Zero on the 363 ordinary days, negative on spring forward,
     positive on fall back. One conversion per date, and the next date's
     midnight is needed by the walk anyway. */
  deltaMs(localDate: string): number {
    return (
      this.midnightUtc(shiftLocalDate(localDate, 1)) -
      this.midnightUtc(localDate) -
      MS_PER_DAY
    );
  }

  localDateOf(utcMs: number): string {
    const wall = wallClockOf(utcMs, this.tz);
    const pad = (value: number, width = 2): string => String(value).padStart(width, "0");
    return `${pad(wall.year, 4)}-${pad(wall.month)}-${pad(wall.day)}`;
  }

  /* Two conversions for the whole range rather than two per day: the endpoints
     are resolved through the zone, everything between them is calendar
     arithmetic that no transition can disturb. */
  datesBetween(startUtc: number, endUtc: number): string[] {
    if (endUtc < startUtc) return [];

    const first = this.localDateOf(startUtc);
    const last = this.localDateOf(endUtc);
    const dates: string[] = [];

    let cursor = first;
    // Bounded so a malformed range can never spin: 18 months plus slack.
    for (let guard = 0; guard < 800; guard += 1) {
      dates.push(cursor);
      if (cursor >= last) break;
      cursor = shiftLocalDate(cursor, 1);
    }

    return dates;
  }
}

/* A reading inside the gap resolves to one side of it or the other, and which
   side fromZonedTime picks is not documented. Rather than assume, this works
   out which one it handed back by looking at where the instant actually lands,
   then derives the other by moving one gap width. Assuming it was the forward
   answer silently produced 01:30 for a 02:30 rule, which the DST tests caught. */
function resolveNonexistent(
  nominal: number,
  requestedMinutes: number,
  landedMinutes: number,
  gapMs: number,
  policy: NonexistentPolicy,
): Resolution {
  if (policy === "skip") return { instants: [], note: "skipped" };

  const landedBefore = landedMinutes < requestedMinutes;
  const back = landedBefore ? nominal : nominal - gapMs;
  const forward = landedBefore ? nominal + gapMs : nominal;

  return policy === "shift-forward"
    ? { instants: [forward], note: "shifted-forward" }
    : { instants: [back], note: "shifted-back" };
}

function resolveAmbiguous(
  first: number,
  second: number,
  policy: AmbiguousPolicy,
): Resolution {
  switch (policy) {
    case "first":
      return { instants: [first], note: "ambiguous-first" };
    case "second":
      return { instants: [second], note: "ambiguous-second" };
    /* Legal, and occasionally what a broadcaster actually wants. */
    case "both":
      return { instants: [first, second], note: "ambiguous-both" };
  }
}

export type TzResolver = (localDate: string, minutes: number) => Resolution;

export function makeResolver(
  context: TzContext,
  policy: DstPolicy,
): TzResolver {
  const tz = context.tz;
  const deltas = new Map<string, number>();

  return (localDate: string, minutes: number): Resolution => {
    let delta = deltas.get(localDate);
    if (delta === undefined) {
      delta = context.deltaMs(localDate);
      deltas.set(localDate, delta);
    }

    /* The overwhelmingly common case: an ordinary day, constant offset, so the
       instant is midnight plus the minutes and no conversion is needed. */
    if (delta === 0) {
      return {
        instants: [context.midnightUtc(localDate) + minutes * MS_PER_MINUTE],
        note: "exact",
      };
    }

    const wall = wallOf(localDate, minutes);
    const nominal = utcFromWallClock(wall, tz);
    const roundTrip = wallClockOf(nominal, tz);

    if (!sameWall(roundTrip, wall)) {
      const landedMinutes = roundTrip.hour * MINUTES_PER_HOUR + roundTrip.minute;
      return resolveNonexistent(
        nominal,
        minutes,
        landedMinutes,
        -delta,
        policy.nonexistent,
      );
    }

    /* A reading that exists twice. Whether fromZonedTime handed back the first
       or the second is not documented, so both neighbours are tested rather
       than assumed. */
    if (delta > 0) {
      const earlier = nominal - delta;
      if (sameWall(wallClockOf(earlier, tz), wall)) {
        return resolveAmbiguous(earlier, nominal, policy.ambiguous);
      }
      const later = nominal + delta;
      if (sameWall(wallClockOf(later, tz), wall)) {
        return resolveAmbiguous(nominal, later, policy.ambiguous);
      }
    }

    return { instants: [nominal], note: "exact" };
  };
}

/* Kept for callers outside a generation pass, where no context exists. Inside
   one, go through TzContext so the memo is shared. */
export function localDateIn(utcMs: number, tz: string): string {
  return new TzContext(tz).localDateOf(utcMs);
}

export function localDatesBetween(
  startUtc: number,
  endUtc: number,
  tz: string,
): string[] {
  return new TzContext(tz).datesBetween(startUtc, endUtc);
}

export function parseClock(text: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (match === null) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * MINUTES_PER_HOUR + minute;
}
