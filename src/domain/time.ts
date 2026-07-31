import { addDays, startOfDay, startOfWeek } from "date-fns";
import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";

export type UtcMillis = number;

export type UtcRange = {
  start: UtcMillis;
  end: UtcMillis;
};

export const MINUTES_PER_HOUR = 60;
export const HOURS_PER_DAY = 24;
export const MINUTES_PER_DAY = MINUTES_PER_HOUR * HOURS_PER_DAY;
export const DAYS_PER_WEEK = 7;
export const SNAP_MINUTES = 15;

export const DEFAULT_TZ = "Europe/Rome";

/* Monday. SPEC does not state a week start; Europe/Rome convention is assumed. */
export const WEEK_STARTS_ON = 1 as const;

export const HOUR_HEIGHTS = [28, 44, 72, 120] as const;
export type HourHeight = (typeof HOUR_HEIGHTS)[number];
export const DEFAULT_HOUR_HEIGHT: HourHeight = 44;

/* toZonedTime returns a Date whose system-local fields carry the target zone's
   wall clock, so date-fns day and week math operates on wall time and
   fromZonedTime maps the result back across a DST boundary correctly. */
function toWall(utcMs: UtcMillis, tz: string): Date {
  return toZonedTime(new Date(utcMs), tz);
}

function fromWall(wall: Date, tz: string): UtcMillis {
  return fromZonedTime(wall, tz).getTime();
}

export function startOfLocalDay(utcMs: UtcMillis, tz: string): UtcMillis {
  return fromWall(startOfDay(toWall(utcMs, tz)), tz);
}

export function endOfLocalDay(utcMs: UtcMillis, tz: string): UtcMillis {
  return fromWall(addDays(startOfDay(toWall(utcMs, tz)), 1), tz);
}

export function startOfLocalWeek(utcMs: UtcMillis, tz: string): UtcMillis {
  return fromWall(
    startOfWeek(toWall(utcMs, tz), { weekStartsOn: WEEK_STARTS_ON }),
    tz,
  );
}

export function weekRange(utcMs: UtcMillis, tz: string): UtcRange {
  const firstDay = startOfWeek(toWall(utcMs, tz), { weekStartsOn: WEEK_STARTS_ON });
  return {
    start: fromWall(firstDay, tz),
    end: fromWall(addDays(firstDay, DAYS_PER_WEEK), tz),
  };
}

export function dayRange(utcMs: UtcMillis, tz: string): UtcRange {
  return { start: startOfLocalDay(utcMs, tz), end: endOfLocalDay(utcMs, tz) };
}

export function daysOfWeek(utcMs: UtcMillis, tz: string): UtcMillis[] {
  const firstDay = startOfWeek(toWall(utcMs, tz), { weekStartsOn: WEEK_STARTS_ON });
  return Array.from({ length: DAYS_PER_WEEK }, (_, index) =>
    fromWall(addDays(firstDay, index), tz),
  );
}

/* Wall clock minutes, not elapsed minutes. On a DST day the two differ, and the
   grid is drawn in wall clock, so a 09:00 block has to land on the 09:00 row. */
export function localMinutesOfDay(utcMs: UtcMillis, tz: string): number {
  const wall = toWall(utcMs, tz);
  return wall.getHours() * MINUTES_PER_HOUR + wall.getMinutes();
}

export function minutesWithinDay(
  utcMs: UtcMillis,
  day: UtcRange,
  tz: string,
): number {
  if (utcMs <= day.start) return 0;
  if (utcMs >= day.end) return MINUTES_PER_DAY;
  return localMinutesOfDay(utcMs, tz);
}

/* Inverse of localMinutesOfDay. Built by setting wall clock fields rather than
   adding milliseconds to the day start, so a drop onto the 09:00 row lands on
   09:00 even on the two days a year when the day is 23 or 25 hours long. */
export function utcFromDayMinutes(
  dayStartUtc: UtcMillis,
  minutes: number,
  tz: string,
): UtcMillis {
  const wall = toWall(dayStartUtc, tz);
  wall.setHours(0, 0, 0, 0);
  wall.setMinutes(minutes);
  return fromWall(wall, tz);
}

export function toDateTimeLocal(utcMs: UtcMillis, tz: string): string {
  return formatInTimeZone(new Date(utcMs), tz, "yyyy-MM-dd'T'HH:mm");
}

export function fromDateTimeLocal(value: string, tz: string): UtcMillis | null {
  const parsed = fromZonedTime(value, tz).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

export function isSameLocalDay(a: UtcMillis, b: UtcMillis, tz: string): boolean {
  return startOfLocalDay(a, tz) === startOfLocalDay(b, tz);
}

export function minutesToPixels(minutes: number, hourHeight: number): number {
  return (minutes / MINUTES_PER_HOUR) * hourHeight;
}

export function pixelsToMinutes(pixels: number, hourHeight: number): number {
  return (pixels / hourHeight) * MINUTES_PER_HOUR;
}

export function snapToGrid(minutes: number, step: number = SNAP_MINUTES): number {
  return Math.round(minutes / step) * step;
}

export function zoomBy(current: HourHeight, direction: 1 | -1): HourHeight {
  const index = HOUR_HEIGHTS.indexOf(current);
  const next = Math.min(HOUR_HEIGHTS.length - 1, Math.max(0, index + direction));
  return HOUR_HEIGHTS[next];
}

export function rangesOverlap(a: UtcRange, b: UtcRange): boolean {
  return a.start < b.end && a.end > b.start;
}

export function formatTime(utcMs: UtcMillis, tz: string): string {
  return formatInTimeZone(new Date(utcMs), tz, "HH:mm");
}

export function formatWeekday(utcMs: UtcMillis, tz: string): string {
  return formatInTimeZone(new Date(utcMs), tz, "EEE");
}

export function formatDayNumber(utcMs: UtcMillis, tz: string): string {
  return formatInTimeZone(new Date(utcMs), tz, "d");
}

export function formatHourLabel(hour: number): string {
  return String(hour).padStart(2, "0");
}
