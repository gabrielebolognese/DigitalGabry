import { describe, expect, it } from "vitest";
import {
  hashSeed,
  hashString,
  mulberry32,
  randomFor,
  randomIntFor,
  randomNormalFor,
} from "./prng";
import {
  derivedSlotKeyOf,
  parseSlotKey,
  rekeyByNearestTime,
  slotKeyOf,
} from "./slotKey";

describe("hashString", () => {
  it("is stable for the same input", () => {
    expect(hashString("gabry-2026")).toBe(hashString("gabry-2026"));
  });

  it("separates inputs that differ only in order", () => {
    expect(hashSeed("a", "b")).not.toBe(hashSeed("b", "a"));
  });

  it("stays inside 32 unsigned bits", () => {
    for (const text of ["", "a", "gabry-2026", "x".repeat(500)]) {
      const hash = hashString(text);
      expect(Number.isInteger(hash)).toBe(true);
      expect(hash).toBeGreaterThanOrEqual(0);
      expect(hash).toBeLessThan(2 ** 32);
    }
  });
});

describe("mulberry32", () => {
  it("gives the same sequence for the same seed", () => {
    const first = mulberry32(12345);
    const second = mulberry32(12345);
    for (let index = 0; index < 20; index += 1) {
      expect(second()).toBe(first());
    }
  });

  it("stays in [0, 1)", () => {
    const next = mulberry32(99);
    for (let index = 0; index < 1000; index += 1) {
      const value = next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("is not obviously biased to one half", () => {
    const next = mulberry32(7);
    let low = 0;
    for (let index = 0; index < 2000; index += 1) if (next() < 0.5) low += 1;
    expect(low).toBeGreaterThan(850);
    expect(low).toBeLessThan(1150);
  });
});

describe("randomFor", () => {
  /* Edge case 20 in spirit: jitter with a fixed seed has to be identical
     across app restarts and across devices. Keying every draw by its
     coordinates rather than by position in a stream is what delivers that, so
     these assert the property rather than a snapshot of the numbers. */
  it("depends only on its coordinates", () => {
    expect(randomFor("s", "gen", "2026-08-03", 2)).toBe(
      randomFor("s", "gen", "2026-08-03", 2),
    );
  });

  it("changes when any coordinate changes", () => {
    const base = randomFor("s", "gen", "2026-08-03", 2);
    expect(randomFor("t", "gen", "2026-08-03", 2)).not.toBe(base);
    expect(randomFor("s", "gen2", "2026-08-03", 2)).not.toBe(base);
    expect(randomFor("s", "gen", "2026-08-04", 2)).not.toBe(base);
    expect(randomFor("s", "gen", "2026-08-03", 3)).not.toBe(base);
  });

  it("does not depend on how many draws came before it", () => {
    const direct = randomFor("s", "gen", "2026-08-03", 99);
    for (let ordinal = 0; ordinal < 99; ordinal += 1) {
      randomFor("s", "gen", "2026-08-03", ordinal);
    }
    expect(randomFor("s", "gen", "2026-08-03", 99)).toBe(direct);
  });

  it("keeps integers inside the range, endpoints included", () => {
    let sawLow = false;
    let sawHigh = false;
    for (let ordinal = 0; ordinal < 400; ordinal += 1) {
      const value = randomIntFor("s", "gen", "2026-08-03", ordinal, -20, 20);
      expect(value).toBeGreaterThanOrEqual(-20);
      expect(value).toBeLessThanOrEqual(20);
      expect(Number.isInteger(value)).toBe(true);
      if (value === -20) sawLow = true;
      if (value === 20) sawHigh = true;
    }
    expect(sawLow || sawHigh).toBe(true);
  });

  it("collapses an empty range rather than dividing by zero", () => {
    expect(randomIntFor("s", "gen", "2026-08-03", 0, 5, 5)).toBe(5);
    expect(randomIntFor("s", "gen", "2026-08-03", 0, 9, 2)).toBe(9);
  });

  it("clamps the normal distribution to its spread", () => {
    for (let ordinal = 0; ordinal < 500; ordinal += 1) {
      const value = randomNormalFor("s", "gen", "2026-08-03", ordinal, 20);
      expect(value).toBeGreaterThanOrEqual(-20);
      expect(value).toBeLessThanOrEqual(20);
      expect(Number.isFinite(value)).toBe(true);
    }
  });

  it("clusters the normal distribution nearer the middle than a flat one", () => {
    let normalNear = 0;
    let uniformNear = 0;
    for (let ordinal = 0; ordinal < 800; ordinal += 1) {
      if (Math.abs(randomNormalFor("s", "g", "2026-08-03", ordinal, 20)) < 7) {
        normalNear += 1;
      }
      if (Math.abs(randomIntFor("s", "g", "2026-08-03", ordinal, -20, 20)) < 7) {
        uniformNear += 1;
      }
    }
    expect(normalNear).toBeGreaterThan(uniformNear);
  });
});

describe("slot keys", () => {
  it("round trips", () => {
    const key = slotKeyOf("019fb80d-a798-756c-b46d-5cb347a96c28", "2026-08-03", 3);
    expect(parseSlotKey(key)).toEqual({
      generatorId: "019fb80d-a798-756c-b46d-5cb347a96c28",
      localDate: "2026-08-03",
      ordinal: 3,
    });
  });

  it("survives a generator id that contains the separator", () => {
    const key = slotKeyOf("odd|id", "2026-08-03", 0);
    expect(parseSlotKey(key)?.generatorId).toBe("odd|id");
  });

  it("is identity, not time: the same ordinal keeps its key when the time moves", () => {
    expect(slotKeyOf("gen", "2026-08-03", 1)).toBe(slotKeyOf("gen", "2026-08-03", 1));
  });

  it("refuses anything that is not a key", () => {
    for (const bad of ["", "gen", "gen|2026-08-03", "gen|not-a-date|0", "gen|2026-08-03|x", "gen|2026-08-03|-1"]) {
      expect(parseSlotKey(bad)).toBeNull();
    }
  });

  it("keys derived slots on the trigger, so they survive it moving", () => {
    expect(derivedSlotKeyOf("gen", "trigger-1", 2)).toBe("gen|trigger-1|2");
  });
});

describe("rekeyByNearestTime", () => {
  /* Spec1.1 section 7. Inserting a time at the start of a day shifts every
     later ordinal, which would silently misalign existing overrides. */
  it("maps old ordinals to new by nearest time", () => {
    const mapping = rekeyByNearestTime([480, 720, 1080], [420, 480, 720, 1080]);
    expect(mapping.get(0)).toBe(1);
    expect(mapping.get(1)).toBe(2);
    expect(mapping.get(2)).toBe(3);
  });

  it("leaves an old ordinal unmapped when the new list is shorter", () => {
    const mapping = rekeyByNearestTime([480, 720, 1080], [480]);
    expect(mapping.get(0)).toBe(0);
    expect(mapping.size).toBe(1);
  });

  it("never maps two old ordinals onto the same new one", () => {
    const mapping = rekeyByNearestTime([480, 490, 500], [495]);
    expect([...mapping.values()]).toEqual([0]);
  });

  it("prefers the genuinely closest pair over first come first served", () => {
    // 720 is an exact match; a greedy left-to-right walk would give it to 700.
    const mapping = rekeyByNearestTime([700, 720], [720, 900]);
    expect(mapping.get(1)).toBe(0);
    expect(mapping.get(0)).toBe(1);
  });

  it("is empty when either side is", () => {
    expect(rekeyByNearestTime([], [480]).size).toBe(0);
    expect(rekeyByNearestTime([480], []).size).toBe(0);
  });
});
