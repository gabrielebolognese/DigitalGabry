import { describe, expect, it } from "vitest";
import {
  DEFAULT_HOUR_HEIGHT,
  DEFAULT_TZ,
  HOUR_HEIGHTS,
  MINUTES_PER_DAY,
  daysOfWeek,
  formatTime,
  isSameLocalDay,
  localMinutesOfDay,
  minutesToPixels,
  minutesWithinDay,
  pixelsToMinutes,
  rangesOverlap,
  snapToGrid,
  startOfLocalDay,
  utcFromDayMinutes,
  weekRange,
  zoomBy,
} from "./time";

const utc = (iso: string): number => new Date(iso).getTime();

describe("weekRange", () => {
  it("starts on Monday local time", () => {
    // 2026-07-31 is a Friday.
    const { start, end } = weekRange(utc("2026-07-31T12:00:00Z"), DEFAULT_TZ);
    expect(formatTime(start, DEFAULT_TZ)).toBe("00:00");
    expect(new Date(start).toISOString()).toBe("2026-07-26T22:00:00.000Z");
    expect(end - start).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("yields seven day starts, each at local midnight", () => {
    const days = daysOfWeek(utc("2026-07-31T12:00:00Z"), DEFAULT_TZ);
    expect(days).toHaveLength(7);
    for (const day of days) {
      expect(localMinutesOfDay(day, DEFAULT_TZ)).toBe(0);
    }
  });
});

describe("localMinutesOfDay", () => {
  it("returns wall clock minutes in the given zone", () => {
    // 07:30 UTC is 09:30 in Rome during summer time.
    expect(localMinutesOfDay(utc("2026-07-31T07:30:00Z"), DEFAULT_TZ)).toBe(
      9 * 60 + 30,
    );
  });

  it("tracks the zone rather than UTC across a DST boundary", () => {
    // Rome is UTC+1 in winter and UTC+2 in summer, so the same wall clock hour
    // has a different UTC instant on either side of the change.
    const winter = localMinutesOfDay(utc("2026-01-15T08:00:00Z"), DEFAULT_TZ);
    const summer = localMinutesOfDay(utc("2026-07-15T07:00:00Z"), DEFAULT_TZ);
    expect(winter).toBe(9 * 60);
    expect(summer).toBe(9 * 60);
  });
});

describe("minutesWithinDay", () => {
  const day = {
    start: startOfLocalDay(utc("2026-07-31T12:00:00Z"), DEFAULT_TZ),
    end: startOfLocalDay(utc("2026-08-01T12:00:00Z"), DEFAULT_TZ),
  };

  it("clamps a block starting before the day to the top", () => {
    expect(minutesWithinDay(day.start - 60_000, day, DEFAULT_TZ)).toBe(0);
  });

  it("clamps a block ending after the day to the bottom", () => {
    expect(minutesWithinDay(day.end + 60_000, day, DEFAULT_TZ)).toBe(
      MINUTES_PER_DAY,
    );
  });

  it("returns the wall clock offset inside the day", () => {
    expect(minutesWithinDay(utc("2026-07-31T07:30:00Z"), day, DEFAULT_TZ)).toBe(
      9 * 60 + 30,
    );
  });
});

describe("pixel conversion", () => {
  it("round trips minutes through pixels at every zoom step", () => {
    for (const hourHeight of HOUR_HEIGHTS) {
      const pixels = minutesToPixels(90, hourHeight);
      expect(pixelsToMinutes(pixels, hourHeight)).toBeCloseTo(90);
    }
  });

  it("maps one hour to the hour height", () => {
    expect(minutesToPixels(60, DEFAULT_HOUR_HEIGHT)).toBe(DEFAULT_HOUR_HEIGHT);
  });
});

describe("snapToGrid", () => {
  it("snaps to the nearest quarter hour", () => {
    expect(snapToGrid(0)).toBe(0);
    expect(snapToGrid(7)).toBe(0);
    expect(snapToGrid(8)).toBe(15);
    expect(snapToGrid(22)).toBe(15);
    expect(snapToGrid(23)).toBe(30);
    expect(snapToGrid(1439)).toBe(1440);
  });

  it("never produces a value off the grid", () => {
    for (let minute = 0; minute <= MINUTES_PER_DAY; minute += 1) {
      expect(snapToGrid(minute) % 15).toBe(0);
    }
  });
});

describe("zoomBy", () => {
  it("steps through the fixed zoom ladder", () => {
    expect(zoomBy(44, 1)).toBe(72);
    expect(zoomBy(44, -1)).toBe(28);
  });

  it("saturates at both ends rather than wrapping", () => {
    expect(zoomBy(28, -1)).toBe(28);
    expect(zoomBy(120, 1)).toBe(120);
  });
});

describe("rangesOverlap", () => {
  it("treats touching ranges as non overlapping", () => {
    expect(rangesOverlap({ start: 0, end: 10 }, { start: 10, end: 20 })).toBe(false);
  });

  it("detects partial and full containment", () => {
    expect(rangesOverlap({ start: 0, end: 10 }, { start: 5, end: 20 })).toBe(true);
    expect(rangesOverlap({ start: 0, end: 30 }, { start: 5, end: 10 })).toBe(true);
  });
});

describe("utcFromDayMinutes", () => {
  it("round trips through localMinutesOfDay", () => {
    const day = startOfLocalDay(utc("2026-07-31T12:00:00Z"), DEFAULT_TZ);
    for (const minutes of [0, 15, 540, 555, 1230, 1425]) {
      expect(
        localMinutesOfDay(utcFromDayMinutes(day, minutes, DEFAULT_TZ), DEFAULT_TZ),
      ).toBe(minutes);
    }
  });

  it("lands on the wall clock hour across the spring forward day", () => {
    // Rome moves 02:00 to 03:00 on 2026-03-29, making the day 23 hours long.
    const day = startOfLocalDay(utc("2026-03-29T12:00:00Z"), DEFAULT_TZ);
    const nine = utcFromDayMinutes(day, 9 * 60, DEFAULT_TZ);
    expect(localMinutesOfDay(nine, DEFAULT_TZ)).toBe(9 * 60);
    // Adding a plain nine hours of milliseconds would land an hour late.
    expect(localMinutesOfDay(day + 9 * 60 * 60 * 1000, DEFAULT_TZ)).toBe(10 * 60);
  });

  it("lands on the wall clock hour across the autumn back day", () => {
    // Rome repeats 02:00 to 03:00 on 2026-10-25, making the day 25 hours long.
    const day = startOfLocalDay(utc("2026-10-25T12:00:00Z"), DEFAULT_TZ);
    expect(
      localMinutesOfDay(utcFromDayMinutes(day, 9 * 60, DEFAULT_TZ), DEFAULT_TZ),
    ).toBe(9 * 60);
  });
});

describe("isSameLocalDay", () => {
  it("groups instants by zone local day, not by UTC day", () => {
    // 22:30 UTC on 30 July is already 31 July in Rome.
    expect(
      isSameLocalDay(
        utc("2026-07-30T22:30:00Z"),
        utc("2026-07-31T09:00:00Z"),
        DEFAULT_TZ,
      ),
    ).toBe(true);
  });
});
