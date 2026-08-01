/* The scoring engine. Pure: no React, no SQL, no clock, no zone.
 *
 * momentum_daily is a cache of what this file computes, never a source of
 * truth. Delete the table, run computeSeries again over the same activity log
 * and the same constants, and the result is identical. Architecture
 * invariant 9. */

/** A calendar day in the user's zone, 'YYYY-MM-DD'. */
export type LocalDate = string;

export type MomentumConstants = {
  /** Daily decay. SPEC 8.2. */
  readonly lambda: number;
  /** Added to the multiplier per streak day. */
  readonly streakIncrement: number;
  /** Ceiling on the multiplier itself. */
  readonly streakMultiplierCap: number;
  /** A day counts towards the streak once its raw score reaches this. */
  readonly streakThreshold: number;
  /** Streak days beyond this stop adding to the multiplier. */
  readonly streakDayCap: number;
};

export const DEFAULT_MOMENTUM_CONSTANTS: MomentumConstants = {
  lambda: 0.92,
  streakIncrement: 0.005,
  streakMultiplierCap: 1.3,
  streakThreshold: 3,
  streakDayCap: 60,
};

export type ScoringType = {
  readonly id: string;
  readonly weight: number;
  readonly dailyCap: number;
};

export type ActivityCount = {
  readonly activityTypeId: string;
  readonly count: number;
};

export type MomentumDay = {
  readonly localDate: LocalDate;
  readonly rawScore: number;
  readonly multiplier: number;
  readonly momentum: number;
  readonly streak: number;
};

export type MomentumLevel = {
  readonly band: number;
  readonly min: number;
  readonly label: string;
};

/* SPEC 8.3. Ordered low to high; levelFor walks from the top. */
export const MOMENTUM_LEVELS: readonly MomentumLevel[] = [
  { band: 0, min: 0, label: "Dormant" },
  { band: 1, min: 25, label: "Warming" },
  { band: 2, min: 75, label: "Steady" },
  { band: 3, min: 200, label: "Building" },
  { band: 4, min: 450, label: "Compounding" },
  { band: 5, min: 900, label: "Peak" },
];

export function levelFor(momentum: number): MomentumLevel {
  let found = MOMENTUM_LEVELS[0];
  for (const level of MOMENTUM_LEVELS) {
    if (momentum >= level.min) found = level;
  }
  return found;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/* Date only arithmetic, so UTC millis are exact here and no zone is involved.
   A LocalDate has already been resolved against a zone by the time it is
   written to the activity log. */
export function addLocalDays(date: LocalDate, days: number): LocalDate {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  const moved = new Date(Date.UTC(year, month - 1, day) + days * 86_400_000);
  return `${moved.getUTCFullYear()}-${pad(moved.getUTCMonth() + 1)}-${pad(moved.getUTCDate())}`;
}

export function daysBetweenLocalDates(from: LocalDate, to: LocalDate): number {
  const parse = (date: LocalDate): number =>
    Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
  return Math.round((parse(to) - parse(from)) / 86_400_000);
}

/* S(d) = sum over types of min(count, cap) * weight.
   Counts are summed per type before the cap, so twenty separate entries and
   one entry of twenty score the same. */
export function dailyRawScore(
  entries: readonly ActivityCount[],
  types: ReadonlyMap<string, ScoringType>,
): number {
  if (entries.length === 0) return 0;

  const totals = new Map<string, number>();
  for (const entry of entries) {
    totals.set(entry.activityTypeId, (totals.get(entry.activityTypeId) ?? 0) + entry.count);
  }

  let score = 0;
  for (const [typeId, total] of totals) {
    const type = types.get(typeId);
    // An entry pointing at an archived or deleted type contributes nothing
    // rather than throwing, so one stale row cannot break the whole curve.
    if (type === undefined) continue;
    score += Math.min(total, type.dailyCap) * type.weight;
  }
  return score;
}

/* K(d) = 1 + min(streak, dayCap) * increment, capped. SPEC 8.2. */
export function streakMultiplier(
  streak: number,
  constants: MomentumConstants = DEFAULT_MOMENTUM_CONSTANTS,
): number {
  const days = Math.min(Math.max(streak, 0), constants.streakDayCap);
  return Math.min(1 + days * constants.streakIncrement, constants.streakMultiplierCap);
}

export type SeriesInput = {
  readonly logsByDate: ReadonlyMap<LocalDate, readonly ActivityCount[]>;
  readonly types: readonly ScoringType[];
  readonly constants?: MomentumConstants;
  readonly from?: LocalDate;
  readonly to?: LocalDate;
};

/* M(d) = lambda * M(d-1) + S(d) * K(d), folded over every day in the range.
   Days with no activity still produce a row with S = 0, which is what makes
   the decay apply on empty days rather than freezing the curve. */
export function computeSeries(input: SeriesInput): MomentumDay[] {
  const constants = input.constants ?? DEFAULT_MOMENTUM_CONSTANTS;
  const types = new Map(input.types.map((type) => [type.id, type]));

  const logged = [...input.logsByDate.keys()].sort();
  const from = input.from ?? logged[0];
  const to = input.to ?? logged[logged.length - 1];
  if (from === undefined || to === undefined || from > to) return [];

  const days: MomentumDay[] = [];
  let momentum = 0;
  let streak = 0;

  for (let date = from; date <= to; date = addLocalDays(date, 1)) {
    const rawScore = dailyRawScore(input.logsByDate.get(date) ?? [], types);
    streak = rawScore >= constants.streakThreshold ? streak + 1 : 0;
    const multiplier = streakMultiplier(streak, constants);
    momentum = constants.lambda * momentum + rawScore * multiplier;
    days.push({ localDate: date, rawScore, multiplier, momentum, streak });
  }

  return days;
}

/* Steady state of the fold under a constant daily contribution. Useful for
   calibration: SPEC 8.2 gives M∞ = S / (1 - lambda) = 12.5 × S, which is the
   value with the multiplier neutral. */
export function steadyState(
  dailyContribution: number,
  constants: MomentumConstants = DEFAULT_MOMENTUM_CONSTANTS,
): number {
  return dailyContribution / (1 - constants.lambda);
}

export function halfLifeDays(
  constants: MomentumConstants = DEFAULT_MOMENTUM_CONSTANTS,
): number {
  return Math.log(0.5) / Math.log(constants.lambda);
}
