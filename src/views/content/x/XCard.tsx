import { Copy, ImagePlus, Send } from "lucide-react";
import StatusChip from "../../../components/StatusChip";
import {
  STAGE_CLASS,
  counterStage,
  postLength,
  softLimitOf,
  type XPayload,
} from "../../../domain/xPost";
import type { ContentItem } from "../../../domain/content";

/* Spec2 2.2. Image forward, because an X post with an image is a different
   object from one without and the card should say which it is at a glance. */

type XCardProps = {
  item: ContentItem;
  imageUrl: string | null;
  softLimitDefault: number;
  onOpen: (item: ContentItem) => void;
  onCopy: (item: ContentItem) => void;
  onPostThis: (item: ContentItem) => void;
};

export default function XCard({
  item,
  imageUrl,
  softLimitDefault,
  onOpen,
  onCopy,
  onPostThis,
}: XCardProps) {
  const text = item.body === "" ? item.title : item.body;
  const length = postLength(text);
  const softLimit = softLimitOf(item.payload as XPayload, softLimitDefault);
  const stage = counterStage(length, softLimit);

  return (
    <div className="content-card flex flex-col gap-2 rounded-panel border border-hair bg-surface p-3 hover:border-line">
      <div className="flex items-center gap-2">
        <StatusChip status={item.status} />
        <div className="flex-1" />
      </div>

      <button
        type="button"
        aria-label="Open this post"
        onClick={() => onOpen(item)}
        className="flex flex-col gap-2 text-left"
      >
        <span className="x-card-image flex items-center justify-center overflow-hidden rounded-block bg-elevated">
          {imageUrl === null ? (
            <ImagePlus className="icon-content text-tertiary" aria-hidden />
          ) : (
            <img
              src={imageUrl}
              alt={(item.payload as XPayload).altText ?? ""}
              className="h-full w-full object-cover"
            />
          )}
        </span>

        <span className="line-clamp-3 min-h-12 text-meta text-primary">
          {text === "" ? "Empty post" : text}
        </span>
      </button>

      <div className="flex items-center gap-2">
        <span className={`text-micro tabular-nums ${STAGE_CLASS[stage]}`}>
          {`${length}/${softLimit}`}
        </span>
        <div className="flex-1" />

        <button
          type="button"
          aria-label="Copy the text"
          onClick={() => onCopy(item)}
          className="motion-hover flex items-center gap-1 rounded-control px-2 py-1 text-micro text-secondary hover:bg-hover hover:text-primary"
        >
          <Copy className="icon-content" aria-hidden />
          Copy
        </button>

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
