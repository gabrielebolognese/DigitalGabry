import { describe, expect, it } from "vitest";
import { generate } from "./engine";
import type { Generator, ResolvedRuleset, SlotIntent } from "./types";

/* Spec1.1 section 15. Committed rather than run once and forgotten, because
   the budget is what decides whether generation can stay on the main thread,
   and a regression in it is invisible until the calendar feels slow.

   Best of five. A single timing on a shared machine is noise; the best run is
   the one least disturbed by whatever else the box was doing, which is the
   honest measure of the code rather than of the scheduler. */

const TZ = "Europe/Rome";
const DAY_MS = 86_400_000;

const INTENT: SlotIntent = {
  kind: "post",
  platform: "x",
  category: "content",
  durationMinutes: 10,
};

function twentyGenerators(): Generator[] {
  const generators: Generator[] = [];

  for (let index = 0; index < 20; index += 1) {
    const base = {
      id: `gen-${String(index).padStart(2, "0")}`,
      version: 1,
      name: `Generator ${index}`,
      enabled: true,
      layer: 10 + (index % 9) * 10,
      validFrom: null,
      validTo: null,
      timezone: TZ,
      emits: INTENT,
    };

    // A realistic mix rather than twenty copies of the cheapest kind.
    if (index % 3 === 0) {
      generators.push({
        ...base,
        kind: "weekly-grid",
        config: {
          times: {
            mon: ["08:00", "12:00", "18:00", "22:00"],
            tue: ["09:00", "13:00", "19:00"],
            wed: ["08:00", "12:00", "18:00", "22:00"],
            thu: ["09:00", "13:00", "19:00"],
            fri: ["08:00", "12:00", "17:00"],
            sat: ["11:00", "20:00"],
            sun: [],
          },
        },
      });
    } else if (index % 3 === 1) {
      generators.push({
        ...base,
        kind: "daily-times",
        config: {
          times: ["07:30", "10:00", "14:00", "20:30"],
          weekdays: ["mon", "tue", "wed", "thu", "fri"],
        },
      });
    } else {
      generators.push({
        ...base,
        kind: "daily-times",
        config: { times: ["09:15", "16:45"] },
      });
    }
  }

  return generators;
}

const RULES: ResolvedRuleset = {
  id: "bench",
  name: "Benchmark",
  generators: twentyGenerators(),
};

const START = Date.parse("2026-01-05T00:00:00Z");

function bestOfFive(days: number): { ms: number; slots: number } {
  const window = { startUtc: START, endUtc: START + days * DAY_MS };
  let best = Infinity;
  let slots = 0;

  for (let run = 0; run < 5; run += 1) {
    const began = performance.now();
    const produced = generate(RULES, window);
    const elapsed = performance.now() - began;
    if (elapsed < best) best = elapsed;
    slots = produced.length;
  }

  return { ms: best, slots };
}

describe("generation performance, Spec1.1 section 15", () => {
  it("7 days with 20 generators stays under 4ms", () => {
    const { ms, slots } = bestOfFive(7);
    expect(slots).toBeGreaterThan(100);
    expect(ms).toBeLessThan(4);
  });

  it("90 days with 20 generators stays under 40ms", () => {
    const { ms, slots } = bestOfFive(90);
    expect(slots).toBeGreaterThan(2000);
    expect(ms).toBeLessThan(40);
  });

  it("365 days with 20 generators stays under 200ms", () => {
    const { ms, slots } = bestOfFive(365);
    expect(slots).toBeGreaterThan(9000);
    expect(ms).toBeLessThan(200);
  });

  /* Trace doubles the work, which is why Spec1.1 keeps it to development
     builds. Guarded so the default path cannot quietly start paying for it. */
  it("tracing costs something, and is therefore off by default", () => {
    const window = { startUtc: START, endUtc: START + 30 * DAY_MS };
    expect(generate(RULES, window)[0]?.trace).toBeUndefined();
    expect(generate(RULES, window, [], [], undefined, { trace: true })[0]?.trace)
      .toBeDefined();
  });
});
