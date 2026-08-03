import { ImagePlus, Send } from "lucide-react";
import StatusChip from "../../../components/StatusChip";
import type { LinkedInPayload } from "../../../content/linkedin/schema";
import type { ContentItem } from "../../../domain/content";

/* Spec2 3.5. The X card's shape with a 4:5 image area and the format label,
   because a LinkedIn image is portrait and the card should say which format it
   was written for before it is opened. */

type LinkedInCardProps = {
  item: ContentItem;
  imageUrl: string | null;
  onOpen: (item: ContentItem) => void;
  onPostThis: (item: ContentItem) => void;
};

export default function LinkedInCard({
  item,
  imageUrl,
  onOpen,
  onPostThis,
}: LinkedInCardProps) {
  const payload = item.payload as LinkedInPayload;
  const text = item.body === "" ? item.title : item.body;

  return (
    <div className="content-card flex flex-col gap-2 rounded-panel border border-hair bg-surface p-3 hover:border-line">
      <div className="flex items-center gap-2">
        <StatusChip status={item.status} />
        {payload.format !== undefined && (
          <span className="truncate text-micro uppercase text-tertiary">
            {payload.format.replace(/-/g, " ")}
          </span>
        )}
        <div className="flex-1" />
      </div>

      <button
        type="button"
        aria-label="Open this post"
        onClick={() => onOpen(item)}
        className="flex flex-col gap-2 text-left"
      >
        <span className="li-card-image flex items-center justify-center overflow-hidden rounded-block bg-elevated">
          {imageUrl === null ? (
            <ImagePlus className="icon-content text-tertiary" aria-hidden />
          ) : (
            <img src={imageUrl} alt="" className="h-full w-full object-cover" />
          )}
        </span>

        <span className="line-clamp-3 min-h-12 text-meta text-primary">
          {text === "" ? "Empty post" : text}
        </span>
      </button>

      <div className="flex items-center gap-2">
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => onPostThis(item)}
          className="motion-hover flex items-center gap-1 rounded-control border border-line px-2 py-1 text-micro text-primary hover:bg-hover"
        >
          <Send className="icon-content" aria-hidden />
          Post this
        </button>
      </div>
    </div>
  );
}
