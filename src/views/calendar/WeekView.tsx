import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import BlockBox from "../../components/Block";
import Inspector from "../../components/Inspector";
import Toast from "../../components/Toast";
import {
  isScheduled,
  newBlock,
  type Block,
  type ScheduledBlock,
} from "../../domain/block";
import { uuidv7 } from "../../domain/id";
import {
  layoutDay,
  type DayLayout,
  type Overflow,
  type Placement,
  type Span,
} from "../../domain/layout";
import {
  DAYS_PER_WEEK,
  DEFAULT_HOUR_HEIGHT,
  DEFAULT_TZ,
  MINUTES_PER_DAY,
  MINUTES_PER_HOUR,
  SNAP_MINUTES,
  daysOfWeek,
  endOfLocalDay,
  formatDayNumber,
  formatMonthYear,
  formatWeekday,
  isSameLocalDay,
  localMinutesOfDay,
  minutesToPixels,
  minutesWithinDay,
  pixelsToMinutes,
  shiftWeeks,
  snapToGrid,
  startOfLocalDay,
  utcFromDayMinutes,
  weekRange,
  zoomBy,
  type HourHeight,
  type UtcMillis,
} from "../../domain/time";
import { useBlocks } from "../../store/useBlocks";
import { ui, useUiStore } from "../../store/useUiStore";
import NowLine from "./NowLine";
import TimeGutter from "./TimeGutter";

const NOW_TICK_MS = 30_000;

/* Below this the gesture is a click, above it a drag. Without it every click
   would nudge a block by whatever the pointer drifted during the press. */
const DRAG_THRESHOLD_PX = 3;

/* Opening on midnight would spend the top third of the viewport on hours that
   are almost never used. SPEC does not state a landing hour. */
const INITIAL_SCROLL_HOUR = 7;

type DayBlock = Span & { block: ScheduledBlock };

type Slot = { dayIndex: number; minutes: number };

type Preview = { dayIndex: number; startMin: number; endMin: number };

type DragMode = "move" | "resize-start" | "resize-end" | "create";

type Drag = {
  mode: DragMode;
  blockId: string | null;
  originX: number;
  originY: number;
  anchorDay: number;
  anchorMin: number;
  grabOffsetMin: number;
  durationMin: number;
  fixedMin: number;
  moved: boolean;
  preview: Preview | null;
};

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function samePreview(a: Preview | null, b: Preview | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.dayIndex === b.dayIndex && a.startMin === b.startMin && a.endMin === b.endMin
  );
}

function computePreview(drag: Drag, slot: Slot): Preview {
  const snapped = snapToGrid(slot.minutes);

  switch (drag.mode) {
    case "move": {
      const startMin = clamp(
        snapToGrid(snapped - drag.grabOffsetMin),
        0,
        MINUTES_PER_DAY - drag.durationMin,
      );
      return { dayIndex: slot.dayIndex, startMin, endMin: startMin + drag.durationMin };
    }
    case "resize-end": {
      const endMin = clamp(snapped, drag.fixedMin + SNAP_MINUTES, MINUTES_PER_DAY);
      return { dayIndex: drag.anchorDay, startMin: drag.fixedMin, endMin };
    }
    case "resize-start": {
      const startMin = clamp(snapped, 0, drag.fixedMin - SNAP_MINUTES);
      return { dayIndex: drag.anchorDay, startMin, endMin: drag.fixedMin };
    }
    case "create": {
      const low = Math.min(drag.anchorMin, snapped);
      const high = Math.max(drag.anchorMin, snapped);
      return {
        dayIndex: drag.anchorDay,
        startMin: clamp(low, 0, MINUTES_PER_DAY - SNAP_MINUTES),
        endMin: clamp(Math.max(high, low + SNAP_MINUTES), SNAP_MINUTES, MINUTES_PER_DAY),
      };
    }
  }
}

function blockGeometry(span: Span, placement: Placement): CSSProperties {
  const columnWidth = `calc((100% - 2 * var(--block-inset) - ${placement.columns - 1} * var(--block-gap)) / ${placement.columns})`;

  return {
    top: `calc(var(--hour-h) * ${span.startMin / MINUTES_PER_HOUR})`,
    height: `max(calc(var(--hour-h) * ${(span.endMin - span.startMin) / MINUTES_PER_HOUR}), var(--block-min-h))`,
    left: `calc(var(--block-inset) + (${columnWidth} + var(--block-gap)) * ${placement.column})`,
    width: columnWidth,
  };
}

function spanGeometry(startMin: number, endMin: number): CSSProperties {
  return {
    top: `calc(var(--hour-h) * ${startMin / MINUTES_PER_HOUR})`,
    height: `max(calc(var(--hour-h) * ${(endMin - startMin) / MINUTES_PER_HOUR}), var(--block-min-h))`,
    left: "var(--block-inset)",
    right: "var(--block-inset)",
  };
}

function overflowGeometry(entry: Overflow): CSSProperties {
  return {
    top: `calc(var(--hour-h) * ${entry.startMin / MINUTES_PER_HOUR})`,
    left: "var(--block-inset)",
    right: "var(--block-inset)",
  };
}

type DayColumnProps = {
  layout: DayLayout<DayBlock>;
  tz: string;
  nowUtc: number;
  hourHeight: HourHeight;
  isToday: boolean;
  selectedBlockId: string | null;
  editingBlockId: string | null;
  draggingBlockId: string | null;
  ghost: Preview | null;
  onTitleCommit: (id: string, title: string) => void;
  onTitleCancel: () => void;
};

function DayColumn({
  layout,
  tz,
  nowUtc,
  hourHeight,
  isToday,
  selectedBlockId,
  editingBlockId,
  draggingBlockId,
  ghost,
  onTitleCommit,
  onTitleCancel,
}: DayColumnProps) {
  return (
    <div className="cal-column cal-body relative min-w-0 flex-1 border-l border-hair">
      {layout.placed.map(({ item, placement }) => (
        <div
          key={item.block.id}
          className="absolute"
          style={blockGeometry(item, placement)}
        >
          <BlockBox
            block={item.block}
            tz={tz}
            nowUtc={nowUtc}
            heightPx={minutesToPixels(item.endMin - item.startMin, hourHeight)}
            selected={item.block.id === selectedBlockId}
            dragging={item.block.id === draggingBlockId}
            editing={item.block.id === editingBlockId}
            onTitleCommit={(title) => onTitleCommit(item.block.id, title)}
            onTitleCancel={onTitleCancel}
          />
        </div>
      ))}

      {layout.overflow.map((entry) => (
        <div
          key={`overflow-${entry.startMin}`}
          className="block-overflow absolute z-10 flex items-center justify-center text-micro"
          style={overflowGeometry(entry)}
        >
          {`+${entry.count} more`}
        </div>
      ))}

      {ghost !== null && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute z-10 rounded-block border border-line-strong bg-selected"
          style={spanGeometry(ghost.startMin, ghost.endMin)}
        />
      )}

      {isToday && <NowLine nowUtc={nowUtc} tz={tz} />}
    </div>
  );
}

type WeekViewProps = {
  tz?: string;
};

export default function WeekView({ tz = DEFAULT_TZ }: WeekViewProps) {
  const [hourHeight, setHourHeight] = useState<HourHeight>(DEFAULT_HOUR_HEIGHT);
  const [nowUtc, setNowUtc] = useState<UtcMillis>(() => Date.now());
  const [anchorUtc, setAnchorUtc] = useState<UtcMillis>(() => Date.now());
  const [drag, setDrag] = useState<Drag | null>(null);
  const [toast, setToast] = useState<{
    message: string;
    undoBlockId: string | null;
  } | null>(null);
  const [createdBlockId, setCreatedBlockId] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const columnsRef = useRef<HTMLDivElement>(null);
  const zoomAnchor = useRef<{ minutes: number; offsetY: number } | null>(null);
  const landed = useRef(false);

  const { selectedBlockId, inspectorOpen, editingTitleBlockId } = useUiStore();

  useEffect(() => {
    const id = window.setInterval(() => setNowUtc(Date.now()), NOW_TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  const range = useMemo(() => weekRange(anchorUtc, tz), [anchorUtc, tz]);
  const days = useMemo(() => daysOfWeek(anchorUtc, tz), [anchorUtc, tz]);

  const { blocks, loading, error, createBlock, updateBlock, softDeleteBlock, restoreBlock } =
    useBlocks(range, tz);

  // A write that the database rejected has already been rolled back in the
  // store; the user still needs to be told the change did not stick.
  useEffect(() => {
    if (error === null) return;
    setToast({ message: "Could not save, the change was rolled back", undoBlockId: null });
  }, [error]);

  const selectedBlock: Block | null = useMemo(
    () => blocks.find((block) => block.id === selectedBlockId) ?? null,
    [blocks, selectedBlockId],
  );

  // While a move or resize is in flight the dragged block is laid out from the
  // preview, so it lands in the right column even when the pointer crosses days.
  const effectiveBlocks = useMemo(() => {
    const preview = drag?.preview;
    if (drag === null || preview === undefined || preview === null || drag.blockId === null) {
      return blocks;
    }
    const dayStart = days[preview.dayIndex];
    return blocks.map((block) =>
      block.id === drag.blockId
        ? {
            ...block,
            startUtc: utcFromDayMinutes(dayStart, preview.startMin, tz),
            endUtc: utcFromDayMinutes(dayStart, preview.endMin, tz),
          }
        : block,
    );
  }, [blocks, drag, days, tz]);

  const layouts = useMemo(
    () =>
      days.map((dayStart) => {
        const day = { start: dayStart, end: endOfLocalDay(dayStart, tz) };
        const spans: DayBlock[] = effectiveBlocks
          .filter(isScheduled)
          .filter((block) => block.startUtc < day.end && block.endUtc > day.start)
          .map((block) => ({
            block,
            startMin: minutesWithinDay(block.startUtc, day, tz),
            endMin: minutesWithinDay(block.endUtc, day, tz),
          }));
        return layoutDay(spans);
      }),
    [effectiveBlocks, days, tz],
  );

  const orderedBlocks = useMemo(
    () =>
      effectiveBlocks
        .filter(isScheduled)
        .slice()
        .sort((a, b) => a.startUtc - b.startUtc || a.id.localeCompare(b.id)),
    [effectiveBlocks],
  );

  const slotFromPointer = useCallback(
    (clientX: number, clientY: number): Slot | null => {
      const element = columnsRef.current;
      if (element === null) return null;
      const rect = element.getBoundingClientRect();
      const columnWidth = rect.width / DAYS_PER_WEEK;
      return {
        dayIndex: clamp(
          Math.floor((clientX - rect.left) / columnWidth),
          0,
          DAYS_PER_WEEK - 1,
        ),
        minutes: pixelsToMinutes(clientY - rect.top, hourHeight),
      };
    },
    [hourHeight],
  );

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>): void {
    if (event.button !== 0) return;
    if (!(event.target instanceof HTMLElement)) return;

    const slot = slotFromPointer(event.clientX, event.clientY);
    if (slot === null) return;

    const blockElement = event.target.closest("[data-block-id]");
    const resizeElement = event.target.closest("[data-resize]");
    const base = {
      originX: event.clientX,
      originY: event.clientY,
      moved: false,
      preview: null,
    };

    event.currentTarget.setPointerCapture(event.pointerId);

    if (blockElement instanceof HTMLElement) {
      const blockId = blockElement.dataset.blockId;
      const block = blocks.find((candidate) => candidate.id === blockId);
      if (blockId === undefined || block === undefined || !isScheduled(block)) return;

      const dayIndex = days.indexOf(startOfLocalDay(block.startUtc, tz));
      const startMin = localMinutesOfDay(block.startUtc, tz);
      const durationMin = (block.endUtc - block.startUtc) / 60_000;
      const endMin = startMin + durationMin;
      const edge =
        resizeElement instanceof HTMLElement ? resizeElement.dataset.resize : undefined;

      setDrag({
        ...base,
        mode: edge === "start" ? "resize-start" : edge === "end" ? "resize-end" : "move",
        blockId,
        anchorDay: dayIndex < 0 ? slot.dayIndex : dayIndex,
        anchorMin: startMin,
        grabOffsetMin: snapToGrid(slot.minutes) - startMin,
        durationMin,
        fixedMin: edge === "start" ? endMin : startMin,
      });
      return;
    }

    setDrag({
      ...base,
      mode: "create",
      blockId: null,
      anchorDay: slot.dayIndex,
      anchorMin: snapToGrid(slot.minutes),
      grabOffsetMin: 0,
      durationMin: SNAP_MINUTES,
      fixedMin: 0,
    });
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>): void {
    if (drag === null) return;

    const passedThreshold =
      drag.moved ||
      Math.abs(event.clientX - drag.originX) > DRAG_THRESHOLD_PX ||
      Math.abs(event.clientY - drag.originY) > DRAG_THRESHOLD_PX;
    if (!passedThreshold) return;

    const slot = slotFromPointer(event.clientX, event.clientY);
    if (slot === null) return;

    const preview = computePreview(drag, slot);

    // Only re-render when the snapped slot actually changes, so a drag costs one
    // render per quarter hour crossed rather than one per pointer event.
    setDrag((previous) => {
      if (previous === null) return null;
      if (previous.moved && samePreview(previous.preview, preview)) return previous;
      return { ...previous, moved: true, preview };
    });
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>): void {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (drag === null) return;

    const finished = drag;
    setDrag(null);

    if (!finished.moved) {
      if (finished.blockId !== null) ui.selectBlock(finished.blockId);
      else ui.clearSelection();
      return;
    }

    const preview = finished.preview;
    if (preview === null) return;

    const dayStart = days[preview.dayIndex];
    const startUtc = utcFromDayMinutes(dayStart, preview.startMin, tz);
    const endUtc = utcFromDayMinutes(dayStart, preview.endMin, tz);

    if (finished.mode === "create") {
      const created = newBlock({
        id: uuidv7(),
        startUtc,
        endUtc,
        tz,
        nowUtc: Date.now(),
      });
      createBlock(created);
      setCreatedBlockId(created.id);
      ui.selectBlock(created.id);
      return;
    }

    if (finished.blockId !== null) {
      updateBlock(finished.blockId, { startUtc, endUtc });
    }
  }

  function handleDoubleClick(event: ReactMouseEvent<HTMLDivElement>): void {
    if (!(event.target instanceof HTMLElement)) return;
    const blockElement = event.target.closest("[data-block-id]");
    if (!(blockElement instanceof HTMLElement)) return;
    const blockId = blockElement.dataset.blockId;
    if (blockId !== undefined) ui.startTitleEdit(blockId);
  }

  const handleTitleCommit = useCallback(
    (id: string, title: string) => {
      updateBlock(id, { title });
      ui.stopTitleEdit();
    },
    [updateBlock],
  );

  const dismissToast = useCallback(() => setToast(null), []);

  const moveSelection = useCallback(
    (direction: "up" | "down" | "left" | "right") => {
      if (orderedBlocks.length === 0) return;

      const current = orderedBlocks.find((block) => block.id === selectedBlockId);
      if (current === undefined) {
        ui.selectBlock(orderedBlocks[0].id);
        return;
      }

      if (direction === "up" || direction === "down") {
        const index = orderedBlocks.indexOf(current);
        const next = orderedBlocks[direction === "down" ? index + 1 : index - 1];
        if (next !== undefined) ui.selectBlock(next.id);
        return;
      }

      const step = direction === "right" ? 1 : -1;
      const currentMinutes = localMinutesOfDay(current.startUtc, tz);
      const dayIndex = days.indexOf(startOfLocalDay(current.startUtc, tz));

      for (let day = dayIndex + step; day >= 0 && day < days.length; day += step) {
        const candidates = orderedBlocks.filter(
          (block) => startOfLocalDay(block.startUtc, tz) === days[day],
        );
        if (candidates.length === 0) continue;
        const nearest = candidates.reduce((best, candidate) =>
          Math.abs(localMinutesOfDay(candidate.startUtc, tz) - currentMinutes) <
          Math.abs(localMinutesOfDay(best.startUtc, tz) - currentMinutes)
            ? candidate
            : best,
        );
        ui.selectBlock(nearest.id);
        return;
      }
    },
    [orderedBlocks, selectedBlockId, days, tz],
  );

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        if (editingTitleBlockId !== null) ui.stopTitleEdit();
        else ui.closeInspector();
        return;
      }

      const target = event.target;
      const typing =
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);
      if (typing) return;

      if (event.key === "t" || event.key === "T") {
        event.preventDefault();
        setAnchorUtc(Date.now());
        return;
      }

      /* SPEC 10 gives the arrows to the previous and next period, PLAN phase 3
         gives them to block selection. With a block selected they move the
         selection; with nothing selected they move the week. */
      if (selectedBlockId === null) {
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          setAnchorUtc((current) => shiftWeeks(current, tz, -1));
        } else if (event.key === "ArrowRight") {
          event.preventDefault();
          setAnchorUtc((current) => shiftWeeks(current, tz, 1));
        }
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        const block = blocks.find((candidate) => candidate.id === selectedBlockId);
        if (block === undefined) return;
        const done = block.status === "done";
        updateBlock(selectedBlockId, {
          status: done ? "open" : "done",
          completedUtc: done ? null : Date.now(),
        });
        return;
      }

      if (event.key === "Delete") {
        event.preventDefault();
        softDeleteBlock(selectedBlockId);
        setToast({ message: "Block deleted", undoBlockId: selectedBlockId });
        ui.clearSelection();
        return;
      }

      const arrows: Record<string, "up" | "down" | "left" | "right"> = {
        ArrowUp: "up",
        ArrowDown: "down",
        ArrowLeft: "left",
        ArrowRight: "right",
      };
      const direction = arrows[event.key];
      if (direction !== undefined) {
        event.preventDefault();
        moveSelection(direction);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    blocks,
    selectedBlockId,
    editingTitleBlockId,
    updateBlock,
    softDeleteBlock,
    moveSelection,
  ]);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (element === null || landed.current) return;
    landed.current = true;
    element.scrollTop = minutesToPixels(
      INITIAL_SCROLL_HOUR * MINUTES_PER_HOUR,
      hourHeight,
    );
  }, [hourHeight]);

  // Ctrl+wheel would otherwise zoom the whole webview, so the listener has to
  // be non passive to cancel it.
  useEffect(() => {
    const element = scrollRef.current;
    if (element === null) return;

    const handleWheel = (event: WheelEvent): void => {
      if (!event.ctrlKey) return;
      event.preventDefault();

      const next = zoomBy(hourHeight, event.deltaY < 0 ? 1 : -1);
      if (next === hourHeight) return;

      const offsetY = event.clientY - element.getBoundingClientRect().top;
      zoomAnchor.current = {
        minutes: pixelsToMinutes(element.scrollTop + offsetY, hourHeight),
        offsetY,
      };
      setHourHeight(next);
    };

    element.addEventListener("wheel", handleWheel, { passive: false });
    return () => element.removeEventListener("wheel", handleWheel);
  }, [hourHeight]);

  // Keep whatever minute sat under the cursor pinned there across the zoom.
  useLayoutEffect(() => {
    const anchor = zoomAnchor.current;
    const element = scrollRef.current;
    if (anchor === null || element === null) return;
    zoomAnchor.current = null;
    element.scrollTop = minutesToPixels(anchor.minutes, hourHeight) - anchor.offsetY;
  }, [hourHeight]);

  const createGhost =
    drag !== null && drag.mode === "create" && drag.moved ? drag.preview : null;

  const weekIsEmpty = !loading && layouts.every((layout) => layout.placed.length === 0);

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <header className="shell-header flex shrink-0 items-center gap-1 border-b border-hair px-3">
        <span className="text-title text-primary">
          {formatMonthYear(range.start, tz)}
        </span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => setAnchorUtc(Date.now())}
          className="motion-hover rounded-control px-2 py-1 text-meta text-secondary hover:bg-hover hover:text-primary"
        >
          Today
        </button>
        <button
          type="button"
          aria-label="Previous week"
          onClick={() => setAnchorUtc((current) => shiftWeeks(current, tz, -1))}
          className="motion-hover flex rounded-control p-1 text-tertiary hover:bg-hover hover:text-primary"
        >
          <ChevronLeft className="icon-content" aria-hidden={true} />
        </button>
        <button
          type="button"
          aria-label="Next week"
          onClick={() => setAnchorUtc((current) => shiftWeeks(current, tz, 1))}
          className="motion-hover flex rounded-control p-1 text-tertiary hover:bg-hover hover:text-primary"
        >
          <ChevronRight className="icon-content" aria-hidden={true} />
        </button>
      </header>

      <div className="cal-day-header flex shrink-0 border-b border-hair">
        <div className="cal-gutter shrink-0" />
        {days.map((dayStart) => {
          const today = isSameLocalDay(dayStart, nowUtc, tz);
          const tone = today ? "text-primary" : "text-secondary";
          return (
            <div
              key={dayStart}
              className="flex min-w-0 flex-1 items-center justify-center gap-1 border-l border-hair"
            >
              <span className={`text-micro uppercase ${tone}`}>
                {formatWeekday(dayStart, tz)}
              </span>
              <span className={`text-micro ${tone}`}>
                {formatDayNumber(dayStart, tz)}
              </span>
            </div>
          );
        })}
      </div>

      <div className="relative min-h-0 flex-1">
        {weekIsEmpty && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
            <span className="text-meta text-tertiary">
              Drag anywhere to add your first block
            </span>
          </div>
        )}
      <div ref={scrollRef} className="cal-scroll h-full overflow-y-auto">
        <div
          className="flex"
          style={{ "--hour-h": `${hourHeight}px` } as CSSProperties}
        >
          <TimeGutter />
          <div
            ref={columnsRef}
            className="flex min-w-0 flex-1 touch-none select-none"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onDoubleClick={handleDoubleClick}
          >
            {days.map((dayStart, index) => (
              <DayColumn
                key={dayStart}
                layout={layouts[index]}
                tz={tz}
                nowUtc={nowUtc}
                hourHeight={hourHeight}
                isToday={isSameLocalDay(dayStart, nowUtc, tz)}
                selectedBlockId={selectedBlockId}
                editingBlockId={editingTitleBlockId}
                draggingBlockId={drag?.moved === true ? drag.blockId : null}
                ghost={createGhost !== null && createGhost.dayIndex === index ? createGhost : null}
                onTitleCommit={handleTitleCommit}
                onTitleCancel={ui.stopTitleEdit}
              />
            ))}
          </div>
        </div>
      </div>
      </div>

      {inspectorOpen && selectedBlock !== null && (
        <Inspector
          block={selectedBlock}
          tz={tz}
          autoFocusTitle={selectedBlock.id === createdBlockId}
          onChange={(patch) => updateBlock(selectedBlock.id, patch)}
          onClose={ui.closeInspector}
        />
      )}

      {toast !== null && (
        <Toast
          message={toast.message}
          action={
            toast.undoBlockId === null
              ? undefined
              : {
                  label: "Undo",
                  onAct: () => {
                    const id = toast.undoBlockId;
                    if (id === null) return;
                    restoreBlock(id);
                    ui.selectBlock(id);
                    setToast(null);
                  },
                }
          }
          onDismiss={dismissToast}
        />
      )}
    </div>
  );
}
