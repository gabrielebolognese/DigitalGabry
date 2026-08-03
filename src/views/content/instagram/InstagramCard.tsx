import { Link2, ListVideo } from "lucide-react";
import StatusChip from "../../../components/StatusChip";
import {
  formatDuration,
  totalSeconds,
  type InstagramPayload,
} from "../../../domain/instagram";
import type { ContentItem } from "../../../domain/content";

/* Spec2 4.2. No image by default: these are pre-production artifacts and the
   idea is the identifying content, so a picture would be a thumbnail of
   something that does not exist yet. A reference thumbnail, if there is one,
   goes in the header as a small square. */

type InstagramCardProps = {
  item: ContentItem;
  thumbnailUrl: string | null;
  onOpen: (item: ContentItem) => void;
};

export default function InstagramCard({
  item,
  thumbnailUrl,
  onOpen,
}: InstagramCardProps) {
  const payload = item.payload as InstagramPayload;
  const sections = payload.script ?? [];
  const references = payload.references ?? [];
  const idea = payload.idea ?? item.title;

  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      className="content-card motion-standard flex flex-col gap-2 rounded-panel border border-hair bg-surface p-3 text-left hover:border-line"
    >
      <div className="flex items-center gap-2">
        {thumbnailUrl !== null && (
          <img
            src={thumbnailUrl}
            alt=""
            className="ig-thumb shrink-0 rounded-block object-cover"
          />
        )}
        <StatusChip status={item.status} />
        <div className="flex-1" />
      </div>

      <span className="line-clamp-2 min-h-8 flex-1 text-meta text-primary">
        {idea === "" ? "No idea yet" : idea}
      </span>

      <span className="flex items-center gap-1 text-micro text-tertiary">
        <ListVideo className="icon-content shrink-0" aria-hidden />
        <span className="tabular-nums">
          {`${sections.length} ${sections.length === 1 ? "section" : "sections"}`}
        </span>
        <span className="text-disabled">·</span>
        <span className="tabular-nums">{formatDuration(totalSeconds(sections))}</span>
      </span>

      {references.length > 0 && (
        <span className="flex items-center gap-1 text-micro text-tertiary">
          <Link2 className="icon-content shrink-0" aria-hidden />
          <span className="tabular-nums">
            {`${references.length} ${references.length === 1 ? "reference" : "references"}`}
          </span>
        </span>
      )}
    </button>
  );
}
