import { isCompleted, isOverdue, type ScheduledBlock } from "../domain/block";
import { densityFor } from "../domain/layout";
import { formatTime } from "../domain/time";
import { iconForBlock } from "./blockIcon";

type BlockProps = {
  block: ScheduledBlock;
  tz: string;
  heightPx: number;
  nowUtc: number;
  selected?: boolean;
  dragging?: boolean;
  editing?: boolean;
  onTitleCommit?: (title: string) => void;
  onTitleCancel?: () => void;
};

export default function Block({
  block,
  tz,
  heightPx,
  nowUtc,
  selected = false,
  dragging = false,
  editing = false,
  onTitleCommit,
  onTitleCancel,
}: BlockProps) {
  const density = densityFor(heightPx);
  const completed = isCompleted(block);
  const overdue = isOverdue(block, nowUtc);
  const Icon = iconForBlock(block);

  const untitled = block.title.trim() === "";
  const timeLabel = `${formatTime(block.startUtc, tz)} - ${formatTime(block.endUtc, tz)}`;

  return (
    <div
      data-block-id={block.id}
      className={[
        "block",
        `cat-${block.category}`,
        "relative flex h-full w-full overflow-hidden px-1",
        density === "compact" ? "items-center" : "items-start py-1",
        completed ? "is-completed" : "",
        selected ? "is-selected" : "",
        dragging ? "is-dragging" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <span className="block-icon flex shrink-0 justify-center">
        <Icon className="icon-content" aria-hidden={true} />
      </span>

      <div className="flex min-w-0 flex-1 flex-col">
        {editing ? (
          <input
            autoFocus
            defaultValue={block.title}
            aria-label="Block title"
            onPointerDown={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onTitleCommit?.(event.currentTarget.value);
              } else if (event.key === "Escape") {
                event.preventDefault();
                onTitleCancel?.();
              }
            }}
            onBlur={(event) => onTitleCommit?.(event.currentTarget.value)}
            className="w-full min-w-0 rounded-block border border-accent-border bg-surface px-1 text-meta text-primary"
          />
        ) : (
          <span
            className={[
              "block-title truncate text-meta",
              untitled ? "text-tertiary" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {untitled ? "Untitled" : block.title}
          </span>
        )}

        {density !== "compact" && (
          <span
            className={["block-meta truncate text-micro", overdue ? "is-overdue" : ""]
              .filter(Boolean)
              .join(" ")}
          >
            {timeLabel}
          </span>
        )}

        {density === "expanded" && block.description !== null && (
          <span className="block-description mt-1 line-clamp-2 text-micro">
            {block.description}
          </span>
        )}
      </div>

      {!editing && (
        <>
          <span
            data-resize="start"
            aria-hidden="true"
            className="absolute inset-x-0 top-0 h-1 cursor-ns-resize"
          />
          <span
            data-resize="end"
            aria-hidden="true"
            className="absolute inset-x-0 bottom-0 h-1 cursor-ns-resize"
          />
        </>
      )}
    </div>
  );
}
