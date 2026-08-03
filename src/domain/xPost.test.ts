import { describe, expect, it } from "vitest";
import {
  DEFAULT_SOFT_LIMIT,
  HARD_LIMIT,
  clampToHardLimit,
  counterStage,
  isOverHardLimit,
  postLength,
  softLimitOf,
} from "./xPost";

describe("counterStage", () => {
  /* Spec2 2.2 stages the colour against the soft limit: quiet under 80 percent,
     a warning from 80 to 100, loud past it. */
  it("is quiet well under the target", () => {
    expect(counterStage(0, 150)).toBe("under");
    expect(counterStage(119, 150)).toBe("under");
  });

  it("warns from four fifths of the way to the target", () => {
    expect(counterStage(120, 150)).toBe("near");
    expect(counterStage(150, 150)).toBe("near");
  });

  it("is loud past the target", () => {
    expect(counterStage(151, 150)).toBe("over");
    expect(counterStage(280, 150)).toBe("over");
  });

  it("does not divide by zero on a nonsense limit", () => {
    expect(counterStage(50, 0)).toBe("under");
    expect(counterStage(50, -10)).toBe("under");
  });
});

describe("postLength", () => {
  it("counts plain text", () => {
    expect(postLength("")).toBe(0);
    expect(postLength("hello")).toBe(5);
  });

  /* Counting UTF-16 units would make one emoji cost two characters, which is
     visible and wrong the first time someone uses one. */
  it("counts an emoji as one character, not two", () => {
    expect(postLength("🚀")).toBe(1);
    expect(postLength("ship 🚀")).toBe(6);
  });
});

describe("the hard limit", () => {
  const long = "a".repeat(HARD_LIMIT + 40);

  it("cannot be exceeded", () => {
    expect(postLength(clampToHardLimit(long))).toBe(HARD_LIMIT);
    expect(isOverHardLimit(clampToHardLimit(long))).toBe(false);
  });

  it("leaves anything inside it untouched", () => {
    const fine = "a".repeat(HARD_LIMIT);
    expect(clampToHardLimit(fine)).toBe(fine);
    expect(clampToHardLimit("short")).toBe("short");
  });

  it("does not split an emoji in half when it truncates", () => {
    const text = "a".repeat(HARD_LIMIT - 1) + "🚀🚀";
    const clamped = clampToHardLimit(text);
    expect(postLength(clamped)).toBe(HARD_LIMIT);
    expect(clamped.endsWith("🚀")).toBe(true);
    // A naive slice would leave a lone surrogate, which renders as a box.
    expect(clamped).not.toContain("🚀\uD83D");
  });

  it("is above the soft default, so the target is always reachable", () => {
    expect(DEFAULT_SOFT_LIMIT).toBeLessThan(HARD_LIMIT);
  });
});

describe("softLimitOf", () => {
  it("prefers the item's own limit", () => {
    expect(softLimitOf({ charLimit: 200 }, 150)).toBe(200);
  });

  it("falls back when there is none, or it makes no sense", () => {
    expect(softLimitOf({}, 150)).toBe(150);
    expect(softLimitOf({ charLimit: 0 }, 150)).toBe(150);
    expect(softLimitOf({ charLimit: -5 }, 150)).toBe(150);
  });
});
