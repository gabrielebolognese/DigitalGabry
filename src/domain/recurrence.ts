import { Frequency, RRule, datetime } from "rrule";
import {
  isNonexistentWallClock,
  utcFromWallClock,
  wallClockOf,
  type UtcMillis,
  type UtcRange,
  type WallClock,
} from "./time";

/* The only file allowed to import rrule.
 *
 * rrule runs in floating mode here, never with tzid. Setting tzid would make
 * rrule a second DST authority carrying its own timezone database alongside
 * date-fns-tz, and the two could disagree on a transition with nothing to say
 * so. In floating mode rrule is pure calendar arithmetic and time.ts stays the
 * single authority on zones.
 *
 * A floating Date carries its wall clock in its UTC fields. That convention is
 * the opposite of date-fns-tz's, so a Date must never cross between the two.
 * WallClock is the only thing that crosses.
 */

export const RECURRENCE_MAX_OCCURRENCES = 2000;

export type RecurrenceFreq = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";

export type RecurrenceRule = {
  readonly text: string;
  readonly freq: RecurrenceFreq;
  readonly interval: number;
  readonly count: number | null;
  readonly untilWall: WallClock | null;
  readonly byWeekday: readonly number[];
  readonly byMonthDay: readonly number[];
  readonly bySetPos: readonly number[];
};

export type RecurrenceError =
  | { kind: "empty" }
  | { kind: "malformed"; message: string }
  | { kind: "unsupported-freq"; freq: string }
  | { kind: "count-and-until" };

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: RecurrenceError };

export type OccurrenceSeed = {
  readonly blockId: string;
  readonly startUtc: UtcMillis;
  readonly endUtc: UtcMillis;
  readonly tz: string;
  readonly rrule: string;
};

export type GeneratedOccurrence = {
  readonly blockId: string;
  readonly startUtc: UtcMillis;
  readonly endUtc: UtcMillis;
};

export type ExceptionKind = "override" | "cancelled";

export type ExceptionMarker = {
  readonly originalStartUtc: UtcMillis;
  readonly kind: ExceptionKind;
};

export type GenerateOptions = {
  readonly maxOccurrences?: number;
  readonly exceptions?: readonly ExceptionMarker[];
};

export type GenerateResult = {
  readonly occurrences: readonly GeneratedOccurrence[];
  readonly truncated: boolean;
  readonly dstShifted: readonly UtcMillis[];
  readonly orphanedExceptions: readonly ExceptionMarker[];
};

const WEEKDAY_CODES = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;

const FREQ_OF_TEXT: Record<RecurrenceFreq, Frequency> = {
  DAILY: Frequency.DAILY,
  WEEKLY: Frequency.WEEKLY,
  MONTHLY: Frequency.MONTHLY,
  YEARLY: Frequency.YEARLY,
};

function freqText(value: Frequency): RecurrenceFreq | null {
  for (const [text, freq] of Object.entries(FREQ_OF_TEXT)) {
    if (freq === value) return text as RecurrenceFreq;
  }
  return null;
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, "0");
}

/* byweekday comes back from parseString as a number, a two letter code, or a
   Weekday instance depending on how the rule was written. */
function weekdayIndex(day: unknown): number {
  if (typeof day === "number") return day;
  if (typeof day === "string") {
    const found = (WEEKDAY_CODES as readonly string[]).indexOf(day.toUpperCase());
    return found < 0 ? 0 : found;
  }
  if (typeof day === "object" && day !== null && "weekday" in day) {
    const weekday = (day as { weekday: unknown }).weekday;
    if (typeof weekday === "number") return weekday;
  }
  return 0;
}

export function formatFloatingStamp(wall: WallClock): string {
  return (
    `${pad(wall.year, 4)}${pad(wall.month)}${pad(wall.day)}` +
    `T${pad(wall.hour)}${pad(wall.minute)}${pad(wall.second)}`
  );
}

function toFloating(wall: WallClock): Date {
  return datetime(wall.year, wall.month, wall.day, wall.hour, wall.minute, wall.second);
}

function wallOfFloating(date: Date): WallClock {
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
    second: date.getUTCSeconds(),
  };
}

const MS_PER_DAY = 86_400_000;

/* Pure arithmetic on a floating reading. No zone is involved, so plain
   millisecond maths is exact here in a way it would not be on a UTC instant. */
function shiftWallDays(wall: WallClock, days: number): WallClock {
  const moved = new Date(
    Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second) +
      days * MS_PER_DAY,
  );
  return wallOfFloating(moved);
}

const UNTIL_UTC = /UNTIL=(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/i;

/* An absolute UNTIL against a floating DTSTART is illegal per RFC 5545, and
   rrule reads the value as floating regardless, which ends the series at the
   wrong wall time. Every ICS export writes one, so it is normalised at the
   door rather than trusted. */
function canonicaliseUntil(text: string, tz: string): string {
  const match = UNTIL_UTC.exec(text);
  if (match === null) return text;

  const instant = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6]),
  );
  return text.replace(UNTIL_UTC, `UNTIL=${formatFloatingStamp(wallClockOf(instant, tz))}`);
}

function stripNonRuleLines(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .filter((line) => !/^(DTSTART|EXDATE|RDATE)[;:]/i.test(line))
    .map((line) => line.replace(/^RRULE:/i, ""))
    .join("");
}

export function parseRrule(text: string, tz: string): ParseResult<RecurrenceRule> {
  const stripped = stripNonRuleLines(text);
  if (stripped === "") return { ok: false, error: { kind: "empty" } };

  const canonical = canonicaliseUntil(stripped, tz);

  let options: Partial<import("rrule").Options>;
  try {
    options = RRule.parseString(canonical);
  } catch (cause) {
    return {
      ok: false,
      error: { kind: "malformed", message: cause instanceof Error ? cause.message : String(cause) },
    };
  }

  if (options.freq === undefined) {
    return { ok: false, error: { kind: "malformed", message: "No FREQ in rule" } };
  }

  const freq = freqText(options.freq);
  if (freq === null) {
    // 18 months of FREQ=MINUTELY is 788k instances inside a bounded between().
    return { ok: false, error: { kind: "unsupported-freq", freq: String(options.freq) } };
  }

  const count = options.count ?? null;
  const untilWall = options.until == null ? null : wallOfFloating(options.until);
  if (count !== null && untilWall !== null) {
    return { ok: false, error: { kind: "count-and-until" } };
  }

  const byWeekday =
    options.byweekday == null
      ? []
      : (Array.isArray(options.byweekday) ? options.byweekday : [options.byweekday]).map(
          weekdayIndex,
        );

  const byMonthDay =
    options.bymonthday == null
      ? []
      : Array.isArray(options.bymonthday)
        ? options.bymonthday
        : [options.bymonthday];

  const bySetPos =
    options.bysetpos == null
      ? []
      : Array.isArray(options.bysetpos)
        ? options.bysetpos
        : [options.bysetpos];

  const rule: RecurrenceRule = {
    text: "",
    freq,
    interval: options.interval ?? 1,
    count,
    untilWall,
    byWeekday,
    byMonthDay,
    bySetPos,
  };

  return { ok: true, value: { ...rule, text: formatRrule(rule) } };
}

export function formatRrule(rule: RecurrenceRule): string {
  const parts = [`FREQ=${rule.freq}`];
  if (rule.interval > 1) parts.push(`INTERVAL=${rule.interval}`);
  if (rule.byWeekday.length > 0) {
    parts.push(`BYDAY=${rule.byWeekday.map((day) => WEEKDAY_CODES[day]).join(",")}`);
  }
  if (rule.byMonthDay.length > 0) parts.push(`BYMONTHDAY=${rule.byMonthDay.join(",")}`);
  if (rule.bySetPos.length > 0) parts.push(`BYSETPOS=${rule.bySetPos.join(",")}`);
  if (rule.count !== null) parts.push(`COUNT=${rule.count}`);
  if (rule.untilWall !== null) parts.push(`UNTIL=${formatFloatingStamp(rule.untilWall)}`);
  return parts.join(";");
}

export function applyExceptions(
  generated: readonly GeneratedOccurrence[],
  exceptions: readonly ExceptionMarker[],
): { kept: GeneratedOccurrence[]; orphaned: ExceptionMarker[] } {
  if (exceptions.length === 0) return { kept: [...generated], orphaned: [] };

  const claimed = new Set(exceptions.map((entry) => entry.originalStartUtc));
  const present = new Set(generated.map((entry) => entry.startUtc));

  return {
    kept: generated.filter((entry) => !claimed.has(entry.startUtc)),
    orphaned: exceptions.filter((entry) => !present.has(entry.originalStartUtc)),
  };
}

export function generateOccurrences(
  seed: OccurrenceSeed,
  window: UtcRange,
  options: GenerateOptions = {},
): GenerateResult {
  const exceptions = options.exceptions ?? [];
  const parsed = parseRrule(seed.rrule, seed.tz);
  if (!parsed.ok) {
    return {
      occurrences: [],
      truncated: false,
      dstShifted: [],
      orphanedExceptions: [...exceptions],
    };
  }

  const max = options.maxOccurrences ?? RECURRENCE_MAX_OCCURRENCES;
  const durationMs = seed.endUtc - seed.startUtc;
  const dtstart = toFloating(wallClockOf(seed.startUtc, seed.tz));

  const rule = new RRule({ ...RRule.parseString(parsed.value.text), dtstart });

  /* Generated wide in wall space and filtered exact in UTC space. Without the
     widening, an occurrence whose wall time sits inside the window but whose
     UTC instant sits just outside is lost at the boundary. */
  const from = toFloating(shiftWallDays(wallClockOf(window.start, seed.tz), -1));
  const to = toFloating(shiftWallDays(wallClockOf(window.end, seed.tz), 1));

  let truncated = false;
  // between() is bounded by `to`; .all() is what runs to year 9999 and is
  // never used in this file.
  const floating = rule.between(from, to, true, (_date, length) => {
    if (length >= max) {
      truncated = true;
      return false;
    }
    return true;
  });

  const dstShifted: UtcMillis[] = [];
  const occurrences: GeneratedOccurrence[] = [];

  for (const date of floating) {
    const wall = wallOfFloating(date);
    const startUtc = utcFromWallClock(wall, seed.tz);

    // A reading inside a spring forward gap resolves to the first valid
    // instant. Reported rather than silently accepted.
    if (isNonexistentWallClock(wall, seed.tz)) dstShifted.push(startUtc);

    const endUtc = startUtc + durationMs;
    if (startUtc >= window.end || endUtc <= window.start) continue;
    occurrences.push({ blockId: seed.blockId, startUtc, endUtc });
  }

  const { kept, orphaned } = applyExceptions(occurrences, exceptions);
  return { occurrences: kept, truncated, dstShifted, orphanedExceptions: orphaned };
}

export function occurrenceId(blockId: string, startUtc: UtcMillis): string {
  return `${blockId}:${startUtc}`;
}

export type EditScope = "occurrence" | "future" | "series";

export type OccurrenceRef = {
  readonly seriesId: string;
  readonly originalStartUtc: UtcMillis;
};

export type RuleSplit = {
  /* Bounded remainder of the original rule, or null when the split point is
     the first instance and there is no head at all. */
  readonly head: string | null;
  readonly tail: string;
};

/* Counts instances strictly before an instant, generated from dtstart rather
   than read out of the materialised window, which may not span the whole rule. */
export function countBefore(seed: OccurrenceSeed, beforeUtc: UtcMillis): number {
  if (beforeUtc <= seed.startUtc) return 0;
  const result = generateOccurrences(seed, { start: seed.startUtc, end: beforeUtc });
  return result.occurrences.length;
}

/* Splitting a series at an instant. The head keeps everything before it, the
   tail carries the rest.
 *
 * COUNT and UNTIL are mutually exclusive per RFC 5545, so a counted rule is
 * split by rewriting both counts rather than by bounding the head with UNTIL.
 * UNTIL is inclusive, so the head ends one second before the split, which is
 * correct for every rule shape without having to find the previous instance. */
export function splitRuleAt(
  seed: OccurrenceSeed,
  splitUtc: UtcMillis,
): ParseResult<RuleSplit> {
  const parsed = parseRrule(seed.rrule, seed.tz);
  if (!parsed.ok) return parsed;

  const rule = parsed.value;

  if (splitUtc <= seed.startUtc) {
    return { ok: true, value: { head: null, tail: rule.text } };
  }

  if (rule.count !== null) {
    const before = countBefore(seed, splitUtc);
    if (before === 0) return { ok: true, value: { head: null, tail: rule.text } };
    const remaining = Math.max(rule.count - before, 1);
    return {
      ok: true,
      value: {
        head: formatRrule({ ...rule, count: before, untilWall: null }),
        tail: formatRrule({ ...rule, count: remaining, untilWall: null }),
      },
    };
  }

  const untilWall = wallClockOf(splitUtc - 1000, seed.tz);
  return {
    ok: true,
    value: {
      head: formatRrule({ ...rule, count: null, untilWall }),
      // The tail inherits the original's own end, whether that was an UNTIL or
      // nothing at all.
      tail: formatRrule({ ...rule, count: null, untilWall: rule.untilWall }),
    },
  };
}
