import { BLOCK_KINDS, PLATFORMS, type BlockKind, type Platform } from "../domain/block";
import { utcFromWallClock, wallClockOf, type UtcMillis, type WallClock } from "../domain/time";

/* Pure. No React, no DOM, no Tauri, no database. The project is returned by
   name rather than by id, so resolving it against the projects table stays the
   caller's job and this file needs nothing but its input. */

export type Priority = "low" | "normal" | "high";

export type ParsedCapture = {
  readonly title: string;
  readonly kind: BlockKind;
  readonly startUtc: UtcMillis | null;
  readonly endUtc: UtcMillis | null;
  readonly projectName: string | null;
  readonly tags: readonly string[];
  readonly priority: Priority | null;
  readonly platform: Platform | null;
};

/* SPEC states no default length for a captured block. Thirty minutes is short
   enough to be worth correcting and long enough to be legible on the grid. */
export const DEFAULT_CAPTURE_MINUTES = 30;

/* Used when a day is named without a time. */
export const DEFAULT_CAPTURE_HOUR = 9;

const PRIORITIES: readonly Priority[] = ["low", "normal", "high"];

const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

const MS_PER_DAY = 86_400_000;

function addWallDays(wall: WallClock, days: number): WallClock {
  const moved = new Date(
    Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second) +
      days * MS_PER_DAY,
  );
  return {
    year: moved.getUTCFullYear(),
    month: moved.getUTCMonth() + 1,
    day: moved.getUTCDate(),
    hour: moved.getUTCHours(),
    minute: moved.getUTCMinutes(),
    second: moved.getUTCSeconds(),
  };
}

/* Floating arithmetic, so no zone is involved and getUTCDay is exact. */
function weekdayOf(wall: WallClock): number {
  return new Date(Date.UTC(wall.year, wall.month - 1, wall.day)).getUTCDay();
}

const CLOCK_24 = /^(\d{1,2}):(\d{2})$/;
const CLOCK_12 = /^(\d{1,2})(?::(\d{2}))?(am|pm)$/i;

type TimeOfDay = { hour: number; minute: number };

function readTime(token: string): TimeOfDay | null {
  const twentyFour = CLOCK_24.exec(token);
  if (twentyFour !== null) {
    const hour = Number(twentyFour[1]);
    const minute = Number(twentyFour[2]);
    if (hour > 23 || minute > 59) return null;
    return { hour, minute };
  }

  const twelve = CLOCK_12.exec(token);
  if (twelve !== null) {
    const raw = Number(twelve[1]);
    if (raw < 1 || raw > 12) return null;
    const minute = twelve[2] === undefined ? 0 : Number(twelve[2]);
    if (minute > 59) return null;
    const pm = twelve[3].toLowerCase() === "pm";
    const hour = raw === 12 ? (pm ? 12 : 0) : pm ? raw + 12 : raw;
    return { hour, minute };
  }

  return null;
}

export function parseCapture(
  input: string,
  nowUtc: UtcMillis,
  tz: string,
): ParsedCapture {
  const tokens = input.trim().split(/\s+/).filter((token) => token !== "");

  const tags: string[] = [];
  const titleWords: string[] = [];
  let projectName: string | null = null;
  let priority: Priority | null = null;
  let platform: Platform | null = null;
  let kind: BlockKind | null = null;
  let day: WallClock | null = null;
  let time: TimeOfDay | null = null;

  const today = wallClockOf(nowUtc, tz);

  // A plain loop rather than forEach, so assignments below stay visible to
  // control flow analysis instead of narrowing to never after the callback.
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const lower = token.toLowerCase();

    if (token.startsWith("#") && token.length > 1) {
      tags.push(token.slice(1));
      continue;
    }

    if (token.startsWith("@") && token.length > 1) {
      projectName = token.slice(1);
      continue;
    }

    if (token.startsWith("!") && token.length > 1) {
      const candidate = lower.slice(1);
      const match = PRIORITIES.find((value) => value === candidate);
      if (match !== undefined) {
        priority = match;
        continue;
      }
    }

    // A kind word only counts as a kind when it opens the capture, so a task
    // called "note down the numbers" keeps its first word.
    if (index === 0 && (BLOCK_KINDS as readonly string[]).includes(lower)) {
      kind = lower as BlockKind;
      continue;
    }

    if ((PLATFORMS as readonly string[]).includes(lower)) {
      platform = lower as Platform;
      if (kind === null) kind = "post";
      continue;
    }

    if (lower === "today") {
      day = today;
      continue;
    }

    if (lower === "tomorrow") {
      day = addWallDays(today, 1);
      continue;
    }

    const weekdayIndex = WEEKDAYS.indexOf(lower as (typeof WEEKDAYS)[number]);
    if (weekdayIndex >= 0) {
      const ahead = (weekdayIndex - weekdayOf(today) + 7) % 7;
      day = addWallDays(today, ahead);
      continue;
    }

    const parsedTime = readTime(token);
    if (parsedTime !== null) {
      time = parsedTime;
      continue;
    }

    titleWords.push(token);
  }

  let startUtc: UtcMillis | null = null;
  let endUtc: UtcMillis | null = null;

  if (day !== null || time !== null) {
    const base: WallClock = day ?? today;
    const hour = time?.hour ?? DEFAULT_CAPTURE_HOUR;
    const minute = time?.minute ?? 0;

    let start = utcFromWallClock(
      { ...base, hour, minute, second: 0 },
      tz,
    );

    // A bare time that has already passed today means the next one.
    if (day === null && time !== null && start <= nowUtc) {
      start = utcFromWallClock(
        { ...addWallDays(base, 1), hour, minute, second: 0 },
        tz,
      );
    }

    startUtc = start;
    endUtc = start + DEFAULT_CAPTURE_MINUTES * 60_000;
  }

  return {
    title: titleWords.join(" "),
    kind: kind ?? "task",
    startUtc,
    endUtc,
    projectName,
    tags,
    priority,
    platform,
  };
}
