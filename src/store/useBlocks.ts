import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Block } from "../domain/block";
import type { UtcRange } from "../domain/time";
import { primeClock } from "../db/ops";
import {
  insertBlock,
  listBlocksInRange,
  restoreBlock as restoreInDb,
  softDeleteBlock as softDeleteInDb,
  updateBlock as updateInDb,
} from "../db/repository";

export type BlocksApi = {
  blocks: Block[];
  loading: boolean;
  error: Error | null;
  createBlock: (block: Block) => void;
  updateBlock: (id: string, patch: Partial<Block>) => void;
  softDeleteBlock: (id: string) => void;
  restoreBlock: (id: string) => void;
};

/* One screen of buffer either side of the viewport is fetched, and anything
   beyond three screens is evicted. The frontend never holds the whole dataset,
   only a window onto it. SPEC 7. */
const BUFFER_SCREENS = 1;
const KEEP_SCREENS = 3;

type Cache = Map<string, Block>;

function merge(previous: Cache, fetched: readonly Block[]): Cache {
  const next = new Map(previous);
  for (const block of fetched) next.set(block.id, block);
  return next;
}

function evict(cache: Cache, keep: UtcRange): Cache {
  const next = new Map(cache);
  for (const [id, block] of next) {
    if (block.startUtc === null || block.endUtc === null) continue;
    if (block.endUtc < keep.start || block.startUtc > keep.end) next.delete(id);
  }
  return next;
}

export function useBlocks(range: UtcRange, _tz: string): BlocksApi {
  const [cache, setCache] = useState<Cache>(() => new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

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
  }, [start, end, span]);

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
  }, [start, end, span]);

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

  const createBlock = useCallback(
    (block: Block) => {
      optimistic(
        (next) => next.set(block.id, block),
        () => insertBlock(block),
      );
    },
    [optimistic],
  );

  const updateBlock = useCallback(
    (id: string, patch: Partial<Block>) => {
      optimistic((next) => {
        const current = next.get(id);
        if (current !== undefined) {
          next.set(id, { ...current, ...patch, updatedUtc: Date.now() });
        }
      }, () => updateInDb(id, patch));
    },
    [optimistic],
  );

  const softDeleteBlock = useCallback(
    (id: string) => {
      optimistic((next) => {
        const current = next.get(id);
        if (current !== undefined) next.set(id, { ...current, deletedUtc: Date.now() });
      }, () => softDeleteInDb(id));
    },
    [optimistic],
  );

  const restoreBlock = useCallback(
    (id: string) => {
      optimistic((next) => {
        const current = next.get(id);
        if (current !== undefined) next.set(id, { ...current, deletedUtc: null });
      }, () => restoreInDb(id));
    },
    [optimistic],
  );

  const blocks = useMemo(
    () => [...cache.values()].filter((block) => block.deletedUtc === null),
    [cache],
  );

  return { blocks, loading, error, createBlock, updateBlock, softDeleteBlock, restoreBlock };
}
