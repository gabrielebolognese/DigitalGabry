/* Spec1.1 section 8. Rules have history: changing your Monday schedule must not
   rewrite what last month looked like.

   Every edit that changes emitted output opens a new version rather than
   mutating the existing row, and generation picks the version whose validity
   range contains the date being generated. Versions are never deleted, only
   closed. Invariant 21. */

export type Versioned = {
  readonly id: string;
  readonly version: number;
  readonly validFrom: number | null;
  readonly validTo: number | null;
};

export type SaveMode = "from-today" | "all-time" | "date-range";

export function coversInstant(row: Versioned, atUtc: number): boolean {
  if (row.validFrom !== null && atUtc < row.validFrom) return false;
  if (row.validTo !== null && atUtc >= row.validTo) return false;
  return true;
}

/* The version in force at an instant. Highest version wins where more than one
   covers it, which cannot happen after a well formed save but is the safe
   reading if the table is ever repaired by hand. */
export function versionAt<T extends Versioned>(
  versions: readonly T[],
  atUtc: number,
): T | null {
  let best: T | null = null;
  for (const row of versions) {
    if (!coversInstant(row, atUtc)) continue;
    if (best === null || row.version > best.version) best = row;
  }
  return best;
}

export function latestVersion<T extends Versioned>(versions: readonly T[]): T | null {
  let best: T | null = null;
  for (const row of versions) {
    if (best === null || row.version > best.version) best = row;
  }
  return best;
}

/* Edge case 16: overlapping versions are impossible, because saving one closes
   the other at the same instant. This is the check that proves it, used by the
   repository after every save and by the tests. */
export function findOverlap<T extends Versioned>(
  versions: readonly T[],
): { left: T; right: T } | null {
  const open = versions.filter((row) => row.validTo === null);
  if (open.length > 1) {
    return { left: open[0] as T, right: open[1] as T };
  }

  const sorted = [...versions].sort(
    (left, right) => (left.validFrom ?? -Infinity) - (right.validFrom ?? -Infinity),
  );

  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    if (previous === undefined || current === undefined) continue;
    if (previous.validTo === null) return { left: previous, right: current };
    if (current.validFrom !== null && current.validFrom < previous.validTo) {
      return { left: previous, right: current };
    }
  }

  return null;
}

export type SavePlan<T extends Versioned> = {
  /* Rows whose validity changed, to be updated in place. */
  readonly closed: readonly T[];
  /* The new row to insert, or null when the mode mutates history instead. */
  readonly inserted: T | null;
  /* Rows to rewrite wholesale, used only by all-time. */
  readonly rewritten: readonly T[];
};

export type SaveRequest<T extends Versioned> = {
  readonly existing: readonly T[];
  /* Everything about the new version except its identity and validity, which
     this function owns. */
  readonly next: Omit<T, "version" | "validFrom" | "validTo">;
  readonly mode: SaveMode;
  readonly atUtc: number;
  readonly range?: { from: number; to: number };
};

function withVersion<T extends Versioned>(
  base: Omit<T, "version" | "validFrom" | "validTo">,
  version: number,
  validFrom: number | null,
  validTo: number | null,
): T {
  return { ...base, version, validFrom, validTo } as T;
}

/* The three save modes from Spec1.1 section 8, mirroring the recurring block
   edit prompt so the two feel like the same decision. */
export function planSave<T extends Versioned>(request: SaveRequest<T>): SavePlan<T> {
  const { existing, next, mode, atUtc } = request;
  const highest = existing.reduce((max, row) => Math.max(max, row.version), 0);

  if (mode === "all-time") {
    /* Mutates in place, rewriting history. The caller is required to confirm
       this with a count of how many past slots change, which is why it does
       not silently open a version instead. */
    const rewritten = existing.map((row) =>
      withVersion<T>(next, row.version, row.validFrom, row.validTo),
    );
    return { closed: [], inserted: null, rewritten };
  }

  if (mode === "date-range") {
    const range = request.range;
    if (range === undefined || range.to <= range.from) {
      return { closed: [], inserted: null, rewritten: [] };
    }

    /* A bounded version leaving earlier and later ones intact. Anything open
       across the range is closed at its start so the two cannot overlap. */
    const closed = existing
      .filter((row) => row.validTo === null || row.validTo > range.from)
      .filter((row) => row.validFrom === null || row.validFrom < range.to)
      .map((row) => ({ ...row, validTo: range.from }) as T);

    return {
      closed,
      inserted: withVersion<T>(next, highest + 1, range.from, range.to),
      rewritten: [],
    };
  }

  /* from-today: close whatever is open at the cut and open a new version
     there. The default, and almost always what was meant. */
  const closed = existing
    .filter((row) => row.validTo === null || row.validTo > atUtc)
    .filter((row) => row.validFrom === null || row.validFrom < atUtc)
    .map((row) => ({ ...row, validTo: atUtc }) as T);

  return {
    closed,
    inserted: withVersion<T>(next, highest + 1, atUtc, null),
    rewritten: [],
  };
}

/* Applies a plan to a list, for tests and for anything reasoning about the
   result before it touches the database. */
export function applyPlan<T extends Versioned>(
  existing: readonly T[],
  plan: SavePlan<T>,
): T[] {
  if (plan.rewritten.length > 0) return [...plan.rewritten];

  const closedById = new Map(plan.closed.map((row) => [row.version, row]));
  const out = existing.map((row) => closedById.get(row.version) ?? row);
  if (plan.inserted !== null) out.push(plan.inserted);
  return out.sort((left, right) => left.version - right.version);
}
