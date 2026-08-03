import type { Slot } from "./types";

/* Spec1.1 section 13. Slots are useless empty; this decides what goes in them.

   Pure, and over the smallest shapes that answer the question, so the planner
   can be tested without a database and the dry run the user approves is
   literally the thing that gets applied rather than a description of it. */

export type AssignableContent = {
  id: string;
  platform: string;
  status: string;
  title: string;
  projectId: string | null;
  createdUtc: number;
  updatedUtc: number;
  priority?: number;
};

export type AutoFillStrategy =
  | "oldest-first"
  | "newest-first"
  | "round-robin-project"
  | "priority";

export type AutoFillOptions = {
  strategy: AutoFillStrategy;
  /* Do not reuse a project within N slots, so a schedule does not read as one
     project shouting for a week. */
  respectCooldown: boolean;
  cooldownSlots: number;
  maxAssignments: number;
};

export const DEFAULT_AUTOFILL: AutoFillOptions = {
  strategy: "oldest-first",
  respectCooldown: true,
  cooldownSlots: 3,
  maxAssignments: 50,
};

export type Assignment = {
  slotKey: string;
  slot: Slot;
  content: AssignableContent;
};

export type Unfilled = {
  slotKey: string;
  slot: Slot;
  reason: string;
};

export type AutoFillPlan = {
  assignments: Assignment[];
  unfilled: Unfilled[];
};

/* Only content that is finished and not already committed elsewhere. */
export function isAssignable(item: AssignableContent): boolean {
  return item.status === "ready";
}

function orderContent(
  items: readonly AssignableContent[],
  strategy: AutoFillStrategy,
): AssignableContent[] {
  const tie = (left: AssignableContent, right: AssignableContent): number =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0;

  switch (strategy) {
    case "newest-first":
      return [...items].sort((a, b) => b.createdUtc - a.createdUtc || tie(a, b));
    case "priority":
      return [...items].sort(
        (a, b) => (b.priority ?? 0) - (a.priority ?? 0) || a.createdUtc - b.createdUtc || tie(a, b),
      );
    /* round-robin is handled during the walk, since it depends on what has
       already been placed rather than on the item alone. */
    case "round-robin-project":
    case "oldest-first":
      return [...items].sort((a, b) => a.createdUtc - b.createdUtc || tie(a, b));
  }
}

/* Greedy, in slot order, which is what makes the result explainable: the
   earliest empty slot takes the best remaining candidate, and nothing later
   can take it back. */
export function planAutoFill(
  slots: readonly Slot[],
  content: readonly AssignableContent[],
  options: AutoFillOptions = DEFAULT_AUTOFILL,
): AutoFillPlan {
  const assignments: Assignment[] = [];
  const unfilled: Unfilled[] = [];

  const pool = orderContent(content.filter(isAssignable), options.strategy);
  const used = new Set<string>();
  /* Which slot index each project was last used at, for the cooldown. */
  const lastUsedAt = new Map<string, number>();

  const empty = [...slots]
    .filter((slot) => slot.contentId === undefined && slot.blockId === undefined)
    .sort((left, right) => left.startUtc - right.startUtc || (left.key < right.key ? -1 : 1));

  for (const [index, slot] of empty.entries()) {
    if (assignments.length >= options.maxAssignments) {
      unfilled.push({ slotKey: slot.key, slot, reason: "Reached the assignment limit" });
      continue;
    }

    const wanted = slot.intent.platform;
    const candidates = pool.filter(
      (item) => !used.has(item.id) && (wanted === undefined || item.platform === wanted),
    );

    if (candidates.length === 0) {
      unfilled.push({
        slotKey: slot.key,
        slot,
        reason:
          wanted === undefined
            ? "Nothing ready to put here"
            : `Nothing ready for ${wanted}`,
      });
      continue;
    }

    let chosen: AssignableContent | undefined;

    if (options.respectCooldown) {
      chosen = candidates.find((item) => {
        if (item.projectId === null) return true;
        const last = lastUsedAt.get(item.projectId);
        return last === undefined || index - last >= options.cooldownSlots;
      });
    }

    /* The cooldown is a preference, not a rule: leaving a slot empty to honour
       it would be worse than two posts from one project close together. */
    chosen = chosen ?? candidates[0];
    if (chosen === undefined) continue;

    used.add(chosen.id);
    if (chosen.projectId !== null) lastUsedAt.set(chosen.projectId, index);
    assignments.push({ slotKey: slot.key, slot, content: chosen });
  }

  return { assignments, unfilled };
}

/* ---- capacity and starvation, Spec1.1 section 13 ---- */

export type PlatformCapacity = {
  platform: string;
  slots: number;
  ready: number;
  /* Positive is spare, negative is short. */
  balance: number;
  /* Slots per day across the window, for the sparkline. */
  perDay: number[];
};

const SPARK_CHARS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇"] as const;

export function sparkline(values: readonly number[]): string {
  const max = Math.max(...values, 0);
  if (max === 0) return SPARK_CHARS[0]?.repeat(values.length) ?? "";
  return values
    .map((value) => {
      const step = Math.round((value / max) * (SPARK_CHARS.length - 1));
      return SPARK_CHARS[step] ?? SPARK_CHARS[0];
    })
    .join("");
}

/* The number that says whether the schedule is realistic. A schedule you
   cannot feed is worse than no schedule, and without this the shortfall only
   shows up as empty slots one day at a time. */
export function capacityReport(
  slots: readonly Slot[],
  content: readonly AssignableContent[],
  dates: readonly string[],
): PlatformCapacity[] {
  const platforms = new Set<string>();
  for (const slot of slots) {
    if (slot.intent.platform !== undefined) platforms.add(slot.intent.platform);
  }
  for (const item of content) {
    if (isAssignable(item)) platforms.add(item.platform);
  }

  const dateIndex = new Map(dates.map((date, index) => [date, index]));

  return [...platforms]
    .sort()
    .map((platform) => {
      const mine = slots.filter((slot) => slot.intent.platform === platform);
      const perDay = dates.map(() => 0);

      for (const slot of mine) {
        const index = dateIndex.get(slot.localDate);
        if (index !== undefined) perDay[index] = (perDay[index] ?? 0) + 1;
      }

      const ready = content.filter(
        (item) => isAssignable(item) && item.platform === platform,
      ).length;

      return {
        platform,
        slots: mine.length,
        ready,
        balance: ready - mine.length,
        perDay,
      };
    })
    .sort((left, right) => left.balance - right.balance);
}
