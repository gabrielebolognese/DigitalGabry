import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Block, CalendarEntry } from "../domain/block";
import type { UtcRange } from "../domain/time";
import { listen } from "@tauri-apps/api/event";
import { primeClock } from "../db/ops";
import { ensureMaterialized } from "../scheduler/materialize";
import { BLOCKS_CHANGED } from "./events";
import {
  insertBlock,
  listBlocksInRange,
  restoreBlock as restoreInDb,
  softDeleteBlock as softDeleteInDb,
  updateBlock as updateInDb,
} from "../db/repository";

export type BlocksApi = {
  blocks: CalendarEntry[];
  loading: boolean;
  error: Error | null;
  createBlock: (block: Block) => void;
  updateBlock: (id: string, patch: Partial<Block>) => void;
  softDeleteBlock: (id: string) => void;
  restoreBlock: (id: string) => void;
  /* Forces a re-read. Used after an operation that writes rows this hook did
     not issue itself, such as a recurrence edit scope. */
  refresh: () => void;
};

/* One screen of buffer either side of the viewport is fetched, and anything
   beyond three screens is evicted. The frontend never holds the whole dataset,
   only a window onto it. SPEC 7. */
const BUFFER_SCREENS = 1;
const KEEP_SCREENS = 3;

/* Keyed by entryId, not by block id. Every instance of a recurring series
   shares its parent's id, so a cache keyed by id would collapse a daily rule
   into a single entry and quietly show one instance. */
type Cache = Map<string, CalendarEntry>;

function merge(previous: Cache, fetched: readonly CalendarEntry[]): Cache {
  const next = new Map(previous);
  for (const entry of fetched) next.set(entry.entryId, entry);
  return next;
}

function evict(cache: Cache, keep: UtcRange): Cache {
  const next = new Map(cache);
  for (const [entryId, entry] of next) {
    if (entry.startUtc === null || entry.endUtc === null) continue;
    if (entry.endUtc < keep.start || entry.startUtc > keep.end) next.delete(entryId);
  }
  return next;
}

function asEntry(block: Block): CalendarEntry {
  return { ...block, entryId: block.id, occurrenceStartUtc: null };
}

export function useBlocks(range: UtcRange, tz: string): BlocksApi {
  const [cache, setCache] = useState<Cache>(() => new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  /* The capture window writes to the same database this window reads, so a
     captured block would not appear until the week changed without this. */
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    void listen(BLOCKS_CHANGED, () => setRefreshToken((token) => token + 1)).then(
      (stop) => {
        unlisten = stop;
      },
    );
    return () => {
      if (unlisten !== null) unlisten();
    };
  }, []);

  const cacheRef = useRef<Cache>(cache);
  cacheRef.current = cache;

  const { start, end } = range;
  const span = end - start;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    void (async () => {
      try {
        await primeClock();
        // Occurrences are read from the table, never expanded at query time,
        // so they have to exist before the first read.
        await ensureMaterialized(Date.now(), tz);
        const fetched = await listBlocksInRange({
          start: start - span * BUFFER_SCREENS,
          end: end + span * BUFFER_SCREENS,
        });
        if (cancelled) return;
        setCache((previous) =>
          evict(merge(previous, fetched), {
            start: start - span * KEEP_SCREENS,
            end: end + span * KEEP_SCREENS,
          }),
        );
        setError(null);
        setLoading(false);
      } catch (cause) {
        if (cancelled) return;
        setError(cause instanceof Error ? cause : new Error(String(cause)));
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [start, end, span, tz, refreshToken]);

  // Adjacent weeks are fetched only when the main thread has nothing better to
  // do, so a fast scroll never waits on a prefetch.
  useEffect(() => {
    const handle = window.requestIdleCallback(() => {
      void (async () => {
        const ahead: UtcRange[] = [
          { start: start - span * 2, end: start - span },
          { start: end + span, end: end + span * 2 },
        ];
        for (const window_ of ahead) {
          try {
            const fetched = await listBlocksInRange(window_);
            setCache((previous) => merge(previous, fetched));
          } catch {
            // A prefetch that fails is not worth surfacing; the real read for
            // that range will report it if the user ever gets there.
          }
        }
      })();
    });
    return () => window.cancelIdleCallback(handle);
  }, [start, end, span, tz, refreshToken]);

  /* Mutations land in local state immediately and reconcile against the write.
     A rejected write puts the previous snapshot back and reports the failure
     rather than leaving the UI showing something the database never accepted. */
  const optimistic = useCallback(
    (mutate: (cache: Cache) => void, persist: () => Promise<void>) => {
      const snapshot = cacheRef.current;
      setCache((previous) => {
        const next = new Map(previous);
        mutate(next);
        return next;
      });
      persist().catch((cause: unknown) => {
        setCache(snapshot);
        setError(cause instanceof Error ? cause : new Error(String(cause)));
      });
    },
    [],
  );

  /* Mutations address the row by block id, so every entry sharing that id is
     updated, which is what makes an optimistic edit to a series show on all of
     its visible instances at once. */
  const patchById = useCallback(
    (cache: Cache, id: string, patch: Partial<CalendarEntry>) => {
      for (const [entryId, entry] of cache) {
        if (entry.id === id) cache.set(entryId, { ...entry, ...patch });
      }
    },
    [],
  );

  const createBlock = useCallback(
    (block: Block) => {
      optimistic(
        (next) => next.set(block.id, asEntry(block)),
        () => insertBlock(block),
      );
    },
    [optimistic],
  );

  const updateBlock = useCallback(
    (id: string, patch: Partial<Block>) => {
      optimistic(
        (next) => patchById(next, id, { ...patch, updatedUtc: Date.now() }),
        () => updateInDb(id, patch),
      );
    },
    [optimistic, patchById],
  );

  const softDeleteBlock = useCallback(
    (id: string) => {
      optimistic(
        (next) => patchById(next, id, { deletedUtc: Date.now() }),
        () => softDeleteInDb(id),
      );
    },
    [optimistic, patchById],
  );

  const restoreBlock = useCallback(
    (id: string) => {
      optimistic(
        (next) => patchById(next, id, { deletedUtc: null }),
        () => restoreInDb(id),
      );
    },
    [optimistic, patchById],
  );

  const blocks = useMemo(
    () => [...cache.values()].filter((entry) => entry.deletedUtc === null),
    [cache],
  );

  const refresh = useCallback(() => setRefreshToken((token) => token + 1), []);

  return {
    blocks,
    loading,
    error,
    createBlock,
    updateBlock,
    softDeleteBlock,
    restoreBlock,
    refresh,
  };
}
