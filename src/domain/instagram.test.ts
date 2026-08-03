import { describe, expect, it } from "vitest";
import {
  LONG_SECONDS,
  WARN_SECONDS,
  WORDS_PER_SECOND,
  durationTone,
  estimateSeconds,
  formatDuration,
  formatScriptForFilming,
  kindAfter,
  looksLikeUrl,
  newSection,
  nextKind,
  normaliseUrl,
  reorderSections,
  sectionSeconds,
  totalSeconds,
  wordCount,
  type ScriptSection,
} from "./instagram";

const section = (
  id: string,
  text: string,
  overrides: Partial<ScriptSection> = {},
): ScriptSection => ({ id, kind: "body", text, ...overrides });

describe("duration", () => {
  it("estimates at the scripted delivery rate", () => {
    const twentySixWords = Array.from({ length: 26 }, () => "word").join(" ");
    expect(wordCount(twentySixWords)).toBe(26);
    expect(estimateSeconds(twentySixWords)).toBeCloseTo(26 / WORDS_PER_SECOND, 5);
  });

  it("counts nothing as nothing", () => {
    expect(wordCount("")).toBe(0);
    expect(wordCount("   ")).toBe(0);
    expect(estimateSeconds("")).toBe(0);
  });

  it("lets an override win outright", () => {
    expect(sectionSeconds(section("a", "one two three", { seconds: 12 }))).toBe(12);
  });

  /* Zero is a legitimate override, so the check has to be for undefined rather
     than for falsiness. A silent b-roll shot is a real section. */
  it("treats a zero override as an override", () => {
    expect(sectionSeconds(section("a", "several words here", { seconds: 0 }))).toBe(0);
  });

  /* The acceptance criterion. Summed per section, never estimated over the
     joined text, or the header would disagree with the rows. */
  it("totals exactly the sum of the sections, including overrides", () => {
    const sections = [
      section("a", "one two three four five"),
      section("b", "six seven", { seconds: 30 }),
      section("c", "eight nine ten"),
    ];

    const byHand =
      estimateSeconds("one two three four five") + 30 + estimateSeconds("eight nine ten");

    expect(totalSeconds(sections)).toBeCloseTo(byHand, 10);
  });

  it("is zero for an empty script", () => {
    expect(totalSeconds([])).toBe(0);
  });

  it("changes colour past ninety seconds and again past three minutes", () => {
    expect(durationTone(30)).toBe("text-tertiary");
    expect(durationTone(WARN_SECONDS)).toBe("text-tertiary");
    expect(durationTone(WARN_SECONDS + 1)).toBe("text-cat-deadline");
    expect(durationTone(LONG_SECONDS + 1)).toBe("text-cat-build");
  });

  it("formats as minutes and seconds", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(38)).toBe("0:38");
    expect(formatDuration(95)).toBe("1:35");
  });
});

describe("reorderSections", () => {
  const sections = [
    section("a", "first", { seconds: 5 }),
    section("b", "second", { kind: "hook" }),
    section("c", "third", { bRoll: "wide shot" }),
  ];

  /* The acceptance criterion: a per-section override has to survive a move. */
  it("carries the override with the section", () => {
    const moved = reorderSections(sections, 0, 2);
    expect(moved.map((entry) => entry.id)).toEqual(["b", "c", "a"]);
    expect(moved[2]?.seconds).toBe(5);
    expect(totalSeconds(moved)).toBeCloseTo(totalSeconds(sections), 10);
  });

  it("carries the kind and the b-roll too", () => {
    // Moving c to the front gives [c, a, b], so the hook lands at index 2.
    const moved = reorderSections(sections, 2, 0);
    expect(moved.map((entry) => entry.id)).toEqual(["c", "a", "b"]);
    expect(moved[0]?.bRoll).toBe("wide shot");
    expect(moved[2]?.kind).toBe("hook");
  });

  it("does nothing for a move that goes nowhere or out of range", () => {
    for (const [from, to] of [
      [1, 1],
      [-1, 0],
      [0, 9],
      [5, 0],
    ] as const) {
      expect(reorderSections(sections, from, to).map((entry) => entry.id)).toEqual([
        "a",
        "b",
        "c",
      ]);
    }
  });

  it("never loses or duplicates a section", () => {
    for (let from = 0; from < 3; from += 1) {
      for (let to = 0; to < 3; to += 1) {
        const moved = reorderSections(sections, from, to);
        expect(moved).toHaveLength(3);
        expect(new Set(moved.map((entry) => entry.id)).size).toBe(3);
      }
    }
  });
});

describe("kinds", () => {
  it("cycles, so Tab can set the whole structure", () => {
    expect(nextKind("hook")).toBe("context");
    expect(nextKind("cta")).toBe("hook");
  });

  it("starts a script with a hook, then follows the one before", () => {
    expect(kindAfter(undefined)).toBe("hook");
    expect(kindAfter(section("a", "x", { kind: "hook" }))).toBe("context");
    expect(kindAfter(section("a", "x", { kind: "body" }))).toBe("body");
  });

  it("makes an empty section", () => {
    expect(newSection("id", "cta")).toEqual({ id: "id", kind: "cta", text: "" });
  });
});

describe("formatScriptForFilming", () => {
  const payload = {
    idea: "How the scheduling engine works",
    audioNote: "Quiet bed, no vocals",
    script: [
      section("a", "Most calendars store what you decided.", { kind: "hook" }),
      section("b", "This one stores what you always do.", {
        kind: "body",
        bRoll: "screen recording of the grid",
      }),
    ],
  };

  it("labels each section so a place in the script is findable", () => {
    const text = formatScriptForFilming(payload, "Engine explainer");
    expect(text).toContain("HOOK");
    expect(text).toContain("BODY");
    expect(text).toContain("Engine explainer");
  });

  /* Bracketed so it cannot be read aloud by mistake while filming. */
  it("brackets the b-roll", () => {
    expect(formatScriptForFilming(payload, "x")).toContain(
      "[screen recording of the grid]",
    );
  });

  it("carries the estimate and the audio note", () => {
    const text = formatScriptForFilming(payload, "x");
    expect(text).toContain("estimated");
    expect(text).toContain("AUDIO: Quiet bed, no vocals");
  });

  it("marks an empty section rather than leaving a blank", () => {
    expect(formatScriptForFilming({ script: [section("a", "")] }, "x")).toContain("...");
  });

  it("ends with exactly one newline", () => {
    const text = formatScriptForFilming(payload, "x");
    expect(text.endsWith("\n")).toBe(true);
    expect(text.endsWith("\n\n")).toBe(false);
  });

  it("handles an empty payload without throwing", () => {
    expect(() => formatScriptForFilming({}, "")).not.toThrow();
    expect(formatScriptForFilming({}, "")).toContain("Untitled");
  });
});

describe("urls", () => {
  it("accepts what someone actually copies", () => {
    for (const url of [
      "https://instagram.com/reel/abc",
      "instagram.com/reel/abc",
      "www.youtube.com/watch?v=x",
    ]) {
      expect(looksLikeUrl(url)).toBe(true);
    }
  });

  it("refuses prose and anything with a space in it", () => {
    for (const text of ["", "   ", "a note about a video", "hello", "not a url"]) {
      expect(looksLikeUrl(text)).toBe(false);
    }
  });

  it("adds a scheme when there is none, and leaves one that is there", () => {
    expect(normaliseUrl("instagram.com/x")).toBe("https://instagram.com/x");
    expect(normaliseUrl("http://example.com")).toBe("http://example.com");
  });
});
