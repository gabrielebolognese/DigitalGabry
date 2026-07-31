import { useEffect, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import {
  BLOCK_CATEGORIES,
  BLOCK_KINDS,
  BLOCK_STATUSES,
  PLATFORMS,
  type Block,
  type BlockCategory,
  type BlockKind,
  type BlockStatus,
  type Platform,
} from "../domain/block";
import { fromDateTimeLocal, toDateTimeLocal } from "../domain/time";

const CONTROL =
  "w-full rounded-control border border-line bg-surface px-2 py-1 text-body text-primary";

type InspectorProps = {
  block: Block;
  tz: string;
  autoFocusTitle?: boolean;
  onChange: (patch: Partial<Block>) => void;
  onClose: () => void;
};

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-micro uppercase text-tertiary">{label}</span>
      {children}
    </label>
  );
}

export default function Inspector({
  block,
  tz,
  autoFocusTitle = false,
  onChange,
  onClose,
}: InspectorProps) {
  const titleRef = useRef<HTMLInputElement>(null);
  const [tagsText, setTagsText] = useState(block.tags.join(", "));
  const [rawOpen, setRawOpen] = useState(false);
  const [rawText, setRawText] = useState(() => JSON.stringify(block, null, 2));
  const [rawError, setRawError] = useState<string | null>(null);

  // Resync only when a different block is selected. Resyncing on every edit
  // would overwrite whatever the user is part way through typing.
  useEffect(() => {
    setTagsText(block.tags.join(", "));
    setRawText(JSON.stringify(block, null, 2));
    setRawError(null);
  }, [block.id]);

  useEffect(() => {
    if (autoFocusTitle) titleRef.current?.focus();
  }, [autoFocusTitle, block.id]);

  function handleRawChange(value: string): void {
    setRawText(value);
    try {
      const parsed: unknown = JSON.parse(value);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        setRawError("Raw value must be an object");
        return;
      }
      setRawError(null);
    } catch {
      setRawError("Invalid JSON, nothing was written back");
    }
  }

  function handleRawBlur(): void {
    if (rawError !== null) return;
    try {
      const parsed: unknown = JSON.parse(rawText);
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        onChange(parsed as Partial<Block>);
      }
    } catch {
      setRawError("Invalid JSON, nothing was written back");
    }
  }

  return (
    <aside
      aria-label="Block inspector"
      className="inspector absolute inset-y-0 right-0 z-20 flex flex-col border-l border-line bg-elevated"
    >
      <header className="shell-header flex shrink-0 items-center justify-between border-b border-hair px-3">
        <span className="text-title text-primary">Block</span>
        <button
          type="button"
          aria-label="Close inspector"
          onClick={onClose}
          className="motion-hover flex items-center rounded-control p-1 text-tertiary hover:bg-hover hover:text-secondary"
        >
          <X className="icon-content" aria-hidden={true} />
        </button>
      </header>

      <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-3">
        <Field label="Title">
          <input
            ref={titleRef}
            className={CONTROL}
            value={block.title}
            onChange={(event) => onChange({ title: event.target.value })}
          />
        </Field>

        <div className="grid grid-cols-2 gap-2">
          <Field label="Kind">
            <select
              className={CONTROL}
              value={block.kind}
              onChange={(event) => onChange({ kind: event.target.value as BlockKind })}
            >
              {BLOCK_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {kind}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Category">
            <select
              className={CONTROL}
              value={block.category}
              onChange={(event) =>
                onChange({ category: event.target.value as BlockCategory })
              }
            >
              {BLOCK_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </Field>
        </div>

        {block.kind === "post" && (
          <Field label="Platform">
            <select
              className={CONTROL}
              value={block.payload.platform ?? ""}
              onChange={(event) =>
                onChange({
                  payload: {
                    ...block.payload,
                    platform:
                      event.target.value === ""
                        ? undefined
                        : (event.target.value as Platform),
                  },
                })
              }
            >
              <option value="">None</option>
              {PLATFORMS.map((platform) => (
                <option key={platform} value={platform}>
                  {platform}
                </option>
              ))}
            </select>
          </Field>
        )}

        <div className="grid grid-cols-2 gap-2">
          <Field label="Start">
            <input
              type="datetime-local"
              className={CONTROL}
              value={block.startUtc === null ? "" : toDateTimeLocal(block.startUtc, tz)}
              onChange={(event) => {
                const next = fromDateTimeLocal(event.target.value, tz);
                if (next !== null) onChange({ startUtc: next });
              }}
            />
          </Field>

          <Field label="End">
            <input
              type="datetime-local"
              className={CONTROL}
              value={block.endUtc === null ? "" : toDateTimeLocal(block.endUtc, tz)}
              onChange={(event) => {
                const next = fromDateTimeLocal(event.target.value, tz);
                if (next !== null) onChange({ endUtc: next });
              }}
            />
          </Field>
        </div>

        <Field label="Status">
          <select
            className={CONTROL}
            value={block.status}
            onChange={(event) => {
              const status = event.target.value as BlockStatus;
              onChange({
                status,
                completedUtc: status === "done" ? Date.now() : null,
              });
            }}
          >
            {BLOCK_STATUSES.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Project">
          <input
            className={CONTROL}
            value={block.projectId ?? ""}
            placeholder="None"
            onChange={(event) =>
              onChange({ projectId: event.target.value === "" ? null : event.target.value })
            }
          />
        </Field>

        <Field label="Tags">
          <input
            className={CONTROL}
            value={tagsText}
            placeholder="Comma separated"
            onChange={(event) => setTagsText(event.target.value)}
            onBlur={() =>
              onChange({
                tags: tagsText
                  .split(",")
                  .map((tag) => tag.trim())
                  .filter((tag) => tag !== ""),
              })
            }
          />
        </Field>

        <Field label="Description">
          <textarea
            rows={4}
            className={`${CONTROL} resize-none`}
            value={block.description ?? ""}
            onChange={(event) =>
              onChange({ description: event.target.value === "" ? null : event.target.value })
            }
          />
        </Field>

        <Field label="Recurrence">
          <input
            className={CONTROL}
            value={block.rrule ?? ""}
            placeholder="FREQ=WEEKLY;BYDAY=MO"
            onChange={(event) =>
              onChange({ rrule: event.target.value === "" ? null : event.target.value })
            }
          />
        </Field>

        <div className="flex flex-col gap-1">
          <button
            type="button"
            aria-expanded={rawOpen}
            onClick={() => setRawOpen((open) => !open)}
            className="motion-hover self-start rounded-control px-1 text-micro uppercase text-tertiary hover:text-secondary"
          >
            Raw
          </button>

          {rawOpen && (
            <>
              <textarea
                rows={12}
                spellCheck={false}
                aria-label="Raw block JSON"
                className={`${CONTROL} resize-none font-mono`}
                value={rawText}
                onChange={(event) => handleRawChange(event.target.value)}
                onBlur={handleRawBlur}
              />
              {rawError !== null && (
                <span className="text-micro text-cat-deadline">{rawError}</span>
              )}
            </>
          )}
        </div>
      </div>
    </aside>
  );
}
