export const MAX_COLUMNS = 3;

export const DENSITY_COMPACT_BELOW = 28;
export const DENSITY_STANDARD_THROUGH = 56;

export type Density = "compact" | "standard" | "expanded";

export function densityFor(heightPx: number): Density {
  if (heightPx < DENSITY_COMPACT_BELOW) return "compact";
  if (heightPx <= DENSITY_STANDARD_THROUGH) return "standard";
  return "expanded";
}

export type Span = {
  startMin: number;
  endMin: number;
};

export type Placement = {
  column: number;
  columns: number;
};

export type Placed<T> = {
  item: T;
  placement: Placement;
};

export type Overflow = {
  startMin: number;
  endMin: number;
  count: number;
};

export type DayLayout<T> = {
  placed: Placed<T>[];
  overflow: Overflow[];
};

/* Greedy interval colouring over each cluster of mutually overlapping spans.
   A cluster wider than MAX_COLUMNS keeps its first three lanes and reports the
   remainder as a single overflow marker, because a fourth lane in a seven day
   week is narrower than the icon it would have to hold. */
export function layoutDay<T extends Span>(items: readonly T[]): DayLayout<T> {
  const sorted = [...items].sort(
    (a, b) =>
      a.startMin - b.startMin ||
      b.endMin - b.startMin - (a.endMin - a.startMin),
  );

  const placed: Placed<T>[] = [];
  const overflow: Overflow[] = [];

  let cluster: T[] = [];
  let clusterEnd = Number.NEGATIVE_INFINITY;

  function flushCluster(): void {
    if (cluster.length === 0) return;

    const laneEnds: number[] = [];
    const assigned: Array<{ item: T; column: number }> = [];
    const hidden: T[] = [];

    for (const item of cluster) {
      let column = laneEnds.findIndex((end) => end <= item.startMin);
      if (column === -1) {
        column = laneEnds.length;
        laneEnds.push(item.endMin);
      } else {
        laneEnds[column] = item.endMin;
      }

      if (column < MAX_COLUMNS) {
        assigned.push({ item, column });
      } else {
        hidden.push(item);
      }
    }

    const columns = Math.min(laneEnds.length, MAX_COLUMNS);
    for (const entry of assigned) {
      placed.push({ item: entry.item, placement: { column: entry.column, columns } });
    }

    if (hidden.length > 0) {
      overflow.push({
        startMin: Math.min(...hidden.map((item) => item.startMin)),
        endMin: Math.max(...hidden.map((item) => item.endMin)),
        count: hidden.length,
      });
    }

    cluster = [];
    clusterEnd = Number.NEGATIVE_INFINITY;
  }

  for (const item of sorted) {
    if (cluster.length > 0 && item.startMin >= clusterEnd) flushCluster();
    cluster.push(item);
    clusterEnd = Math.max(clusterEnd, item.endMin);
  }
  flushCluster();

  return { placed, overflow };
}
