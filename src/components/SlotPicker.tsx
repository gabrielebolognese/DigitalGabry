import { useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { fuzzyRank } from "../domain/fuzzy";
import { formatTime } from "../domain/time";
import { STATUS_LABELS, type ContentItem, type ContentPlatform } from "../domain/content";
import { listContent } from "../db/repository";
import type { Slot } from "../domain/generation/types";

/* Spec1.1 section 13. Clicking an empty slot opens this: ready content for
   that platform, oldest first, with search and a way to make something new.

   Oldest first because the thing most at risk of never going out is the thing
   that has been sitting longest, and a picker sorted by recency buries it. */

type SlotPickerProps = {
  slot: Slot;
  tz: string;
  onAssign: (item: ContentItem) => void;
  onCreate: () => void;
  onExplain: () => void;
  onClose: () => void;
};

export default function SlotPicker({
  slot,
  tz,
  onAssign,
  onCreate,
  onExplain,
  onClose,
}: SlotPickerProps) {
  const [items, setItems] = useState<readonly ContentItem[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);

  const platform = slot.intent.platform;

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        if (platform === undefined) {
          if (!cancelled) setItems([]);
          return;
        }
        const found = await listContent({
          platform: platform as ContentPlatform,
          statuses: ["ready"],
          projectId: null,
          query: "",
          sort: "created",
        });
        if (!cancelled) setItems(found);
      } catch {
        if (!cancelled) setItems([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [platform]);

  const shown = useMemo(() => {
    const oldest = [...items].sort((left, right) => left.createdUtc - right.createdUtc);
    return query.trim() === ""
      ? oldest
      : fuzzyRank(query, oldest, (entry) => `${entry.title} ${entry.body}`);
  }, [items, query]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Fill this slot"
      className="scrim fixed inset-0 z-50 flex items-center justify-center"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <div className="flex w-96 flex-col gap-2 rounded-panel border border-line bg-elevated p-3">
        <div className="flex items-baseline gap-2">
          <span className="text-title text-primary">
            {`${platform ?? slot.intent.kind}, ${formatTime(slot.startUtc, tz)}`}
          </span>
          <div className="flex-1" />
          <button
            type="button"
            onClick={onExplain}
            className="motion-hover rounded-control px-2 py-1 text-micro text-tertiary hover:text-secondary"
          >
            Why this slot
          </button>
        </div>

        <input
          autoFocus
          value={query}
          aria-label="Search ready content"
          placeholder="Search ready content"
          onChange={(event) => setQuery(event.target.value)}
          className="rounded-control border border-line bg-surface px-2 py-1 text-body text-primary"
        />

        <div className="flex max-h-64 flex-col gap-1 overflow-y-auto">
          {loading ? (
            <span className="px-2 py-1 text-meta text-tertiary">Looking</span>
          ) : shown.length === 0 ? (
            <span className="px-2 py-1 text-meta text-tertiary">
              {platform === undefined
                ? "This slot has no platform to match on"
                : `Nothing ready for ${platform}`}
            </span>
          ) : (
            shown.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => onAssign(entry)}
                className="motion-hover flex items-baseline gap-2 rounded-control px-2 py-1 text-left hover:bg-hover"
              >
                <span className="min-w-0 flex-1 truncate text-meta text-primary">
                  {entry.title === "" ? "Untitled" : entry.title}
                </span>
                <span className="shrink-0 text-micro text-tertiary">
                  {STATUS_LABELS[entry.status]}
                </span>
              </button>
            ))
          )}
        </div>

        <button
          type="button"
          onClick={onCreate}
          className="motion-hover flex items-center gap-2 rounded-control border border-line px-2 py-1 text-meta text-primary hover:bg-hover"
        >
          <Plus className="icon-content shrink-0" aria-hidden />
          New {platform ?? "item"}
        </button>
      </div>
    </div>
  );
}
