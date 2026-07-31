import { describe, expect, it } from "vitest";
import { MAX_COLUMNS, densityFor, layoutDay, type Span } from "./layout";

const span = (startMin: number, endMin: number): Span => ({ startMin, endMin });

describe("densityFor", () => {
  it("uses the tiers from SPEC 5.1", () => {
    expect(densityFor(27)).toBe("compact");
    expect(densityFor(28)).toBe("standard");
    expect(densityFor(56)).toBe("standard");
    expect(densityFor(57)).toBe("expanded");
  });
});

describe("layoutDay", () => {
  it("gives a lone block the full width", () => {
    const { placed, overflow } = layoutDay([span(540, 600)]);
    expect(placed).toHaveLength(1);
    expect(placed[0].placement).toEqual({ column: 0, columns: 1 });
    expect(overflow).toHaveLength(0);
  });

  it("keeps sequential blocks in one column", () => {
    const { placed } = layoutDay([span(540, 600), span(600, 660), span(660, 720)]);
    expect(placed.every((entry) => entry.placement.columns === 1)).toBe(true);
    expect(placed.every((entry) => entry.placement.column === 0)).toBe(true);
  });

  it("splits two overlapping blocks into two columns", () => {
    const { placed } = layoutDay([span(540, 660), span(600, 720)]);
    expect(placed.map((entry) => entry.placement.column).sort()).toEqual([0, 1]);
    expect(placed.every((entry) => entry.placement.columns === 2)).toBe(true);
  });

  it("never assigns two concurrent blocks the same column", () => {
    const items = [span(540, 720), span(560, 700), span(580, 640)];
    const { placed } = layoutDay(items);
    const columns = placed.map((entry) => entry.placement.column);
    expect(new Set(columns).size).toBe(columns.length);
  });

  it("caps at three lanes and reports the rest as overflow", () => {
    const items = [
      span(540, 720),
      span(540, 720),
      span(540, 720),
      span(540, 720),
      span(540, 720),
    ];
    const { placed, overflow } = layoutDay(items);
    expect(placed).toHaveLength(MAX_COLUMNS);
    expect(placed.every((entry) => entry.placement.columns === MAX_COLUMNS)).toBe(true);
    expect(overflow).toEqual([{ startMin: 540, endMin: 720, count: 2 }]);
  });

  it("separates clusters that do not touch", () => {
    const { placed, overflow } = layoutDay([
      span(0, 60),
      span(30, 90),
      span(600, 660),
    ]);
    expect(overflow).toHaveLength(0);
    const wide = placed.filter((entry) => entry.placement.columns === 2);
    const solo = placed.filter((entry) => entry.placement.columns === 1);
    expect(wide).toHaveLength(2);
    expect(solo).toHaveLength(1);
  });

  it("reuses a lane once its previous block has ended", () => {
    // Two long blocks plus a short one that starts after the first has ended.
    const { placed, overflow } = layoutDay([
      span(0, 60),
      span(0, 240),
      span(60, 120),
    ]);
    expect(overflow).toHaveLength(0);
    expect(placed.every((entry) => entry.placement.columns === 2)).toBe(true);
  });

  it("does not mutate its input", () => {
    const items = [span(600, 660), span(540, 600)];
    const snapshot = JSON.stringify(items);
    layoutDay(items);
    expect(JSON.stringify(items)).toBe(snapshot);
  });

  it("is deterministic", () => {
    const items = [span(540, 720), span(560, 700), span(580, 640), span(590, 630)];
    expect(JSON.stringify(layoutDay(items))).toBe(JSON.stringify(layoutDay(items)));
  });
});
