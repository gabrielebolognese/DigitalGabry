import { describe, expect, it } from "vitest";
import {
  CONTEXT_TOKEN_CAP,
  estimateTokens,
  serialiseContext,
  type ContextInput,
} from "./context";
import type { CalendarEntry } from "../domain/block";
import type { MomentumDay } from "../domain/momentum";
import { DEFAULT_TZ } from "../domain/time";

const NOW = new Date("2026-07-31T10:00:00Z").getTime();
const HOUR = 60 * 60 * 1000;

function entry(index: number, startUtc: number, description = ""): CalendarEntry {
  return {
    id: `block-${index}`,
    entryId: `entry-${index}`,
    occurrenceStartUtc: null,
    kind: "task",
    title: `Block number ${index} with a reasonably long title`,
    description: description === "" ? null : description,
    startUtc,
    endUtc: startUtc + HOUR,
    tz: DEFAULT_TZ,
    allDay: false,
    status: "open",
    category: "build",
    projectId: null,
    tags: [],
    rrule: null,
    recurrenceParentId: null,
    exceptionRole: "none",
    recurrenceOriginalStartUtc: null,
    payload: {},
    sortOrder: index,
    createdUtc: NOW,
    updatedUtc: NOW,
    completedUtc: null,
    deletedUtc: null,
  };
}

function momentumDays(count: number): MomentumDay[] {
  return Array.from({ length: count }, (_, index) => ({
    localDate: `2026-07-${String(index + 1).padStart(2, "0")}`,
    rawScore: 16,
    multiplier: 1.3,
    momentum: 200 + index,
    streak: index,
  }));
}

/* A week far denser than a real one: 300 blocks, every one carrying a long
   description, plus a long overdue tail. */
function densePayload(): ContextInput {
  const start = new Date("2026-07-27T00:00:00Z").getTime();
  const longDescription = "This description exists purely to bloat the payload. ".repeat(12);

  const entries = Array.from({ length: 300 }, (_, index) =>
    entry(index, start + index * HOUR, longDescription),
  );

  return {
    entries,
    momentum: momentumDays(30),
    range: { start, end: start + 7 * 24 * HOUR },
    nowUtc: NOW,
    tz: DEFAULT_TZ,
  };
}

describe("estimateTokens", () => {
  it("is pessimistic rather than optimistic", () => {
    // 340 characters of dense JSON is nearer 85 real tokens; the estimate
    // deliberately reports more so the cap is approached from the safe side.
    expect(estimateTokens("x".repeat(340))).toBe(100);
  });
});

describe("serialiseContext", () => {
  it("stays under the cap on a densely seeded week", () => {
    const result = serialiseContext(densePayload());
    expect(result.tokens).toBeLessThanOrEqual(CONTEXT_TOKEN_CAP);
    expect(result.dropped.length).toBeGreaterThan(0);
  });

  it("still emits parseable JSON after truncating", () => {
    const result = serialiseContext(densePayload());
    const parsed: unknown = JSON.parse(result.json);
    expect(parsed).toBeTypeOf("object");
  });

  it("reports what it dropped rather than truncating silently", () => {
    const result = serialiseContext(densePayload());
    expect(result.dropped[0]).toBe("descriptions");
  });

  it("keeps everything when the week is small", () => {
    const start = new Date("2026-07-27T00:00:00Z").getTime();
    const result = serialiseContext({
      entries: [entry(1, start + 40 * HOUR)],
      momentum: momentumDays(7),
      range: { start, end: start + 7 * 24 * HOUR },
      nowUtc: NOW,
      tz: DEFAULT_TZ,
    });
    expect(result.dropped).toEqual([]);
    expect(result.tokens).toBeLessThan(CONTEXT_TOKEN_CAP);
  });

  it("separates today from the rest of the week", () => {
    const todayStart = new Date("2026-07-31T08:00:00Z").getTime();
    const otherDay = new Date("2026-07-29T08:00:00Z").getTime();
    const result = serialiseContext({
      entries: [entry(1, todayStart), entry(2, otherDay)],
      momentum: [],
      range: { start: otherDay - HOUR, end: todayStart + HOUR },
      nowUtc: NOW,
      tz: DEFAULT_TZ,
    });
    const parsed = JSON.parse(result.json) as { today: unknown[]; week: unknown[] };
    expect(parsed.today).toHaveLength(1);
    expect(parsed.week).toHaveLength(1);
  });

  it("caps momentum at the last seven days", () => {
    const start = new Date("2026-07-27T00:00:00Z").getTime();
    const result = serialiseContext({
      entries: [],
      momentum: momentumDays(30),
      range: { start, end: start + 7 * 24 * HOUR },
      nowUtc: NOW,
      tz: DEFAULT_TZ,
    });
    const parsed = JSON.parse(result.json) as { momentum: unknown[] };
    expect(parsed.momentum).toHaveLength(7);
  });

  it("never sends the whole entry, only the fields the panel needs", () => {
    const start = new Date("2026-07-31T08:00:00Z").getTime();
    const result = serialiseContext({
      entries: [entry(1, start)],
      momentum: [],
      range: { start, end: start + HOUR },
      nowUtc: NOW,
      tz: DEFAULT_TZ,
    });
    expect(result.json).not.toContain("createdUtc");
    expect(result.json).not.toContain("sortOrder");
    expect(result.json).not.toContain("block-1");
  });
});
