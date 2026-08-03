import { describe, expect, it } from "vitest";
import { parseLooseTime, sortTimes } from "./WeeklyGridEditor";

describe("parseLooseTime", () => {
  /* Spec1.1 12.4 asks the time input to accept 8, 08, 8:30 and 20:00. Being
     made to type a colon and a leading zero to add one slot is the kind of
     friction that stops a schedule being edited at all. */
  it("accepts every shape the specification names", () => {
    expect(parseLooseTime("8")).toBe("08:00");
    expect(parseLooseTime("08")).toBe("08:00");
    expect(parseLooseTime("8:30")).toBe("08:30");
    expect(parseLooseTime("20:00")).toBe("20:00");
  });

  it("accepts a bare four digit reading", () => {
    expect(parseLooseTime("0830")).toBe("08:30");
    expect(parseLooseTime("2045")).toBe("20:45");
  });

  it("trims whitespace", () => {
    expect(parseLooseTime("  9:15  ")).toBe("09:15");
  });

  it("refuses what is not a time", () => {
    for (const bad of ["", "   ", "abc", "25", "24:00", "9:60", "-1", "9:5"]) {
      expect(parseLooseTime(bad)).toBeNull();
    }
  });
});

describe("sortTimes", () => {
  it("sorts and removes duplicates, so ordinals follow the clock", () => {
    expect(sortTimes(["18:00", "08:00", "12:00", "08:00"])).toEqual([
      "08:00",
      "12:00",
      "18:00",
    ]);
  });

  it("sorts lexicographically, which is chronological for zero padded times", () => {
    expect(sortTimes(["09:00", "10:00", "08:30"])).toEqual([
      "08:30",
      "09:00",
      "10:00",
    ]);
  });
});
