import { describe, expect, it } from "vitest";
import type { Block } from "../domain/block";
import { DEFAULT_TZ } from "../domain/time";
import {
  groupByMonth,
  monthMarkdown,
  prunableSnapshots,
  snapshotName,
  stableJson,
} from "./format";
import { parseCsv, parseImport, parseMarkdownExport } from "./parse";
import { isNightlyDue } from "../scheduler/tick";

const utc = (iso: string): number => new Date(iso).getTime();

function block(overrides: Partial<Block> & { id: string; startUtc: number }): Block {
  return {
    kind: "task",
    title: "A block",
    description: null,
    endUtc: overrides.startUtc + 60 * 60 * 1000,
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
    sortOrder: 0,
    createdUtc: 0,
    updatedUtc: 0,
    completedUtc: null,
    deletedUtc: null,
    ...overrides,
  };
}

describe("snapshotName", () => {
  it("is dated and sorts by age", () => {
    const early = snapshotName(utc("2026-07-31T01:00:00Z"), DEFAULT_TZ);
    const late = snapshotName(utc("2026-08-01T01:00:00Z"), DEFAULT_TZ);
    expect(early < late).toBe(true);
    expect(early).toMatch(/^digitalgabry-\d{4}-\d{2}-\d{2}-\d{4}\.db$/);
  });
});

describe("prunableSnapshots", () => {
  const names = [
    "digitalgabry-2026-07-01-0300.db",
    "digitalgabry-2026-07-02-0300.db",
    "digitalgabry-2026-07-03-0300.db",
  ];

  it("keeps the newest and drops the oldest", () => {
    expect(prunableSnapshots(names, 2)).toEqual(["digitalgabry-2026-07-01-0300.db"]);
  });

  it("drops nothing when under the retention count", () => {
    expect(prunableSnapshots(names, 30)).toEqual([]);
  });

  it("ignores files that are not snapshots", () => {
    expect(prunableSnapshots([...names, "notes.txt", "digitalgabry.db-wal"], 3)).toEqual([]);
  });
});

describe("stableJson", () => {
  it("sorts keys so insertion order cannot cause a diff", () => {
    expect(stableJson({ b: 1, a: 2 })).toBe(stableJson({ a: 2, b: 1 }));
  });

  it("sorts nested keys too", () => {
    expect(stableJson({ x: { z: 1, y: 2 } })).toBe(stableJson({ x: { y: 2, z: 1 } }));
  });

  it("leaves array order alone, because order is data there", () => {
    expect(stableJson([2, 1])).not.toBe(stableJson([1, 2]));
  });

  it("ends with exactly one newline", () => {
    expect(stableJson({ a: 1 }).endsWith("}\n")).toBe(true);
  });
});

describe("monthMarkdown", () => {
  const blocks = [
    block({ id: "b", startUtc: utc("2026-07-31T08:00:00Z"), title: "Second" }),
    block({ id: "a", startUtc: utc("2026-07-31T07:00:00Z"), title: "First" }),
    block({ id: "c", startUtc: utc("2026-07-30T07:00:00Z"), title: "Earlier day" }),
  ];

  it("is byte identical when the input order changes", () => {
    const forwards = monthMarkdown("2026-07", blocks, DEFAULT_TZ);
    const backwards = monthMarkdown("2026-07", [...blocks].reverse(), DEFAULT_TZ);
    expect(forwards).toBe(backwards);
  });

  it("groups by day in chronological order", () => {
    const output = monthMarkdown("2026-07", blocks, DEFAULT_TZ);
    expect(output.indexOf("## 2026-07-30")).toBeLessThan(output.indexOf("## 2026-07-31"));
    expect(output.indexOf("First")).toBeLessThan(output.indexOf("Second"));
  });

  it("omits deleted blocks", () => {
    const output = monthMarkdown(
      "2026-07",
      [...blocks, block({ id: "d", startUtc: utc("2026-07-31T09:00:00Z"), title: "Gone", deletedUtc: 1 })],
      DEFAULT_TZ,
    );
    expect(output).not.toContain("Gone");
  });

  it("says so when a month is empty", () => {
    expect(monthMarkdown("2026-01", [], DEFAULT_TZ)).toContain("_No blocks this month_");
  });

  it("keeps a pipe in a title from breaking the row", () => {
    const output = monthMarkdown(
      "2026-07",
      [block({ id: "a", startUtc: utc("2026-07-31T07:00:00Z"), title: "a | b" })],
      DEFAULT_TZ,
    );
    expect(output).toContain("a \\| b");
  });

  it("ends with exactly one newline", () => {
    const output = monthMarkdown("2026-07", blocks, DEFAULT_TZ);
    expect(output.endsWith("\n")).toBe(true);
    expect(output.endsWith("\n\n")).toBe(false);
  });
});

describe("groupByMonth", () => {
  it("splits blocks by their local month", () => {
    const months = groupByMonth(
      [
        block({ id: "a", startUtc: utc("2026-07-31T22:30:00Z") }), // 1 Aug in Rome
        block({ id: "b", startUtc: utc("2026-07-15T10:00:00Z") }),
      ],
      DEFAULT_TZ,
    );
    expect([...months.keys()].sort()).toEqual(["2026-07", "2026-08"]);
  });
});

describe("round trip", () => {
  it("re-imports what it exported", () => {
    const original = [
      block({
        id: "a",
        startUtc: utc("2026-07-31T07:00:00Z"),
        title: "Ship the renderer",
        kind: "focus",
        category: "build",
        tags: ["deep"],
      }),
    ];
    const markdown = monthMarkdown("2026-07", original, DEFAULT_TZ);
    const { drafts, errors } = parseMarkdownExport(markdown, DEFAULT_TZ);

    expect(errors).toEqual([]);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].title).toBe("Ship the renderer");
    expect(drafts[0].kind).toBe("focus");
    expect(drafts[0].tags).toEqual(["deep"]);
    expect(drafts[0].startUtc).toBe(original[0].startUtc);
  });
});

describe("parseMarkdownExport, malformed input", () => {
  it("reports a bad row and keeps the good ones", () => {
    const text = [
      "# 2026-07",
      "## 2026-07-31",
      "- 09:00-10:00 | task | build | open | Good one",
      "- this row is nonsense",
      "- 99:99-10:00 | task | build | open | Bad time",
      "- 11:00-12:00 | task | build | open | Also good",
    ].join("\n");

    const { drafts, errors } = parseMarkdownExport(text, DEFAULT_TZ);
    expect(drafts.map((draft) => draft.title)).toEqual(["Good one", "Also good"]);
    expect(errors).toHaveLength(2);
  });

  it("refuses a block that appears before any date heading", () => {
    const { drafts, errors } = parseMarkdownExport(
      "- 09:00-10:00 | task | build | open | Orphan",
      DEFAULT_TZ,
    );
    expect(drafts).toEqual([]);
    expect(errors[0].reason).toContain("before any date heading");
  });

  it("returns nothing at all for unrelated text rather than throwing", () => {
    expect(parseMarkdownExport("just some prose\nand more", DEFAULT_TZ).drafts).toEqual([]);
  });

  it("attaches a description to the preceding block", () => {
    const { drafts } = parseMarkdownExport(
      ["## 2026-07-31", "- 09:00-10:00 | task | build | open | Titled", "  > Some detail"].join("\n"),
      DEFAULT_TZ,
    );
    expect(drafts[0].description).toBe("Some detail");
  });
});

describe("parseCsv", () => {
  it("reads columns by header name, in any order", () => {
    const text = ["kind,title,start,end", "focus,Deep work,2026-07-31 09:00,2026-07-31 11:00"].join("\n");
    const { drafts, errors } = parseCsv(text, DEFAULT_TZ);
    expect(errors).toEqual([]);
    expect(drafts[0].kind).toBe("focus");
    expect(drafts[0].title).toBe("Deep work");
    expect(drafts[0].endUtc).not.toBeNull();
  });

  it("handles quoted fields containing commas", () => {
    const text = ['title,start', '"Plan, then build",2026-07-31 09:00'].join("\n");
    expect(parseCsv(text, DEFAULT_TZ).drafts[0].title).toBe("Plan, then build");
  });

  it("gives an unfinished row an hour rather than a null end", () => {
    const { drafts } = parseCsv("title,start\nNo end,2026-07-31 09:00", DEFAULT_TZ);
    expect(drafts[0].endUtc).toBe((drafts[0].startUtc ?? 0) + 3_600_000);
  });

  it("leaves a block unscheduled when it has no start", () => {
    const { drafts } = parseCsv("title\nSomeday", DEFAULT_TZ);
    expect(drafts[0].startUtc).toBeNull();
  });

  it("rejects a file with no title column instead of importing junk", () => {
    const { drafts, errors } = parseCsv("foo,bar\n1,2", DEFAULT_TZ);
    expect(drafts).toEqual([]);
    expect(errors[0].reason).toContain("title column");
  });

  it("skips a row with an unreadable start and keeps the rest", () => {
    const text = ["title,start", "Bad,not-a-date", "Good,2026-07-31 09:00"].join("\n");
    const { drafts, errors } = parseCsv(text, DEFAULT_TZ);
    expect(drafts.map((draft) => draft.title)).toEqual(["Good"]);
    expect(errors).toHaveLength(1);
  });
});

describe("isNightlyDue", () => {
  // 02:00 and 04:00 Rome on the same local day.
  const before3am = utc("2026-07-31T00:00:00Z");
  const after3am = utc("2026-07-31T02:00:00Z");

  it("holds off before 03:00 local", () => {
    expect(isNightlyDue(before3am, null, DEFAULT_TZ)).toBe(false);
  });

  it("runs after 03:00 when it has never run", () => {
    expect(isNightlyDue(after3am, null, DEFAULT_TZ)).toBe(true);
  });

  it("does not run twice on the same local day", () => {
    expect(isNightlyDue(after3am, after3am, DEFAULT_TZ)).toBe(false);
  });

  it("catches up when the machine was asleep for days", () => {
    const lastWeek = utc("2026-07-24T02:00:00Z");
    expect(isNightlyDue(after3am, lastWeek, DEFAULT_TZ)).toBe(true);
  });

  it("compares local days, not UTC days", () => {
    // Both instants are 1 August in Rome, but they fall on different UTC
    // days: 22:00Z on 31 July is already 00:00 on 1 August local. Comparing
    // UTC dates would call this due and run the job twice in one night.
    const lastRun = utc("2026-07-31T22:00:00Z");
    const now = utc("2026-08-01T02:00:00Z");
    expect(isNightlyDue(now, lastRun, DEFAULT_TZ)).toBe(false);
  });

  it("is due once the local day actually rolls over", () => {
    const lastRun = utc("2026-07-31T02:00:00Z");
    const now = utc("2026-08-01T02:00:00Z");
    expect(isNightlyDue(now, lastRun, DEFAULT_TZ)).toBe(true);
  });
});

describe("parseImport", () => {
  it("picks the parser from the file extension", () => {
    expect(parseImport("title\nX", "blocks.csv", DEFAULT_TZ).drafts).toHaveLength(1);
    expect(parseImport("title\nX", "blocks.md", DEFAULT_TZ).drafts).toHaveLength(0);
  });

  it("never throws on binary-ish rubbish", () => {
    expect(() => parseImport(" ", "x.md", DEFAULT_TZ)).not.toThrow();
    expect(() => parseImport(" ", "x.csv", DEFAULT_TZ)).not.toThrow();
  });
});
