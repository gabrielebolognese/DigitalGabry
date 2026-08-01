import { isOverdue, type CalendarEntry } from "../domain/block";
import type { MomentumDay } from "../domain/momentum";
import { formatTime, localDateOf, type UtcRange } from "../domain/time";

/* Serialises just enough of the app for the panel to be useful, and never the
   whole database. SPEC 9. */

export const CONTEXT_TOKEN_CAP = 4000;

/* Characters per token. Deliberately pessimistic: the real ratio for dense
   JSON sits nearer 4, so estimating at 3.4 over-counts and the cap is
   approached from the safe side. */
const CHARS_PER_TOKEN = 3.4;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

type ContextBlock = {
  title: string;
  kind: string;
  category: string;
  time: string;
  status: string;
  description?: string;
};

export type PanelContext = {
  now: string;
  timezone: string;
  today: ContextBlock[];
  week: ContextBlock[];
  overdue: ContextBlock[];
  momentum: Array<{ date: string; raw: number; momentum: number; streak: number }>;
};

export type ContextInput = {
  entries: readonly CalendarEntry[];
  momentum: readonly MomentumDay[];
  range: UtcRange;
  nowUtc: number;
  tz: string;
};

/* Every lever the truncator can pull, in the order it pulls them. Each step is
   reported, so the panel can say what was left out rather than silently
   shipping a thinner picture. */
type Budget = {
  descriptions: boolean;
  week: number;
  overdue: number;
  momentum: number;
  today: number;
};

const FULL_BUDGET: Budget = {
  descriptions: true,
  week: 40,
  overdue: 15,
  momentum: 7,
  today: 20,
};

const STEPS: Array<{ label: string; apply: (budget: Budget) => Budget }> = [
  { label: "descriptions", apply: (b) => ({ ...b, descriptions: false }) },
  { label: "week to 20 blocks", apply: (b) => ({ ...b, week: 20 }) },
  { label: "overdue to 8 items", apply: (b) => ({ ...b, overdue: 8 }) },
  { label: "week to 8 blocks", apply: (b) => ({ ...b, week: 8 }) },
  { label: "momentum to 3 days", apply: (b) => ({ ...b, momentum: 3 }) },
  { label: "today to 8 blocks", apply: (b) => ({ ...b, today: 8 }) },
  { label: "week dropped", apply: (b) => ({ ...b, week: 0 }) },
  { label: "overdue to 3 items", apply: (b) => ({ ...b, overdue: 3 }) },
];

function toContextBlock(
  entry: CalendarEntry,
  tz: string,
  withDescription: boolean,
): ContextBlock {
  const time =
    entry.startUtc === null || entry.endUtc === null
      ? "unscheduled"
      : `${formatTime(entry.startUtc, tz)}-${formatTime(entry.endUtc, tz)}`;

  const block: ContextBlock = {
    title: entry.title,
    kind: entry.kind,
    category: entry.category,
    time,
    status: entry.status,
  };

  if (withDescription && entry.description !== null && entry.description !== "") {
    block.description = entry.description;
  }
  return block;
}

function build(input: ContextInput, budget: Budget): PanelContext {
  const { entries, momentum, range, nowUtc, tz } = input;
  const todayDate = localDateOf(nowUtc, tz);

  const scheduled = entries.filter((entry) => entry.startUtc !== null);

  const today = scheduled
    .filter((entry) => entry.startUtc !== null && localDateOf(entry.startUtc, tz) === todayDate)
    .slice(0, budget.today)
    .map((entry) => toContextBlock(entry, tz, budget.descriptions));

  const week = scheduled
    .filter(
      (entry) =>
        entry.startUtc !== null &&
        localDateOf(entry.startUtc, tz) !== todayDate &&
        entry.startUtc >= range.start &&
        entry.startUtc < range.end,
    )
    .slice(0, budget.week)
    .map((entry) => toContextBlock(entry, tz, budget.descriptions));

  const overdue = entries
    .filter((entry) => isOverdue(entry, nowUtc))
    .slice(0, budget.overdue)
    .map((entry) => toContextBlock(entry, tz, budget.descriptions));

  return {
    now: new Date(nowUtc).toISOString(),
    timezone: tz,
    today,
    week,
    overdue,
    momentum: momentum.slice(-budget.momentum).map((day) => ({
      date: day.localDate,
      raw: Math.round(day.rawScore),
      momentum: Math.round(day.momentum),
      streak: day.streak,
    })),
  };
}

export type SerialisedContext = {
  json: string;
  tokens: number;
  dropped: string[];
};

/* Tightens the payload one documented step at a time until it fits, rather
   than truncating the JSON string, which would produce something unparseable.
   The last step is guaranteed to fit because it keeps only today plus three
   overdue items. */
export function serialiseContext(input: ContextInput): SerialisedContext {
  let budget = FULL_BUDGET;
  const dropped: string[] = [];

  for (let step = 0; step <= STEPS.length; step += 1) {
    const json = JSON.stringify(build(input, budget));
    const tokens = estimateTokens(json);
    if (tokens <= CONTEXT_TOKEN_CAP || step === STEPS.length) {
      return { json, tokens, dropped };
    }
    const next = STEPS[step];
    dropped.push(next.label);
    budget = next.apply(budget);
  }

  // Unreachable: the loop always returns on its final iteration.
  return { json: "{}", tokens: 1, dropped };
}
