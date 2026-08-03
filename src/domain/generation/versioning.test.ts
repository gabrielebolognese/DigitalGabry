import { describe, expect, it } from "vitest";
import { generate } from "./engine";
import { findCycle, checkNoCycles } from "./graph";
import { GenerationCache, memoKey } from "./memo";
import { describeRekey, invertRekey, planRekey } from "./rekey";
import { exportRuleset, importRuleset } from "./serialize";
import { cronMatchesDate, cronMinutesOfDay, parseCron } from "./cron";
import {
  applyPlan,
  findOverlap,
  latestVersion,
  planSave,
  versionAt,
} from "./versioning";
import { localMinutesOfDay } from "../time";
import type { Generator, ResolvedRuleset, SlotIntent, WorldState } from "./types";

const TZ = "Europe/Rome";
const utc = (iso: string): number => Date.parse(iso);

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

function ruleset(...generators: Generator[]): ResolvedRuleset {
  return { id: "rs", name: "Test", generators, modifiers: [] };
}

const emptyWorld: WorldState = {
  now: 0,
  blocks: [],
  contentItems: [],
  momentum: [],
  holidays: [],
};

describe("versionAt", () => {
  const v1 = generator({ version: 1, validFrom: null, validTo: utc("2026-08-15T00:00:00Z") });
  const v2 = generator({ version: 2, validFrom: utc("2026-08-15T00:00:00Z"), validTo: null });

  it("picks the version in force", () => {
    expect(versionAt([v1, v2], utc("2026-08-14T12:00:00Z"))?.version).toBe(1);
    expect(versionAt([v1, v2], utc("2026-08-16T12:00:00Z"))?.version).toBe(2);
  });

  it("treats the boundary as belonging to the newer version", () => {
    expect(versionAt([v1, v2], utc("2026-08-15T00:00:00Z"))?.version).toBe(2);
  });

  it("returns nothing outside every range", () => {
    const bounded = generator({
      version: 1,
      validFrom: utc("2026-08-01T00:00:00Z"),
      validTo: utc("2026-08-10T00:00:00Z"),
    });
    expect(versionAt([bounded], utc("2026-07-01T00:00:00Z"))).toBeNull();
    expect(latestVersion([v1, v2])?.version).toBe(2);
    expect(latestVersion([])).toBeNull();
  });
});

describe("planSave", () => {
  const existing = [generator({ version: 1, validFrom: null, validTo: null })];
  const cut = utc("2026-08-15T00:00:00Z");
  const next = { ...generator({ config: { times: ["10:00"] } }) };

  it("from-today closes the open version and opens a new one", () => {
    const plan = planSave<Generator>({ existing, next, mode: "from-today", atUtc: cut });
    expect(plan.closed[0]?.validTo).toBe(cut);
    expect(plan.inserted?.version).toBe(2);
    expect(plan.inserted?.validFrom).toBe(cut);
    expect(plan.inserted?.validTo).toBeNull();
  });

  it("all-time rewrites in place rather than opening a version", () => {
    const plan = planSave<Generator>({ existing, next, mode: "all-time", atUtc: cut });
    expect(plan.inserted).toBeNull();
    expect(plan.rewritten).toHaveLength(1);
    expect(plan.rewritten[0]?.version).toBe(1);
  });

  it("date-range creates a bounded version", () => {
    const range = { from: utc("2026-09-01T00:00:00Z"), to: utc("2026-09-30T00:00:00Z") };
    const plan = planSave<Generator>({
      existing,
      next,
      mode: "date-range",
      atUtc: cut,
      range,
    });
    expect(plan.inserted?.validFrom).toBe(range.from);
    expect(plan.inserted?.validTo).toBe(range.to);
  });

  /* Edge case 16. */
  it("never leaves versions overlapping, whichever mode is used", () => {
    for (const mode of ["from-today", "all-time", "date-range"] as const) {
      const plan = planSave<Generator>({
        existing,
        next,
        mode,
        atUtc: cut,
        range: { from: utc("2026-09-01T00:00:00Z"), to: utc("2026-09-30T00:00:00Z") },
      });
      expect(findOverlap(applyPlan(existing, plan))).toBeNull();
    }
  });

  it("detects an overlap that was constructed by hand", () => {
    const bad = [
      generator({ version: 1, validFrom: null, validTo: null }),
      generator({ version: 2, validFrom: null, validTo: null }),
    ];
    expect(findOverlap(bad)).not.toBeNull();
  });

  it("saving repeatedly keeps a clean chain", () => {
    let chain = existing;
    for (const [index, at] of [cut, cut + 86_400_000, cut + 172_800_000].entries()) {
      const plan = planSave<Generator>({
        existing: chain,
        next: generator({ config: { times: [`0${index + 1}:00`] } }),
        mode: "from-today",
        atUtc: at,
      });
      chain = applyPlan(chain, plan);
      expect(findOverlap(chain)).toBeNull();
    }
    expect(chain).toHaveLength(4);
  });
});

describe("version aware generation", () => {
  /* The headline acceptance criterion for this phase. */
  it("renders 14 August with v1 and 16 August with v2", () => {
    const cut = utc("2026-08-15T00:00:00Z");
    const rules = ruleset(
      generator({ version: 1, validFrom: null, validTo: cut, config: { times: ["08:00"] } }),
      generator({ version: 2, validFrom: cut, validTo: null, config: { times: ["09:00"] } }),
    );

    const slots = generate(
      rules,
      { startUtc: utc("2026-08-10T00:00:00Z"), endUtc: utc("2026-08-20T00:00:00Z") },
    );

    const on = (date: string): number | undefined => {
      const slot = slots.find((candidate) => candidate.localDate === date);
      return slot === undefined ? undefined : localMinutesOfDay(slot.startUtc, TZ);
    };

    expect(on("2026-08-14")).toBe(480);
    expect(on("2026-08-16")).toBe(540);
  });

  it("emits each date exactly once, never from two versions at the same time", () => {
    const cut = utc("2026-08-15T00:00:00Z");
    const slots = generate(
      ruleset(
        generator({ version: 1, validFrom: null, validTo: cut, config: { times: ["08:00"] } }),
        generator({ version: 2, validFrom: cut, validTo: null, config: { times: ["09:00"] } }),
      ),
      { startUtc: utc("2026-08-10T00:00:00Z"), endUtc: utc("2026-08-20T00:00:00Z") },
    );

    const perDate = new Map<string, number>();
    for (const slot of slots) {
      perDate.set(slot.localDate, (perDate.get(slot.localDate) ?? 0) + 1);
    }
    for (const count of perDate.values()) expect(count).toBe(1);
  });
});

describe("cron", () => {
  it("parses the shape from the specification", () => {
    const parsed = parseCron("0 8,12,18,22 * * 1");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(cronMinutesOfDay(parsed.fields)).toEqual([480, 720, 1080, 1320]);
    // 2026-08-03 is a Monday.
    expect(cronMatchesDate(parsed.fields, "2026-08-03")).toBe(true);
    expect(cronMatchesDate(parsed.fields, "2026-08-04")).toBe(false);
  });

  it("handles ranges, steps and names", () => {
    const parsed = parseCron("*/30 9-11 * jan,jul mon-fri");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(cronMinutesOfDay(parsed.fields)).toEqual([540, 570, 600, 630, 660, 690]);
    expect(cronMatchesDate(parsed.fields, "2026-07-06")).toBe(true);
    expect(cronMatchesDate(parsed.fields, "2026-07-05")).toBe(false);
    expect(cronMatchesDate(parsed.fields, "2026-08-03")).toBe(false);
  });

  it("treats Sunday as both 0 and 7", () => {
    const zero = parseCron("0 9 * * 0");
    const seven = parseCron("0 9 * * 7");
    expect(zero.ok && seven.ok).toBe(true);
    if (!zero.ok || !seven.ok) return;
    expect(cronMatchesDate(zero.fields, "2026-08-09")).toBe(true);
    expect(cronMatchesDate(seven.fields, "2026-08-09")).toBe(true);
  });

  /* Cron's documented oddity, which surprises everyone exactly once. */
  it("ORs the two day fields when both are restricted", () => {
    const parsed = parseCron("0 9 1 * mon");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(cronMatchesDate(parsed.fields, "2026-08-01")).toBe(true);
    expect(cronMatchesDate(parsed.fields, "2026-08-03")).toBe(true);
    expect(cronMatchesDate(parsed.fields, "2026-08-04")).toBe(false);
  });

  it("refuses malformed expressions by name", () => {
    for (const bad of ["", "0 9 * *", "0 9 * * * *", "60 9 * * *", "0 24 * * *", "a b c d e", "0 9 * * 8"]) {
      const parsed = parseCron(bad);
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) expect(parsed.error.length).toBeGreaterThan(0);
    }
  });

  it("emits through the engine", () => {
    const slots = generate(
      ruleset(generator({ kind: "cron", config: { expression: "0 8,20 * * *" } })),
      { startUtc: utc("2026-08-03T00:00:00Z"), endUtc: utc("2026-08-05T00:00:00Z") },
    );
    expect(slots.map((slot) => localMinutesOfDay(slot.startUtc, TZ))).toEqual([
      480, 1200, 480, 1200,
    ]);
  });
});

describe("cycle detection", () => {
  /* Edge case 8. */
  it("rejects a rotation whose source is itself", () => {
    const rules = [
      generator({
        id: "a",
        kind: "rotation",
        config: { sourceGeneratorId: "a", cycle: [{ platform: "x" }] },
      }),
    ];
    expect(findCycle(rules)).not.toBeNull();
    expect(checkNoCycles(rules).ok).toBe(false);
  });

  it("rejects two rotations pointing at each other", () => {
    const rules = [
      generator({
        id: "a",
        kind: "rotation",
        config: { sourceGeneratorId: "b", cycle: [{ platform: "x" }] },
      }),
      generator({
        id: "b",
        kind: "rotation",
        config: { sourceGeneratorId: "a", cycle: [{ platform: "x" }] },
      }),
    ];
    const cycle = findCycle(rules);
    expect(cycle).not.toBeNull();
    expect(checkNoCycles(rules).ok).toBe(false);
  });

  /* The one that actually bites: nothing in the config looks like a reference. */
  it("rejects a derived generator that triggers on what it emits", () => {
    const rules = [
      generator({
        id: "promo",
        kind: "derived",
        emits: { ...INTENT, platform: "x" },
        config: {
          trigger: { platform: "x" },
          offsets: [{ minutes: 120, emits: { platform: "x" } }],
        },
      }),
    ];
    expect(findCycle(rules)).not.toBeNull();
  });

  it("accepts a chain that does not close", () => {
    const rules = [
      generator({ id: "grid", emits: { ...INTENT, platform: "youtube" } }),
      generator({
        id: "promo",
        kind: "derived",
        emits: { ...INTENT, platform: "linkedin" },
        config: {
          trigger: { platform: "youtube" },
          offsets: [{ minutes: 120, emits: { platform: "linkedin" } }],
        },
      }),
    ];
    expect(findCycle(rules)).toBeNull();
    expect(checkNoCycles(rules).ok).toBe(true);
  });

  it("names the generators involved, so the refusal is actionable", () => {
    const rules = [
      generator({
        id: "a",
        kind: "rotation",
        config: { sourceGeneratorId: "b", cycle: [{ platform: "x" }] },
      }),
      generator({
        id: "b",
        kind: "rotation",
        config: { sourceGeneratorId: "a", cycle: [{ platform: "x" }] },
      }),
    ];
    const check = checkNoCycles(rules);
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.error).toContain("a");
      expect(check.error).toContain("b");
    }
  });
});

describe("rekey", () => {
  /* Edge case 10. */
  it("remaps by nearest time when a time is inserted at the start of a day", () => {
    const overrides = [
      { slotKey: "gen-a|2026-08-03|0", localDate: "2026-08-03", ordinal: 0 },
      { slotKey: "gen-a|2026-08-03|1", localDate: "2026-08-03", ordinal: 1 },
    ];

    const plan = planRekey(
      "gen-a",
      "daily-times",
      { times: ["09:00", "17:00"] },
      { times: ["07:00", "09:00", "17:00"] },
      overrides,
    );

    expect(plan.pairs).toHaveLength(2);
    expect(plan.pairs[0]?.toOrdinal).toBe(1);
    expect(plan.pairs[1]?.toOrdinal).toBe(2);
    expect(plan.orphaned).toHaveLength(0);
    expect(describeRekey(plan)).toContain("2 overrides remapped");
  });

  it("leaves ordinals alone when a time is appended", () => {
    const plan = planRekey(
      "gen-a",
      "daily-times",
      { times: ["09:00", "17:00"] },
      { times: ["09:00", "17:00", "21:00"] },
      [{ slotKey: "gen-a|2026-08-03|1", localDate: "2026-08-03", ordinal: 1 }],
    );
    expect(plan.pairs).toHaveLength(0);
  });

  it("reports an override whose time was removed rather than dropping it", () => {
    const plan = planRekey(
      "gen-a",
      "daily-times",
      { times: ["09:00", "13:00", "17:00"] },
      { times: ["09:00"] },
      [
        { slotKey: "gen-a|2026-08-03|1", localDate: "2026-08-03", ordinal: 1 },
        { slotKey: "gen-a|2026-08-03|2", localDate: "2026-08-03", ordinal: 2 },
      ],
    );
    expect(plan.orphaned.length).toBeGreaterThan(0);
    expect(describeRekey(plan)).toContain("without a matching time");
  });

  it("maps per weekday for a weekly grid", () => {
    const plan = planRekey(
      "gen-a",
      "weekly-grid",
      { times: { mon: ["09:00"], tue: ["09:00", "17:00"] } },
      { times: { mon: ["07:00", "09:00"], tue: ["09:00", "17:00"] } },
      [
        // 2026-08-03 is a Monday, 2026-08-04 a Tuesday.
        { slotKey: "gen-a|2026-08-03|0", localDate: "2026-08-03", ordinal: 0 },
        { slotKey: "gen-a|2026-08-04|1", localDate: "2026-08-04", ordinal: 1 },
      ],
    );
    expect(plan.pairs).toHaveLength(1);
    expect(plan.pairs[0]?.localDate).toBe("2026-08-03");
  });

  it("inverts, which is the undo", () => {
    const plan = planRekey(
      "gen-a",
      "daily-times",
      { times: ["09:00"] },
      { times: ["07:00", "09:00"] },
      [{ slotKey: "gen-a|2026-08-03|0", localDate: "2026-08-03", ordinal: 0 }],
    );
    const undo = invertRekey(plan);
    expect(undo.pairs[0]?.fromKey).toBe(plan.pairs[0]?.toKey);
    expect(undo.pairs[0]?.toKey).toBe(plan.pairs[0]?.fromKey);
  });

  it("does nothing for a kind whose times are not a list", () => {
    const plan = planRekey("gen-a", "rrule", {}, {}, [
      { slotKey: "gen-a|2026-08-03|0", localDate: "2026-08-03", ordinal: 0 },
    ]);
    expect(plan.pairs).toHaveLength(0);
    expect(describeRekey(plan)).toBe("No overrides needed moving");
  });
});

describe("export and import", () => {
  const rules: ResolvedRuleset = {
    id: "rs",
    name: "Creator daily",
    generators: [
      generator({ id: "a", config: { times: ["08:00", "12:00"] } }),
      generator({
        id: "b",
        kind: "weekly-grid",
        config: { times: { mon: ["09:00"], sat: ["11:00"] } },
      }),
    ],
    modifiers: [
      {
        id: "m1",
        version: 1,
        name: "sleep",
        kind: "blackout",
        enabled: true,
        order: 0,
        validFrom: null,
        validTo: null,
        timezone: TZ,
        config: { windows: [{ range: ["23:30", "07:00"] }] },
      },
    ],
  };

  const window = {
    startUtc: utc("2026-08-03T00:00:00Z"),
    endUtc: utc("2026-08-10T00:00:00Z"),
  };

  it("round trips to identical generated output", () => {
    const text = exportRuleset(rules);
    const imported = importRuleset(text, "rs");
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;

    /* Deep equality, not JSON text: export canonicalises by sorting keys, so
       the imported ruleset's emits object carries the same fields in a
       different order. The criterion is identical generated output, which is a
       statement about values. */
    expect(generate(imported.ruleset, window)).toEqual(generate(rules, window));
  });

  it("re-exports byte identically", () => {
    const once = exportRuleset(rules);
    const imported = importRuleset(once, "rs");
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(exportRuleset(imported.ruleset)).toBe(once);
  });

  it("exports only the version in force", () => {
    const versioned: ResolvedRuleset = {
      ...rules,
      generators: [
        generator({ id: "a", version: 1, validTo: utc("2026-01-01T00:00:00Z") }),
        generator({ id: "a", version: 2, validFrom: utc("2026-01-01T00:00:00Z") }),
      ],
    };
    const document = JSON.parse(exportRuleset(versioned)) as { generators: unknown[] };
    expect(document.generators).toHaveLength(1);
  });

  /* Edge case 24. */
  it("refuses an unknown kind by name, applying nothing", () => {
    const text = exportRuleset(rules).replace('"daily-times"', '"time-warp"');
    const imported = importRuleset(text, "rs");
    expect(imported.ok).toBe(false);
    if (!imported.ok) expect(imported.error).toContain("time-warp");
  });

  it("refuses an invalid configuration by name", () => {
    const text = exportRuleset(rules).replace('"08:00"', '"25:99"');
    const imported = importRuleset(text, "rs");
    expect(imported.ok).toBe(false);
  });

  it("refuses a newer format rather than guessing", () => {
    const text = exportRuleset(rules).replace('"format": 1', '"format": 99');
    const imported = importRuleset(text, "rs");
    expect(imported.ok).toBe(false);
    if (!imported.ok) expect(imported.error).toContain("newer version");
  });

  it("refuses rubbish without throwing", () => {
    expect(importRuleset("not json", "rs").ok).toBe(false);
    expect(importRuleset("[]", "rs").ok).toBe(false);
    expect(importRuleset("{}", "rs").ok).toBe(false);
  });
});

describe("memoisation", () => {
  const rules = ruleset(generator({ config: { times: ["09:00", "17:00"] } }));
  const window = {
    startUtc: utc("2026-08-03T00:00:00Z"),
    endUtc: utc("2026-08-10T00:00:00Z"),
  };

  it("serves a repeat of the same question from cache", () => {
    const cache = new GenerationCache();
    const first = cache.get(rules, window);
    const second = cache.get(rules, window);
    expect(second).toBe(first);
    expect(cache.stats).toEqual({ hits: 1, misses: 1 });
  });

  it("misses when the ruleset changes", () => {
    const cache = new GenerationCache();
    cache.get(rules, window);
    cache.get(ruleset(generator({ config: { times: ["10:00"] } })), window);
    expect(cache.stats.misses).toBe(2);
  });

  it("misses when the window changes", () => {
    const cache = new GenerationCache();
    cache.get(rules, window);
    cache.get(rules, { ...window, endUtc: window.endUtc + 86_400_000 });
    expect(cache.stats.misses).toBe(2);
  });

  it("misses when a block inside the window moves", () => {
    const cache = new GenerationCache();
    const block = {
      id: "b",
      startUtc: utc("2026-08-05T09:00:00Z"),
      endUtc: utc("2026-08-05T10:00:00Z"),
      kind: "event" as const,
      tags: [] as string[],
    };
    const before: WorldState = { ...emptyWorld, blocks: [block] };
    const after: WorldState = {
      ...emptyWorld,
      blocks: [{ ...block, startUtc: utc("2026-08-05T11:00:00Z") }],
    };

    cache.get(rules, window, [], [], before);
    cache.get(rules, window, [], [], after);
    expect(cache.stats.misses).toBe(2);
  });

  it("hits when only a block's title changes, which cannot move a slot", () => {
    const cache = new GenerationCache();
    const base = {
      id: "b",
      startUtc: utc("2026-08-05T09:00:00Z"),
      endUtc: utc("2026-08-05T10:00:00Z"),
      kind: "event" as const,
      tags: [] as string[],
    };

    cache.get(rules, window, [], [], { ...emptyWorld, blocks: [{ ...base, title: "One" }] });
    cache.get(rules, window, [], [], { ...emptyWorld, blocks: [{ ...base, title: "Two" }] });
    expect(cache.stats.hits).toBe(1);
  });

  it("misses when an override is added", () => {
    const cache = new GenerationCache();
    const slots = generate(rules, window);
    cache.get(rules, window);
    cache.get(rules, window, [{ slotKey: slots[0]?.key ?? "", action: "skip" }]);
    expect(cache.stats.misses).toBe(2);
  });

  it("keys differ only when something relevant differs", () => {
    const a = memoKey(rules, window, [], [], emptyWorld, {});
    const b = memoKey(rules, window, [], [], emptyWorld, {});
    expect(a).toBe(b);
    expect(memoKey(rules, window, [], [], emptyWorld, { trace: true })).not.toBe(a);
  });

  it("bounds what it keeps", () => {
    const cache = new GenerationCache();
    for (let index = 0; index < 60; index += 1) {
      cache.get(rules, { startUtc: window.startUtc + index, endUtc: window.endUtc });
    }
    expect(cache.size).toBeLessThanOrEqual(32);
  });
});
