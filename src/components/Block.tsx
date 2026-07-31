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
};

export default function Block({
  block,
  tz,
  heightPx,
  nowUtc,
  selected = false,
  dragging = false,
}: BlockProps) {
  const density = densityFor(heightPx);
  const completed = isCompleted(block);
  const overdue = isOverdue(block, nowUtc);
  const Icon = iconForBlock(block);

  const timeLabel = `${formatTime(block.startUtc, tz)} - ${formatTime(block.endUtc, tz)}`;

  return (
    <div
      className={[
        "block",
        `cat-${block.category}`,
        "flex h-full w-full overflow-hidden px-1",
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
        <span className="block-title truncate text-meta">{block.title}</span>

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
    </div>
  );
}
