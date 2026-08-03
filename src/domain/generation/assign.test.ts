import { describe, expect, it } from "vitest";
import {
  DEFAULT_AUTOFILL,
  capacityReport,
  planAutoFill,
  sparkline,
  type AssignableContent,
} from "./assign";
import { generate } from "./engine";
import { importRuleset } from "./serialize";
import { PRESETS, presetByName } from "./presets";
import { exportRuleset } from "./serialize";
import type { Generator, ResolvedRuleset, Slot, SlotIntent } from "./types";

const TZ = "Europe/Rome";
const utc = (iso: string): number => Date.parse(iso);

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

function slot(index: number, platform = "x"): Slot {
  return {
    key: `gen|2026-08-0${index + 3}|0`,
    generatorId: "gen",
    generatorVersion: 1,
    localDate: `2026-08-0${index + 3}`,
    ordinal: 0,
    startUtc: utc("2026-08-03T07:00:00Z") + index * 86_400_000,
    endUtc: utc("2026-08-03T07:10:00Z") + index * 86_400_000,
    intent: { ...INTENT, platform: platform as SlotIntent["platform"] },
    state: "virtual",
    layer: 50,
  };
}

function item(overrides: Partial<AssignableContent> & { id: string }): AssignableContent {
  return {
    platform: "x",
    status: "ready",
    title: overrides.id,
    projectId: null,
    createdUtc: 0,
    updatedUtc: 0,
    ...overrides,
  };
}

describe("planAutoFill", () => {
  it("fills the earliest slots first", () => {
    const plan = planAutoFill(
      [slot(0), slot(1), slot(2)],
      [item({ id: "a", createdUtc: 1 }), item({ id: "b", createdUtc: 2 })],
    );

    expect(plan.assignments.map((entry) => entry.content.id)).toEqual(["a", "b"]);
    expect(plan.assignments[0]?.slotKey).toBe(slot(0).key);
    expect(plan.unfilled).toHaveLength(1);
  });

  it("never assigns the same item twice", () => {
    const plan = planAutoFill([slot(0), slot(1)], [item({ id: "only" })]);
    expect(plan.assignments).toHaveLength(1);
    expect(plan.unfilled[0]?.reason).toContain("Nothing ready");
  });

  it("matches the platform, and says so when it cannot", () => {
    const plan = planAutoFill(
      [slot(0, "linkedin")],
      [item({ id: "a", platform: "x" })],
    );
    expect(plan.assignments).toEqual([]);
    expect(plan.unfilled[0]?.reason).toContain("linkedin");
  });

  it("ignores content that is not ready", () => {
    const plan = planAutoFill(
      [slot(0)],
      [item({ id: "draft", status: "draft" }), item({ id: "posted", status: "posted" })],
    );
    expect(plan.assignments).toEqual([]);
  });

  it("takes the newest first when asked", () => {
    const plan = planAutoFill(
      [slot(0)],
      [item({ id: "old", createdUtc: 1 }), item({ id: "new", createdUtc: 9 })],
      { ...DEFAULT_AUTOFILL, strategy: "newest-first" },
    );
    expect(plan.assignments[0]?.content.id).toBe("new");
  });

  it("orders by priority when asked", () => {
    const plan = planAutoFill(
      [slot(0)],
      [
        item({ id: "low", priority: 1, createdUtc: 1 }),
        item({ id: "high", priority: 9, createdUtc: 5 }),
      ],
      { ...DEFAULT_AUTOFILL, strategy: "priority" },
    );
    expect(plan.assignments[0]?.content.id).toBe("high");
  });

  it("keeps a project off the next few slots when a cooldown is set", () => {
    const plan = planAutoFill(
      [slot(0), slot(1)],
      [
        item({ id: "p1-a", projectId: "p1", createdUtc: 1 }),
        item({ id: "p1-b", projectId: "p1", createdUtc: 2 }),
        item({ id: "p2-a", projectId: "p2", createdUtc: 3 }),
      ],
      { ...DEFAULT_AUTOFILL, respectCooldown: true, cooldownSlots: 3 },
    );

    expect(plan.assignments[0]?.content.projectId).toBe("p1");
    expect(plan.assignments[1]?.content.projectId).toBe("p2");
  });

  /* The cooldown is a preference, not a rule. */
  it("fills the slot anyway when only a cooled-down project is left", () => {
    const plan = planAutoFill(
      [slot(0), slot(1)],
      [
        item({ id: "p1-a", projectId: "p1", createdUtc: 1 }),
        item({ id: "p1-b", projectId: "p1", createdUtc: 2 }),
      ],
      { ...DEFAULT_AUTOFILL, respectCooldown: true, cooldownSlots: 5 },
    );
    expect(plan.assignments).toHaveLength(2);
  });

  it("stops at the assignment limit and reports the rest", () => {
    const plan = planAutoFill(
      [slot(0), slot(1), slot(2)],
      [item({ id: "a" }), item({ id: "b" }), item({ id: "c" })],
      { ...DEFAULT_AUTOFILL, maxAssignments: 2 },
    );
    expect(plan.assignments).toHaveLength(2);
    expect(plan.unfilled[0]?.reason).toContain("limit");
  });

  it("leaves a slot that already has content alone", () => {
    const taken: Slot = { ...slot(0), contentId: "already" };
    const plan = planAutoFill([taken, slot(1)], [item({ id: "a" })]);
    expect(plan.assignments).toHaveLength(1);
    expect(plan.assignments[0]?.slotKey).toBe(slot(1).key);
  });

  it("is deterministic, so the dry run is what gets applied", () => {
    const slots = [slot(0), slot(1), slot(2)];
    const content = [item({ id: "a" }), item({ id: "b" })];
    expect(planAutoFill(slots, content)).toEqual(planAutoFill(slots, content));
  });
});

describe("capacityReport", () => {
  const dates = ["2026-08-03", "2026-08-04", "2026-08-05"];

  /* The acceptance criterion: the report has to match a count done by hand. */
  it("matches a manual count", () => {
    const slots = [slot(0), slot(1), slot(2), slot(0, "linkedin")];
    const content = [
      item({ id: "a" }),
      item({ id: "b" }),
      item({ id: "c", platform: "linkedin" }),
      item({ id: "d", status: "draft" }),
    ];

    const report = capacityReport(slots, content, dates);
    const x = report.find((row) => row.platform === "x");
    const linkedin = report.find((row) => row.platform === "linkedin");

    // Three X slots against two ready items: one short.
    expect(x?.slots).toBe(3);
    expect(x?.ready).toBe(2);
    expect(x?.balance).toBe(-1);

    // One LinkedIn slot against one ready item: level.
    expect(linkedin?.slots).toBe(1);
    expect(linkedin?.ready).toBe(1);
    expect(linkedin?.balance).toBe(0);
  });

  it("puts the shortest first, which is what needs attention", () => {
    const report = capacityReport(
      [slot(0), slot(1), slot(0, "linkedin")],
      [item({ id: "c", platform: "linkedin" }), item({ id: "d", platform: "linkedin" })],
      dates,
    );
    expect(report[0]?.platform).toBe("x");
  });

  it("counts slots per day for the sparkline", () => {
    const report = capacityReport([slot(0), slot(0), slot(2)], [], dates);
    expect(report[0]?.perDay).toEqual([2, 0, 1]);
  });

  it("includes a platform with content but no slots", () => {
    const report = capacityReport([], [item({ id: "a", platform: "youtube" })], dates);
    expect(report[0]?.platform).toBe("youtube");
    expect(report[0]?.balance).toBe(1);
  });
});

describe("sparkline", () => {
  it("scales to the largest value", () => {
    expect(sparkline([0, 0, 0])).toBe("▁▁▁");
    expect(sparkline([0, 4])).toBe("▁▇");
    expect(sparkline([2, 4]).length).toBe(2);
  });

  it("handles an empty run without throwing", () => {
    expect(sparkline([])).toBe("");
  });
});

describe("bundled presets", () => {
  const window = {
    startUtc: utc("2026-08-03T00:00:00Z"),
    endUtc: utc("2026-08-10T00:00:00Z"),
  };

  it("there are five", () => {
    expect(PRESETS).toHaveLength(5);
    expect(PRESETS.map((preset) => preset.name)).toEqual([
      "Creator daily",
      "Build in public",
      "Student schedule",
      "Minimal",
      "Agency",
    ]);
  });

  /* Seeded but not enabled. A preset that started producing slots on import
     would put items on a calendar nobody asked to have filled. */
  it("every generator and modifier arrives disabled", () => {
    for (const preset of PRESETS) {
      for (const generator of preset.generators) expect(generator.enabled).toBe(false);
      for (const modifier of preset.modifiers) expect(modifier.enabled).toBe(false);
    }
  });

  it("each one imports cleanly", () => {
    for (const preset of PRESETS) {
      const imported = importRuleset(JSON.stringify(preset), "rs");
      expect(imported.ok, `${preset.name} should import`).toBe(true);
    }
  });

  it("produces the documented slot count for a known week once enabled", () => {
    const preset = presetByName("Minimal");
    expect(preset).not.toBeNull();
    const imported = importRuleset(JSON.stringify(preset), "rs");
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;

    const enabled: ResolvedRuleset = {
      ...imported.ruleset,
      generators: imported.ruleset.generators.map((row) => ({ ...row, enabled: true })),
    };

    // One a weekday, so five in the week beginning Monday 3 August 2026.
    expect(generate(enabled, window)).toHaveLength(5);
  });

  it("round trips through export and import", () => {
    for (const preset of PRESETS) {
      const imported = importRuleset(JSON.stringify(preset), "rs");
      expect(imported.ok).toBe(true);
      if (!imported.ok) continue;

      const again = importRuleset(exportRuleset(imported.ruleset), "rs");
      expect(again.ok).toBe(true);
      if (!again.ok) continue;

      expect(generate(again.ruleset, window)).toEqual(generate(imported.ruleset, window));
    }
  });

  it("the agency preset stays inside its own daily cap once enabled", () => {
    const preset = presetByName("Agency");
    const imported = importRuleset(JSON.stringify(preset), "rs");
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;

    const enabled: ResolvedRuleset = {
      id: "rs",
      name: "Agency",
      generators: imported.ruleset.generators.map((row) => ({ ...row, enabled: true })),
      modifiers: (imported.ruleset.modifiers ?? []).map((row) => ({ ...row, enabled: true })),
    };

    const perDay = new Map<string, number>();
    for (const produced of generate(enabled, window)) {
      perDay.set(produced.localDate, (perDay.get(produced.localDate) ?? 0) + 1);
    }
    for (const count of perDay.values()) expect(count).toBeLessThanOrEqual(4);
  });
});

describe("generator naming, so a preset reads in the rule list", () => {
  it("every preset generator has a name and a stable id", () => {
    for (const preset of PRESETS) {
      for (const row of preset.generators) {
        expect(row.name.length).toBeGreaterThan(0);
        expect(row.id.startsWith("preset-")).toBe(true);
      }
    }
  });

  it("a generator built by hand is unaffected", () => {
    expect(generator().name).toBe("Test");
  });
});
