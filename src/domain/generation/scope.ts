import { z } from "zod";
import { BLOCK_CATEGORIES, BLOCK_KINDS, PLATFORMS } from "../block";
import type { Period, Scope, Slot } from "./types";

/* Shared by every modifier: which slots am I allowed to touch, and which
   bucket does this one fall in. Kept in one file so two modifiers can never
   disagree about what "this week" means. */

export const scopeSchema = z
  .object({
    platforms: z.array(z.enum(PLATFORMS)).optional(),
    kinds: z.array(z.enum(BLOCK_KINDS)).optional(),
    categories: z.array(z.enum(BLOCK_CATEGORIES)).optional(),
    generatorIds: z.array(z.string()).optional(),
  })
  .default({});

export const periodSchema = z.enum(["day", "week", "month"]);

/* An absent or empty list matches everything. Written this way so a scope of
   {} is the permissive default rather than a filter that excludes all. */
function listMatches<T>(allowed: readonly T[] | undefined, value: T | undefined): boolean {
  if (allowed === undefined || allowed.length === 0) return true;
  if (value === undefined) return false;
  return allowed.includes(value);
}

export function matchesScope(slot: Slot, scope: Scope | undefined): boolean {
  if (scope === undefined) return true;
  return (
    listMatches(scope.platforms, slot.intent.platform) &&
    listMatches(scope.kinds, slot.intent.kind) &&
    listMatches(scope.categories, slot.intent.category) &&
    listMatches(scope.generatorIds, slot.generatorId)
  );
}

/* ISO week, computed rather than formatted. Intl would be locale dependent,
   and "week" has to mean the same thing on every machine. Thursday rule: the
   week belongs to the year containing its Thursday. */
export function isoWeekKey(localDate: string): string {
  const [year, month, day] = localDate.split("-").map(Number);
  const date = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1));

  // Move to the Thursday of this week: day 0 is Sunday, so map it to 7.
  const weekday = date.getUTCDay() === 0 ? 7 : date.getUTCDay();
  date.setUTCDate(date.getUTCDate() + 4 - weekday);

  const isoYear = date.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const firstWeekday = firstThursday.getUTCDay() === 0 ? 7 : firstThursday.getUTCDay();
  firstThursday.setUTCDate(firstThursday.getUTCDate() + 4 - firstWeekday);

  const week =
    1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

export function periodKeyOf(localDate: string, period: Period): string {
  switch (period) {
    case "day":
      return localDate;
    case "week":
      return isoWeekKey(localDate);
    case "month":
      return localDate.slice(0, 7);
  }
}

export function groupBy<T>(items: readonly T[], keyOf: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const bucket = groups.get(key);
    if (bucket === undefined) groups.set(key, [item]);
    else bucket.push(item);
  }
  return groups;
}

/* Bound, pinned, moved and materialized slots are immune to stages 3 through
   6. Once a person has attached content or moved something by hand, the
   schedule stops rearranging it underneath them. Invariant 20. */
export function isProtected(slot: Slot): boolean {
  return (
    slot.state === "assigned" ||
    slot.state === "pinned" ||
    slot.state === "materialized" ||
    slot.state === "moved"
  );
}

export function byStart(left: Slot, right: Slot): number {
  return left.startUtc - right.startUtc || (left.key < right.key ? -1 : 1);
}
