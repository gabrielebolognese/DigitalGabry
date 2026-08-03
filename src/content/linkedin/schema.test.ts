import { describe, expect, it } from "vitest";
import {
  LINKEDIN_LAYOUTS,
  linkedInImageSpecSchema,
  parseSpec,
  stripFences,
  templatesFor,
  type LinkedInImageSpec,
} from "./schema";
import { DEFAULT_PROMPT, promptHashOf } from "./prompt";

const valid: LinkedInImageSpec = {
  headline: "The engine got seventeen times faster",
  eyebrow: "PERFORMANCE",
  accent: "amber",
  layout: "metric",
  metric: { value: "15.7ms", label: "ninety days, twenty rules" },
};

describe("the character limits", () => {
  /* Spec2 3.3. These are what stop the single most common failure, a headline
     that overflows its box. A model asked nicely for sixty characters gives
     you seventy-four often enough to matter. */
  it("accepts a spec inside every limit", () => {
    expect(linkedInImageSpecSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects a headline one character over", () => {
    const over = { ...valid, headline: "a".repeat(61) };
    expect(linkedInImageSpecSchema.safeParse(over).success).toBe(false);
  });

  it("rejects an over-long eyebrow, subheadline, bullet and badge", () => {
    const cases: Partial<LinkedInImageSpec>[] = [
      { eyebrow: "a".repeat(25) },
      { subheadline: "a".repeat(91) },
      { bullets: ["a".repeat(49)] },
      { badge: "a".repeat(17) },
    ];
    for (const patch of cases) {
      expect(linkedInImageSpecSchema.safeParse({ ...valid, ...patch }).success).toBe(false);
    }
  });

  it("caps the number of bullets and code lines", () => {
    expect(
      linkedInImageSpecSchema.safeParse({ ...valid, bullets: ["a", "b", "c", "d", "e"] })
        .success,
    ).toBe(false);
    expect(
      linkedInImageSpecSchema.safeParse({
        ...valid,
        codeSnippet: { language: "ts", lines: Array.from({ length: 9 }, () => "x") },
      }).success,
    ).toBe(false);
  });

  it("requires a headline and refuses an empty one", () => {
    expect(linkedInImageSpecSchema.safeParse({ ...valid, headline: "" }).success).toBe(false);
    const { headline: _headline, ...without } = valid;
    expect(linkedInImageSpecSchema.safeParse(without).success).toBe(false);
  });

  it("refuses a layout or accent it does not know", () => {
    expect(linkedInImageSpecSchema.safeParse({ ...valid, layout: "carousel" }).success).toBe(
      false,
    );
    expect(linkedInImageSpecSchema.safeParse({ ...valid, accent: "pink" }).success).toBe(
      false,
    );
  });
});

describe("stripFences", () => {
  /* Models return fenced JSON often enough that stripping is not optional,
     however firmly the prompt says not to. */
  it("unwraps a fenced block", () => {
    expect(stripFences('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(stripFences('```\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it("leaves bare JSON alone", () => {
    expect(stripFences('{"a":1}')).toBe('{"a":1}');
  });

  it("recovers an object from a sentence wrapped around it", () => {
    expect(stripFences('Here you go: {"a":1} hope that helps')).toBe('{"a":1}');
  });
});

describe("parseSpec", () => {
  it("accepts a good response", () => {
    const result = parseSpec(JSON.stringify(valid));
    expect(result.ok).toBe(true);
  });

  it("names the field and the overshoot, so the retry can fix it", () => {
    const result = parseSpec(JSON.stringify({ ...valid, headline: "a".repeat(70) }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("headline");
    expect(result.error).toContain("60");
  });

  /* Invariant 13: never swallowed, never silently defaulted. The raw output
     travels with the failure or there is nothing to repair by hand. */
  it("keeps the raw output on a failure", () => {
    const result = parseSpec("this is not json at all");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.raw).toBe("this is not json at all");
    expect(result.error).toContain("not valid JSON");
  });

  it("does not throw on anything, however malformed", () => {
    for (const bad of ["", "null", "[]", "{", '{"headline":', "🚀"]) {
      expect(() => parseSpec(bad)).not.toThrow();
      expect(parseSpec(bad).ok).toBe(false);
    }
  });
});

describe("templatesFor", () => {
  it("leads with the layout the model chose", () => {
    expect(templatesFor(valid)[0]).toBe("metric");
  });

  it("offers three plausible variants, never duplicates", () => {
    const layouts = templatesFor({
      ...valid,
      layout: "headline",
      bullets: ["one", "two"],
      codeSnippet: { language: "ts", lines: ["const a = 1"] },
    });
    expect(layouts).toHaveLength(3);
    expect(new Set(layouts).size).toBe(3);
    for (const layout of layouts) expect(LINKEDIN_LAYOUTS).toContain(layout);
  });

  it("always has something to fall back on", () => {
    const layouts = templatesFor({ headline: "x", accent: "neutral", layout: "headline" });
    expect(layouts.length).toBeGreaterThan(0);
  });
});

describe("the prompt", () => {
  it("states the limits the schema enforces, so the model is asked for what is accepted", () => {
    for (const limit of ["60", "24", "90", "48", "52", "30", "16"]) {
      expect(DEFAULT_PROMPT).toContain(limit);
    }
  });

  it("asks for JSON only, since fences are stripped defensively anyway", () => {
    expect(DEFAULT_PROMPT).toContain("ONLY a JSON object");
    expect(DEFAULT_PROMPT).toContain("no markdown fences");
  });

  it("hashes stably, so an image can be traced to the prompt that made it", () => {
    expect(promptHashOf(DEFAULT_PROMPT)).toBe(promptHashOf(DEFAULT_PROMPT));
    expect(promptHashOf(DEFAULT_PROMPT)).not.toBe(promptHashOf(`${DEFAULT_PROMPT} edited`));
  });
});
