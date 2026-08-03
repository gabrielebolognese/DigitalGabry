import { useCallback, useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { emit } from "@tauri-apps/api/event";
import {
  compareContent,
  newContentItem,
  type ContentFilter,
  type ContentItem,
  type ContentPlatform,
  type ContentSort,
  type ContentStatus,
} from "../domain/content";
import { uuidv7 } from "../domain/id";
import {
  countUnfinishedContent,
  getBlock,
  insertContentItem,
  listContent,
  softDeleteContentItem,
  updateContentItem,
} from "../db/repository";
import { BLOCKS_CHANGED, CONTENT_CHANGED } from "./events";

export type ContentApi = {
  items: ContentItem[];
  counts: Record<ContentPlatform, number>;
  loading: boolean;
  error: Error | null;
  filter: ContentFilter;
  setStatuses: (statuses: readonly ContentStatus[]) => void;
  setProjectId: (projectId: string | null) => void;
  setQuery: (query: string) => void;
  setSort: (sort: ContentSort) => void;
  createItem: (platform: ContentPlatform) => Promise<ContentItem>;
  patchItem: (id: string, patch: Partial<ContentItem>) => Promise<void>;
  removeItem: (id: string) => Promise<void>;
  refresh: () => void;
};

const EMPTY_COUNTS: Record<ContentPlatform, number> = {
  x: 0,
  linkedin: 0,
  instagram: 0,
  youtube: 0,
};

export function useContent(platform: ContentPlatform): ContentApi {
  const [statuses, setStatuses] = useState<readonly ContentStatus[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<ContentSort>("updated");

  const [items, setItems] = useState<ContentItem[]>([]);
  const [counts, setCounts] = useState(EMPTY_COUNTS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  /* Only used by the scheduled sort. Fetched lazily so the common sorts do not
     pay for a second read. */
  const [blockStarts, setBlockStarts] = useState<Map<string, number>>(new Map());

  const filter = useMemo<ContentFilter>(
    () => ({ platform, statuses, projectId, query, sort }),
    [platform, statuses, projectId, query, sort],
  );

  const refresh = useCallback(() => setRefreshToken((token) => token + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    void (async () => {
      try {
        const [found, unfinished] = await Promise.all([
          listContent(filter),
          countUnfinishedContent(),
        ]);
        if (cancelled) return;
        setItems(found);
        setCounts(unfinished);
        setError(null);
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause : new Error(String(cause)));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [filter, refreshToken]);

  /* The scheduled sort needs each linked block's start time, which lives on
     blocks rather than on the item. Read once per result set, not per row. */
  useEffect(() => {
    if (sort !== "scheduled") return;
    let cancelled = false;

    void (async () => {
      const linked = items.filter((item) => item.blockId !== null);
      const pairs = await Promise.all(
        linked.map(async (item) => {
          const block = item.blockId === null ? null : await getBlock(item.blockId);
          return [item.id, block?.startUtc ?? null] as const;
        }),
      );
      if (cancelled) return;
      const map = new Map<string, number>();
      for (const [id, start] of pairs) if (start !== null) map.set(id, start);
      setBlockStarts(map);
    })();

    return () => {
      cancelled = true;
    };
  }, [items, sort]);

  useEffect(() => {
    let unlistenContent: (() => void) | null = null;
    let unlistenBlocks: (() => void) | null = null;

    void listen(CONTENT_CHANGED, refresh).then((off) => {
      unlistenContent = off;
    });
    void listen(BLOCKS_CHANGED, refresh).then((off) => {
      unlistenBlocks = off;
    });

    return () => {
      unlistenContent?.();
      unlistenBlocks?.();
    };
  }, [refresh]);

  /* Sorting is a pure domain comparator rather than an ORDER BY, so the same
     rule can be tested without a database and does not change with the filter. */
  const sorted = useMemo(
    () =>
      [...items].sort((left, right) =>
        compareContent(left, right, sort, (item) => blockStarts.get(item.id) ?? null),
      ),
    [items, sort, blockStarts],
  );

  const createItem = useCallback(
    async (target: ContentPlatform) => {
      const item = newContentItem({
        id: uuidv7(),
        platform: target,
        nowUtc: Date.now(),
      });
      await insertContentItem(item);
      await emit(CONTENT_CHANGED);
      return item;
    },
    [],
  );

  const patchItem = useCallback(async (id: string, patch: Partial<ContentItem>) => {
    await updateContentItem(id, patch);
    await emit(CONTENT_CHANGED);
  }, []);

  const removeItem = useCallback(async (id: string) => {
    await softDeleteContentItem(id);
    await emit(CONTENT_CHANGED);
  }, []);

  return {
    items: sorted,
    counts,
    loading,
    error,
    filter,
    setStatuses,
    setProjectId,
    setQuery,
    setSort,
    createItem,
    patchItem,
    removeItem,
    refresh,
  };
}
