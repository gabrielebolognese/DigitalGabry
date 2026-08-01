import { describe, expect, it } from "vitest";
import {
  RECURRENCE_MAX_OCCURRENCES,
  applyExceptions,
  countBefore,
  generateOccurrences,
  parseRrule,
  splitRuleAt,
  type OccurrenceSeed,
} from "./recurrence";
import { DEFAULT_TZ, localMinutesOfDay, wallClockOf } from "./time";

const utc = (iso: string): number => new Date(iso).getTime();

/* 09:00 to 10:00 Rome on Monday 2026-01-05. */
const seed = (rrule: string, startIso = "2026-01-05T08:00:00Z"): OccurrenceSeed => ({
  blockId: "series-1",
  startUtc: utc(startIso),
  endUtc: utc(startIso) + 60 * 60 * 1000,
  tz: DEFAULT_TZ,
  rrule,
});

describe("parseRrule", () => {
  it("canonicalises a simple daily rule", () => {
    const parsed = parseRrule("FREQ=DAILY", DEFAULT_TZ);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.freq).toBe("DAILY");
    expect(parsed.value.interval).toBe(1);
    expect(parsed.value.text).toBe("FREQ=DAILY");
  });

  it("strips DTSTART so it can never disagree with the block", () => {
    const parsed = parseRrule("DTSTART:20200101T090000\nRRULE:FREQ=WEEKLY;BYDAY=MO", DEFAULT_TZ);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.text).toBe("FREQ=WEEKLY;BYDAY=MO");
  });

  it("rejects sub daily frequencies", () => {
    const parsed = parseRrule("FREQ=MINUTELY", DEFAULT_TZ);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error.kind).toBe("unsupported-freq");
  });

  it("rejects an empty rule", () => {
    expect(parseRrule("   ", DEFAULT_TZ).ok).toBe(false);
  });

  it("rejects COUNT and UNTIL together", () => {
    const parsed = parseRrule("FREQ=DAILY;COUNT=5;UNTIL=20260201T090000", DEFAULT_TZ);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error.kind).toBe("count-and-until");
  });

  it("converts an absolute UNTIL into floating wall clock in the block's zone", () => {
    // 22:30Z in July is 00:30 the next day in Rome.
    const parsed = parseRrule("FREQ=DAILY;UNTIL=20260715T223000Z", DEFAULT_TZ);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.text).toBe("FREQ=DAILY;UNTIL=20260716T003000");
  });
});

describe("generateOccurrences", () => {
  it("generates one occurrence per day with the seed's duration", () => {
    const result = generateOccurrences(seed("FREQ=DAILY"), {
      start: utc("2026-01-05T00:00:00Z"),
      end: utc("2026-01-12T00:00:00Z"),
    });
    expect(result.occurrences).toHaveLength(7);
    for (const entry of result.occurrences) {
      expect(entry.endUtc - entry.startUtc).toBe(60 * 60 * 1000);
    }
  });

  it("keeps a daily 09:00 rule at 09:00 across the spring forward transition", () => {
    // Rome moves 02:00 to 03:00 on 2026-03-29.
    const result = generateOccurrences(seed("FREQ=DAILY"), {
      start: utc("2026-03-25T00:00:00Z"),
      end: utc("2026-04-03T00:00:00Z"),
    });
    expect(result.occurrences.length).toBeGreaterThan(6);
    for (const entry of result.occurrences) {
      expect(localMinutesOfDay(entry.startUtc, DEFAULT_TZ)).toBe(9 * 60);
    }
  });

  it("keeps a daily 09:00 rule at 09:00 across the autumn back transition", () => {
    // Rome repeats 02:00 to 03:00 on 2026-10-25.
    const result = generateOccurrences(seed("FREQ=DAILY"), {
      start: utc("2026-10-21T00:00:00Z"),
      end: utc("2026-10-30T00:00:00Z"),
    });
    expect(result.occurrences.length).toBeGreaterThan(6);
    for (const entry of result.occurrences) {
      expect(localMinutesOfDay(entry.startUtc, DEFAULT_TZ)).toBe(9 * 60);
    }
  });

  it("reports a reading that falls inside the spring forward gap", () => {
    // 02:30 Rome does not exist on 2026-03-29.
    const gapSeed = seed("FREQ=DAILY", "2026-03-27T01:30:00Z");
    expect(wallClockOf(gapSeed.startUtc, DEFAULT_TZ).hour).toBe(2);
    const result = generateOccurrences(gapSeed, {
      start: utc("2026-03-27T00:00:00Z"),
      end: utc("2026-03-31T00:00:00Z"),
    });
    expect(result.dstShifted.length).toBe(1);
  });

  it("honours a weekly BYDAY rule", () => {
    const result = generateOccurrences(seed("FREQ=WEEKLY;BYDAY=MO,WE"), {
      start: utc("2026-01-05T00:00:00Z"),
      end: utc("2026-01-19T00:00:00Z"),
    });
    expect(result.occurrences).toHaveLength(4);
  });

  it("stops at COUNT", () => {
    const result = generateOccurrences(seed("FREQ=DAILY;COUNT=3"), {
      start: utc("2026-01-01T00:00:00Z"),
      end: utc("2026-02-01T00:00:00Z"),
    });
    expect(result.occurrences).toHaveLength(3);
  });

  it("returns nothing and keeps exceptions orphaned for an unparseable rule", () => {
    const result = generateOccurrences(seed("FREQ=SECONDLY"), {
      start: utc("2026-01-05T00:00:00Z"),
      end: utc("2026-01-06T00:00:00Z"),
      // eslint-disable-next-line
    }, { exceptions: [{ originalStartUtc: 1, kind: "override" }] });
    expect(result.occurrences).toHaveLength(0);
    expect(result.orphanedExceptions).toHaveLength(1);
  });

  it("caps runaway generation and reports it", () => {
    const result = generateOccurrences(
      seed("FREQ=DAILY"),
      { start: utc("2026-01-05T00:00:00Z"), end: utc("2036-01-05T00:00:00Z") },
      { maxOccurrences: 10 },
    );
    expect(result.truncated).toBe(true);
    expect(result.occurrences.length).toBeLessThanOrEqual(10);
  });

  it("does not lose an occurrence at the window boundary", () => {
    const day = generateOccurrences(seed("FREQ=DAILY"), {
      start: utc("2026-01-05T08:00:00Z"),
      end: utc("2026-01-05T09:00:00Z"),
    });
    expect(day.occurrences).toHaveLength(1);
  });

  it("is deterministic", () => {
    const window = { start: utc("2026-01-05T00:00:00Z"), end: utc("2026-03-05T00:00:00Z") };
    const first = generateOccurrences(seed("FREQ=DAILY"), window);
    const second = generateOccurrences(seed("FREQ=DAILY"), window);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it("rebuilds 18 months of a daily rule well inside the budget", () => {
    const began = Date.now();
    // Seeded at the window start, since nothing is generated before dtstart.
    const result = generateOccurrences(seed("FREQ=DAILY", "2025-09-30T22:00:00Z"), {
      start: utc("2025-10-01T00:00:00Z"),
      end: utc("2027-04-01T00:00:00Z"),
    });
    expect(result.occurrences.length).toBeGreaterThan(500);
    expect(Date.now() - began).toBeLessThan(500);
    expect(RECURRENCE_MAX_OCCURRENCES).toBeGreaterThan(result.occurrences.length);
  });
});

describe("splitRuleAt", () => {
  const daily = seed("FREQ=DAILY");

  it("returns no head when the split is the first instance", () => {
    const split = splitRuleAt(daily, daily.startUtc);
    expect(split.ok).toBe(true);
    if (!split.ok) return;
    expect(split.value.head).toBeNull();
    expect(split.value.tail).toBe("FREQ=DAILY");
  });

  it("bounds the head one second before the split", () => {
    // Third instance, 2026-01-07 09:00 Rome.
    const third = utc("2026-01-07T08:00:00Z");
    const split = splitRuleAt(daily, third);
    expect(split.ok).toBe(true);
    if (!split.ok) return;
    // UNTIL is inclusive, so it lands on 08:59:59 the same morning.
    expect(split.value.head).toBe("FREQ=DAILY;UNTIL=20260107T085959");
    expect(split.value.tail).toBe("FREQ=DAILY");
  });

  it("leaves the head covering exactly the instances before the split", () => {
    const third = utc("2026-01-07T08:00:00Z");
    const split = splitRuleAt(daily, third);
    if (!split.ok || split.value.head === null) throw new Error("expected a head");

    const head = generateOccurrences({ ...daily, rrule: split.value.head }, {
      start: utc("2026-01-01T00:00:00Z"),
      end: utc("2026-02-01T00:00:00Z"),
    });
    expect(head.occurrences).toHaveLength(2);
  });

  it("splits a counted rule by rewriting both counts", () => {
    const counted = seed("FREQ=DAILY;COUNT=10");
    const third = utc("2026-01-07T08:00:00Z");
    const split = splitRuleAt(counted, third);
    expect(split.ok).toBe(true);
    if (!split.ok) return;
    // COUNT and UNTIL are mutually exclusive, so neither side may gain UNTIL.
    expect(split.value.head).toBe("FREQ=DAILY;COUNT=2");
    expect(split.value.tail).toBe("FREQ=DAILY;COUNT=8");
  });

  it("reports an unparseable rule rather than splitting it", () => {
    expect(splitRuleAt(seed("FREQ=SECONDLY"), Date.now()).ok).toBe(false);
  });
});

describe("countBefore", () => {
  it("counts instances strictly before an instant", () => {
    const daily = seed("FREQ=DAILY");
    expect(countBefore(daily, daily.startUtc)).toBe(0);
    expect(countBefore(daily, utc("2026-01-08T08:00:00Z"))).toBe(3);
  });
});

describe("applyExceptions", () => {
  const generated = [
    { blockId: "s", startUtc: 100, endUtc: 200 },
    { blockId: "s", startUtc: 300, endUtc: 400 },
  ];

  it("removes a claimed instant from the generated set", () => {
    const { kept, orphaned } = applyExceptions(generated, [
      { originalStartUtc: 100, kind: "override" },
    ]);
    expect(kept).toHaveLength(1);
    expect(kept[0].startUtc).toBe(300);
    expect(orphaned).toHaveLength(0);
  });

  it("reports an exception that matches nothing rather than swallowing it", () => {
    const { kept, orphaned } = applyExceptions(generated, [
      { originalStartUtc: 999, kind: "override" },
    ]);
    expect(kept).toHaveLength(2);
    expect(orphaned).toHaveLength(1);
  });

  it("treats a cancellation the same as an override for removal", () => {
    const { kept } = applyExceptions(generated, [
      { originalStartUtc: 300, kind: "cancelled" },
    ]);
    expect(kept.map((entry) => entry.startUtc)).toEqual([100]);
  });
});
