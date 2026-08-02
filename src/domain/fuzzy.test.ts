import { describe, expect, it } from "vitest";
import { fuzzyMatch, fuzzyRank } from "./fuzzy";

describe("fuzzyMatch", () => {
  it("matches an initialism spread through the label", () => {
    expect(fuzzyMatch("gtm", "Go to momentum")).not.toBeNull();
  });

  it("returns null when a character is missing", () => {
    expect(fuzzyMatch("gtz", "Go to momentum")).toBeNull();
  });

  it("returns null when the characters are present but out of order", () => {
    expect(fuzzyMatch("mog", "Go to momentum")).toBeNull();
  });

  it("is case insensitive both ways", () => {
    expect(fuzzyMatch("GTM", "go to momentum")).not.toBeNull();
    expect(fuzzyMatch("gtm", "GO TO MOMENTUM")).not.toBeNull();
  });

  it("treats a space in the query as a separator, not a character to find", () => {
    const spaced = fuzzyMatch("go mo", "Go to momentum");
    const tight = fuzzyMatch("gomo", "Go to momentum");
    expect(spaced).not.toBeNull();
    expect(spaced?.score).toBe(tight?.score);
  });

  it("an empty query matches everything, so the palette opens with a full list", () => {
    expect(fuzzyMatch("", "anything at all")).toEqual({ score: 0, positions: [] });
  });

  it("reports where it matched, in ascending order", () => {
    const match = fuzzyMatch("gtm", "Go to momentum");
    expect(match?.positions).toEqual([0, 3, 6]);
  });

  it("scores a consecutive run above the same letters scattered", () => {
    const run = fuzzyMatch("mom", "momentum");
    const scattered = fuzzyMatch("mom", "m o m");
    expect(run?.score).toBeGreaterThan(scattered?.score ?? Infinity);
  });

  it("scores a word start above a mid-word match", () => {
    const wordStart = fuzzyMatch("b", "go back");
    const midWord = fuzzyMatch("b", "abbey");
    expect(wordStart?.score).toBeGreaterThan(midWord?.score ?? Infinity);
  });

  it("never throws on regex-significant input", () => {
    for (const query of ["(", ".*", "\\", "[a-z]", "$^", '"']) {
      expect(() => fuzzyMatch(query, "Go to momentum")).not.toThrow();
    }
  });
});

describe("fuzzyRank", () => {
  const commands = ["Go to calendar", "Go to momentum", "Go to settings", "Back up now"];

  it("drops what does not match at all", () => {
    expect(fuzzyRank("zzz", commands, (item) => item)).toEqual([]);
  });

  it("puts the closest label first", () => {
    expect(fuzzyRank("moment", commands, (item) => item)[0]).toBe("Go to momentum");
    expect(fuzzyRank("backup", commands, (item) => item)[0]).toBe("Back up now");
  });

  it("keeps the authored order when the query is empty", () => {
    expect(fuzzyRank("", commands, (item) => item)).toEqual(commands);
  });

  it("prefers the shorter of two labels that both contain the query", () => {
    const ranked = fuzzyRank("cal", ["Go to calendar", "Calendar"], (item) => item);
    expect(ranked[0]).toBe("Calendar");
  });
});
