import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DEFAULT_MOMENTUM_CONSTANTS,
  addLocalDays,
  levelFor,
  type LocalDate,
  type MomentumConstants,
  type MomentumDay,
} from "../domain/momentum";
import { localDateOf } from "../domain/time";
import {
  activityTotals,
  insertActivity,
  listActivityTypes,
  readMomentumConstants,
  readMomentumDaily,
  recomputeMomentum,
  writeMomentumConstants,
  type ActivityTotal,
  type ActivityType,
} from "../db/repository";

export type MomentumApi = {
  today: MomentumDay | null;
  series: MomentumDay[];
  types: ActivityType[];
  totals: ActivityTotal[];
  constants: MomentumConstants;
  loading: boolean;
  recomputing: boolean;
  error: Error | null;
  /** Delta against seven days ago, for the header strip. */
  weekDelta: number;
  logOne: (activityTypeId: string) => Promise<void>;
  saveConstants: (next: MomentumConstants) => Promise<void>;
  rebuild: () => Promise<void>;
};

/* Longest window the chart offers, so switching between 30, 90 and 365 never
   has to go back to the database. */
const SERIES_DAYS = 365;

/* The heatmap wants 52 weeks, which is slightly more than the chart. */
const HISTORY_DAYS = 371;

export function useMomentum(tz: string): MomentumApi {
  const [series, setSeries] = useState<MomentumDay[]>([]);
  const [types, setTypes] = useState<ActivityType[]>([]);
  const [totals, setTotals] = useState<ActivityTotal[]>([]);
  const [constants, setConstants] = useState<MomentumConstants>(
    DEFAULT_MOMENTUM_CONSTANTS,
  );
  const [loading, setLoading] = useState(true);
  const [recomputing, setRecomputing] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [token, setToken] = useState(0);

  const today: LocalDate = useMemo(() => localDateOf(Date.now(), tz), [tz, token]);

  const load = useCallback(async () => {
    const from = addLocalDays(today, -HISTORY_DAYS);
    const [loadedTypes, loadedConstants] = await Promise.all([
      listActivityTypes(),
      readMomentumConstants(),
    ]);

    let days = await readMomentumDaily(from, today);
    // momentum_daily is a cache and may simply not exist yet. Rebuilding is
    // cheap and always reproduces the same numbers, so an empty read is not
    // an error state.
    if (days.length === 0) {
      await recomputeMomentum(loadedConstants);
      days = await readMomentumDaily(from, today);
    }

    setTypes(loadedTypes);
    setConstants(loadedConstants);
    setSeries(days);
    setTotals(await activityTotals(addLocalDays(today, -30), today));
  }, [today]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void load()
      .then(() => {
        if (!cancelled) setError(null);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause : new Error(String(cause)));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [load, token]);

  const rebuild = useCallback(async () => {
    setRecomputing(true);
    try {
      await recomputeMomentum();
      setToken((value) => value + 1);
    } finally {
      setRecomputing(false);
    }
  }, []);

  /* The quick log strip is the primary logging path, so the visible score has
     to move immediately rather than after a full rebuild. The row is written,
     the tail of the curve is extended locally, and the authoritative rebuild
     follows. */
  const logOne = useCallback(
    async (activityTypeId: string) => {
      const type = types.find((candidate) => candidate.id === activityTypeId);
      await insertActivity({ activityTypeId, localDate: today, count: 1 });

      if (type !== undefined) {
        setSeries((current) => {
          if (current.length === 0) return current;
          const last = current[current.length - 1];
          if (last.localDate !== today) return current;
          const rawScore = last.rawScore + type.weight;
          return [
            ...current.slice(0, -1),
            {
              ...last,
              rawScore,
              momentum: last.momentum + type.weight * last.multiplier,
            },
          ];
        });
      }

      await recomputeMomentum();
      setToken((value) => value + 1);
    },
    [today, types],
  );

  const saveConstants = useCallback(async (next: MomentumConstants) => {
    setRecomputing(true);
    try {
      await writeMomentumConstants(next);
      // Any change to a weight, a cap or a constant invalidates the whole
      // cache, not part of it. SPEC 8.4.
      await recomputeMomentum(next);
      setConstants(next);
      setToken((value) => value + 1);
    } finally {
      setRecomputing(false);
    }
  }, []);

  const trimmed = useMemo(() => series.slice(-SERIES_DAYS), [series]);

  const current = trimmed.length === 0 ? null : trimmed[trimmed.length - 1];

  const weekDelta = useMemo(() => {
    if (trimmed.length === 0) return 0;
    const last = trimmed[trimmed.length - 1];
    const past = trimmed[trimmed.length - 8];
    return past === undefined ? last.momentum : last.momentum - past.momentum;
  }, [trimmed]);

  return {
    today: current,
    series: trimmed,
    types,
    totals,
    constants,
    loading,
    recomputing,
    error,
    weekDelta,
    logOne,
    saveConstants,
    rebuild,
  };
}

export { levelFor };
