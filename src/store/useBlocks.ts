import { useCallback, useEffect, useMemo, useState } from "react";
import type { Block } from "../domain/block";
import type { UtcRange } from "../domain/time";
import { createMockBlocks } from "../mock/blocks";

export type BlocksApi = {
  blocks: Block[];
  loading: boolean;
  error: Error | null;
  createBlock: (block: Block) => void;
  updateBlock: (id: string, patch: Partial<Block>) => void;
  softDeleteBlock: (id: string) => void;
  restoreBlock: (id: string) => void;
};

/* Phase 5 replaces the body with range bounded repository calls. The signature
   and the promise shape are already what the repository will provide, so no
   consumer changes when the mock goes away. */
export function useBlocks(range: UtcRange, tz: string): BlocksApi {
  const [all, setAll] = useState<Block[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const { start, end } = range;

  useEffect(() => {
    let cancelled = false;

    Promise.resolve(createMockBlocks({ start, end }, tz))
      .then((blocks) => {
        if (cancelled) return;
        setAll(blocks);
        setLoading(false);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setAll([]);
        setLoading(false);
        setError(cause instanceof Error ? cause : new Error(String(cause)));
      });

    return () => {
      cancelled = true;
    };
  }, [start, end, tz]);

  const createBlock = useCallback((block: Block) => {
    setAll((previous) => [...previous, block]);
  }, []);

  const updateBlock = useCallback((id: string, patch: Partial<Block>) => {
    const stamp = Date.now();
    setAll((previous) =>
      previous.map((block) =>
        block.id === id ? { ...block, ...patch, updatedUtc: stamp } : block,
      ),
    );
  }, []);

  /* No hard delete anywhere in the app. The row keeps existing with a
     tombstone and every read filters it out. */
  const softDeleteBlock = useCallback((id: string) => {
    const stamp = Date.now();
    setAll((previous) =>
      previous.map((block) =>
        block.id === id ? { ...block, deletedUtc: stamp, updatedUtc: stamp } : block,
      ),
    );
  }, []);

  const restoreBlock = useCallback((id: string) => {
    const stamp = Date.now();
    setAll((previous) =>
      previous.map((block) =>
        block.id === id ? { ...block, deletedUtc: null, updatedUtc: stamp } : block,
      ),
    );
  }, []);

  const blocks = useMemo(
    () => all.filter((block) => block.deletedUtc === null),
    [all],
  );

  return { blocks, loading, error, createBlock, updateBlock, softDeleteBlock, restoreBlock };
}
