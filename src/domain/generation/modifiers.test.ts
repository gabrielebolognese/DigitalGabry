import { describe, expect, it } from "vitest";
import { generate, generateDetailed } from "./engine";
import { chooseEvictions } from "./modifiers/constrain";
import { datesInPeriodOf, largestGap, pickIndices } from "./kinds/quota";
import { spreadPositions } from "./kinds/spread";
import { isoWeekKey, periodKeyOf } from "./scope";
import { localMinutesOfDay } from "../time";
import type {
  BlockLike,
  Generator,
  Modifier,
  ResolvedRuleset,
  Slot,
  SlotIntent,
  WorldState,
} from "./types";

const TZ = "Europe/Rome";
const utc = (iso: string): number => Date.parse(iso);
const MIN = 60_000;

const INTENT: SlotIntent = {
  kind: "post",
  platform: "x",
  category: "content",
  durationMinutes: 30,
};

function generator(overrides: Partial<Generator> = {}): Generator {
  return {
    id: "gen-a",
    version: 1,
    name: "Test",
    kind: "daily-times",
    enabled: true,
    layer: 50,
    validFrom: null,
    validTo: null,
    timezone: TZ,
    emits: INTENT,
    config: { times: ["09:00"] },
    ...overrides,
  };
}

function modifier(kind: Modifier["kind"], config: unknown, extra: Partial<Modifier> = {}): Modifier {
  return {
    id: `mod-${kind}`,
    version: 1,
    name: kind,
    kind,
    enabled: true,
    order: 0,
    validFrom: null,
    validTo: null,
    timezone: TZ,
    config,
    ...extra,
  };
}

function ruleset(generators: Generator[], modifiers: Modifier[] = []): ResolvedRuleset {
  return { id: "rs", name: "Test", generators, modifiers };
}

function world(blocks: BlockLike[] = []): WorldState {
  return { now: 0, blocks, contentItems: [], momentum: [], holidays: [] };
}

const DAY = { startUtc: utc("2026-08-03T00:00:00Z"), endUtc: utc("2026-08-04T00:00:00Z") };
const WEEK = { startUtc: utc("2026-08-03T00:00:00Z"), endUtc: utc("2026-08-10T00:00:00Z") };

const minutesOf = (slot: Slot): number => localMinutesOfDay(slot.startUtc, TZ);

describe("interval", () => {
  it("steps through the window and stops at its end", () => {
    const slots = generate(
      ruleset([
        generator({
          kind: "interval",
          config: { everyMinutes: 180, window: ["08:00", "22:00"] },
        }),
      ]),
      DAY,
    );
    expect(slots.map(minutesOf)).toEqual([480, 660, 840, 1020, 1200]);
  });

  it("aligns to midnight when asked, so times read the same every day", () => {
    const slots = generate(
      ruleset([
        generator({
          kind: "interval",
          config: { everyMinutes: 180, window: ["08:00", "14:00"], alignTo: "midnight" },
        }),
      ]),
      DAY,
    );
    // Multiples of 180 from midnight: 540 and 720 fall inside 480..840.
    expect(slots.map(minutesOf)).toEqual([540, 720]);
  });

  it("respects weekday filtering", () => {
    const slots = generate(
      ruleset([
        generator({
          kind: "interval",
          config: {
            everyMinutes: 240,
            window: ["09:00", "17:00"],
            weekdays: ["sat", "sun"],
          },
        }),
      ]),
      WEEK,
    );
    expect(slots.length).toBeGreaterThan(0);
    for (const slot of slots) {
      expect(["2026-08-08", "2026-08-09"]).toContain(slot.localDate);
    }
  });
});

describe("spread", () => {
  it("places the requested count across the window", () => {
    const slots = generate(
      ruleset([
        generator({
          kind: "spread",
          config: { perDay: 4, window: ["08:00", "20:00"] },
        }),
      ]),
      DAY,
    );
    expect(slots.map(minutesOf)).toEqual([480, 720, 960, 1200]);
  });

  it("keeps the endpoints off the edges when told not to include them", () => {
    const slots = generate(
      ruleset([
        generator({
          kind: "spread",
          config: { perDay: 2, window: ["08:00", "20:00"], includeEndpoints: false },
        }),
      ]),
      DAY,
    );
    expect(slots.map(minutesOf)).toEqual([660, 1020]);
  });

  it("front loads and back loads in opposite directions", () => {
    const positionsFront = spreadPositions(4, "front-loaded", true);
    const positionsBack = spreadPositions(4, "back-loaded", true);
    expect(positionsFront[1]).toBeLessThan(0.5);
    expect(positionsBack[1]).toBeGreaterThan(0.25);
    expect(positionsFront[1]).toBeLessThan(positionsBack[1] ?? 1);
  });

  it("emits golden positions in time order, so ordinals agree with the clock", () => {
    const positions = spreadPositions(6, "golden", true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });
});

describe("quota", () => {
  it("places the requested count in the period", () => {
    const slots = generate(
      ruleset([
        generator({
          kind: "quota",
          config: { count: 3, period: "week", window: ["09:00", "17:00"] },
        }),
      ]),
      WEEK,
    );
    expect(slots).toHaveLength(3);
  });

  it("does not depend on the window it was asked for", () => {
    const rules = ruleset([
      generator({
        kind: "quota",
        config: { count: 3, period: "week", window: ["09:00", "17:00"] },
      }),
    ]);
    const wide = generate(rules, {
      startUtc: utc("2026-07-01T00:00:00Z"),
      endUtc: utc("2026-09-01T00:00:00Z"),
    }).filter((slot) => slot.localDate >= "2026-08-03" && slot.localDate <= "2026-08-09");
    const narrow = generate(rules, WEEK);

    expect(wide.map((slot) => slot.key)).toEqual(narrow.map((slot) => slot.key));
  });

  it("honours a minimum gap by dropping what is too close", () => {
    const slots = generate(
      ruleset([
        generator({
          kind: "quota",
          config: {
            count: 7,
            period: "week",
            window: ["09:00", "17:00"],
            minGapHours: 48,
          },
        }),
      ]),
      WEEK,
    );
    for (let index = 1; index < slots.length; index += 1) {
      const gap = (slots[index]?.startUtc ?? 0) - (slots[index - 1]?.startUtc ?? 0);
      expect(gap).toBeGreaterThanOrEqual(48 * 60 * MIN);
    }
  });

  /* Edge case 17. */
  it("free-space on a fully booked period emits nothing and says why", () => {
    const booked: BlockLike[] = [];
    for (const day of [3, 4, 5, 6, 7, 8, 9]) {
      booked.push({
        id: `busy-${day}`,
        startUtc: utc(`2026-08-0${day}T00:00:00Z`),
        endUtc: utc(`2026-08-0${day}T23:59:00Z`),
        kind: "event",
        tags: [],
      });
    }

    const report = generateDetailed(
      ruleset([
        generator({
          kind: "quota",
          config: {
            count: 2,
            period: "week",
            window: ["09:00", "17:00"],
            placement: "free-space",
          },
        }),
      ]),
      WEEK,
      [],
      [],
      world(booked),
    );

    expect(report.slots).toEqual([]);
    expect(report.notices.some((n) => n.kind === "quota-unplaceable")).toBe(true);
  });

  it("free-space finds the gap when there is one", () => {
    const report = generateDetailed(
      ruleset([
        generator({
          kind: "quota",
          config: {
            count: 1,
            period: "day",
            window: ["09:00", "17:00"],
            placement: "free-space",
          },
        }),
      ]),
      DAY,
      [],
      [],
      world([
        {
          id: "morning",
          startUtc: utc("2026-08-03T07:00:00Z"),
          endUtc: utc("2026-08-03T10:00:00Z"),
          kind: "event",
          tags: [],
        },
      ]),
    );
    expect(report.slots).toHaveLength(1);
    expect(report.notices).toEqual([]);
  });
});

describe("rrule kind", () => {
  it("delegates to the recurrence module and lands on the right weekday", () => {
    const slots = generate(
      ruleset([
        generator({
          kind: "rrule",
          config: {
            rrule: "FREQ=WEEKLY;BYDAY=TU",
            anchorDate: "2026-01-06",
            time: "10:00",
          },
        }),
      ]),
      { startUtc: utc("2026-08-01T00:00:00Z"), endUtc: utc("2026-09-01T00:00:00Z") },
    );

    expect(slots.length).toBeGreaterThanOrEqual(4);
    for (const slot of slots) {
      expect(minutesOf(slot)).toBe(600);
    }
  });

  it("does not depend on the window, because the phase comes from the anchor", () => {
    const rules = ruleset([
      generator({
        kind: "rrule",
        config: { rrule: "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO", anchorDate: "2026-01-05" },
      }),
    ]);
    const wide = generate(rules, {
      startUtc: utc("2026-06-01T00:00:00Z"),
      endUtc: utc("2026-10-01T00:00:00Z"),
    }).filter((slot) => slot.localDate >= "2026-08-01" && slot.localDate < "2026-09-01");
    const narrow = generate(rules, {
      startUtc: utc("2026-08-01T00:00:00Z"),
      endUtc: utc("2026-09-01T00:00:00Z"),
    });
    expect(wide.map((slot) => slot.localDate)).toEqual(
      narrow.map((slot) => slot.localDate),
    );
  });
});

describe("jitter", () => {
  const rules = (seed: string) =>
    ruleset(
      [generator({ config: { times: ["09:00", "13:00", "17:00"] } })],
      [modifier("jitter", { rangeMinutes: 20, seed })],
    );

  /* Edge case 20. */
  it("is identical across runs with the same seed", () => {
    const first = generate(rules("gabry-2026"), WEEK);
    const second = generate(rules("gabry-2026"), WEEK);
    expect(second.map((s) => s.startUtc)).toEqual(first.map((s) => s.startUtc));
  });

  it("changes when the seed changes", () => {
    const a = generate(rules("gabry-2026"), WEEK);
    const b = generate(rules("other-seed"), WEEK);
    expect(b.map((s) => s.startUtc)).not.toEqual(a.map((s) => s.startUtc));
  });

  it("does not depend on the window a slot was found in", () => {
    const wide = generate(rules("gabry-2026"), {
      startUtc: utc("2026-07-01T00:00:00Z"),
      endUtc: utc("2026-09-01T00:00:00Z"),
    }).filter((slot) => slot.localDate === "2026-08-05");
    const narrow = generate(rules("gabry-2026"), {
      startUtc: utc("2026-08-05T00:00:00Z"),
      endUtc: utc("2026-08-06T00:00:00Z"),
    });
    expect(wide.map((s) => s.startUtc)).toEqual(narrow.map((s) => s.startUtc));
  });

  it("stays inside its range", () => {
    const plain = generate(
      ruleset([generator({ config: { times: ["09:00", "13:00", "17:00"] } })]),
      WEEK,
    );
    const jittered = generate(rules("gabry-2026"), WEEK);

    // Matched by key, not by date: three slots a day share a local date.
    const byKey = new Map(plain.map((slot) => [slot.key, slot.startUtc]));
    expect(jittered.length).toBe(plain.length);

    for (const slot of jittered) {
      const reference = byKey.get(slot.key);
      expect(reference).toBeDefined();
      expect(Math.abs(slot.startUtc - (reference ?? 0))).toBeLessThanOrEqual(20 * MIN);
    }
  });
});

describe("snap", () => {
  it("rounds onto the grid after jitter has moved things off it", () => {
    const slots = generate(
      ruleset(
        [generator({ config: { times: ["09:07"] } })],
        [
          modifier("jitter", { rangeMinutes: 20, seed: "s" }, { order: 0 }),
          modifier("snap", { toMinutes: 15 }, { order: 1 }),
        ],
      ),
      WEEK,
    );
    for (const slot of slots) {
      expect(minutesOf(slot) % 15).toBe(0);
    }
  });

  it("rounds up and down on demand", () => {
    const up = generate(
      ruleset([generator({ config: { times: ["09:07"] } })], [modifier("snap", { toMinutes: 15, direction: "up" })]),
      DAY,
    );
    const down = generate(
      ruleset([generator({ config: { times: ["09:07"] } })], [modifier("snap", { toMinutes: 15, direction: "down" })]),
      DAY,
    );
    expect(minutesOf(up[0] as Slot)).toBe(555);
    expect(minutesOf(down[0] as Slot)).toBe(540);
  });
});

describe("blackout", () => {
  it("removes a slot inside a window", () => {
    const slots = generate(
      ruleset(
        [generator({ config: { times: ["09:00", "15:00"] } })],
        [modifier("blackout", { windows: [{ range: ["08:00", "14:00"], label: "school" }] })],
      ),
      DAY,
    );
    expect(slots.map(minutesOf)).toEqual([900]);
  });

  /* Edge case 4. */
  it("a window crossing midnight catches both sides of it", () => {
    const report = generateDetailed(
      ruleset(
        [generator({ config: { times: ["00:30", "12:00", "23:45"] } })],
        [modifier("blackout", { windows: [{ range: ["23:30", "07:00"], label: "sleep" }] })],
      ),
      { startUtc: utc("2026-08-03T00:00:00Z"), endUtc: utc("2026-08-06T00:00:00Z") },
    );

    // Only the midday slot survives on any day.
    for (const slot of report.slots) expect(minutesOf(slot)).toBe(720);
    expect(report.dropped.length).toBeGreaterThan(0);
    expect(report.dropped.every((drop) => drop.reason.includes("sleep"))).toBe(true);
  });

  it("shifts out to the nearer edge rather than losing the slot", () => {
    const slots = generate(
      ruleset(
        [generator({ config: { times: ["13:30"] } })],
        [
          modifier("blackout", {
            windows: [{ range: ["08:00", "14:00"] }],
            mode: "shift-out",
          }),
        ],
      ),
      DAY,
    );
    expect(slots).toHaveLength(1);
    expect(minutesOf(slots[0] as Slot)).toBe(840);
  });

  it("blacks out whole date ranges", () => {
    const slots = generate(
      ruleset(
        [generator({ config: { times: ["09:00"] } })],
        [modifier("blackout", { dateRanges: [{ from: "2026-08-04", to: "2026-08-06" }] })],
      ),
      WEEK,
    );
    for (const slot of slots) {
      expect(slot.localDate < "2026-08-04" || slot.localDate > "2026-08-06").toBe(true);
    }
  });

  it("only touches what its scope allows", () => {
    const slots = generate(
      ruleset(
        [
          generator({ id: "x", config: { times: ["09:00"] } }),
          generator({
            id: "li",
            emits: { ...INTENT, platform: "linkedin" },
            config: { times: ["09:00"] },
          }),
        ],
        [
          modifier("blackout", {
            windows: [{ range: ["08:00", "10:00"] }],
            appliesTo: { platforms: ["x"] },
          }),
        ],
      ),
      DAY,
    );
    expect(slots).toHaveLength(1);
    expect(slots[0]?.intent.platform).toBe("linkedin");
  });
});

describe("spacing", () => {
  it("shifts a slot later to open the gap", () => {
    const slots = generate(
      ruleset(
        [generator({ config: { times: ["09:00", "09:30"] } })],
        [modifier("spacing", { minMinutes: 90, maxShiftMinutes: 120 })],
      ),
      DAY,
    );
    expect(slots.map(minutesOf)).toEqual([540, 630]);
  });

  /* Edge case 6. */
  it("drops and records the reason when the shift would exceed the limit", () => {
    const report = generateDetailed(
      ruleset(
        [generator({ config: { times: ["09:00", "09:05"] } })],
        [modifier("spacing", { minMinutes: 240, maxShiftMinutes: 10 })],
      ),
      DAY,
    );
    expect(report.slots).toHaveLength(1);
    expect(report.dropped).toHaveLength(1);
    expect(report.dropped[0]?.reason).toContain("limit is 10m");
  });

  it("allow leaves everything alone", () => {
    const slots = generate(
      ruleset(
        [generator({ config: { times: ["09:00", "09:05"] } })],
        [modifier("spacing", { minMinutes: 240, resolution: "allow" })],
      ),
      DAY,
    );
    expect(slots).toHaveLength(2);
  });
});

describe("capacity", () => {
  it("caps a day and drops the lowest layer first", () => {
    const report = generateDetailed(
      ruleset(
        [
          generator({ id: "high", layer: 90, config: { times: ["09:00"] } }),
          generator({ id: "mid", layer: 50, config: { times: ["12:00"] } }),
          generator({ id: "low", layer: 10, config: { times: ["15:00"] } }),
        ],
        [modifier("capacity", { max: 2, period: "day" })],
      ),
      DAY,
    );
    expect(report.slots).toHaveLength(2);
    expect(report.slots.some((slot) => slot.generatorId === "low")).toBe(false);
    expect(report.dropped[0]?.reason).toContain("limit of 2");
  });

  /* Edge case 5. */
  it("evicts nothing and reports the overage when bound slots already exceed it", () => {
    const first = generate(ruleset([generator({ config: { times: ["09:00", "12:00", "15:00"] } })]), DAY);
    const bindings = first.map((slot) => ({ slotKey: slot.key, contentId: "c" }));

    const report = generateDetailed(
      ruleset(
        [generator({ config: { times: ["09:00", "12:00", "15:00"] } })],
        [modifier("capacity", { max: 2, period: "day" })],
      ),
      DAY,
      [],
      bindings,
    );

    expect(report.slots).toHaveLength(3);
    expect(report.dropped).toEqual([]);
    expect(report.notices.some((n) => n.kind === "capacity-exceeded")).toBe(true);
  });

  it("compress keeps them all and redistributes", () => {
    const report = generateDetailed(
      ruleset(
        [generator({ config: { times: ["09:00", "09:30", "10:00", "20:00"] } })],
        [modifier("capacity", { max: 2, period: "day", eviction: "compress" })],
      ),
      DAY,
    );
    expect(report.slots).toHaveLength(4);
    expect(report.dropped).toEqual([]);
    const gaps = report.slots
      .slice(1)
      .map((slot, index) => slot.startUtc - (report.slots[index]?.startUtc ?? 0));
    expect(new Set(gaps).size).toBe(1);
  });

  it("chooseEvictions honours each policy", () => {
    const slots = [
      { key: "a", startUtc: 100, layer: 10 },
      { key: "b", startUtc: 200, layer: 90 },
      { key: "c", startUtc: 300, layer: 50 },
    ] as unknown as Slot[];

    expect(chooseEvictions(slots, 1, "drop-lowest-layer")[0]?.key).toBe("a");
    expect(chooseEvictions(slots, 1, "drop-latest")[0]?.key).toBe("c");
    expect(chooseEvictions(slots, 1, "drop-earliest")[0]?.key).toBe("a");
    expect(chooseEvictions(slots, 0, "drop-latest")).toEqual([]);
  });
});

describe("collision", () => {
  const busy = world([
    {
      id: "meeting",
      startUtc: utc("2026-08-03T07:00:00Z"),
      endUtc: utc("2026-08-03T08:00:00Z"),
      kind: "event",
      tags: ["work"],
    },
  ]);

  it("skips a slot that lands on a real block", () => {
    const report = generateDetailed(
      ruleset(
        [generator({ config: { times: ["09:15"] } })],
        [modifier("collision", { against: { kinds: ["event"] }, policy: "skip" })],
      ),
      DAY,
      [],
      [],
      busy,
    );
    expect(report.slots).toEqual([]);
    expect(report.dropped[0]?.reason).toContain("existing block");
  });

  it("shifts past it when allowed", () => {
    const slots = generate(
      ruleset(
        [generator({ config: { times: ["09:15"] } })],
        [
          modifier("collision", {
            against: { kinds: ["event"] },
            policy: "shift-later",
            maxShiftMinutes: 120,
          }),
        ],
      ),
      DAY,
      [],
      [],
      busy,
    );
    expect(slots).toHaveLength(1);
    expect(minutesOf(slots[0] as Slot)).toBe(600);
  });

  /* Invariant 19: a generator may never destroy manual work. */
  it("replace degrades to skip against a real block", () => {
    const report = generateDetailed(
      ruleset(
        [generator({ config: { times: ["09:15"] } })],
        [modifier("collision", { against: { kinds: ["event"] }, policy: "replace" })],
      ),
      DAY,
      [],
      [],
      busy,
    );
    expect(report.slots).toEqual([]);
    expect(report.dropped[0]?.reason).toContain("never replace");
  });

  it("allow leaves the overlap in place", () => {
    const slots = generate(
      ruleset(
        [generator({ config: { times: ["09:15"] } })],
        [modifier("collision", { against: { kinds: ["event"] }, policy: "allow" })],
      ),
      DAY,
      [],
      [],
      busy,
    );
    expect(slots).toHaveLength(1);
  });
});

describe("protection from the modifiers", () => {
  /* Spec1.1 section 6: bound and pinned slots are immune to stages 3 to 6.
     Bindings are applied at stage 8, so without marking their state before the
     modifiers run, the immunity would not exist at the moment it is needed. */
  it("a bound slot is not jittered, blacked out, or evicted", () => {
    const rules = (mods: Modifier[]) =>
      ruleset([generator({ config: { times: ["09:00"] } })], mods);

    const plain = generate(rules([]), DAY);
    const target = plain[0];
    expect(target).toBeDefined();
    const bindings = [{ slotKey: target?.key ?? "", contentId: "c" }];

    const jittered = generate(
      rules([modifier("jitter", { rangeMinutes: 30, seed: "s" })]),
      DAY,
      [],
      bindings,
    );
    expect(jittered[0]?.startUtc).toBe(target?.startUtc);

    const blackedOut = generate(
      rules([modifier("blackout", { windows: [{ range: ["08:00", "10:00"] }] })]),
      DAY,
      [],
      bindings,
    );
    expect(blackedOut).toHaveLength(1);
  });

  it("a pinned slot is left where it is", () => {
    const rules = ruleset(
      [generator({ config: { times: ["09:00"] } })],
      [modifier("jitter", { rangeMinutes: 30, seed: "s" })],
    );
    const plain = generate(ruleset([generator({ config: { times: ["09:00"] } })]), DAY);
    const key = plain[0]?.key ?? "";

    const pinned = generate(rules, DAY, [{ slotKey: key, action: "pin" }]);
    expect(pinned[0]?.startUtc).toBe(plain[0]?.startUtc);
    expect(pinned[0]?.state).toBe("pinned");
  });
});

describe("period helpers", () => {
  it("groups by ISO week, Thursday rule", () => {
    expect(isoWeekKey("2026-01-01")).toBe("2026-W01");
    expect(isoWeekKey("2026-08-03")).toBe("2026-W32");
    expect(isoWeekKey("2026-08-09")).toBe("2026-W32");
    expect(isoWeekKey("2026-08-10")).toBe("2026-W33");
  });

  it("keys days and months plainly", () => {
    expect(periodKeyOf("2026-08-03", "day")).toBe("2026-08-03");
    expect(periodKeyOf("2026-08-03", "month")).toBe("2026-08");
  });

  it("enumerates a period's own dates, not the window's", () => {
    expect(datesInPeriodOf("2026-08-05", "week")).toEqual([
      "2026-08-03",
      "2026-08-04",
      "2026-08-05",
      "2026-08-06",
      "2026-08-07",
      "2026-08-08",
      "2026-08-09",
    ]);
    expect(datesInPeriodOf("2026-02-10", "month")).toHaveLength(28);
    expect(datesInPeriodOf("2026-08-05", "day")).toEqual(["2026-08-05"]);
  });

  it("picks evenly spaced indices", () => {
    expect(pickIndices(7, 3)).toEqual([0, 3, 6]);
    expect(pickIndices(3, 5)).toEqual([0, 1, 2]);
    expect(pickIndices(5, 1)).toEqual([2]);
  });

  it("finds the largest free gap around what is booked", () => {
    const gap = largestGap(0, 1000, [
      { startUtc: 100, endUtc: 200 },
      { startUtc: 400, endUtc: 450 },
    ]);
    expect(gap.startUtc).toBe(450);
    expect(gap.ms).toBe(550);
  });
});

describe("determinism with modifiers", () => {
  it("stays byte identical with the whole pipeline engaged", () => {
    const rules = ruleset(
      [
        generator({ id: "a", config: { times: ["08:00", "12:00", "18:00"] } }),
        generator({
          id: "b",
          kind: "spread",
          layer: 70,
          config: { perDay: 3, window: ["09:00", "21:00"], distribution: "golden" },
        }),
        generator({
          id: "c",
          kind: "quota",
          layer: 30,
          config: { count: 2, period: "week", placement: "balanced" },
        }),
      ],
      [
        modifier("jitter", { rangeMinutes: 15, seed: "gabry-2026" }),
        modifier("snap", { toMinutes: 5 }),
        modifier("blackout", { windows: [{ range: ["23:30", "07:00"] }] }),
        modifier("spacing", { minMinutes: 45 }),
        modifier("capacity", { max: 6, period: "day" }),
      ],
    );

    const first = generateDetailed(rules, WEEK, [], [], undefined, { trace: true });
    const second = generateDetailed(rules, WEEK, [], [], undefined, { trace: true });

    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(first.slots.length).toBeGreaterThan(0);
  });
});
