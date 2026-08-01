import type { Block } from "../domain/block";
import { formatTime, localDateOf } from "../domain/time";

/* Pure formatting. Everything here is deterministic: the same data always
   produces byte identical output, which is what makes "run the export twice
   and get an empty diff" true rather than aspirational. */

export function snapshotName(utcMs: number, tz: string): string {
  const date = localDateOf(utcMs, tz);
  const time = formatTime(utcMs, tz).replace(":", "");
  return `digitalgabry-${date}-${time}.db`;
}

/* Mirrors the Rust side's pruning so the rule can be tested without a disk.
   Names are dated, so lexicographic order is age order. */
export function prunableSnapshots(
  names: readonly string[],
  keep: number,
): string[] {
  const snapshots = names
    .filter((name) => name.startsWith("digitalgabry-") && name.endsWith(".db"))
    .slice()
    .sort();
  return keep >= snapshots.length ? [] : snapshots.slice(0, snapshots.length - keep);
}

/* JSON.stringify preserves insertion order, so a record built in a different
   order would diff even with identical content. Sorting every object's keys
   removes that. */
export function stableJson(value: unknown): string {
  return `${JSON.stringify(sortDeep(value), null, 2)}\n`;
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value === null || typeof value !== "object") return value;

  const source = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) {
    sorted[key] = sortDeep(source[key]);
  }
  return sorted;
}

export function monthKeyOf(utcMs: number, tz: string): string {
  return localDateOf(utcMs, tz).slice(0, 7);
}

export function monthFileName(monthKey: string): string {
  return `${monthKey}.md`;
}

function escapePipes(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

/* One file per month. Grouped by day, one line per block, sorted so an
   unchanged month re-exports identically. SPEC 11. */
export function monthMarkdown(
  monthKey: string,
  blocks: readonly Block[],
  tz: string,
): string {
  const scheduled = blocks
    .filter((block) => block.startUtc !== null && block.deletedUtc === null)
    .slice()
    .sort((a, b) => (a.startUtc ?? 0) - (b.startUtc ?? 0) || a.id.localeCompare(b.id));

  const lines: string[] = [`# ${monthKey}`, ""];
  let currentDay = "";

  for (const block of scheduled) {
    if (block.startUtc === null || block.endUtc === null) continue;
    const day = localDateOf(block.startUtc, tz);
    if (day !== currentDay) {
      if (currentDay !== "") lines.push("");
      lines.push(`## ${day}`, "");
      currentDay = day;
    }

    const time = `${formatTime(block.startUtc, tz)}-${formatTime(block.endUtc, tz)}`;
    const tags = block.tags.length === 0 ? "" : ` #${block.tags.join(" #")}`;
    lines.push(
      `- ${time} | ${block.kind} | ${block.category} | ${block.status} | ${escapePipes(block.title)}${tags}`,
    );

    if (block.description !== null && block.description !== "") {
      lines.push(`  > ${escapePipes(block.description)}`);
    }
  }

  if (scheduled.length === 0) lines.push("_No blocks this month_");

  // Trailing newline, no trailing blank lines: a file that ends consistently
  // is a file that does not diff on whitespace.
  return `${lines.join("\n").replace(/\n+$/, "")}\n`;
}

export function groupByMonth(
  blocks: readonly Block[],
  tz: string,
): Map<string, Block[]> {
  const months = new Map<string, Block[]>();
  for (const block of blocks) {
    if (block.startUtc === null || block.deletedUtc !== null) continue;
    const key = monthKeyOf(block.startUtc, tz);
    const bucket = months.get(key);
    if (bucket === undefined) months.set(key, [block]);
    else bucket.push(block);
  }
  return months;
}
