import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { emit } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { newBlock, type Block } from "../domain/block";
import { uuidv7 } from "../domain/id";
import { DEFAULT_TZ, formatTime, formatWeekday } from "../domain/time";
import { insertBlock, listProjects } from "../db/repository";
import { BLOCKS_CHANGED } from "../store/events";
import { parseCapture, type ParsedCapture } from "./parser";

type QuickCaptureProps = {
  tz?: string;
};

function previewOf(parsed: ParsedCapture, tz: string): string {
  const parts: string[] = [parsed.kind];

  if (parsed.platform !== null) parts.push(parsed.platform);

  if (parsed.startUtc !== null) {
    parts.push(
      `${formatWeekday(parsed.startUtc, tz).toLowerCase()} ${formatTime(parsed.startUtc, tz)}`,
    );
  } else {
    parts.push("backlog");
  }

  if (parsed.projectName !== null) parts.push(`@${parsed.projectName}`);
  for (const tag of parsed.tags) parts.push(`#${tag}`);
  if (parsed.priority !== null) parts.push(`!${parsed.priority}`);

  return parts.join("  ·  ");
}

export default function QuickCapture({ tz = DEFAULT_TZ }: QuickCaptureProps) {
  const [text, setText] = useState("");
  const [nowUtc, setNowUtc] = useState<number>(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const parsed = useMemo(() => parseCapture(text, nowUtc, tz), [text, nowUtc, tz]);

  const hide = useCallback(async () => {
    await getCurrentWebviewWindow().hide();
  }, []);

  /* The window is shown rather than created, so it keeps whatever was typed
     last time unless it is reset when it comes back into view. */
  useEffect(() => {
    function onFocus(): void {
      setText("");
      setError(null);
      setNowUtc(Date.now());
      inputRef.current?.focus();
    }
    window.addEventListener("focus", onFocus);
    inputRef.current?.focus();
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  const save = useCallback(async () => {
    if (busy) return;
    if (parsed.title.trim() === "") return;

    setBusy(true);
    setError(null);
    try {
      let projectId: string | null = null;
      if (parsed.projectName !== null) {
        const wanted = parsed.projectName.toLowerCase();
        const projects = await listProjects();
        projectId =
          projects.find((project) => project.name.toLowerCase() === wanted)?.id ?? null;
      }

      const seed = newBlock({
        id: uuidv7(),
        startUtc: parsed.startUtc ?? 0,
        endUtc: parsed.endUtc ?? 0,
        tz,
        nowUtc: Date.now(),
        kind: parsed.kind,
        title: parsed.title,
      });

      const block: Block = {
        ...seed,
        // A capture with no date at all is unscheduled and belongs in the
        // backlog, which is what a null start means. SPEC 6.1.
        startUtc: parsed.startUtc,
        endUtc: parsed.endUtc,
        projectId,
        tags: [...parsed.tags],
        payload: {
          ...(parsed.platform === null ? {} : { platform: parsed.platform }),
          ...(parsed.priority === null ? {} : { priority: parsed.priority }),
        },
      };

      await insertBlock(block);
      await emit(BLOCKS_CHANGED);
      setText("");
      await hide();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [busy, parsed, tz, hide]);

  return (
    <div
      data-tauri-drag-region
      className="flex h-full w-full flex-col justify-center gap-2 border border-line bg-elevated px-4"
    >
      <input
        ref={inputRef}
        value={text}
        autoFocus
        spellCheck={false}
        aria-label="Quick capture"
        placeholder="Capture anything"
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void save();
          } else if (event.key === "Escape") {
            event.preventDefault();
            void hide();
          }
        }}
        className="w-full rounded-control border border-line bg-surface px-2 py-1 text-body text-primary"
      />

      <span className="truncate text-micro text-tertiary">
        {error ?? (text.trim() === "" ? "Enter to save, escape to close" : previewOf(parsed, tz))}
      </span>
    </div>
  );
}
