import { useEffect, useMemo, useRef, useState } from "react";
import { MOMENTUM_LEVELS, type MomentumDay } from "../../domain/momentum";

export const CHART_RANGES = [30, 90, 365] as const;
export type ChartRange = (typeof CHART_RANGES)[number];

type MomentumChartProps = {
  series: readonly MomentumDay[];
  range: ChartRange;
  onRangeChange: (range: ChartRange) => void;
};

/* Viewbox units. The SVG scales to its container, so these are a coordinate
   space rather than pixels, and the stroke widths below are corrected for the
   horizontal scale by vectorEffect instead. */
const VIEW_HEIGHT = 180;
const PAD_TOP = 8;
const PAD_BOTTOM = 16;
const PAD_RIGHT = 28;

type Hover = { index: number; x: number };

export default function MomentumChart({
  series,
  range,
  onRangeChange,
}: MomentumChartProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  const [hover, setHover] = useState<Hover | null>(null);

  /* The chart has to reflow with the panel, and a resize listener on window
     would miss the splitter being dragged. */
  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry !== undefined) setWidth(Math.max(entry.contentRect.width, 1));
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  const points = useMemo(() => series.slice(-range), [series, range]);

  const geometry = useMemo(() => {
    if (points.length === 0) return null;

    const peakMomentum = Math.max(...points.map((day) => day.momentum), 1);
    const peakRaw = Math.max(...points.map((day) => day.rawScore), 1);
    const plotWidth = Math.max(width - PAD_RIGHT, 1);
    const plotHeight = VIEW_HEIGHT - PAD_TOP - PAD_BOTTOM;

    const xOf = (index: number): number =>
      points.length === 1 ? 0 : (index / (points.length - 1)) * plotWidth;
    const yOf = (value: number): number =>
      PAD_TOP + plotHeight - (value / peakMomentum) * plotHeight;

    const line = points
      .map((day, index) => `${index === 0 ? "M" : "L"}${xOf(index)} ${yOf(day.momentum)}`)
      .join(" ");

    const area =
      points.length === 0
        ? ""
        : `${line} L${xOf(points.length - 1)} ${PAD_TOP + plotHeight} L${xOf(0)} ${PAD_TOP + plotHeight} Z`;

    return { peakMomentum, peakRaw, plotWidth, plotHeight, xOf, yOf, line, area };
  }, [points, width]);

  const hovered = hover === null ? null : points[hover.index];

  return (
    <div ref={hostRef} className="flex flex-col gap-2">
      <div className="flex items-center gap-1 self-end">
        {CHART_RANGES.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => onRangeChange(option)}
            aria-pressed={option === range}
            className={[
              "motion-hover rounded-control border px-2 py-1 text-micro",
              option === range
                ? "border-line bg-selected text-primary"
                : "border-transparent text-tertiary hover:bg-hover hover:text-secondary",
            ].join(" ")}
          >
            {option}
          </button>
        ))}
      </div>

      {geometry === null ? (
        <span className="text-meta text-tertiary">Log something to start the curve</span>
      ) : (
        <svg
          role="img"
          aria-label="Momentum over time"
          viewBox={`0 0 ${width} ${VIEW_HEIGHT}`}
          width="100%"
          height={VIEW_HEIGHT}
          preserveAspectRatio="none"
          onMouseLeave={() => setHover(null)}
          onMouseMove={(event) => {
            const bounds = event.currentTarget.getBoundingClientRect();
            const ratio = (event.clientX - bounds.left) / Math.max(bounds.width, 1);
            const index = Math.round(ratio * (points.length - 1));
            const clamped = Math.min(Math.max(index, 0), points.length - 1);
            setHover({ index: clamped, x: geometry.xOf(clamped) });
          }}
        >
          {/* Level thresholds, hairlines labelled at the right edge. */}
          {MOMENTUM_LEVELS.filter(
            (level) => level.min > 0 && level.min <= geometry.peakMomentum,
          ).map((level) => (
            <g key={level.band}>
              <line
                x1={0}
                x2={geometry.plotWidth}
                y1={geometry.yOf(level.min)}
                y2={geometry.yOf(level.min)}
                className="chart-gridline"
                vectorEffect="non-scaling-stroke"
              />
              <text
                x={geometry.plotWidth + 4}
                y={geometry.yOf(level.min) + 3}
                className="chart-axis-label"
              >
                {level.min}
              </text>
            </g>
          ))}

          {/* Raw daily score behind the curve. */}
          {points.map((day, index) => {
            if (day.rawScore <= 0) return null;
            const height = (day.rawScore / geometry.peakRaw) * geometry.plotHeight * 0.5;
            return (
              <line
                key={day.localDate}
                x1={geometry.xOf(index)}
                x2={geometry.xOf(index)}
                y1={PAD_TOP + geometry.plotHeight}
                y2={PAD_TOP + geometry.plotHeight - height}
                className="chart-raw-bar"
                vectorEffect="non-scaling-stroke"
              />
            );
          })}

          <path d={geometry.area} className="chart-area" />
          <path
            d={geometry.line}
            className="chart-line"
            vectorEffect="non-scaling-stroke"
          />

          {hover !== null && (
            <line
              x1={hover.x}
              x2={hover.x}
              y1={PAD_TOP}
              y2={PAD_TOP + geometry.plotHeight}
              className="chart-cursor"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
      )}

      <div className="h-4">
        {hovered !== null && (
          <span className="rounded-control border border-line bg-elevated px-2 py-1 text-micro text-secondary">
            {`${hovered.localDate}  ·  raw ${Math.round(hovered.rawScore)}  ·  momentum ${Math.round(hovered.momentum)}`}
          </span>
        )}
      </div>
    </div>
  );
}
