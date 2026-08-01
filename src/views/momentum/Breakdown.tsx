import { useMemo } from "react";
import type { BlockCategory } from "../../domain/block";
import type { ActivityTotal, ActivityType } from "../../db/repository";

type BreakdownProps = {
  totals: readonly ActivityTotal[];
  types: readonly ActivityType[];
};

const CATEGORY_FILL: Record<BlockCategory, string> = {
  build: "bg-cat-build",
  content: "bg-cat-content",
  admin: "bg-cat-admin",
  personal: "bg-cat-personal",
  deadline: "bg-cat-deadline",
};

export default function Breakdown({ totals, types }: BreakdownProps) {
  const byId = useMemo(() => new Map(types.map((type) => [type.id, type])), [types]);

  const rows = useMemo(
    () =>
      totals
        .map((total) => ({ total, type: byId.get(total.activityTypeId) }))
        .filter(
          (row): row is { total: ActivityTotal; type: ActivityType } =>
            row.type !== undefined,
        ),
    [totals, byId],
  );

  const byCategory = useMemo(() => {
    const sums = new Map<BlockCategory, number>();
    for (const row of rows) {
      sums.set(row.type.category, (sums.get(row.type.category) ?? 0) + row.total.points);
    }
    return [...sums.entries()].filter(([, points]) => points > 0);
  }, [rows]);

  const grandTotal = byCategory.reduce((sum, [, points]) => sum + points, 0);

  if (rows.length === 0) {
    return (
      <span className="text-meta text-tertiary">Nothing logged in the last 30 days</span>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <span className="text-micro uppercase text-tertiary">Last 30 days</span>

      <div className="flex h-1 w-full overflow-hidden rounded-block">
        {byCategory.map(([category, points]) => (
          <div
            key={category}
            title={`${category}  ·  ${Math.round(points)}`}
            style={{ width: `${(points / Math.max(grandTotal, 1)) * 100}%` }}
            className={CATEGORY_FILL[category]}
          />
        ))}
      </div>

      <table className="w-full text-meta">
        <thead>
          <tr className="text-micro uppercase text-tertiary">
            <th className="py-1 text-left font-medium">Type</th>
            <th className="py-1 text-right font-medium">Count</th>
            <th className="py-1 text-right font-medium">Weight</th>
            <th className="py-1 text-right font-medium">Points</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ total, type }) => (
            <tr key={type.id} className="border-t border-hair">
              <td className="py-1 text-secondary">{type.name}</td>
              <td className="py-1 text-right text-secondary">{total.count}</td>
              <td className="py-1 text-right text-tertiary">{type.weight}</td>
              <td className="py-1 text-right text-primary">{Math.round(total.points)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
