import { useState } from "react";
import { TrendingDown, TrendingUp } from "lucide-react";
import { levelFor } from "../../domain/momentum";
import { DEFAULT_TZ } from "../../domain/time";
import { useMomentum } from "../../store/useMomentum";
import { Skeleton } from "../../components/Skeleton";
import Breakdown from "./Breakdown";
import Heatmap from "./Heatmap";
import MomentumChart, { type ChartRange } from "./MomentumChart";
import QuickLog from "./QuickLog";

type MomentumViewProps = {
  tz?: string;
};

export default function MomentumView({ tz = DEFAULT_TZ }: MomentumViewProps) {
  const [range, setRange] = useState<ChartRange>(90);
  const momentum = useMomentum(tz);

  const current = momentum.today;
  const score = current === null ? 0 : current.momentum;
  const level = levelFor(score);
  const rising = momentum.weekDelta >= 0;
  const Trend = rising ? TrendingUp : TrendingDown;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shell-header flex shrink-0 items-center gap-3 border-b border-hair px-3">
        <span className="text-display text-primary">{Math.round(score)}</span>
        <span className="text-meta text-secondary">{level.label}</span>

        <span
          className={`flex items-center gap-1 text-meta ${rising ? "text-cat-admin" : "text-cat-deadline"}`}
        >
          <Trend className="icon-content" aria-hidden={true} />
          {Math.abs(Math.round(momentum.weekDelta))}
        </span>

        <span className="text-meta text-tertiary">
          {`${current?.streak ?? 0} day streak`}
        </span>

        <div className="flex-1" />

        {momentum.recomputing && (
          <span className="text-micro text-tertiary">Recomputing</span>
        )}
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-3">
        {momentum.error !== null && (
          <span className="text-meta text-cat-deadline">
            {momentum.error.message}
          </span>
        )}

        {momentum.loading ? (
          <div role="status" aria-label="Loading momentum" className="flex flex-col gap-6">
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : (
          <>
            <MomentumChart
              series={momentum.series}
              range={range}
              onRangeChange={setRange}
            />

            <Breakdown totals={momentum.totals} types={momentum.types} />

            <Heatmap series={momentum.series} />
          </>
        )}
      </div>

      <QuickLog
        types={momentum.types}
        totals={momentum.totals}
        onLog={momentum.logOne}
      />
    </div>
  );
}
