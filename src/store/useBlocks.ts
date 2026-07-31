import { useEffect, useState } from "react";
import type { Block } from "../domain/block";
import type { UtcRange } from "../domain/time";
import { createMockBlocks } from "../mock/blocks";

export type BlocksState = {
  blocks: Block[];
  loading: boolean;
  error: Error | null;
};

/* Phase 5 replaces the body with a range bounded repository read. The signature
   and the promise shape are already what the repository will provide, so no
   consumer changes when the mock goes away. */
export function useBlocks(range: UtcRange, tz: string): BlocksState {
  const [state, setState] = useState<BlocksState>({
    blocks: [],
    loading: true,
    error: null,
  });

  const { start, end } = range;

  useEffect(() => {
    let cancelled = false;

    Promise.resolve(createMockBlocks({ start, end }, tz))
      .then((blocks) => {
        if (!cancelled) setState({ blocks, loading: false, error: null });
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setState({
          blocks: [],
          loading: false,
          error: cause instanceof Error ? cause : new Error(String(cause)),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [start, end, tz]);

  return state;
}
