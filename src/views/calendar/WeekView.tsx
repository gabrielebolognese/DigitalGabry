import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import BlockBox from "../../components/Block";
import { isScheduled, type ScheduledBlock } from "../../domain/block";
import {
  layoutDay,
  type DayLayout,
  type Overflow,
  type Placement,
  type Span,
} from "../../domain/layout";
import {
  DEFAULT_HOUR_HEIGHT,
  DEFAULT_TZ,
  MINUTES_PER_HOUR,
  daysOfWeek,
  endOfLocalDay,
  formatDayNumber,
  formatWeekday,
  isSameLocalDay,
  minutesToPixels,
  minutesWithinDay,
  pixelsToMinutes,
  weekRange,
  zoomBy,
  type HourHeight,
  type UtcMillis,
} from "../../domain/time";
import { useBlocks } from "../../store/useBlocks";
import NowLine from "./NowLine";
import TimeGutter from "./TimeGutter";

const NOW_TICK_MS = 30_000;

/* Opening on midnight would spend the top third of the viewport on hours that
   are almost never used. SPEC does not state a landing hour. */
const INITIAL_SCROLL_HOUR = 7;

type DayBlock = Span & { block: ScheduledBlock };

function blockGeometry(span: Span, placement: Placement): CSSProperties {
  const columnWidth = `calc((100% - 2 * var(--block-inset) - ${placement.columns - 1} * var(--block-gap)) / ${placement.columns})`;

  return {
    top: `calc(var(--hour-h) * ${span.startMin / MINUTES_PER_HOUR})`,
    height: `max(calc(var(--hour-h) * ${(span.endMin - span.startMin) / MINUTES_PER_HOUR}), var(--block-min-h))`,
    left: `calc(var(--block-inset) + (${columnWidth} + var(--block-gap)) * ${placement.column})`,
    width: columnWidth,
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
};

function DayColumn({ layout, tz, nowUtc, hourHeight, isToday }: DayColumnProps) {
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
  const [anchorUtc] = useState<UtcMillis>(() => Date.now());

  const scrollRef = useRef<HTMLDivElement>(null);
  const zoomAnchor = useRef<{ minutes: number; offsetY: number } | null>(null);
  const landed = useRef(false);

  useEffect(() => {
    const id = window.setInterval(() => setNowUtc(Date.now()), NOW_TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  const range = useMemo(() => weekRange(anchorUtc, tz), [anchorUtc, tz]);
  const days = useMemo(() => daysOfWeek(anchorUtc, tz), [anchorUtc, tz]);
  const { blocks } = useBlocks(range, tz);

  const layouts = useMemo(
    () =>
      days.map((dayStart) => {
        const day = { start: dayStart, end: endOfLocalDay(dayStart, tz) };
        const spans: DayBlock[] = blocks
          .filter(isScheduled)
          .filter((block) => block.startUtc < day.end && block.endUtc > day.start)
          .map((block) => ({
            block,
            startMin: minutesWithinDay(block.startUtc, day, tz),
            endMin: minutesWithinDay(block.endUtc, day, tz),
          }));
        return layoutDay(spans);
      }),
    [blocks, days, tz],
  );

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

    // An arrow const rather than a function declaration, so the null check
    // above still narrows `element` inside the closure.
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
    element.scrollTop =
      minutesToPixels(anchor.minutes, hourHeight) - anchor.offsetY;
  }, [hourHeight]);

  return (
    <div className="flex h-full min-h-0 flex-col">
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

      <div ref={scrollRef} className="cal-scroll min-h-0 flex-1 overflow-y-auto">
        <div
          className="flex"
          style={{ "--hour-h": `${hourHeight}px` } as CSSProperties}
        >
          <TimeGutter />
          {days.map((dayStart, index) => (
            <DayColumn
              key={dayStart}
              layout={layouts[index]}
              tz={tz}
              nowUtc={nowUtc}
              hourHeight={hourHeight}
              isToday={isSameLocalDay(dayStart, nowUtc, tz)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
