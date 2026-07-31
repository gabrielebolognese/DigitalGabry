/* The only file in the app that contains SQL. Everything above it works in
   domain objects and never learns that SQLite exists. */
import {
  BLOCK_CATEGORIES,
  BLOCK_KINDS,
  BLOCK_STATUSES,
  type Block,
  type BlockCategory,
  type BlockKind,
  type BlockPayload,
  type BlockStatus,
} from "../domain/block";
import { uuidv7 } from "../domain/id";
import type { UtcRange } from "../domain/time";
import { execute, query, type SqlValue, type Step } from "./client";
import { applyInsert, applyUpdate, type FieldChange } from "./ops";

const BLOCK_COLUMNS = `id, kind, title, description, start_utc, end_utc, tz, all_day,
  status, category, project_id, rrule, payload, sort_order,
  created_utc, updated_utc, completed_utc, deleted_utc`;

type BlockRow = {
  id: string;
  kind: string;
  title: string;
  description: string | null;
  start_utc: number | null;
  end_utc: number | null;
  tz: string;
  all_day: number;
  status: string;
  category: string;
  project_id: string | null;
  rrule: string | null;
  payload: string;
  sort_order: number;
  created_utc: number;
  updated_utc: number;
  completed_utc: number | null;
  deleted_utc: number | null;
};

function oneOf<T extends string>(
  allowed: readonly string[],
  value: string,
  fallback: T,
): T {
  return allowed.includes(value) ? (value as T) : fallback;
}

function parsePayload(raw: string): BlockPayload {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as BlockPayload;
    }
  } catch {
    // A malformed payload must not take the whole calendar down with it.
  }
  return {};
}

function toBlock(row: BlockRow, tags: string[]): Block {
  return {
    id: row.id,
    kind: oneOf<BlockKind>(BLOCK_KINDS, row.kind, "task"),
    title: row.title,
    description: row.description,
    startUtc: row.start_utc,
    endUtc: row.end_utc,
    tz: row.tz,
    allDay: row.all_day !== 0,
    status: oneOf<BlockStatus>(BLOCK_STATUSES, row.status, "open"),
    category: oneOf<BlockCategory>(BLOCK_CATEGORIES, row.category, "build"),
    projectId: row.project_id,
    tags,
    rrule: row.rrule,
    payload: parsePayload(row.payload),
    sortOrder: row.sort_order,
    createdUtc: row.created_utc,
    updatedUtc: row.updated_utc,
    completedUtc: row.completed_utc,
    deletedUtc: row.deleted_utc,
  };
}

const COLUMN_OF: Partial<Record<keyof Block, string>> = {
  kind: "kind",
  title: "title",
  description: "description",
  startUtc: "start_utc",
  endUtc: "end_utc",
  tz: "tz",
  allDay: "all_day",
  status: "status",
  category: "category",
  projectId: "project_id",
  rrule: "rrule",
  payload: "payload",
  sortOrder: "sort_order",
  completedUtc: "completed_utc",
  deletedUtc: "deleted_utc",
};

function toSql(value: unknown): SqlValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number" || typeof value === "string") return value;
  return JSON.stringify(value);
}

async function tagsFor(blockIds: readonly string[]): Promise<Map<string, string[]>> {
  const byBlock = new Map<string, string[]>();
  if (blockIds.length === 0) return byBlock;

  const placeholders = blockIds.map(() => "?").join(", ");
  const rows = await query<{ block_id: string; name: string }>(
    `SELECT bt.block_id AS block_id, t.name AS name
       FROM block_tags bt
       JOIN tags t ON t.id = bt.tag_id
      WHERE bt.block_id IN (${placeholders})
        AND t.deleted_utc IS NULL`,
    [...blockIds],
  );

  for (const row of rows) {
    const existing = byBlock.get(row.block_id);
    if (existing === undefined) byBlock.set(row.block_id, [row.name]);
    else existing.push(row.name);
  }
  return byBlock;
}

async function hydrate(rows: BlockRow[]): Promise<Block[]> {
  const tags = await tagsFor(rows.map((row) => row.id));
  return rows.map((row) => toBlock(row, tags.get(row.id) ?? []));
}

/* Every calendar read is range bounded. Architecture invariant 7. */
export async function listBlocksInRange(range: UtcRange): Promise<Block[]> {
  if (import.meta.env.DEV) {
    console.debug(
      "[db] blocks in range",
      new Date(range.start).toISOString(),
      "to",
      new Date(range.end).toISOString(),
    );
  }

  const rows = await query<BlockRow>(
    `SELECT ${BLOCK_COLUMNS} FROM blocks
      WHERE deleted_utc IS NULL
        AND start_utc IS NOT NULL
        AND start_utc < ?
        AND end_utc > ?
      ORDER BY start_utc`,
    [range.end, range.start],
  );

  return hydrate(rows);
}

export async function getBlock(id: string): Promise<Block | null> {
  const rows = await query<BlockRow>(
    `SELECT ${BLOCK_COLUMNS} FROM blocks WHERE id = ? AND deleted_utc IS NULL`,
    [id],
  );
  if (rows.length === 0) return null;
  const [block] = await hydrate(rows);
  return block ?? null;
}

export async function listBacklogBlocks(limit = 200): Promise<Block[]> {
  const rows = await query<BlockRow>(
    `SELECT ${BLOCK_COLUMNS} FROM blocks
      WHERE deleted_utc IS NULL AND start_utc IS NULL
      ORDER BY sort_order LIMIT ?`,
    [limit],
  );
  return hydrate(rows);
}

function insertStep(block: Block): Step {
  return {
    sql: `INSERT INTO blocks
            (id, kind, title, description, start_utc, end_utc, tz, all_day, status,
             category, project_id, rrule, payload, sort_order,
             created_utc, updated_utc, completed_utc, deleted_utc, hlc, device_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params: [
      block.id,
      block.kind,
      block.title,
      block.description,
      block.startUtc,
      block.endUtc,
      block.tz,
      block.allDay ? 1 : 0,
      block.status,
      block.category,
      block.projectId,
      block.rrule,
      JSON.stringify(block.payload),
      block.sortOrder,
      block.createdUtc,
      block.updatedUtc,
      block.completedUtc,
      block.deletedUtc,
      "",
      "",
    ],
  };
}

export async function insertBlock(block: Block): Promise<void> {
  await applyInsert("block", block.id, insertStep(block));
  if (block.tags.length > 0) await setBlockTags(block.id, block.tags);
}

export async function updateBlock(
  id: string,
  patch: Partial<Block>,
): Promise<void> {
  const current = await getBlock(id);
  if (current === null) throw new Error(`Block ${id} not found`);

  const changes: FieldChange[] = [];
  for (const [key, column] of Object.entries(COLUMN_OF)) {
    if (column === undefined) continue;
    const field = key as keyof Block;
    if (!(field in patch)) continue;
    changes.push({
      field: column,
      oldValue: toSql(current[field]),
      newValue: toSql(patch[field]),
    });
  }

  if (changes.length > 0) await applyUpdate("block", id, changes);
  if (patch.tags !== undefined) await setBlockTags(id, patch.tags);
}

/* No hard delete anywhere. Architecture invariant 5. */
export async function softDeleteBlock(id: string): Promise<void> {
  await updateBlock(id, { deletedUtc: Date.now() });
}

export async function restoreBlock(id: string): Promise<void> {
  const rows = await query<BlockRow>(
    `SELECT ${BLOCK_COLUMNS} FROM blocks WHERE id = ?`,
    [id],
  );
  const row = rows[0];
  if (row === undefined) return;
  await applyUpdate("block", id, [
    { field: "deleted_utc", oldValue: row.deleted_utc, newValue: null },
  ]);
}

/* At month, quarter and year zoom the app never fetches blocks, only counts and
   minutes per day. A year of individual blocks is unreadable anyway, so the
   visual design and the performance strategy agree. SPEC 7.
   Grouping uses SQLite's 'localtime', which is the OS zone rather than the
   app's configured zone. They match on this machine; a stored local_date
   column is the durable fix. */
export type DayAggregate = {
  localDate: string;
  count: number;
  minutes: number;
};

export async function blockAggregatesByDay(range: UtcRange): Promise<DayAggregate[]> {
  const rows = await query<{ local_date: string; n: number; minutes: number }>(
    `SELECT date(start_utc / 1000, 'unixepoch', 'localtime') AS local_date,
            count(*) AS n,
            COALESCE(SUM((end_utc - start_utc) / 60000.0), 0) AS minutes
       FROM blocks
      WHERE deleted_utc IS NULL
        AND start_utc IS NOT NULL
        AND start_utc < ?
        AND end_utc > ?
      GROUP BY local_date
      ORDER BY local_date`,
    [range.end, range.start],
  );

  return rows.map((row) => ({
    localDate: row.local_date,
    count: row.n,
    minutes: row.minutes,
  }));
}

export async function searchBlocks(term: string, limit = 50): Promise<Block[]> {
  if (term.trim() === "") return [];
  const rows = await query<BlockRow>(
    `SELECT ${BLOCK_COLUMNS.split(",")
      .map((column) => `b.${column.trim()}`)
      .join(", ")}
       FROM blocks_fts f
       JOIN blocks b ON b.rowid = f.rowid
      WHERE blocks_fts MATCH ?
        AND b.deleted_utc IS NULL
      ORDER BY rank
      LIMIT ?`,
    [term, limit],
  );
  return hydrate(rows);
}

export type Project = {
  id: string;
  name: string;
  color: string;
  archived: boolean;
  sortOrder: number;
};

export async function listProjects(): Promise<Project[]> {
  const rows = await query<{
    id: string;
    name: string;
    color: string;
    archived: number;
    sort_order: number;
  }>(
    `SELECT id, name, color, archived, sort_order
       FROM projects WHERE deleted_utc IS NULL ORDER BY sort_order`,
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    color: row.color,
    archived: row.archived !== 0,
    sortOrder: row.sort_order,
  }));
}

export async function listTags(): Promise<string[]> {
  const rows = await query<{ name: string }>(
    "SELECT name FROM tags WHERE deleted_utc IS NULL ORDER BY name",
  );
  return rows.map((row) => row.name);
}

export async function setBlockTags(
  blockId: string,
  names: readonly string[],
): Promise<void> {
  const wanted = names.map((name) => name.trim()).filter((name) => name !== "");

  for (const name of wanted) {
    const existing = await query<{ id: string }>(
      "SELECT id FROM tags WHERE name = ?",
      [name],
    );
    if (existing.length === 0) {
      await execute(
        `INSERT INTO tags (id, name, created_utc, hlc, device_id) VALUES (?, ?, ?, ?, ?)`,
        [uuidv7(), name, Date.now(), "", ""],
      );
    }
  }

  await execute("DELETE FROM block_tags WHERE block_id = ?", [blockId]);

  for (const name of wanted) {
    await execute(
      `INSERT OR IGNORE INTO block_tags (block_id, tag_id)
       SELECT ?, id FROM tags WHERE name = ?`,
      [blockId, name],
    );
  }
}

export type ActivityType = {
  id: string;
  name: string;
  icon: string;
  category: BlockCategory;
  weight: number;
  dailyCap: number;
  unit: string;
  archived: boolean;
  sortOrder: number;
};

export async function listActivityTypes(): Promise<ActivityType[]> {
  const rows = await query<{
    id: string;
    name: string;
    icon: string;
    category: string;
    weight: number;
    daily_cap: number;
    unit: string;
    archived: number;
    sort_order: number;
  }>(
    `SELECT id, name, icon, category, weight, daily_cap, unit, archived, sort_order
       FROM activity_types WHERE deleted_utc IS NULL ORDER BY sort_order`,
  );

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    icon: row.icon,
    category: oneOf<BlockCategory>(BLOCK_CATEGORIES, row.category, "build"),
    weight: row.weight,
    dailyCap: row.daily_cap,
    unit: row.unit,
    archived: row.archived !== 0,
    sortOrder: row.sort_order,
  }));
}

export type ActivityEntry = {
  id: string;
  activityTypeId: string;
  localDate: string;
  count: number;
  source: string;
  blockId: string | null;
};

export async function listActivityBetween(
  fromLocalDate: string,
  toLocalDate: string,
): Promise<ActivityEntry[]> {
  const rows = await query<{
    id: string;
    activity_type_id: string;
    local_date: string;
    count: number;
    source: string;
    block_id: string | null;
  }>(
    `SELECT id, activity_type_id, local_date, count, source, block_id
       FROM activity_log
      WHERE deleted_utc IS NULL AND local_date >= ? AND local_date <= ?
      ORDER BY local_date`,
    [fromLocalDate, toLocalDate],
  );

  return rows.map((row) => ({
    id: row.id,
    activityTypeId: row.activity_type_id,
    localDate: row.local_date,
    count: row.count,
    source: row.source,
    blockId: row.block_id,
  }));
}

export async function insertActivity(entry: {
  activityTypeId: string;
  localDate: string;
  count?: number;
  source?: string;
  blockId?: string | null;
}): Promise<string> {
  const id = uuidv7();
  const now = Date.now();

  await applyInsert("activity_log", id, {
    sql: `INSERT INTO activity_log
            (id, activity_type_id, local_date, count, source, block_id,
             created_utc, updated_utc, hlc, device_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params: [
      id,
      entry.activityTypeId,
      entry.localDate,
      entry.count ?? 1,
      entry.source ?? "manual",
      entry.blockId ?? null,
      now,
      now,
      "",
      "",
    ],
  });

  return id;
}

export async function softDeleteActivity(id: string): Promise<void> {
  await applyUpdate("activity_log", id, [
    { field: "deleted_utc", oldValue: null, newValue: Date.now() },
  ]);
}
