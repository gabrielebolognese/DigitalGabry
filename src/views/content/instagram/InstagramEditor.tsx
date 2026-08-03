import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowUp, GripVertical, Plus, Send, Trash2, X } from "lucide-react";
import {
  INSTAGRAM_FORMATS,
  KIND_TONE,
  MAX_HOOK_VARIANTS,
  durationTone,
  formatDuration,
  kindAfter,
  looksLikeUrl,
  newSection,
  nextKind,
  normaliseUrl,
  reorderSections,
  sectionSeconds,
  totalSeconds,
  type InstagramFormat,
  type InstagramPayload,
  type Reference,
  type ScriptSection,
} from "../../../domain/instagram";
import { uuidv7 } from "../../../domain/id";
import {
  STATUS_LABELS,
  statusesFor,
  type ContentItem,
  type ContentStatus,
} from "../../../domain/content";
import { importAsset, resolveAssetUrl } from "../../../vault/vault";
import { openUrl } from "@tauri-apps/plugin-opener";

/* Spec2 4.3. Full width, not the 320px inspector overlay, because a video
   script needs horizontal space: the line, what is on screen during it, and
   how long it runs are three things you read across rather than down. */

const FIELD =
  "w-full rounded-control border border-line bg-surface px-2 py-1 text-body text-primary";

type InstagramEditorProps = {
  item: ContentItem;
  onPatch: (patch: Partial<ContentItem>) => Promise<void>;
  onSendToPhone: (payload: InstagramPayload) => void;
  onClose: () => void;
};

export default function InstagramEditor({
  item,
  onPatch,
  onSendToPhone,
  onClose,
}: InstagramEditorProps) {
  const stored = item.payload as InstagramPayload;

  /* Held locally and written back on a debounce. A twelve section script
     writing a row per keystroke would make typing feel like the app is
     thinking, which is the acceptance criterion this exists to meet. */
  const [payload, setPayload] = useState<InstagramPayload>({
    format: stored.format ?? "reel",
    idea: stored.idea ?? "",
    references: stored.references ?? [],
    script: stored.script ?? [],
    hookVariants: stored.hookVariants ?? [],
    audioNote: stored.audioNote ?? "",
  });

  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [refDraft, setRefDraft] = useState("");
  const [refNote, setRefNote] = useState<string | null>(null);
  const [thumbs, setThumbs] = useState<Map<string, string>>(new Map());
  const columnRef = useRef<HTMLDivElement | null>(null);
  const saveTimer = useRef<number | null>(null);

  const sections = payload.script ?? [];
  const total = totalSeconds(sections);

  const commit = useCallback(
    (next: InstagramPayload) => {
      setPayload(next);
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        void onPatch({ payload: next as Record<string, unknown> });
      }, 400);
    },
    [onPatch],
  );

  useEffect(
    () => () => {
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    },
    [],
  );

  const setSections = useCallback(
    (next: ScriptSection[]) => commit({ ...payload, script: next }),
    [commit, payload],
  );

  const patchSection = useCallback(
    (index: number, patch: Partial<ScriptSection>) => {
      setSections(
        sections.map((section, position) =>
          position === index ? { ...section, ...patch } : section,
        ),
      );
    },
    [sections, setSections],
  );

  const addSectionAfter = useCallback(
    (index: number) => {
      const next = [...sections];
      next.splice(index + 1, 0, newSection(uuidv7(), kindAfter(sections[index])));
      setSections(next);
    },
    [sections, setSections],
  );

  /* References resolve their thumbnails asynchronously. */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const pairs = await Promise.all(
        (payload.references ?? [])
          .filter((reference) => reference.assetId !== undefined)
          .map(async (reference) => {
            try {
              const url = await resolveAssetUrl({
                id: reference.assetId ?? "",
                path: reference.note,
                sha256: "",
                mime: "image/png",
                width: null,
                height: null,
                bytes: 0,
                origin: "capture",
                createdUtc: reference.addedUtc,
                deletedUtc: null,
              });
              return [reference.id, url] as const;
            } catch {
              return null;
            }
          }),
      );
      if (!cancelled) {
        setThumbs(new Map(pairs.filter((pair): pair is [string, string] => pair !== null)));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [payload.references]);

  const addReference = useCallback(() => {
    if (!looksLikeUrl(refDraft)) {
      setRefNote("That does not look like a link");
      return;
    }

    const reference: Reference = {
      id: uuidv7(),
      url: normaliseUrl(refDraft),
      note: "",
      addedUtc: Date.now(),
    };

    commit({ ...payload, references: [...(payload.references ?? []), reference] });
    setRefDraft("");

    /* Instagram blocks most scraping, so a metadata fetch is expected to fail
       and must never take the reference with it. The URL and the note are what
       matter; a title is a bonus. */
    setRefNote("Added. Title lookup is not attempted, Instagram blocks it");
  }, [refDraft, commit, payload]);

  /* Ctrl+V anywhere in the column attaches a screenshot, which Spec2 4.3 calls
     the reliable path precisely because scraping is not. */
  useEffect(() => {
    const element = columnRef.current;
    if (element === null) return;

    const onPaste = (event: ClipboardEvent): void => {
      const file = [...(event.clipboardData?.items ?? [])]
        .filter((entry) => entry.kind === "file" && entry.type.startsWith("image/"))
        .map((entry) => entry.getAsFile())
        .find((entry): entry is File => entry !== null);

      if (file === undefined) return;
      event.preventDefault();

      void file.arrayBuffer().then(async (buffer) => {
        const result = await importAsset({
          bytes: new Uint8Array(buffer),
          mime: file.type,
          folder: "reference",
          origin: "capture",
          nowUtc: Date.now(),
        });
        commit({
          ...payload,
          references: [
            ...(payload.references ?? []),
            {
              id: uuidv7(),
              url: "",
              note: "Pasted screenshot",
              assetId: result.asset.id,
              addedUtc: Date.now(),
            },
          ],
        });
      });
    };

    element.addEventListener("paste", onPaste);
    return () => element.removeEventListener("paste", onPaste);
  }, [commit, payload]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shell-header flex shrink-0 items-center gap-2 border-b border-hair px-3">
        <button
          type="button"
          aria-label="Back to the grid"
          onClick={onClose}
          className="motion-hover flex rounded-control p-1 text-tertiary hover:bg-hover hover:text-primary"
        >
          <ArrowLeft className="icon-content" aria-hidden />
        </button>
        <span className="text-title text-primary">Script</span>

        <span className={`text-meta tabular-nums ${durationTone(total)}`}>
          {formatDuration(total)}
        </span>

        <div className="flex-1" />

        <button
          type="button"
          onClick={() => onSendToPhone(payload)}
          className="motion-hover flex items-center gap-1 rounded-control border border-line px-2 py-1 text-meta text-primary hover:bg-hover"
        >
          <Send className="icon-content shrink-0" aria-hidden />
          Send to phone
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="ig-left flex shrink-0 flex-col gap-3 overflow-y-auto border-r border-hair p-3">
          <label className="flex flex-col gap-1">
            <span className="text-micro uppercase text-tertiary">Idea</span>
            <textarea
              rows={3}
              className={FIELD}
              value={payload.idea ?? ""}
              onChange={(event) => commit({ ...payload, idea: event.target.value })}
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-micro uppercase text-tertiary">Format</span>
            <select
              className={FIELD}
              value={payload.format ?? "reel"}
              onChange={(event) =>
                commit({ ...payload, format: event.target.value as InstagramFormat })
              }
            >
              {INSTAGRAM_FORMATS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
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
              {statusesFor("instagram").map((status) => (
                <option key={status} value={status}>
                  {STATUS_LABELS[status]}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-micro uppercase text-tertiary">Audio note</span>
            <input
              className={FIELD}
              value={payload.audioNote ?? ""}
              onChange={(event) => commit({ ...payload, audioNote: event.target.value })}
            />
          </label>

          <div className="flex flex-col gap-1">
            <span className="text-micro uppercase text-tertiary">Hook variants</span>
            {(payload.hookVariants ?? []).map((variant, index) => (
              <div key={index} className="flex items-center gap-1">
                <input
                  className={FIELD}
                  aria-label={`Hook variant ${index + 1}`}
                  value={variant}
                  onChange={(event) => {
                    const next = [...(payload.hookVariants ?? [])];
                    next[index] = event.target.value;
                    commit({ ...payload, hookVariants: next });
                  }}
                />
                <button
                  type="button"
                  aria-label={`Use hook variant ${index + 1}`}
                  onClick={() => {
                    /* Promotes the variant into the hook section, swapping the
                       one that was there so nothing is lost. */
                    const hookIndex = sections.findIndex((entry) => entry.kind === "hook");
                    if (hookIndex === -1) return;
                    const previous = sections[hookIndex]?.text ?? "";
                    const nextVariants = [...(payload.hookVariants ?? [])];
                    nextVariants[index] = previous;
                    commit({
                      ...payload,
                      hookVariants: nextVariants,
                      script: sections.map((entry, position) =>
                        position === hookIndex ? { ...entry, text: variant } : entry,
                      ),
                    });
                  }}
                  className="motion-hover shrink-0 rounded-control p-1 text-tertiary hover:bg-hover hover:text-primary"
                >
                  <ArrowUp className="icon-content" aria-hidden />
                </button>
              </div>
            ))}

            {(payload.hookVariants ?? []).length < MAX_HOOK_VARIANTS && (
              <button
                type="button"
                onClick={() =>
                  commit({ ...payload, hookVariants: [...(payload.hookVariants ?? []), ""] })
                }
                className="motion-hover flex items-center gap-1 self-start rounded-control px-2 py-1 text-micro text-tertiary hover:text-secondary"
              >
                <Plus className="icon-content" aria-hidden />
                Add a variant
              </button>
            )}
          </div>
        </div>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
          {sections.length === 0 && (
            <span className="text-meta text-tertiary">
              No sections yet, start with the hook
            </span>
          )}

          {sections.map((section, index) => (
            <div
              key={section.id}
              draggable
              onDragStart={() => setDragIndex(index)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                if (dragIndex !== null) setSections(reorderSections(sections, dragIndex, index));
                setDragIndex(null);
              }}
              className="flex items-start gap-2 rounded-control border border-hair p-2"
            >
              <GripVertical
                className="icon-content mt-1 shrink-0 cursor-grab text-disabled"
                aria-hidden
              />

              <button
                type="button"
                aria-label={`Change kind, currently ${section.kind}`}
                onClick={() => patchSection(index, { kind: nextKind(section.kind) })}
                className={`ig-gutter shrink-0 text-left text-micro uppercase ${KIND_TONE[section.kind]}`}
              >
                {section.kind}
              </button>

              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <textarea
                  rows={2}
                  aria-label={`${section.kind} line`}
                  className="w-full resize-none rounded-block border border-hair bg-surface px-1 py-1 text-body text-primary"
                  value={section.text}
                  onChange={(event) => patchSection(index, { text: event.target.value })}
                  onKeyDown={(event) => {
                    /* Enter at the end makes the next section, so a script can
                       be written straight through without reaching for a
                       button. Shift+Enter still breaks a line. */
                    const target = event.currentTarget;
                    if (
                      event.key === "Enter" &&
                      !event.shiftKey &&
                      target.selectionStart === target.value.length
                    ) {
                      event.preventDefault();
                      addSectionAfter(index);
                    } else if (event.key === "Tab" && !event.shiftKey) {
                      event.preventDefault();
                      patchSection(index, { kind: nextKind(section.kind) });
                    }
                  }}
                />

                <input
                  aria-label="What is on screen"
                  placeholder="what is on screen"
                  className="w-full rounded-block bg-transparent px-1 text-micro text-secondary"
                  value={section.bRoll ?? ""}
                  onChange={(event) => patchSection(index, { bRoll: event.target.value })}
                />
              </div>

              <input
                type="number"
                min={0}
                aria-label="Seconds"
                className="ig-seconds shrink-0 rounded-block border border-hair bg-surface px-1 text-micro tabular-nums text-tertiary"
                value={Math.round(sectionSeconds(section))}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  patchSection(index, {
                    seconds: Number.isFinite(next) && next >= 0 ? next : undefined,
                  });
                }}
              />

              <button
                type="button"
                aria-label="Remove this section"
                onClick={() =>
                  setSections(sections.filter((_, position) => position !== index))
                }
                className="motion-hover mt-1 shrink-0 text-tertiary hover:text-primary"
              >
                <X className="icon-content" aria-hidden />
              </button>
            </div>
          ))}

          <button
            type="button"
            onClick={() => addSectionAfter(sections.length - 1)}
            className="motion-hover flex items-center gap-1 self-start rounded-control px-2 py-1 text-meta text-tertiary hover:text-secondary"
          >
            <Plus className="icon-content" aria-hidden />
            Add a section
          </button>
        </div>

        <div
          ref={columnRef}
          className="ig-right flex shrink-0 flex-col gap-2 overflow-y-auto border-l border-hair p-3"
        >
          <span className="text-micro uppercase text-tertiary">References</span>

          <input
            className={FIELD}
            aria-label="Paste a link"
            placeholder="Paste a link"
            value={refDraft}
            onChange={(event) => setRefDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addReference();
              }
            }}
          />

          {refNote !== null && (
            <span className="text-micro text-tertiary">{refNote}</span>
          )}

          {(payload.references ?? []).map((reference) => (
            <div
              key={reference.id}
              className="flex flex-col gap-1 rounded-control border border-hair p-2"
            >
              {thumbs.has(reference.id) && (
                <img
                  src={thumbs.get(reference.id)}
                  alt=""
                  className="w-full rounded-block object-cover"
                />
              )}

              {reference.url !== "" && (
                <button
                  type="button"
                  onClick={() => void openUrl(reference.url)}
                  className="motion-hover truncate text-left text-micro text-accent hover:underline"
                >
                  {reference.url}
                </button>
              )}

              <input
                className="w-full rounded-block bg-transparent text-micro text-secondary"
                aria-label="Reference note"
                placeholder="Note"
                value={reference.note}
                onChange={(event) =>
                  commit({
                    ...payload,
                    references: (payload.references ?? []).map((entry) =>
                      entry.id === reference.id
                        ? { ...entry, note: event.target.value }
                        : entry,
                    ),
                  })
                }
              />

              <button
                type="button"
                aria-label="Remove this reference"
                onClick={() =>
                  commit({
                    ...payload,
                    references: (payload.references ?? []).filter(
                      (entry) => entry.id !== reference.id,
                    ),
                  })
                }
                className="motion-hover flex items-center gap-1 self-start text-micro text-tertiary hover:text-secondary"
              >
                <Trash2 className="icon-content" aria-hidden />
                Remove
              </button>
            </div>
          ))}

          <span className="text-micro text-disabled">
            Paste a screenshot anywhere in this column to attach it
          </span>
        </div>
      </div>
    </div>
  );
}
