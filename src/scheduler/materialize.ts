import {
  generateOccurrences,
  type ExceptionMarker,
} from "../domain/recurrence";
import {
  utcFromWallClock,
  wallClockOf,
  type UtcRange,
} from "../domain/time";
import {
  deleteOccurrenceAt,
  listExceptionsFor,
  listRecurrenceState,
  listRecurringSeeds,
  sweepOccurrences,
  writeOccurrences,
  type OccurrenceBatch,
  type RecurringSeed,
} from "../db/repository";

/* Three months back rather than a purely forward window. Forward only means
   scrolling back one week after app start shows an empty calendar for every
   series, which reads as data loss. */
export const WINDOW_MONTHS_BACK = 3;
export const WINDOW_MONTHS_FORWARD = 15;

/* Anchored to the start of the current local month, so the window is stable for
   the whole session and the fingerprint check below is a real no-op on a warm
   start rather than drifting every millisecond. */
export function recurrenceWindow(nowUtc: number, tz: string): UtcRange {
  const wall = wallClockOf(nowUtc, tz);
  const monthIndex = wall.year * 12 + (wall.month - 1);

  const monthStart = (index: number): number =>
    utcFromWallClock(
      {
        year: Math.floor(index / 12),
        month: (index % 12) + 1,
        day: 1,
        hour: 0,
        minute: 0,
        second: 0,
      },
      tz,
    );

  return {
    start: monthStart(monthIndex - WINDOW_MONTHS_BACK),
    end: monthStart(monthIndex + WINDOW_MONTHS_FORWARD),
  };
}

export function fingerprintOf(seed: RecurringSeed): string {
  return `${seed.rrule}|${seed.startUtc}|${seed.endUtc}|${seed.tz}`;
}

export type MaterializeReport = {
  window: UtcRange;
  considered: number;
  rebuilt: number;
  skipped: number;
  occurrencesWritten: number;
  truncated: string[];
  orphaned: { blockId: string; originalStartUtc: number }[];
  elapsedMs: number;
};

async function buildBatch(
  seed: RecurringSeed,
  window: UtcRange,
  report: MaterializeReport,
): Promise<OccurrenceBatch> {
  const exceptions: ExceptionMarker[] = await listExceptionsFor(seed.id);

  const result = generateOccurrences(
    {
      blockId: seed.id,
      startUtc: seed.startUtc,
      endUtc: seed.endUtc,
      tz: seed.tz,
      rrule: seed.rrule,
    },
    window,
    { exceptions },
  );

  if (result.truncated) report.truncated.push(seed.id);
  for (const orphan of result.orphanedExceptions) {
    report.orphaned.push({
      blockId: seed.id,
      originalStartUtc: orphan.originalStartUtc,
    });
  }

  return {
    blockId: seed.id,
    occurrences: result.occurrences,
    windowStartUtc: window.start,
    windowEndUtc: window.end,
    fingerprint: fingerprintOf(seed),
    truncated: result.truncated,
  };
}

export async function materializeAll(
  nowUtc: number,
  tz: string,
  options: { force?: boolean } = {},
): Promise<MaterializeReport> {
  const began = Date.now();
  const window = recurrenceWindow(nowUtc, tz);

  const report: MaterializeReport = {
    window,
    considered: 0,
    rebuilt: 0,
    skipped: 0,
    occurrencesWritten: 0,
    truncated: [],
    orphaned: [],
    elapsedMs: 0,
  };

  await sweepOccurrences(window);

  const seeds = await listRecurringSeeds();
  report.considered = seeds.length;

  const state = new Map(
    (await listRecurrenceState()).map((row) => [row.blockId, row]),
  );

  const batches: OccurrenceBatch[] = [];

  for (const seed of seeds) {
    const previous = state.get(seed.id);
    const unchanged =
      options.force !== true &&
      previous !== undefined &&
      previous.fingerprint === fingerprintOf(seed) &&
      previous.windowStartUtc === window.start &&
      previous.windowEndUtc === window.end;

    if (unchanged) {
      report.skipped += 1;
      continue;
    }

    const batch = await buildBatch(seed, window, report);
    batches.push(batch);
    report.rebuilt += 1;
    report.occurrencesWritten += batch.occurrences.length;
  }

  await writeOccurrences(batches, Date.now());

  report.elapsedMs = Date.now() - began;
  return report;
}

export async function materializeBlocks(
  blockIds: readonly string[],
  nowUtc: number,
  tz: string,
): Promise<MaterializeReport> {
  const began = Date.now();
  const window = recurrenceWindow(nowUtc, tz);
  const wanted = new Set(blockIds);

  const report: MaterializeReport = {
    window,
    considered: 0,
    rebuilt: 0,
    skipped: 0,
    occurrencesWritten: 0,
    truncated: [],
    orphaned: [],
    elapsedMs: 0,
  };

  const seeds = (await listRecurringSeeds()).filter((seed) => wanted.has(seed.id));
  report.considered = seeds.length;

  const batches: OccurrenceBatch[] = [];
  for (const seed of seeds) {
    const batch = await buildBatch(seed, window, report);
    batches.push(batch);
    report.rebuilt += 1;
    report.occurrencesWritten += batch.occurrences.length;
  }

  await writeOccurrences(batches, Date.now());
  report.elapsedMs = Date.now() - began;
  return report;
}

let lastRunWindowStart: number | null = null;
let inFlight: Promise<MaterializeReport> | null = null;

/* Called on every viewport read. The fingerprint check inside materializeAll
   makes a warm run one SELECT and zero writes, and this collapses concurrent
   callers onto a single pass. It re-runs when the window moves, so a session
   left open past a month boundary does not run off the end of its window. */
export async function ensureMaterialized(
  nowUtc: number,
  tz: string,
): Promise<MaterializeReport | null> {
  const window = recurrenceWindow(nowUtc, tz);
  if (lastRunWindowStart === window.start && inFlight === null) return null;
  if (inFlight !== null) return inFlight;

  lastRunWindowStart = window.start;
  inFlight = materializeAll(nowUtc, tz);
  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

/* Used when a single occurrence gains an exception, so the whole series does
   not have to be regenerated to hide one instant. */
export async function invalidateOccurrence(
  seriesId: string,
  originalStartUtc: number,
): Promise<void> {
  await deleteOccurrenceAt(seriesId, originalStartUtc);
}
