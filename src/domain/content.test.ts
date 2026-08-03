import { describe, expect, it } from "vitest";
import {
  CONTENT_STATUSES,
  activityTypeNameFor,
  compareContent,
  isUnfinished,
  newContentItem,
  statusesFor,
  type ContentItem,
  type ContentPlatform,
} from "./content";

function item(overrides: Partial<ContentItem> & { id: string }): ContentItem {
  return {
    ...newContentItem({ id: overrides.id, platform: "x", nowUtc: 0 }),
    ...overrides,
  };
}

describe("statusesFor", () => {
  it("gives X and LinkedIn the six shared states only", () => {
    expect(statusesFor("x")).toEqual([
      "idea",
      "draft",
      "ready",
      "scheduled",
      "posted",
      "archived",
    ]);
    expect(statusesFor("linkedin")).toEqual(statusesFor("x"));
  });

  it("adds the production states where something is produced first", () => {
    for (const platform of ["instagram", "youtube"] as const) {
      const statuses = statusesFor(platform);
      expect(statuses).toContain("scripted");
      expect(statuses).toContain("filmed");
      expect(statuses).toContain("edited");
    }
  });

  it("keeps them in pipeline order rather than declaration order", () => {
    const statuses = statusesFor("instagram");
    expect(statuses.indexOf("draft")).toBeLessThan(statuses.indexOf("scripted"));
    expect(statuses.indexOf("edited")).toBeLessThan(statuses.indexOf("ready"));
    expect(statuses.indexOf("posted")).toBeLessThan(statuses.indexOf("archived"));
  });

  it("never invents a status outside the union", () => {
    for (const platform of ["x", "linkedin", "instagram", "youtube"] as const) {
      for (const status of statusesFor(platform)) {
        expect(CONTENT_STATUSES).toContain(status);
      }
    }
  });
});

describe("isUnfinished", () => {
  it("counts only idea and draft, which is what the tab badge shows", () => {
    expect(isUnfinished("idea")).toBe(true);
    expect(isUnfinished("draft")).toBe(true);
    for (const status of ["ready", "scheduled", "posted", "archived"] as const) {
      expect(isUnfinished(status)).toBe(false);
    }
  });
});

describe("activityTypeNameFor", () => {
  /* Spec2 section 6. Every name here has to exist in the seed from 001_init,
     or completing a post logs nothing at all. */
  it("maps each platform to a seeded activity type", () => {
    const cases: [ContentPlatform, Record<string, unknown>, string][] = [
      ["x", {}, "X post"],
      ["linkedin", {}, "LinkedIn post"],
      ["youtube", {}, "YouTube long form"],
      ["instagram", {}, "Instagram reel"],
      ["instagram", { format: "reel" }, "Instagram reel"],
      ["instagram", { format: "story" }, "Instagram story"],
      ["instagram", { format: "carousel" }, "Instagram reel"],
    ];

    for (const [platform, payload, expected] of cases) {
      expect(activityTypeNameFor(item({ id: "a", platform, payload }))).toBe(expected);
    }
  });
});

describe("compareContent", () => {
  const noStart = (): number | null => null;

  it("puts the most recently updated first", () => {
    const older = item({ id: "a", updatedUtc: 100 });
    const newer = item({ id: "b", updatedUtc: 200 });
    expect([older, newer].sort((l, r) => compareContent(l, r, "updated", noStart))).toEqual([
      newer,
      older,
    ]);
  });

  it("breaks ties on id, so an equal pair never reshuffles between renders", () => {
    const left = item({ id: "a", updatedUtc: 100 });
    const right = item({ id: "b", updatedUtc: 100 });
    expect(compareContent(left, right, "updated", noStart)).toBeLessThan(0);
    expect(compareContent(right, left, "updated", noStart)).toBeGreaterThan(0);
  });

  it("orders by the pipeline when sorting on status", () => {
    const posted = item({ id: "a", status: "posted" });
    const idea = item({ id: "b", status: "idea" });
    expect(compareContent(idea, posted, "status", noStart)).toBeLessThan(0);
  });

  it("sorts unscheduled items last, so the column reads as a timeline", () => {
    const scheduled = item({ id: "a" });
    const loose = item({ id: "b" });
    const startOf = (candidate: ContentItem): number | null =>
      candidate.id === "a" ? 500 : null;

    expect(compareContent(scheduled, loose, "scheduled", startOf)).toBeLessThan(0);
    expect(compareContent(loose, scheduled, "scheduled", startOf)).toBeGreaterThan(0);
  });

  it("is a total order, so Array.sort cannot produce a different result per run", () => {
    const items = [
      item({ id: "a", updatedUtc: 3 }),
      item({ id: "b", updatedUtc: 1 }),
      item({ id: "c", updatedUtc: 3 }),
      item({ id: "d", updatedUtc: 2 }),
    ];
    const forwards = [...items].sort((l, r) => compareContent(l, r, "updated", noStart));
    const backwards = [...items]
      .reverse()
      .sort((l, r) => compareContent(l, r, "updated", noStart));
    expect(forwards.map((entry) => entry.id)).toEqual(backwards.map((entry) => entry.id));
  });
});
