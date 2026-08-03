import { describe, expect, it } from "vitest";
import { generate, generateDetailed } from "./engine";
import { localMinutesOfDay } from "../time";
import type {
  BlockLike,
  Generator,
  ResolvedRuleset,
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

function ruleset(...generators: Generator[]): ResolvedRuleset {
  return { id: "rs", name: "Test", generators, modifiers: [] };
}

function world(blocks: BlockLike[] = []): WorldState {
  return { now: 0, blocks, contentItems: [], momentum: [], holidays: [] };
}

const WEEK = { startUtc: utc("2026-08-03T00:00:00Z"), endUtc: utc("2026-08-10T00:00:00Z") };
const DAY = { startUtc: utc("2026-08-03T00:00:00Z"), endUtc: utc("2026-08-04T00:00:00Z") };
const minutesOf = (startUtc: number): number => localMinutesOfDay(startUtc, TZ);

describe("pattern", () => {
  it("cycles on and off from the anchor", () => {
    const slots = generate(
      ruleset(
        generator({
          kind: "pattern",
          config: {
            pattern: ["on", "on", "off"],
            anchorDate: "2026-08-03",
            onConfig: { times: ["09:00"] },
          },
        }),
      ),
      WEEK,
    );
    expect(slots.map((slot) => slot.localDate)).toEqual([
      "2026-08-03",
      "2026-08-04",
      "2026-08-06",
      "2026-08-07",
      "2026-08-09",
    ]);
  });

  it("is defined before the anchor too, not only after", () => {
    const slots = generate(
      ruleset(
        generator({
          kind: "pattern",
          config: {
            pattern: ["on", "off"],
            anchorDate: "2026-09-01",
            onConfig: { times: ["09:00"] },
          },
        }),
      ),
      WEEK,
    );
    expect(slots.length).toBeGreaterThan(0);
  });
});

describe("relative", () => {
  const busy = world([
    {
      id: "standup",
      startUtc: utc("2026-08-03T07:00:00Z"),
      endUtc: utc("2026-08-03T07:30:00Z"),
      kind: "event",
      tags: ["work"],
    },
  ]);

  it("offsets from the first block of the day", () => {
    const slots = generate(
      ruleset(
        generator({
          kind: "relative",
          config: { anchor: "first-block-of-day", offsetMinutes: 120 },
        }),
      ),
      DAY,
      [],
      [],
      busy,
    );
    expect(slots).toHaveLength(1);
    // 09:00 local plus two hours.
    expect(minutesOf(slots[0]?.startUtc ?? 0)).toBe(660);
  });

  it("falls back to a fixed time when the anchor is absent", () => {
    const slots = generate(
      ruleset(
        generator({
          kind: "relative",
          config: {
            anchor: "first-block-of-day",
            offsetMinutes: 120,
            fallbackTime: "10:00",
          },
        }),
      ),
      DAY,
    );
    expect(minutesOf(slots[0]?.startUtc ?? 0)).toBe(600);
  });
});

describe("rotation", () => {
  const grid = generator({
    id: "grid",
    config: { times: ["08:00", "12:00", "18:00", "22:00"] },
  });

  it("cycles intents across the source's slots", () => {
    const slots = generate(
      ruleset(
        grid,
        generator({
          id: "rot",
          kind: "rotation",
          config: {
            sourceGeneratorId: "grid",
            cycle: [{ platform: "x" }, { platform: "linkedin" }],
            resetOn: "day",
          },
        }),
      ),
      DAY,
    );

    const rotated = slots.filter((slot) => slot.generatorId === "rot");
    expect(rotated.map((slot) => slot.intent.platform)).toEqual([
      "x",
      "linkedin",
      "x",
      "linkedin",
    ]);
  });

  it("says so when its source is gone rather than emitting nothing in silence", () => {
    const report = generateDetailed(
      ruleset(
        generator({
          id: "rot",
          kind: "rotation",
          config: { sourceGeneratorId: "missing", cycle: [{ platform: "x" }] },
        }),
      ),
      DAY,
    );
    expect(report.slots).toEqual([]);
    expect(report.notices.some((n) => n.kind === "rotation-no-source")).toBe(true);
  });

  it("does not recurse when a rotation points at itself", () => {
    expect(() =>
      generate(
        ruleset(
          generator({
            id: "loop",
            kind: "rotation",
            config: { sourceGeneratorId: "loop", cycle: [{ platform: "x" }] },
          }),
        ),
        DAY,
      ),
    ).not.toThrow();
  });
});

describe("derived", () => {
  const upload: BlockLike = {
    id: "video-1",
    startUtc: utc("2026-08-03T10:00:00Z"),
    endUtc: utc("2026-08-03T10:30:00Z"),
    kind: "post",
    tags: [],
    title: "How the engine works",
    platform: "youtube",
    status: "done",
  };

  const promo = generator({
    id: "promo",
    kind: "derived",
    emits: { ...INTENT, platform: "linkedin" },
    config: {
      trigger: { platform: "youtube", status: "done" },
      offsets: [
        { minutes: 120, emits: { platform: "x", titleTemplate: "Promo: {trigger.title}" } },
        { minutes: 1440, emits: { platform: "linkedin" } },
      ],
    },
  });

  it("fires off the trigger at each offset", () => {
    const slots = generate(
      ruleset(promo),
      { startUtc: utc("2026-08-03T00:00:00Z"), endUtc: utc("2026-08-06T00:00:00Z") },
      [],
      [],
      world([upload]),
    );
    expect(slots).toHaveLength(2);
    expect(slots[0]?.startUtc).toBe((upload.startUtc ?? 0) + 120 * MIN);
    expect(slots[1]?.startUtc).toBe((upload.startUtc ?? 0) + 1440 * MIN);
  });

  it("fills the trigger's title into the template", () => {
    const slots = generate(
      ruleset(promo),
      { startUtc: utc("2026-08-03T00:00:00Z"), endUtc: utc("2026-08-06T00:00:00Z") },
      [],
      [],
      world([upload]),
    );
    expect(slots[0]?.intent.titleTemplate).toBe("Promo: How the engine works");
  });

  it("takes negative offsets, which is pre-promotion", () => {
    const slots = generate(
      ruleset(
        generator({
          id: "pre",
          kind: "derived",
          config: {
            trigger: { platform: "youtube" },
            offsets: [{ minutes: -1440, emits: {} }],
          },
        }),
      ),
      { startUtc: utc("2026-08-01T00:00:00Z"), endUtc: utc("2026-08-06T00:00:00Z") },
      [],
      [],
      world([upload]),
    );
    expect(slots[0]?.startUtc).toBe((upload.startUtc ?? 0) - 1440 * MIN);
  });

  /* Edge case 7. */
  it("its slots go when the trigger goes", () => {
    const window = {
      startUtc: utc("2026-08-03T00:00:00Z"),
      endUtc: utc("2026-08-06T00:00:00Z"),
    };
    expect(generate(ruleset(promo), window, [], [], world([upload]))).toHaveLength(2);
    expect(generate(ruleset(promo), window, [], [], world([]))).toEqual([]);
  });

  it("ignores a block that does not match the trigger", () => {
    const slots = generate(
      ruleset(promo),
      { startUtc: utc("2026-08-03T00:00:00Z"), endUtc: utc("2026-08-06T00:00:00Z") },
      [],
      [],
      world([{ ...upload, status: "open" }]),
    );
    expect(slots).toEqual([]);
  });
});

describe("gap-fill", () => {
  const busy = world([
    {
      id: "meeting",
      startUtc: utc("2026-08-03T08:00:00Z"),
      endUtc: utc("2026-08-03T09:00:00Z"),
      kind: "event",
      tags: [],
    },
  ]);

  /* Edge case 18, moved here from A2 because this is where gap-fill is built. */
  it("never emits a chunk below the minimum, even with budget left", () => {
    const slots = generate(
      ruleset(
        generator({
          kind: "gap-fill",
          config: {
            budgetMinutes: 600,
            minChunkMinutes: 45,
            maxChunkMinutes: 120,
            window: ["09:00", "19:00"],
          },
        }),
      ),
      DAY,
      [],
      [],
      world([
        // Leaves only forty minutes free between two blocks.
        {
          id: "a",
          startUtc: utc("2026-08-03T07:00:00Z"),
          endUtc: utc("2026-08-03T12:20:00Z"),
          kind: "event",
          tags: [],
        },
        {
          id: "b",
          startUtc: utc("2026-08-03T13:00:00Z"),
          endUtc: utc("2026-08-03T17:00:00Z"),
          kind: "event",
          tags: [],
        },
      ]),
    );

    for (const slot of slots) {
      expect(slot.endUtc - slot.startUtc).toBeGreaterThanOrEqual(45 * MIN);
    }
  });

  it("stays inside its budget", () => {
    const slots = generate(
      ruleset(
        generator({
          kind: "gap-fill",
          config: {
            budgetMinutes: 120,
            minChunkMinutes: 30,
            maxChunkMinutes: 60,
            window: ["09:00", "19:00"],
          },
        }),
      ),
      DAY,
      [],
      [],
      busy,
    );
    const total = slots.reduce((sum, slot) => sum + (slot.endUtc - slot.startUtc), 0);
    expect(total).toBeLessThanOrEqual(120 * MIN);
  });

  it("does not overlap what is already booked", () => {
    const slots = generate(
      ruleset(
        generator({
          kind: "gap-fill",
          config: { budgetMinutes: 480, minChunkMinutes: 30, window: ["09:00", "19:00"] },
        }),
      ),
      DAY,
      [],
      [],
      busy,
    );
    for (const slot of slots) {
      expect(
        slot.startUtc >= utc("2026-08-03T09:00:00Z") ||
          slot.endUtc <= utc("2026-08-03T08:00:00Z"),
      ).toBe(true);
    }
  });
});

describe("deadline-backfill", () => {
  const exam: BlockLike = {
    id: "exam",
    startUtc: utc("2026-08-20T08:00:00Z"),
    endUtc: utc("2026-08-20T11:00:00Z"),
    kind: "deadline",
    tags: ["exam"],
  };

  it("puts every session before the deadline", () => {
    const slots = generate(
      ruleset(
        generator({
          kind: "deadline-backfill",
          config: { triggerTag: "exam", sessions: 6, spanDays: 14 },
        }),
      ),
      { startUtc: utc("2026-08-01T00:00:00Z"), endUtc: utc("2026-08-21T00:00:00Z") },
      [],
      [],
      world([exam]),
    );

    expect(slots.length).toBeGreaterThan(0);
    for (const slot of slots) {
      expect(slot.startUtc).toBeLessThan(exam.startUtc ?? 0);
    }
  });

  it("back loads towards the deadline, which is how preparation works", () => {
    const slots = generate(
      ruleset(
        generator({
          kind: "deadline-backfill",
          config: {
            triggerTag: "exam",
            sessions: 6,
            spanDays: 14,
            distribution: "back-loaded",
          },
        }),
      ),
      { startUtc: utc("2026-08-01T00:00:00Z"), endUtc: utc("2026-08-21T00:00:00Z") },
      [],
      [],
      world([exam]),
    );

    const half = Math.floor(slots.length / 2);
    const lastHalfSpan =
      (slots[slots.length - 1]?.startUtc ?? 0) - (slots[half]?.startUtc ?? 0);
    const firstHalfSpan = (slots[half]?.startUtc ?? 0) - (slots[0]?.startUtc ?? 0);
    expect(lastHalfSpan).toBeLessThanOrEqual(firstHalfSpan);
  });
});

describe("batch-production", () => {
  it("books time to make what another generator will publish", () => {
    const slots = generate(
      ruleset(
        generator({ id: "posts", config: { times: ["09:00", "13:00", "17:00"] } }),
        generator({
          id: "batch",
          kind: "batch-production",
          emits: { ...INTENT, kind: "focus" },
          config: {
            perSlots: 6,
            leadDays: 2,
            preferredWeekdays: ["sun"],
            sourceGeneratorIds: ["posts"],
          },
        }),
      ),
      { startUtc: utc("2026-08-03T00:00:00Z"), endUtc: utc("2026-08-17T00:00:00Z") },
    );

    const batches = slots.filter((slot) => slot.generatorId === "batch");
    expect(batches.length).toBeGreaterThan(0);
    for (const slot of batches) {
      // Every production block lands on a Sunday.
      const day = new Date(`${slot.localDate}T00:00:00Z`).getUTCDay();
      expect(day).toBe(0);
    }
  });

  it("emits nothing when it has no source", () => {
    const slots = generate(
      ruleset(
        generator({
          id: "batch",
          kind: "batch-production",
          config: { perSlots: 6, sourceGeneratorIds: [] },
        }),
      ),
      WEEK,
    );
    expect(slots).toEqual([]);
  });
});

describe("conditional", () => {
  it("emits only on days its predicate allows", () => {
    const slots = generate(
      ruleset(
        generator({
          kind: "conditional",
          config: {
            inner: { kind: "daily-times", config: { times: ["20:00"] } },
            predicate: { type: "weekday-in", weekdays: ["sat", "sun"] },
          },
        }),
      ),
      WEEK,
    );
    for (const slot of slots) {
      expect(["2026-08-08", "2026-08-09"]).toContain(slot.localDate);
    }
    expect(slots.length).toBe(2);
  });

  it("combines predicates with all and not", () => {
    const slots = generate(
      ruleset(
        generator({
          kind: "conditional",
          config: {
            inner: { kind: "daily-times", config: { times: ["20:00"] } },
            predicate: {
              all: [
                { type: "no-block-with-tag", tag: "travel" },
                { not: { type: "weekday-in", weekdays: ["sun"] } },
              ],
            },
          },
        }),
      ),
      WEEK,
      [],
      [],
      world([
        {
          id: "trip",
          startUtc: utc("2026-08-05T09:00:00Z"),
          endUtc: utc("2026-08-05T10:00:00Z"),
          kind: "event",
          tags: ["travel"],
        },
      ]),
    );

    const dates = slots.map((slot) => slot.localDate);
    expect(dates).not.toContain("2026-08-05");
    expect(dates).not.toContain("2026-08-09");
    expect(dates).toContain("2026-08-04");
  });

  it("reads free minutes from the calendar", () => {
    const rules = ruleset(
      generator({
        kind: "conditional",
        config: {
          inner: { kind: "daily-times", config: { times: ["20:00"] } },
          predicate: {
            type: "free-minutes-at-least",
            window: ["18:00", "23:00"],
            minutes: 240,
          },
        },
      }),
    );

    expect(generate(rules, DAY)).toHaveLength(1);

    const packed = generate(
      rules,
      DAY,
      [],
      [],
      world([
        {
          id: "evening",
          startUtc: utc("2026-08-03T16:00:00Z"),
          endUtc: utc("2026-08-03T21:00:00Z"),
          kind: "event",
          tags: [],
        },
      ]),
    );
    expect(packed).toEqual([]);
  });
});

describe("bindings and deleted blocks", () => {
  /* Edge case 25, the engine half: with the binding gone, the slot is virtual
     again and nothing regenerates the block, because only a binding would. */
  it("a slot returns to virtual once its binding is removed", () => {
    const rules = ruleset(generator({ config: { times: ["09:00"] } }));
    const slots = generate(rules, DAY);
    const key = slots[0]?.key ?? "";

    const bound = generate(rules, DAY, [], [{ slotKey: key, blockId: "block-1" }]);
    expect(bound[0]?.state).toBe("materialized");
    expect(bound[0]?.blockId).toBe("block-1");

    const unbound = generate(rules, DAY, [], []);
    expect(unbound[0]?.state).toBe("virtual");
    expect(unbound[0]?.blockId).toBeUndefined();
  });
});
