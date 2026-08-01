import { useMemo } from "react";
import type { MomentumDay } from "../../domain/momentum";

const WEEKS = 52;
const DAYS_PER_WEEK = 7;

/* Five steps keyed to quintiles of the non zero days, so the scale adapts to
   how much this person actually logs rather than to an absolute ceiling. */
function quintiles(values: readonly number[]): number[] {
  const scoring = values.filter((value) => value > 0).sort((a, b) => a - b);
  if (scoring.length === 0) return [];
  return [0.2, 0.4, 0.6, 0.8].map(
    (fraction) => scoring[Math.min(Math.floor(scoring.length * fraction), scoring.length - 1)],
  );
}

function stepOf(rawScore: number, thresholds: readonly number[]): number {
  if (rawScore <= 0 || thresholds.length === 0) return 0;
  let step = 1;
  for (const threshold of thresholds) {
    if (rawScore > threshold) step += 1;
  }
  return Math.min(step, 5);
}

export default function Heatmap({ series }: { series: readonly MomentumDay[] }) {
  const days = useMemo(() => series.slice(-(WEEKS * DAYS_PER_WEEK)), [series]);
  const thresholds = useMemo(() => quintiles(days.map((day) => day.rawScore)), [days]);

  const columns = useMemo(() => {
    const chunks: MomentumDay[][] = [];
    for (let index = 0; index < days.length; index += DAYS_PER_WEEK) {
      chunks.push(days.slice(index, index + DAYS_PER_WEEK));
    }
    return chunks;
  }, [days]);

  if (days.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <span className="text-micro uppercase text-tertiary">Consistency</span>
      <div className="heat-grid flex overflow-x-auto">
        {columns.map((week) => (
          <div key={week[0]?.localDate ?? ""} className="heat-column flex flex-col">
            {week.map((day) => (
              <div
                key={day.localDate}
                title={`${day.localDate}  ·  ${Math.round(day.rawScore)}`}
                className={`heat-cell heat-${stepOf(day.rawScore, thresholds)}`}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
