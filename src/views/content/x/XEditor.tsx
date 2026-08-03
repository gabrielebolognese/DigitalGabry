import { useCallback, useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { ImagePlus, Trash2 } from "lucide-react";
import {
  HARD_LIMIT,
  STAGE_CLASS,
  clampToHardLimit,
  counterStage,
  postLength,
  softLimitOf,
  type XPayload,
} from "../../../domain/xPost";
import {
  STATUS_LABELS,
  statusesFor,
  type ContentItem,
  type ContentStatus,
} from "../../../domain/content";
import { importAsset, resolveAssetUrl } from "../../../vault/vault";
import { assetsForContent, linkAsset, unlinkAsset } from "../../../db/repository";
import type { Asset } from "../../../domain/content";

/* Spec2 2.3. The inspector overlay, the same 320px component as a block.

   Paste is the one that matters. Copying an image from anywhere and pressing
   Ctrl+V here imports it into the vault directly, which is the difference
   between this being usable and being a form you fill in after doing the real
   work somewhere else. */

const FIELD =
  "w-full rounded-control border border-line bg-surface px-2 py-1 text-body text-primary";

type XEditorProps = {
  item: ContentItem;
  softLimitDefault: number;
  onPatch: (patch: Partial<ContentItem>) => Promise<void>;
  onClose: () => void;
};

export default function XEditor({
  item,
  softLimitDefault,
  onPatch,
  onClose,
}: XEditorProps) {
  const payload = item.payload as XPayload;
  const [text, setText] = useState(item.body);
  const [asset, setAsset] = useState<Asset | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const softLimit = softLimitOf(payload, softLimitDefault);
  const length = postLength(text);
  const stage = counterStage(length, softLimit);

  const loadAsset = useCallback(async () => {
    const linked = await assetsForContent(item.id);
    const primary = linked.find((entry) => entry.role === "primary") ?? null;
    setAsset(primary);
    setImageUrl(primary === null ? null : await resolveAssetUrl(primary));
  }, [item.id]);

  useEffect(() => {
    void loadAsset();
  }, [loadAsset]);

  const attach = useCallback(
    async (bytes: Uint8Array, mime: string) => {
      setBusy(true);
      try {
        const result = await importAsset({
          bytes,
          mime,
          folder: "x",
          nowUtc: Date.now(),
        });
        if (asset !== null) await unlinkAsset(item.id, asset.id, "primary");
        await linkAsset(item.id, result.asset.id, "primary");
        await loadAsset();
        setNote(result.created ? "Image imported" : "Already in the vault");
      } catch (cause) {
        setNote(cause instanceof Error ? cause.message : "That image would not import");
      } finally {
        setBusy(false);
      }
    },
    [asset, item.id, loadAsset],
  );

  /* Paste anywhere in the editor, not only on the image slot: a person who has
     just copied an image is not going to aim first. */
  useEffect(() => {
    const element = rootRef.current;
    if (element === null) return;

    const onPaste = (event: ClipboardEvent): void => {
      const file = [...(event.clipboardData?.items ?? [])]
        .filter((entry) => entry.kind === "file" && entry.type.startsWith("image/"))
        .map((entry) => entry.getAsFile())
        .find((entry): entry is File => entry !== null);

      if (file === undefined) return;
      event.preventDefault();
      void file
        .arrayBuffer()
        .then((buffer) => attach(new Uint8Array(buffer), file.type));
    };

    element.addEventListener("paste", onPaste);
    return () => element.removeEventListener("paste", onPaste);
  }, [attach]);

  const pickFile = useCallback(async () => {
    const path = await open({
      multiple: false,
      filters: [{ name: "Image", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }],
    });
    if (typeof path !== "string") return;

    const bytes = await invoke<number[]>("read_binary_file", { path });
    const extension = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
    const mime = extension === "jpg" ? "image/jpeg" : `image/${extension}`;
    await attach(new Uint8Array(bytes), mime);
  }, [attach]);

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label="Edit post"
      className="scrim fixed inset-0 z-50 flex justify-end"
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
      <aside className="inspector flex h-full flex-col gap-3 overflow-y-auto border-l border-line bg-elevated p-3">
        <span className="text-title text-primary">Post</span>

        <div
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            const file = event.dataTransfer.files[0];
            if (file === undefined || !file.type.startsWith("image/")) return;
            void file
              .arrayBuffer()
              .then((buffer) => attach(new Uint8Array(buffer), file.type));
          }}
          className="x-card-image flex items-center justify-center overflow-hidden rounded-block border border-hair bg-surface"
        >
          {imageUrl === null ? (
            <button
              type="button"
              onClick={() => void pickFile()}
              aria-label="Add an image"
              className="motion-hover flex flex-col items-center gap-1 p-3 text-tertiary hover:text-secondary"
            >
              <ImagePlus className="icon-content" aria-hidden />
              <span className="text-micro">Drop, paste or pick an image</span>
            </button>
          ) : (
            <img src={imageUrl} alt={payload.altText ?? ""} className="h-full w-full object-cover" />
          )}
        </div>

        {asset !== null && (
          <button
            type="button"
            onClick={() => {
              void unlinkAsset(item.id, asset.id, "primary").then(loadAsset);
            }}
            className="motion-hover flex items-center gap-1 self-start rounded-control px-2 py-1 text-micro text-tertiary hover:text-secondary"
          >
            <Trash2 className="icon-content" aria-hidden />
            Remove image
          </button>
        )}

        <label className="flex flex-col gap-1">
          <span className="text-micro uppercase text-tertiary">Text</span>
          <textarea
            rows={6}
            className={FIELD}
            value={text}
            aria-label="Post text"
            onChange={(event) => {
              /* Hard stop at the platform maximum. Finding out at paste time
                 on x.com means rewriting the end of a finished post. */
              const next = clampToHardLimit(event.target.value);
              setText(next);
              void onPatch({ body: next });
            }}
          />
          <span className={`self-end text-micro tabular-nums ${STAGE_CLASS[stage]}`}>
            {`${length}/${softLimit}`}
            <span className="text-disabled">{` · ${HARD_LIMIT} max`}</span>
          </span>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-micro uppercase text-tertiary">Alt text</span>
          <input
            className={FIELD}
            value={payload.altText ?? ""}
            onChange={(event) =>
              void onPatch({ payload: { ...payload, altText: event.target.value } })
            }
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-micro uppercase text-tertiary">Status</span>
          <select
            className={FIELD}
            value={item.status}
            onChange={(event) =>
              void onPatch({ status: event.target.value as ContentStatus })
            }
          >
            {statusesFor("x").map((status) => (
              <option key={status} value={status}>
                {STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-micro uppercase text-tertiary">Posted url</span>
          <input
            className={FIELD}
            value={item.postedUrl ?? ""}
            placeholder="Filled in after posting"
            onChange={(event) => void onPatch({ postedUrl: event.target.value })}
          />
        </label>

        {busy && <span className="text-meta text-tertiary">Importing</span>}
        {note !== null && <span className="text-meta text-secondary">{note}</span>}
      </aside>
    </div>
  );
}
