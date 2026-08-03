import { z } from "zod";

/* Weekday arithmetic on a local date string, done as plain calendar maths
   rather than by formatting. Intl would give a locale-dependent name, which
   invariant 17 forbids inside this directory, and the answer would then depend
   on the machine's locale rather than on the date. */

export const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

export type WeekdayKey = (typeof WEEKDAY_KEYS)[number];

export const weekdayKeySchema = z.enum(WEEKDAY_KEYS);

export function weekdayKeyOf(localDate: string): WeekdayKey {
  const [year, month, day] = localDate.split("-").map(Number);
  /* Date.UTC is a pure calendar function here: the values are already the local
     calendar fields, so no zone is involved and none is implied. */
  const index = new Date(
    Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1),
  ).getUTCDay();
  return WEEKDAY_KEYS[index] ?? "sun";
}

export function matchesWeekdays(
  localDate: string,
  weekdays: readonly WeekdayKey[] | undefined,
): boolean {
  if (weekdays === undefined || weekdays.length === 0) return true;
  return weekdays.includes(weekdayKeyOf(localDate));
}

/* "08:00", rejecting anything that is not a real reading. Kept here so every
   kind validates times the same way. */
export const clockSchema = z
  .string()
  .regex(/^([01]?\d|2[0-3]):[0-5]\d$/, "must be a time like 08:00");
