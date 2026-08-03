import { describe, expect, it } from "vitest";
import { generate } from "./engine";
import {
  TzContext,
  localDateIn,
  localDatesBetween,
  makeResolver,
  parseClock,
} from "./tz";
import {
  DEFAULT_DST_POLICY,
  type DstPolicy,
  type Generator,
  type ResolvedRuleset,
  type SlotIntent,
} from "./types";
import { localMinutesOfDay } from "../time";

const TZ = "Europe/Rome";

/* Europe/Rome, 2026. Spring forward skips 02:00 to 03:00 on 29 March; fall
   back repeats 02:00 to 03:00 on 25 October. */
const SPRING = "2026-03-29";
const AUTUMN = "2026-10-25";

const INTENT: SlotIntent = {
  kind: "post",
  platform: "x",
  category: "content",
  durationMinutes: 10,
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

function ruleset(...generators: Generator[]): ResolvedRuleset {
  return { id: "rs", name: "Test", generators };
}

const utc = (iso: string): number => Date.parse(iso);

function windowOf(fromIso: string, toIso: string) {
  return { startUtc: utc(fromIso), endUtc: utc(toIso) };
}

describe("determinism", () => {
  /* Edge case 21, and the acceptance criterion this whole phase turns on. It
     exists before the fourth generator kind does, so every kind added later
     inherits a harness that catches drift for free. */
  it("returns byte identical output for the same window twice", () => {
    const rules = ruleset(
      generator({ id: "a", config: { times: ["08:00", "12:00", "18:00"] } }),
      generator({
        id: "b",
        kind: "weekly-grid",
        layer: 70,
        config: { times: { mon: ["09:00"], wed: ["09:00", "21:00"], sat: ["11:00"] } },
      }),
      generator({
        id: "c",
        kind: "manual-set",
        layer: 30,
        config: { datetimes: ["2026-08-05T14:30", "2026-08-09T07:15"] },
      }),
    );
    const window = windowOf("2026-08-01T00:00:00Z", "2026-08-15T00:00:00Z");

    const first = generate(rules, window, [], [], undefined, { trace: true });
    const second = generate(rules, window, [], [], undefined, { trace: true });

    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(first.length).toBeGreaterThan(0);
  });

  it("does not depend on the order generators are declared in", () => {
    const a = generator({ id: "a", config: { times: ["08:00"] } });
    const b = generator({ id: "b", layer: 90, config: { times: ["08:00"] } });
    const window = windowOf("2026-08-03T00:00:00Z", "2026-08-04T00:00:00Z");

    const forwards = generate(ruleset(a, b), window);
    const backwards = generate(ruleset(b, a), window);

    expect(JSON.stringify(backwards)).toBe(JSON.stringify(forwards));
  });

  it("sorts by start, then layer descending, then generator, then ordinal", () => {
    const window = windowOf("2026-08-03T00:00:00Z", "2026-08-04T00:00:00Z");
    const slots = generate(
      ruleset(
        generator({ id: "low", layer: 10, config: { times: ["08:00"] } }),
        generator({ id: "high", layer: 90, config: { times: ["08:00"] } }),
      ),
      window,
    );

    expect(slots).toHaveLength(2);
    expect(slots[0]?.layer).toBe(90);
    expect(slots[1]?.layer).toBe(10);
  });

  it("gives the same slot the same key regardless of the window it was found in", () => {
    const rules = ruleset(generator({ config: { times: ["09:00", "17:00"] } }));

    const narrow = generate(rules, windowOf("2026-08-05T00:00:00Z", "2026-08-06T00:00:00Z"));
    const wide = generate(rules, windowOf("2026-06-01T00:00:00Z", "2026-10-01T00:00:00Z"));

    const fromWide = wide.filter((slot) => slot.localDate === "2026-08-05");
    expect(fromWide.map((slot) => slot.key)).toEqual(narrow.map((slot) => slot.key));
  });
});

describe("DST, spring forward", () => {
  const at = (minutes: number, policy: DstPolicy) =>
    makeResolver(new TzContext(TZ), policy)(SPRING, minutes);

  it("shifts a skipped reading forward by default", () => {
    const result = at(150, DEFAULT_DST_POLICY);
    expect(result.note).toBe("shifted-forward");
    expect(result.instants).toHaveLength(1);
    expect(localMinutesOfDay(result.instants[0] ?? 0, TZ)).toBe(210);
  });

  it("shifts it back when asked to", () => {
    const result = at(150, { nonexistent: "shift-back", ambiguous: "first" });
    expect(result.note).toBe("shifted-back");
    expect(localMinutesOfDay(result.instants[0] ?? 0, TZ)).toBe(90);
  });

  it("drops it when asked to, and never silently vanishes otherwise", () => {
    const result = at(150, { nonexistent: "skip", ambiguous: "first" });
    expect(result.note).toBe("skipped");
    expect(result.instants).toEqual([]);
  });

  it("leaves readings outside the gap exactly where they are", () => {
    for (const minutes of [0, 60, 180, 540, 1439]) {
      const result = at(minutes, DEFAULT_DST_POLICY);
      expect(result.note).toBe("exact");
      expect(localMinutesOfDay(result.instants[0] ?? 0, TZ)).toBe(minutes);
    }
  });

  it("keeps a 09:00 rule at 09:00 across the transition", () => {
    const slots = generate(
      ruleset(generator({ config: { times: ["09:00"] } })),
      windowOf("2026-03-27T00:00:00Z", "2026-04-01T00:00:00Z"),
    );
    expect(slots.length).toBeGreaterThanOrEqual(4);
    for (const slot of slots) {
      expect(localMinutesOfDay(slot.startUtc, TZ)).toBe(540);
    }
  });
});

describe("DST, fall back", () => {
  const at = (minutes: number, policy: DstPolicy) =>
    makeResolver(new TzContext(TZ), policy)(AUTUMN, minutes);

  it("fires once by default", () => {
    const result = at(150, DEFAULT_DST_POLICY);
    expect(result.note).toBe("ambiguous-first");
    expect(result.instants).toHaveLength(1);
  });

  it("can take the second reading instead", () => {
    const first = at(150, DEFAULT_DST_POLICY);
    const second = at(150, { nonexistent: "shift-forward", ambiguous: "second" });

    expect(second.note).toBe("ambiguous-second");
    expect(second.instants).toHaveLength(1);
    expect(second.instants[0]).toBeGreaterThan(first.instants[0] ?? 0);
  });

  it("yields exactly two when asked for both", () => {
    const result = at(150, { nonexistent: "shift-forward", ambiguous: "both" });
    expect(result.note).toBe("ambiguous-both");
    expect(result.instants).toHaveLength(2);
    // Both readings are 02:30 local; they differ only in offset.
    for (const instant of result.instants) {
      expect(localMinutesOfDay(instant, TZ)).toBe(150);
    }
    expect(result.instants[1]).toBeGreaterThan(result.instants[0] ?? 0);
  });

  it("leaves unambiguous readings alone", () => {
    for (const minutes of [0, 60, 180, 540, 1439]) {
      const result = at(minutes, DEFAULT_DST_POLICY);
      expect(result.note).toBe("exact");
      expect(localMinutesOfDay(result.instants[0] ?? 0, TZ)).toBe(minutes);
    }
  });

  it("keeps a 09:00 rule at 09:00 across the transition", () => {
    const slots = generate(
      ruleset(generator({ config: { times: ["09:00"] } })),
      windowOf("2026-10-23T00:00:00Z", "2026-10-28T00:00:00Z"),
    );
    expect(slots.length).toBeGreaterThanOrEqual(4);
    for (const slot of slots) {
      expect(localMinutesOfDay(slot.startUtc, TZ)).toBe(540);
    }
  });

  it("both policy produces two slots on the transition day and one elsewhere", () => {
    const slots = generate(
      ruleset(
        generator({
          config: { times: ["02:30"] },
          dst: { nonexistent: "shift-forward", ambiguous: "both" },
        }),
      ),
      windowOf("2026-10-24T00:00:00Z", "2026-10-27T00:00:00Z"),
    );

    const byDate = new Map<string, number>();
    for (const slot of slots) {
      byDate.set(slot.localDate, (byDate.get(slot.localDate) ?? 0) + 1);
    }
    expect(byDate.get(AUTUMN)).toBe(2);
    expect(byDate.get("2026-10-26")).toBe(1);
  });
});

describe("local date walking", () => {
  it("does not skip or repeat a day across either transition", () => {
    for (const [from, to, expected] of [
      ["2026-03-27T12:00:00Z", "2026-03-31T12:00:00Z", 5],
      ["2026-10-23T12:00:00Z", "2026-10-27T12:00:00Z", 5],
    ] as const) {
      const dates = localDatesBetween(utc(from), utc(to), TZ);
      expect(new Set(dates).size).toBe(dates.length);
      expect(dates.length).toBeGreaterThanOrEqual(expected);
      const sorted = [...dates].sort();
      expect(dates).toEqual(sorted);
    }
  });

  it("returns nothing for a reversed range", () => {
    expect(localDatesBetween(utc("2026-08-10T00:00:00Z"), utc("2026-08-01T00:00:00Z"), TZ)).toEqual(
      [],
    );
  });

  it("puts an instant on its local date, not its UTC date", () => {
    // 22:30Z on 3 August is already 4 August in Rome.
    expect(localDateIn(utc("2026-08-03T22:30:00Z"), TZ)).toBe("2026-08-04");
  });
});

describe("edge cases from Spec1.1 section 16", () => {
  const window = windowOf("2026-08-03T00:00:00Z", "2026-08-10T00:00:00Z");

  it("1: an empty config emits nothing and does not throw", () => {
    for (const [kind, config] of [
      ["daily-times", {}],
      ["weekly-grid", {}],
      ["manual-set", {}],
      ["daily-times", { times: [] }],
      ["weekly-grid", { times: {} }],
    ] as const) {
      expect(() =>
        generate(ruleset(generator({ kind, config })), window),
      ).not.toThrow();
      expect(generate(ruleset(generator({ kind, config })), window)).toEqual([]);
    }
  });

  it("1: an invalid config emits nothing rather than throwing", () => {
    const slots = generate(
      ruleset(generator({ config: { times: ["25:99", "not a time"] } })),
      window,
    );
    expect(slots).toEqual([]);
  });

  it("2: two generators at the same instant produce two distinct slots", () => {
    const slots = generate(
      ruleset(
        generator({ id: "a", config: { times: ["08:00"] } }),
        generator({ id: "b", config: { times: ["08:00"] } }),
      ),
      windowOf("2026-08-03T00:00:00Z", "2026-08-04T00:00:00Z"),
    );

    expect(slots).toHaveLength(2);
    expect(slots[0]?.startUtc).toBe(slots[1]?.startUtc);
    expect(new Set(slots.map((slot) => slot.key)).size).toBe(2);
  });

  it("3: a slot straddling midnight belongs to the local date of its start", () => {
    const slots = generate(
      ruleset(
        generator({
          config: { times: ["23:30"] },
          emits: { ...INTENT, durationMinutes: 90 },
        }),
      ),
      windowOf("2026-08-03T00:00:00Z", "2026-08-05T00:00:00Z"),
    );

    const straddler = slots[0];
    expect(straddler).toBeDefined();
    expect(straddler?.localDate).toBe(localDateIn(straddler?.startUtc ?? 0, TZ));
    // It really does cross into the next local day.
    expect(localDateIn(straddler?.endUtc ?? 0, TZ)).not.toBe(straddler?.localDate);
  });

  it("15: validFrom equal to validTo produces zero slots, not an error", () => {
    const instant = utc("2026-08-05T00:00:00Z");
    expect(
      generate(
        ruleset(generator({ validFrom: instant, validTo: instant })),
        window,
      ),
    ).toEqual([]);
  });

  it("22: a window of zero length returns an empty array", () => {
    const instant = utc("2026-08-05T00:00:00Z");
    expect(generate(ruleset(generator()), { startUtc: instant, endUtc: instant })).toEqual(
      [],
    );
    expect(
      generate(ruleset(generator()), { startUtc: instant, endUtc: instant - 1000 }),
    ).toEqual([]);
  });

  it("a disabled generator emits nothing", () => {
    expect(generate(ruleset(generator({ enabled: false })), window)).toEqual([]);
  });

  it("an unknown kind is ignored rather than fatal", () => {
    /* Every kind in the union is registered as of 11.5B, so this needs a name
       that is not one, which is exactly what a ruleset imported from a newer
       version of the app would carry. */
    const unknown = "not-a-real-kind" as Generator["kind"];
    const slots = generate(
      ruleset(
        generator({ id: "bad", kind: unknown, config: {} }),
        generator({ id: "good", config: { times: ["09:00"] } }),
      ),
      windowOf("2026-08-03T00:00:00Z", "2026-08-04T00:00:00Z"),
    );
    expect(slots).toHaveLength(1);
    expect(slots[0]?.generatorId).toBe("good");
  });
});

describe("clipping and validity", () => {
  it("keeps only slots starting inside the window", () => {
    const slots = generate(
      ruleset(generator({ config: { times: ["09:00"] } })),
      windowOf("2026-08-03T00:00:00Z", "2026-08-06T00:00:00Z"),
    );
    for (const slot of slots) {
      expect(slot.startUtc).toBeGreaterThanOrEqual(utc("2026-08-03T00:00:00Z"));
      expect(slot.startUtc).toBeLessThan(utc("2026-08-06T00:00:00Z"));
    }
  });

  it("honours a validity range that only partly covers the window", () => {
    const slots = generate(
      ruleset(
        generator({
          config: { times: ["09:00"] },
          validFrom: null,
          validTo: utc("2026-08-05T00:00:00Z"),
        }),
      ),
      windowOf("2026-08-03T00:00:00Z", "2026-08-10T00:00:00Z"),
    );
    // The generator is selected, since its range intersects; per-date version
    // selection lands in phase 11.5B.
    expect(slots.length).toBeGreaterThan(0);
  });
});

describe("overrides and bindings", () => {
  const window = windowOf("2026-08-03T00:00:00Z", "2026-08-04T00:00:00Z");
  const rules = ruleset(generator({ config: { times: ["09:00", "17:00"] } }));

  it("a skip removes exactly that slot and survives regeneration", () => {
    const before = generate(rules, window);
    const target = before[0]?.key ?? "";

    const after = generate(rules, window, [{ slotKey: target, action: "skip" }]);
    expect(after).toHaveLength(before.length - 1);
    expect(after.some((slot) => slot.key === target)).toBe(false);
  });

  it("a move keeps the slot where it was put", () => {
    const before = generate(rules, window);
    const target = before[0];
    expect(target).toBeDefined();
    const moved = (target?.startUtc ?? 0) + 45 * 60_000;

    const after = generate(rules, window, [
      { slotKey: target?.key ?? "", action: "move", movedStartUtc: moved },
    ]);
    const found = after.find((slot) => slot.key === target?.key);
    expect(found?.startUtc).toBe(moved);
    expect(found?.state).toBe("moved");
  });

  it("a binding marks the slot assigned, and a block marks it materialized", () => {
    const before = generate(rules, window);
    const [first, second] = before;

    const after = generate(
      rules,
      window,
      [],
      [
        { slotKey: first?.key ?? "", contentId: "content-1" },
        { slotKey: second?.key ?? "", contentId: "content-2", blockId: "block-1" },
      ],
    );

    expect(after.find((slot) => slot.key === first?.key)?.state).toBe("assigned");
    expect(after.find((slot) => slot.key === second?.key)?.state).toBe("materialized");
  });
});

describe("parseClock", () => {
  it("accepts real readings and refuses the rest", () => {
    expect(parseClock("08:00")).toBe(480);
    expect(parseClock("8:05")).toBe(485);
    expect(parseClock("23:59")).toBe(1439);
    expect(parseClock("00:00")).toBe(0);
    for (const bad of ["24:00", "12:60", "", "abc", "8", "8:5", "-1:00"]) {
      expect(parseClock(bad)).toBeNull();
    }
  });
});
