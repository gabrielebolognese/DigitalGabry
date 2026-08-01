import { describe, expect, it } from "vitest";
import {
  DEFAULT_MOMENTUM_CONSTANTS,
  addLocalDays,
  computeSeries,
  dailyRawScore,
  daysBetweenLocalDates,
  halfLifeDays,
  levelFor,
  steadyState,
  streakMultiplier,
  type ActivityCount,
  type LocalDate,
  type ScoringType,
} from "./momentum";

const TYPES: ScoringType[] = [
  { id: "x-reply", weight: 1, dailyCap: 20 },
  { id: "li-post", weight: 8, dailyCap: 5 },
  { id: "commit", weight: 2, dailyCap: 10 },
];

const typeMap = new Map(TYPES.map((type) => [type.id, type]));

const entries = (...pairs: Array<[string, number]>): ActivityCount[] =>
  pairs.map(([activityTypeId, count]) => ({ activityTypeId, count }));

/* A run of identical days, for the convergence and decay tests. */
function constantLog(
  from: LocalDate,
  days: number,
  perDay: ActivityCount[],
): Map<LocalDate, ActivityCount[]> {
  const log = new Map<LocalDate, ActivityCount[]>();
  for (let index = 0; index < days; index += 1) {
    log.set(addLocalDays(from, index), perDay);
  }
  return log;
}

describe("date helpers", () => {
  it("adds and subtracts days across a month boundary", () => {
    expect(addLocalDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addLocalDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("handles a leap day", () => {
    expect(addLocalDays("2028-02-28", 1)).toBe("2028-02-29");
  });

  it("measures the gap between two dates", () => {
    expect(daysBetweenLocalDates("2026-01-01", "2026-01-31")).toBe(30);
  });
});

describe("dailyRawScore", () => {
  it("is the sum of min(count, cap) times weight", () => {
    // 2 replies at 1, plus 1 LinkedIn post at 8.
    expect(dailyRawScore(entries(["x-reply", 2], ["li-post", 1]), typeMap)).toBe(10);
  });

  it("caps a type before weighting it", () => {
    // 40 replies, capped at 20, weight 1.
    expect(dailyRawScore(entries(["x-reply", 40]), typeMap)).toBe(20);
  });

  it("sums repeated entries of one type before applying the cap", () => {
    const many = entries(...Array.from({ length: 30 }, () => ["x-reply", 1] as [string, number]));
    expect(dailyRawScore(many, typeMap)).toBe(20);
  });

  it("scores an empty day as zero", () => {
    expect(dailyRawScore([], typeMap)).toBe(0);
  });

  it("ignores an entry pointing at a type that no longer exists", () => {
    expect(dailyRawScore(entries(["ghost", 5], ["x-reply", 1]), typeMap)).toBe(1);
  });

  it("matches the calibration day in SPEC 8.5", () => {
    // One LinkedIn post, three commits, two X replies.
    expect(dailyRawScore(entries(["li-post", 1], ["commit", 3], ["x-reply", 2]), typeMap)).toBe(16);
  });
});

describe("streakMultiplier", () => {
  it("is 1 at a zero streak", () => {
    expect(streakMultiplier(0)).toBe(1);
  });

  it("adds the increment per day", () => {
    expect(streakMultiplier(10)).toBeCloseTo(1.05);
  });

  it("caps at 1.30", () => {
    expect(streakMultiplier(60)).toBeCloseTo(1.3);
    expect(streakMultiplier(500)).toBe(1.3);
  });

  it("never goes below 1", () => {
    expect(streakMultiplier(-5)).toBe(1);
  });
});

describe("levelFor", () => {
  it("uses the six bands from SPEC 8.3", () => {
    expect(levelFor(0).label).toBe("Dormant");
    expect(levelFor(24.9).label).toBe("Dormant");
    expect(levelFor(25).label).toBe("Warming");
    expect(levelFor(74).label).toBe("Warming");
    expect(levelFor(75).label).toBe("Steady");
    expect(levelFor(199).label).toBe("Steady");
    expect(levelFor(200).label).toBe("Building");
    expect(levelFor(449).label).toBe("Building");
    expect(levelFor(450).label).toBe("Compounding");
    expect(levelFor(899).label).toBe("Compounding");
    expect(levelFor(900).label).toBe("Peak");
    expect(levelFor(100_000).band).toBe(5);
  });
});

describe("computeSeries, the calibration cases", () => {
  it("decays with a half life of about 8.3 days", () => {
    expect(halfLifeDays()).toBeCloseTo(8.31, 1);

    // One scoring day, then nothing for a month.
    const log = new Map([["2026-01-01", entries(["li-post", 5])]]);
    const series = computeSeries({
      logsByDate: log,
      types: TYPES,
      from: "2026-01-01",
      to: "2026-02-01",
    });

    const peak = series[0].momentum;
    const after8 = series[8].momentum;
    const after9 = series[9].momentum;

    // The crossing sits between day 8 and day 9, i.e. at about 8.3.
    expect(after8 / peak).toBeGreaterThan(0.5);
    expect(after9 / peak).toBeLessThan(0.5);
  });

  it("converges to S / (1 - lambda) when the multiplier is neutral", () => {
    // SPEC 8.2's headline figure of 200 for a daily 16 is the value with the
    // streak multiplier held at 1.
    const flat = { ...DEFAULT_MOMENTUM_CONSTANTS, streakIncrement: 0 };
    const series = computeSeries({
      logsByDate: constantLog("2026-01-01", 400, entries(["li-post", 1], ["commit", 3], ["x-reply", 2])),
      types: TYPES,
      constants: flat,
    });

    expect(steadyState(16, flat)).toBeCloseTo(200, 6);
    expect(series[series.length - 1].momentum).toBeCloseTo(200, 1);
  });

  it("converges to S * K / (1 - lambda) once the streak multiplier saturates", () => {
    const series = computeSeries({
      logsByDate: constantLog("2026-01-01", 400, entries(["li-post", 1], ["commit", 3], ["x-reply", 2])),
      types: TYPES,
    });

    const last = series[series.length - 1];
    expect(last.rawScore).toBe(16);
    expect(last.multiplier).toBeCloseTo(1.3);
    // 16 * 1.3 / 0.08
    expect(last.momentum).toBeCloseTo(260, 0);
  });

  it("decays towards zero across a 30 day gap without ever going below it", () => {
    const log = new Map([["2026-01-01", entries(["li-post", 5])]]);
    const series = computeSeries({
      logsByDate: log,
      types: TYPES,
      from: "2026-01-01",
      to: "2026-01-31",
    });

    for (const day of series) expect(day.momentum).toBeGreaterThan(0);
    const last = series[series.length - 1];
    expect(last.momentum).toBeLessThan(series[0].momentum * 0.1);
    expect(last.rawScore).toBe(0);
  });

  it("is deterministic, so the cache can always be rebuilt", () => {
    const input = {
      logsByDate: constantLog("2026-01-01", 120, entries(["commit", 4])),
      types: TYPES,
    };
    expect(JSON.stringify(computeSeries(input))).toBe(JSON.stringify(computeSeries(input)));
  });
});

describe("computeSeries, the fold", () => {
  it("emits a row for every day in the range, including empty ones", () => {
    const series = computeSeries({
      logsByDate: new Map([["2026-01-05", entries(["commit", 1])]]),
      types: TYPES,
      from: "2026-01-01",
      to: "2026-01-10",
    });
    expect(series).toHaveLength(10);
    expect(series.map((day) => day.localDate)[0]).toBe("2026-01-01");
    expect(series[0].rawScore).toBe(0);
  });

  it("breaks the streak on a day below the threshold", () => {
    const log = new Map([
      ["2026-01-01", entries(["commit", 3])], // 6, above the threshold
      ["2026-01-02", entries(["commit", 3])],
      ["2026-01-03", entries(["x-reply", 1])], // 1, below it
      ["2026-01-04", entries(["commit", 3])],
    ]);
    const series = computeSeries({ logsByDate: log, types: TYPES });
    expect(series.map((day) => day.streak)).toEqual([1, 2, 0, 1]);
  });

  it("treats a day exactly on the threshold as counting", () => {
    const series = computeSeries({
      logsByDate: new Map([["2026-01-01", entries(["x-reply", 3])]]),
      types: TYPES,
    });
    expect(series[0].streak).toBe(1);
  });

  it("returns nothing for an empty log and no explicit range", () => {
    expect(computeSeries({ logsByDate: new Map(), types: TYPES })).toEqual([]);
  });

  it("returns nothing when the range runs backwards", () => {
    expect(
      computeSeries({
        logsByDate: new Map(),
        types: TYPES,
        from: "2026-02-01",
        to: "2026-01-01",
      }),
    ).toEqual([]);
  });

  it("applies the recomputed curve when a weight changes", () => {
    const log = constantLog("2026-01-01", 30, entries(["commit", 1]));
    const before = computeSeries({ logsByDate: log, types: TYPES });
    const after = computeSeries({
      logsByDate: log,
      types: TYPES.map((type) => (type.id === "commit" ? { ...type, weight: 20 } : type)),
    });
    expect(after[after.length - 1].momentum).toBeGreaterThan(
      before[before.length - 1].momentum * 5,
    );
  });

  it("folds ten years of daily activity quickly", () => {
    const began = Date.now();
    const series = computeSeries({
      logsByDate: constantLog("2016-01-01", 3650, entries(["commit", 2], ["x-reply", 4])),
      types: TYPES,
    });
    expect(series).toHaveLength(3650);
    expect(Date.now() - began).toBeLessThan(2000);
  });
});
