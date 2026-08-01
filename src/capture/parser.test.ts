import { describe, expect, it } from "vitest";
import { DEFAULT_CAPTURE_MINUTES, parseCapture } from "./parser";
import { DEFAULT_TZ, formatTime, localMinutesOfDay, wallClockOf } from "../domain/time";

/* Thursday 2026-07-30, 12:00 Rome. */
const NOW = new Date("2026-07-30T10:00:00Z").getTime();

const parse = (input: string) => parseCapture(input, NOW, DEFAULT_TZ);

describe("parseCapture, the cases PLAN names", () => {
  it("post friday 9am linkedin parenting DAG", () => {
    const result = parse("post friday 9am linkedin parenting DAG");
    expect(result.kind).toBe("post");
    expect(result.platform).toBe("linkedin");
    expect(result.title).toBe("parenting DAG");
    expect(result.startUtc).not.toBeNull();
    if (result.startUtc === null) return;
    expect(formatTime(result.startUtc, DEFAULT_TZ)).toBe("09:00");
    // The Friday after Thursday 30 July is 31 July.
    expect(wallClockOf(result.startUtc, DEFAULT_TZ).day).toBe(31);
  });

  it("tomorrow 14:30 gym", () => {
    const result = parse("tomorrow 14:30 gym");
    expect(result.title).toBe("gym");
    expect(result.kind).toBe("task");
    if (result.startUtc === null) throw new Error("expected a time");
    expect(formatTime(result.startUtc, DEFAULT_TZ)).toBe("14:30");
    expect(wallClockOf(result.startUtc, DEFAULT_TZ).day).toBe(31);
  });

  it("!high fix render bug @flashfx", () => {
    const result = parse("!high fix render bug @flashfx");
    expect(result.priority).toBe("high");
    expect(result.projectName).toBe("flashfx");
    expect(result.title).toBe("fix render bug");
    expect(result.startUtc).toBeNull();
  });
});

describe("parseCapture, tokens", () => {
  it("collects several tags", () => {
    expect(parse("write notes #deep #focus").tags).toEqual(["deep", "focus"]);
  });

  it("keeps a bare hash out of the tag list", () => {
    const result = parse("count the # of items");
    expect(result.tags).toEqual([]);
    expect(result.title).toBe("count the # of items");
  });

  it("reads a project", () => {
    expect(parse("ship it @content").projectName).toBe("content");
  });

  it("reads each priority", () => {
    expect(parse("a !low").priority).toBe("low");
    expect(parse("a !normal").priority).toBe("normal");
    expect(parse("a !high").priority).toBe("high");
  });

  it("leaves an unknown bang token in the title", () => {
    const result = parse("ship it !now");
    expect(result.priority).toBeNull();
    expect(result.title).toBe("ship it !now");
  });
});

describe("parseCapture, kind and platform", () => {
  it("reads a leading kind word", () => {
    expect(parse("focus deep work").kind).toBe("focus");
    expect(parse("event standup").kind).toBe("event");
    expect(parse("deadline tax return").kind).toBe("deadline");
  });

  it("does not treat a kind word inside the sentence as the kind", () => {
    const result = parse("write a note about the renderer");
    expect(result.kind).toBe("task");
    expect(result.title).toBe("write a note about the renderer");
  });

  it("infers post from a platform word", () => {
    const result = parse("youtube shipping a renderer");
    expect(result.kind).toBe("post");
    expect(result.platform).toBe("youtube");
  });

  it("keeps an explicit kind over the platform inference", () => {
    const result = parse("task github review the PR");
    expect(result.kind).toBe("task");
    expect(result.platform).toBe("github");
  });

  it("defaults to task", () => {
    expect(parse("buy milk").kind).toBe("task");
  });
});

describe("parseCapture, dates and times", () => {
  it("returns no time at all when none is given, so the block lands in the backlog", () => {
    const result = parse("some day I will do this");
    expect(result.startUtc).toBeNull();
    expect(result.endUtc).toBeNull();
  });

  it("reads today", () => {
    const result = parse("today 16:00 call");
    if (result.startUtc === null) throw new Error("expected a time");
    expect(wallClockOf(result.startUtc, DEFAULT_TZ).day).toBe(30);
    expect(formatTime(result.startUtc, DEFAULT_TZ)).toBe("16:00");
  });

  it("defaults to 09:00 when a day is named without a time", () => {
    const result = parse("tomorrow ship the build");
    if (result.startUtc === null) throw new Error("expected a time");
    expect(localMinutesOfDay(result.startUtc, DEFAULT_TZ)).toBe(9 * 60);
  });

  it("rolls a bare time that has already passed to the next day", () => {
    // 12:00 Rome is 'now', so 09:00 has gone.
    const result = parse("09:00 standup");
    if (result.startUtc === null) throw new Error("expected a time");
    expect(wallClockOf(result.startUtc, DEFAULT_TZ).day).toBe(31);
  });

  it("keeps a bare time later today on today", () => {
    const result = parse("18:00 dinner");
    if (result.startUtc === null) throw new Error("expected a time");
    expect(wallClockOf(result.startUtc, DEFAULT_TZ).day).toBe(30);
  });

  it("reads 12 hour times", () => {
    const morning = parse("tomorrow 7am run");
    const evening = parse("tomorrow 7pm run");
    if (morning.startUtc === null || evening.startUtc === null) throw new Error("no time");
    expect(formatTime(morning.startUtc, DEFAULT_TZ)).toBe("07:00");
    expect(formatTime(evening.startUtc, DEFAULT_TZ)).toBe("19:00");
  });

  it("reads 12am and 12pm correctly", () => {
    const midnight = parse("tomorrow 12am sleep");
    const noon = parse("tomorrow 12pm lunch");
    if (midnight.startUtc === null || noon.startUtc === null) throw new Error("no time");
    expect(formatTime(midnight.startUtc, DEFAULT_TZ)).toBe("00:00");
    expect(formatTime(noon.startUtc, DEFAULT_TZ)).toBe("12:00");
  });

  it("reads a 12 hour time with minutes", () => {
    const result = parse("tomorrow 9:45am triage");
    if (result.startUtc === null) throw new Error("expected a time");
    expect(formatTime(result.startUtc, DEFAULT_TZ)).toBe("09:45");
  });

  it("treats today's weekday as today rather than a week away", () => {
    const result = parse("thursday review");
    if (result.startUtc === null) throw new Error("expected a time");
    expect(wallClockOf(result.startUtc, DEFAULT_TZ).day).toBe(30);
  });

  it("moves a past weekday forward into next week", () => {
    // Wednesday has gone, so it means next Wednesday, 5 August.
    const result = parse("wednesday retro");
    if (result.startUtc === null) throw new Error("expected a time");
    expect(wallClockOf(result.startUtc, DEFAULT_TZ).day).toBe(5);
    expect(wallClockOf(result.startUtc, DEFAULT_TZ).month).toBe(8);
  });

  it("gives the block the default duration", () => {
    const result = parse("tomorrow 10:00 sync");
    if (result.startUtc === null || result.endUtc === null) throw new Error("no time");
    expect(result.endUtc - result.startUtc).toBe(DEFAULT_CAPTURE_MINUTES * 60_000);
  });

  it("rejects an impossible clock reading and keeps it as title text", () => {
    const result = parse("build 25:99 thing");
    expect(result.startUtc).toBeNull();
    expect(result.title).toBe("build 25:99 thing");
  });
});

describe("parseCapture, whole strings", () => {
  it("collapses whitespace in the title", () => {
    expect(parse("   ship    the   build   ").title).toBe("ship the build");
  });

  it("returns an empty title for an empty input without throwing", () => {
    const result = parse("");
    expect(result.title).toBe("");
    expect(result.kind).toBe("task");
  });

  it("handles every token type at once", () => {
    const result = parse("post tomorrow 8:30 instagram #reel #desk @content !high new setup tour");
    expect(result.kind).toBe("post");
    expect(result.platform).toBe("instagram");
    expect(result.tags).toEqual(["reel", "desk"]);
    expect(result.projectName).toBe("content");
    expect(result.priority).toBe("high");
    expect(result.title).toBe("new setup tour");
    if (result.startUtc === null) throw new Error("expected a time");
    expect(formatTime(result.startUtc, DEFAULT_TZ)).toBe("08:30");
  });
});
