import { useMemo, useState } from "react";
import StatusChip from "../../components/StatusChip";
import { SkeletonList } from "../../components/Skeleton";
import { iconForPlatform } from "../../components/platformIcon";
import {
  STATUS_LABELS,
  statusesFor,
  type ContentItem,
  type ContentPlatform,
  type ContentSort,
  type ContentStatus,
} from "../../domain/content";
import type { Project } from "../../db/repository";
import type { ContentApi } from "../../store/useContent";

/* Spec2 1.6. One grid shell for all four platforms; they differ in the card
   body, which arrives in phases 12 to 15, not in the shell around it. */

const SORTS: readonly { id: ContentSort; label: string }[] = [
  { id: "updated", label: "Updated" },
  { id: "created", label: "Created" },
  { id: "scheduled", label: "Scheduled" },
  { id: "status", label: "Status" },
];

const CONTROL =
  "rounded-control border border-line bg-surface px-2 py-1 text-meta text-primary";

type ContentGridProps = {
  api: ContentApi;
  platform: ContentPlatform;
  projects: readonly Project[];
  onOpen: (item: ContentItem) => void;
};

function relativeTime(fromUtc: number, nowUtc: number): string {
  const minutes = Math.round((nowUtc - fromUtc) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days < 30 ? `${days}d ago` : `${Math.round(days / 30)}mo ago`;
}

function Card({
  item,
  nowUtc,
  onOpen,
}: {
  item: ContentItem;
  nowUtc: number;
  onOpen: (item: ContentItem) => void;
}) {
  const Icon = iconForPlatform(item.platform);

  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      className="content-card motion-standard flex flex-col gap-2 rounded-panel border border-hair bg-surface p-3 text-left hover:border-line"
    >
      <div className="flex items-center gap-2">
        <Icon className="icon-content shrink-0 text-secondary" aria-hidden />
        <StatusChip status={item.status} />
      </div>

      <span className="line-clamp-2 min-h-8 flex-1 text-meta text-primary">
        {item.title === "" ? "Untitled" : item.title}
      </span>

      <span className="text-micro text-tertiary">
        {`updated ${relativeTime(item.updatedUtc, nowUtc)}`}
      </span>
    </button>
  );
}

export default function ContentGrid({
  api,
  platform,
  projects,
  onOpen,
}: ContentGridProps) {
  const [nowUtc] = useState(() => Date.now());
  const available = useMemo(() => statusesFor(platform), [platform]);
  const { items, filter } = api;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-hair px-4 py-2">
        <input
          className={`${CONTROL} min-w-0 flex-1`}
          placeholder="Search title and body"
          aria-label="Search content"
          value={filter.query}
          onChange={(event) => api.setQuery(event.target.value)}
        />

        <select
          className={CONTROL}
          aria-label="Filter by status"
          value={filter.statuses.length === 1 ? filter.statuses[0] : ""}
          onChange={(event) =>
            api.setStatuses(
              event.target.value === "" ? [] : [event.target.value as ContentStatus],
            )
          }
        >
          <option value="">All statuses</option>
          {available.map((status) => (
            <option key={status} value={status}>
              {STATUS_LABELS[status]}
            </option>
          ))}
        </select>

        <select
          className={CONTROL}
          aria-label="Filter by project"
          value={filter.projectId ?? ""}
          onChange={(event) =>
            api.setProjectId(event.target.value === "" ? null : event.target.value)
          }
        >
          <option value="">All projects</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>

        <select
          className={CONTROL}
          aria-label="Sort by"
          value={filter.sort}
          onChange={(event) => api.setSort(event.target.value as ContentSort)}
        >
          {SORTS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {api.loading ? (
          <SkeletonList label="Loading content" rows={6} rowClassName="h-24 w-full" />
        ) : api.error !== null ? (
          <span className="text-meta text-cat-deadline">{api.error.message}</span>
        ) : items.length === 0 ? (
          <span className="text-meta text-tertiary">
            Nothing here yet, start with a new item
          </span>
        ) : (
          <div className="content-grid">
            {items.map((item) => (
              <Card key={item.id} item={item} nowUtc={nowUtc} onOpen={onOpen} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
