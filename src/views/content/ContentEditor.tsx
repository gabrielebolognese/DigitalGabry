import { useCallback, useEffect, useState } from "react";
import {
  STATUS_LABELS,
  statusesFor,
  type ContentItem,
  type ContentPlatform,
  type ContentStatus,
} from "../../domain/content";
import { DEFAULT_TZ, fromDateTimeLocal, toDateTimeLocal } from "../../domain/time";
import { contentTags, setContentTags, type Project } from "../../db/repository";
import { scheduleItem, unscheduleItem } from "../../content/linkToBlock";

/* The shared editor. Title, body, status, project, tags and the schedule
   control, with nothing platform specific in it at all.

   Spec2 section 5 asks for exactly this for YouTube, and the acceptance
   criterion is that creating, editing, scheduling and searching all work
   through shared components with zero YouTube specific code paths. So there is
   no YouTube in this file, and there is no YouTube view: the platform reaches
   it through the same grid as everything else. */

const FIELD =
  "w-full rounded-control border border-line bg-surface px-2 py-1 text-body text-primary";

type ContentEditorProps = {
  item: ContentItem;
  platform: ContentPlatform;
  projects: readonly Project[];
  tz?: string;
  onPatch: (patch: Partial<ContentItem>) => Promise<void>;
  onChanged: () => void;
  onClose: () => void;
};

export default function ContentEditor({
  item,
  platform,
  projects,
  tz = DEFAULT_TZ,
  onPatch,
  onChanged,
  onClose,
}: ContentEditorProps) {
  const [tags, setTags] = useState("");
  const [when, setWhen] = useState("");
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    void contentTags(item.id).then((names) => setTags(names.join(", ")));
  }, [item.id]);

  const saveTags = useCallback(async () => {
    await setContentTags(
      item.id,
      tags.split(",").map((name) => name.trim()),
    );
    onChanged();
  }, [item.id, tags, onChanged]);

  const schedule = useCallback(async () => {
    const startUtc = fromDateTimeLocal(when, tz);
    if (startUtc === null) {
      setNote("Pick a date and time first");
      return;
    }
    await scheduleItem({ item, startUtc, tz, nowUtc: Date.now() });
    setNote("Scheduled");
    onChanged();
  }, [when, item, tz, onChanged]);

  return (
    <div
      role="dialog"
      aria-label="Edit item"
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
        <span className="text-title text-primary">Item</span>

        <label className="flex flex-col gap-1">
          <span className="text-micro uppercase text-tertiary">Title</span>
          <input
            className={FIELD}
            value={item.title}
            onChange={(event) => void onPatch({ title: event.target.value })}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-micro uppercase text-tertiary">Notes</span>
          <textarea
            rows={8}
            className={FIELD}
            value={item.body}
            onChange={(event) => void onPatch({ body: event.target.value })}
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
            {statusesFor(platform).map((status) => (
              <option key={status} value={status}>
                {STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-micro uppercase text-tertiary">Project</span>
          <select
            className={FIELD}
            value={item.projectId ?? ""}
            onChange={(event) =>
              void onPatch({
                projectId: event.target.value === "" ? null : event.target.value,
              })
            }
          >
            <option value="">No project</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-micro uppercase text-tertiary">Tags</span>
          <input
            className={FIELD}
            value={tags}
            placeholder="deep, launch"
            onChange={(event) => setTags(event.target.value)}
            onBlur={() => void saveTags()}
          />
        </label>

        {/* Scheduling creates a linked post block, which is the only thing that
            puts an item on the calendar. Invariant 15: they link, they do not
            duplicate. */}
        <div className="flex flex-col gap-1">
          <span className="text-micro uppercase text-tertiary">Schedule</span>
          <input
            type="datetime-local"
            className={FIELD}
            aria-label="Scheduled time"
            value={when}
            onChange={(event) => setWhen(event.target.value)}
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void schedule()}
              className="motion-hover rounded-control border border-line px-2 py-1 text-meta text-primary hover:bg-hover"
            >
              Schedule
            </button>
            {item.blockId !== null && (
              <button
                type="button"
                onClick={() => {
                  void unscheduleItem(item.id).then(() => {
                    setNote("Unscheduled");
                    onChanged();
                  });
                }}
                className="motion-hover rounded-control px-2 py-1 text-meta text-tertiary hover:text-secondary"
              >
                Unschedule
              </button>
            )}
          </div>
          {item.blockId !== null && (
            <span className="text-micro text-disabled">
              {`On the calendar since ${toDateTimeLocal(item.updatedUtc, tz)}`}
            </span>
          )}
        </div>

        {note !== null && <span className="text-meta text-secondary">{note}</span>}
      </aside>
    </div>
  );
}
