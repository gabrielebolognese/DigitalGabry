import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { emit } from "@tauri-apps/api/event";
import {
  Calendar,
  CalendarDays,
  DatabaseBackup,
  PanelRight,
  Redo2,
  Settings,
  TrendingUp,
  Undo2,
  Upload,
} from "lucide-react";
import { fuzzyRank } from "../domain/fuzzy";
import { DEFAULT_TZ, formatTime, formatWeekday } from "../domain/time";
import type { Block } from "../domain/block";
import {
  PLATFORM_LABELS,
  STATUS_LABELS,
  type ContentItem,
} from "../domain/content";
import { searchBlocks, searchContent } from "../db/repository";
import { redo, undo } from "../db/ops";
import { runBackup, runExport } from "../backup/run";
import { BLOCKS_CHANGED } from "../store/events";
import { ui } from "../store/useUiStore";
import { iconForBlock, type IconComponent } from "./blockIcon";
import { iconForPlatform } from "./platformIcon";
import type { ViewId } from "./Rail";

const SEARCH_DEBOUNCE_MS = 120;
const MAX_BLOCK_RESULTS = 8;

type ScheduledBlock = Block & { startUtc: number };

/* The icon stands in for the category word ("view", "data", "history") rather
   than sitting beside it, and `shortcut` is only filled where a real key
   binding exists. SPEC 3.6: an icon may replace a word, never decorate one. */
type Command = {
  id: string;
  label: string;
  shortcut: string;
  icon: IconComponent;
  run: () => void | Promise<void>;
};

type CommandPaletteProps = {
  onViewChange: (id: ViewId) => void;
  onTogglePanel: () => void;
  onGoToToday: () => void;
  tz?: string;
};

export default function CommandPalette({
  onViewChange,
  onTogglePanel,
  onGoToToday,
  tz = DEFAULT_TZ,
}: CommandPaletteProps) {
  const [open, setOpen] = useState(false);
  const [queryText, setQueryText] = useState("");
  const [blocks, setBlocks] = useState<readonly Block[]>([]);
  const [content, setContent] = useState<readonly ContentItem[]>([]);
  const [active, setActive] = useState(0);
  const [note, setNote] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  /* Focus goes back where it came from on close, or the user lands at the top
     of the document every time the palette is dismissed. */
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    setQueryText("");
    setBlocks([]);
    setContent([]);
    setActive(0);
    setNote(null);
    const target = returnFocusRef.current;
    returnFocusRef.current = null;
    if (target !== null && document.contains(target)) target.focus();
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() !== "k" || !(event.ctrlKey || event.metaKey)) {
        return;
      }
      event.preventDefault();
      if (open) {
        close();
        return;
      }
      returnFocusRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setOpen(true);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [close, open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const runAction = useCallback(
    (work: () => Promise<string>) => {
      setNote("Working");
      void work()
        .then((message) => {
          setNote(message);
          window.setTimeout(close, 900);
        })
        .catch((cause: unknown) => {
          setNote(cause instanceof Error ? cause.message : "That did not work");
        });
    },
    [close],
  );

  const commands = useMemo<readonly Command[]>(
    () => [
      {
        id: "view-calendar",
        label: "Go to calendar",
        shortcut: "",
        icon: Calendar,
        run: () => {
          onViewChange("calendar");
          close();
        },
      },
      {
        id: "view-momentum",
        label: "Go to momentum",
        shortcut: "",
        icon: TrendingUp,
        run: () => {
          onViewChange("momentum");
          close();
        },
      },
      {
        id: "view-settings",
        label: "Go to settings",
        shortcut: "",
        icon: Settings,
        run: () => {
          onViewChange("settings");
          close();
        },
      },
      {
        id: "go-today",
        label: "Go to today",
        shortcut: "T",
        icon: CalendarDays,
        run: () => {
          onViewChange("calendar");
          onGoToToday();
          close();
        },
      },
      {
        id: "toggle-panel",
        label: "Toggle assistant panel",
        shortcut: "Ctrl .",
        icon: PanelRight,
        run: () => {
          onTogglePanel();
          close();
        },
      },
      {
        id: "undo",
        label: "Undo last change",
        shortcut: "",
        icon: Undo2,
        run: () =>
          runAction(async () => {
            const batch = await undo();
            if (batch === null) return "Nothing to undo";
            await emit(BLOCKS_CHANGED);
            return "Undone";
          }),
      },
      {
        id: "redo",
        label: "Redo last change",
        shortcut: "",
        icon: Redo2,
        run: () =>
          runAction(async () => {
            const batch = await redo();
            if (batch === null) return "Nothing to redo";
            await emit(BLOCKS_CHANGED);
            return "Redone";
          }),
      },
      {
        id: "backup",
        label: "Back up now",
        shortcut: "",
        icon: DatabaseBackup,
        run: () =>
          runAction(async () => {
            const report = await runBackup(Date.now(), tz);
            return `Snapshot ${report.file}`;
          }),
      },
      {
        id: "export",
        label: "Export now",
        shortcut: "",
        icon: Upload,
        run: () =>
          runAction(async () => {
            const report = await runExport(Date.now(), tz);
            return `Exported ${report.months} months`;
          }),
      },
    ],
    [close, onGoToToday, onTogglePanel, onViewChange, runAction, tz],
  );

  useEffect(() => {
    if (!open) return;

    const term = queryText.trim();
    if (term === "") {
      setBlocks([]);
      setContent([]);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      /* Two indexes, one box. Settled together so the list does not reorder
         under the cursor as the slower of the two arrives. */
      void Promise.all([searchBlocks(term, 40), searchContent(term, 40)])
        .then(([foundBlocks, foundContent]) => {
          if (cancelled) return;
          setBlocks(foundBlocks);
          setContent(foundContent);
        })
        /* A search that fails must not take the palette down with it; the
           command half of the list still works without it. */
        .catch(() => {
          if (cancelled) return;
          setBlocks([]);
          setContent([]);
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, queryText]);

  const shownCommands = useMemo(
    () => fuzzyRank(queryText, commands, (command) => command.label),
    [commands, queryText],
  );

  /* FTS decides which blocks match; the fuzzy score only reorders what it
     returned, so a title the user has nearly typed in full sits above one that
     merely shares a word.

     Unscheduled blocks are dropped rather than listed. Choosing a result means
     "show me this on the calendar", and a block with no start has nowhere to
     be shown until there is a backlog view to send it to. */
  const shownBlocks = useMemo(() => {
    const scheduled = blocks.filter(
      (block): block is ScheduledBlock => block.startUtc !== null,
    );
    return fuzzyRank(queryText, scheduled, (block) => block.title).slice(
      0,
      MAX_BLOCK_RESULTS,
    );
  }, [blocks, queryText]);

  const shownContent = useMemo(
    () =>
      fuzzyRank(queryText, content, (item) => item.title).slice(0, MAX_BLOCK_RESULTS),
    [content, queryText],
  );

  const rows = useMemo(
    () => [
      ...shownCommands.map((command) => ({ kind: "command" as const, command })),
      ...shownBlocks.map((block) => ({ kind: "block" as const, block })),
      ...shownContent.map((item) => ({ kind: "content" as const, item })),
    ],
    [shownBlocks, shownCommands, shownContent],
  );

  useEffect(() => {
    setActive((current) => (current < rows.length ? current : 0));
  }, [rows.length]);

  const activate = useCallback(
    (index: number) => {
      const row = rows[index];
      if (row === undefined) return;
      if (row.kind === "command") {
        void row.command.run();
        return;
      }
      if (row.kind === "content") {
        ui.revealContent(row.item.platform, row.item.id);
        onViewChange("content");
        close();
        return;
      }
      ui.revealEntry(row.block.id, row.block.startUtc);
      onViewChange("calendar");
      close();
    },
    [close, onViewChange, rows],
  );

  useEffect(() => {
    const row = listRef.current?.querySelector(`[data-index="${active}"]`);
    if (row instanceof HTMLElement) row.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    /* While the palette is open it owns the keyboard. WeekView listens on
       window and handles Escape before its own "is the user typing" guard, so
       without this, dismissing the palette would also close the inspector.
       Ctrl+K is the exception, since the toggle that closes the palette is the
       window listener above. */
    const isToggle = event.key.toLowerCase() === "k" && (event.ctrlKey || event.metaKey);
    if (!isToggle) event.stopPropagation();

    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((current) => (rows.length === 0 ? 0 : (current + 1) % rows.length));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((current) =>
        rows.length === 0 ? 0 : (current - 1 + rows.length) % rows.length,
      );
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      activate(active);
      return;
    }
    /* The palette is the only thing the user is talking to while it is open,
       and it holds focus on a single input, so Tab has nowhere useful to go. */
    if (event.key === "Tab") event.preventDefault();
  };

  const renderRow = (index: number, node: ReactElement): ReactElement => (
    <div
      key={index}
      id={`palette-row-${index}`}
      data-index={index}
      role="option"
      aria-selected={index === active}
      onMouseMove={() => setActive(index)}
      onClick={() => activate(index)}
      className={`palette-row motion-hover flex cursor-default items-center gap-2 rounded-control px-2 ${
        index === active ? "bg-selected text-primary" : "text-secondary"
      }`}
    >
      {node}
    </div>
  );

  return (
    <div
      className="scrim fixed inset-0 z-50 flex justify-center"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onKeyDown={handleKeyDown}
        className="palette-shell flex h-fit flex-col overflow-hidden rounded-panel border border-line bg-elevated"
      >
        {/* No leading search icon: the placeholder already says what this is,
            and SPEC 3.6 does not allow an icon to decorate a word. */}
        <div className="flex items-center border-b border-hair px-3">
          <input
            ref={inputRef}
            role="combobox"
            aria-expanded
            aria-controls="palette-list"
            aria-activedescendant={rows.length === 0 ? undefined : `palette-row-${active}`}
            aria-label="Search blocks, views and actions"
            autoComplete="off"
            spellCheck={false}
            placeholder="Search blocks, views and actions"
            value={queryText}
            onChange={(event) => {
              setQueryText(event.target.value);
              setActive(0);
            }}
            className="shell-panel-input min-w-0 flex-1 rounded-control bg-transparent text-body text-primary placeholder:text-tertiary"
          />
        </div>

        <div
          ref={listRef}
          id="palette-list"
          role="listbox"
          aria-label="Results"
          className="palette-list flex flex-col gap-1 overflow-y-auto p-2"
        >
          {rows.length === 0 ? (
            <span className="px-2 py-2 text-meta text-tertiary">
              Nothing matches that yet
            </span>
          ) : (
            rows.map((row, index) => {
              if (row.kind === "command") {
                const Icon = row.command.icon;
                return renderRow(
                  index,
                  <>
                    <Icon className="icon-content shrink-0" aria-hidden />
                    <span className="min-w-0 flex-1 truncate text-meta">
                      {row.command.label}
                    </span>
                    {row.command.shortcut !== "" && (
                      <span className="shrink-0 text-micro text-tertiary">
                        {row.command.shortcut}
                      </span>
                    )}
                  </>,
                );
              }

              if (row.kind === "content") {
                const PlatformIcon = iconForPlatform(row.item.platform);
                return renderRow(
                  index,
                  <>
                    <PlatformIcon className="icon-content shrink-0" aria-hidden />
                    <span className="min-w-0 flex-1 truncate text-meta">
                      {row.item.title === "" ? "Untitled" : row.item.title}
                    </span>
                    <span className="shrink-0 text-micro text-tertiary">
                      {`${PLATFORM_LABELS[row.item.platform]} ${STATUS_LABELS[row.item.status]}`}
                    </span>
                  </>,
                );
              }

              const Icon = iconForBlock(row.block);
              return renderRow(
                index,
                <>
                  <Icon className="icon-content shrink-0" aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-meta">
                    {row.block.title === "" ? "Untitled" : row.block.title}
                  </span>
                  <span className="shrink-0 text-micro text-tertiary">
                    {formatWeekday(row.block.startUtc, tz)}{" "}
                    {formatTime(row.block.startUtc, tz)}
                  </span>
                </>,
              );
            })
          )}
        </div>

        <div className="flex items-center border-t border-hair px-3 py-2">
          <span className="text-micro text-tertiary">
            {note ?? "Enter to run, escape to dismiss"}
          </span>
        </div>
      </div>
    </div>
  );
}
