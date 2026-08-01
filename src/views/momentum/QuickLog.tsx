import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { iconForActivity } from "../../components/activityIcon";
import type { ActivityTotal, ActivityType } from "../../db/repository";

const SLOTS = 8;
const FLASH_MS = 700;

type QuickLogProps = {
  types: readonly ActivityType[];
  totals: readonly ActivityTotal[];
  onLog: (activityTypeId: string) => Promise<void>;
};

export default function QuickLog({ types, totals, onLog }: QuickLogProps) {
  const [flashed, setFlashed] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  /* Most used first, falling back to the seeded order so the strip is never
     empty on a fresh install. */
  const pinned = useMemo(() => {
    const rank = new Map(totals.map((total, index) => [total.activityTypeId, index]));
    return [...types]
      .filter((type) => !type.archived)
      .sort((a, b) => {
        const left = rank.get(a.id);
        const right = rank.get(b.id);
        if (left !== undefined && right !== undefined) return left - right;
        if (left !== undefined) return -1;
        if (right !== undefined) return 1;
        return a.sortOrder - b.sortOrder;
      })
      .slice(0, SLOTS);
  }, [types, totals]);

  const log = useCallback(
    (id: string) => {
      setFlashed(id);
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setFlashed(null), FLASH_MS);
      void onLog(id);
    },
    [onLog],
  );

  return (
    <div className="flex shrink-0 items-center gap-1 border-t border-hair px-3 py-2">
      {pinned.map((type) => {
        const Icon = iconForActivity(type.icon);
        return (
          <button
            key={type.id}
            type="button"
            title={type.name}
            aria-label={`Log one ${type.name}`}
            onClick={() => log(type.id)}
            className="motion-hover relative flex items-center gap-1 rounded-control border border-transparent px-2 py-1 text-tertiary hover:border-line hover:bg-hover hover:text-primary"
          >
            <Icon className="icon-content" aria-hidden={true} />
            <span
              aria-hidden="true"
              className={[
                "motion-standard text-micro text-accent",
                flashed === type.id ? "opacity-100" : "opacity-0",
              ].join(" ")}
            >
              +1
            </span>
          </button>
        );
      })}
    </div>
  );
}
