/* The only file in the app that contains SQL. Everything above it works in
   domain objects and never learns that SQLite exists. */
import {
  BLOCK_CATEGORIES,
  BLOCK_KINDS,
  BLOCK_STATUSES,
  newBlock,
  type Block,
  type BlockCategory,
  type BlockKind,
  type BlockPayload,
  type BlockStatus,
  type CalendarEntry,
  type ExceptionRole,
} from "../domain/block";
import {
  occurrenceId,
  splitRuleAt,
  type ExceptionMarker,
  type GeneratedOccurrence,
  type OccurrenceRef,
} from "../domain/recurrence";
import { uuidv7 } from "../domain/id";
import {
  DEFAULT_MOMENTUM_CONSTANTS,
  computeSeries,
  type ActivityCount,
  type MomentumConstants,
  type MomentumDay,
} from "../domain/momentum";
import { localDateOf, type UtcRange } from "../domain/time";
import type {
  Generator,
  Modifier,
  ResolvedRuleset,
  SlotBinding,
  SlotOverride,
} from "../domain/generation/types";
import {
  applyPlan,
  findOverlap,
  planSave,
  type SaveMode,
} from "../domain/generation/versioning";
import type { RekeyPlan } from "../domain/generation/rekey";
import {
  CONTENT_PLATFORMS,
  CONTENT_STATUSES,
  type Asset,
  type AssetRole,
  type ContentFilter,
  type ContentItem,
  type ContentPlatform,
} from "../domain/content";
import { execute, query, transaction, type SqlValue, type Step } from "./client";
import {
  applyBatch,
  applyInsert,
  applyUpdate,
  type EntityChange,
  type FieldChange,
} from "./ops";

const BLOCK_FIELDS = [
  "id",
  "kind",
  "title",
  "description",
  "start_utc",
  "end_utc",
  "tz",
  "all_day",
  "status",
  "category",
  "project_id",
  "rrule",
  "recurrence_parent_id",
  "is_exception",
  "recurrence_original_start_utc",
  "payload",
  "sort_order",
  "created_utc",
  "updated_utc",
  "completed_utc",
  "deleted_utc",
] as const;

const BLOCK_COLUMNS = BLOCK_FIELDS.join(", ");

/* The occurrence branch of the calendar read projects the parent's fields but
   the occurrence's own times, so start_utc and end_utc come from o rather
   than b. */
const OCCURRENCE_COLUMNS = BLOCK_FIELDS.map((field) =>
  field === "start_utc" || field === "end_utc" ? `o.${field}` : `b.${field}`,
).join(", ");

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
  recurrence_parent_id: string | null;
  is_exception: number;
  recurrence_original_start_utc: number | null;
  payload: string;
  sort_order: number;
  created_utc: number;
  updated_utc: number;
  completed_utc: number | null;
  deleted_utc: number | null;
};

const EXCEPTION_ROLE_OF: Record<number, ExceptionRole> = {
  0: "none",
  1: "override",
  2: "cancelled",
};

const EXCEPTION_CODE_OF: Record<ExceptionRole, number> = {
  none: 0,
  override: 1,
  cancelled: 2,
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
    recurrenceParentId: row.recurrence_parent_id,
    exceptionRole: EXCEPTION_ROLE_OF[row.is_exception] ?? "none",
    recurrenceOriginalStartUtc: row.recurrence_original_start_utc,
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
  recurrenceParentId: "recurrence_parent_id",
  exceptionRole: "is_exception",
  recurrenceOriginalStartUtc: "recurrence_original_start_utc",
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

/* exceptionRole is a string union in the domain and an integer in the column,
   so it cannot go through the generic encoder. */
function encodeField(field: keyof Block, value: unknown): SqlValue {
  if (field === "exceptionRole") {
    return typeof value === "string" && value in EXCEPTION_CODE_OF
      ? EXCEPTION_CODE_OF[value as ExceptionRole]
      : 0;
  }
  return toSql(value);
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

/* Every calendar read is range bounded. Architecture invariant 7.
 *
 * Two bounded reads rather than one: plain blocks, and materialised
 * occurrences joined to the series that owns them.
 *
 * `rrule IS NULL` on the first is load bearing. A series seed has both its own
 * start_utc and its own occurrence row, so without it every recurring block
 * renders twice at its first instant. */
export async function listBlocksInRange(range: UtcRange): Promise<CalendarEntry[]> {
  const plain = await query<BlockRow>(
    `SELECT ${BLOCK_COLUMNS} FROM blocks
      WHERE deleted_utc IS NULL
        AND rrule IS NULL
        AND is_exception <> 2
        AND start_utc IS NOT NULL
        AND start_utc < ?
        AND end_utc > ?
      ORDER BY start_utc`,
    [range.end, range.start],
  );

  const occurrences = await query<BlockRow & { occurrence_id: string }>(
    `SELECT ${OCCURRENCE_COLUMNS}, o.id AS occurrence_id
       FROM occurrences o
       JOIN blocks b ON b.id = o.block_id
      WHERE b.deleted_utc IS NULL
        AND o.start_utc < ?
        AND o.end_utc > ?
      ORDER BY o.start_utc`,
    [range.end, range.start],
  );

  const tags = await tagsFor([
    ...plain.map((row) => row.id),
    ...occurrences.map((row) => row.id),
  ]);

  const standalone: CalendarEntry[] = plain.map((row) => ({
    ...toBlock(row, tags.get(row.id) ?? []),
    entryId: row.id,
    occurrenceStartUtc: null,
  }));

  const generated: CalendarEntry[] = occurrences.map((row) => ({
    ...toBlock(row, tags.get(row.id) ?? []),
    entryId: row.occurrence_id,
    occurrenceStartUtc: row.start_utc,
  }));

  return [...standalone, ...generated];
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
             category, project_id, rrule, recurrence_parent_id, is_exception,
             recurrence_original_start_utc, payload, sort_order,
             created_utc, updated_utc, completed_utc, deleted_utc, hlc, device_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      block.recurrenceParentId,
      EXCEPTION_CODE_OF[block.exceptionRole],
      block.recurrenceOriginalStartUtc,
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

export { insertStep as blockInsertStep };

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
      oldValue: encodeField(field, current[field]),
      newValue: encodeField(field, patch[field]),
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

/* FTS5 MATCH takes a query language, not a string of text. Raw input reaches
   it full of operators: a lone `"` is an unterminated phrase, `foo(` an
   unclosed group, `NEAR` and `OR` are keywords, and every one of them is a
   thrown SQLite error rather than an empty result. The command palette sends a
   partial query on every keystroke, so this has to hold for any input at all.

   Reducing to letters and digits and re-quoting each token as a phrase leaves
   nothing for the parser to trip on, and no quote left to escape. The last
   token gets a prefix star so results narrow while the user is still typing. */
export function ftsQuery(term: string): string | null {
  const tokens = term.toLowerCase().match(/[\p{L}\p{N}]+/gu);
  if (tokens === null) return null;

  return tokens
    .map((token, index) =>
      index === tokens.length - 1 ? `"${token}"*` : `"${token}"`,
    )
    .join(" ");
}

export async function searchBlocks(term: string, limit = 50): Promise<Block[]> {
  const match = ftsQuery(term);
  if (match === null) return [];
  const rows = await query<BlockRow>(
    `SELECT ${BLOCK_COLUMNS.split(",")
      .map((column) => `b.${column.trim()}`)
      .join(", ")}
       FROM blocks_fts f
       JOIN blocks b ON b.rowid = f.rowid
      WHERE blocks_fts MATCH ?
        AND b.deleted_utc IS NULL
        AND b.is_exception <> 2
      ORDER BY rank
      LIMIT ?`,
    [match, limit],
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
  note?: string | null;
}): Promise<string> {
  const id = uuidv7();
  const now = Date.now();

  await applyInsert("activity_log", id, {
    sql: `INSERT INTO activity_log
            (id, activity_type_id, local_date, count, source, block_id, note,
             created_utc, updated_utc, hlc, device_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params: [
      id,
      entry.activityTypeId,
      entry.localDate,
      entry.count ?? 1,
      entry.source ?? "manual",
      entry.blockId ?? null,
      entry.note ?? null,
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

export async function activityForBlock(blockId: string): Promise<string[]> {
  const rows = await query<{ id: string }>(
    "SELECT id FROM activity_log WHERE block_id = ? AND deleted_utc IS NULL",
    [blockId],
  );
  return rows.map((row) => row.id);
}

/* SPEC 8.6 says to match "by platform and format" but the seeds carry two or
   three types per platform. The post variant is preferred where one exists,
   otherwise the lowest sort_order for that platform. */
function activityTypeForPlatform(
  types: readonly ActivityType[],
  platform: string,
): ActivityType | null {
  const candidates = types
    .filter((type) => !type.archived && type.icon === platform)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  if (candidates.length === 0) return null;
  return candidates.find((type) => /post/i.test(type.name)) ?? candidates[0];
}

/* Completing a post with a platform logs it; un-completing removes the log.
   SPEC 8.6. Auto-logged rows carry source='block' so they can be told apart
   from anything typed by hand. */
export async function syncBlockActivity(
  blockId: string,
  tz: string,
): Promise<boolean> {
  const block = await getBlock(blockId);
  if (block === null) return false;

  const existing = await activityForBlock(blockId);
  const platform = block.payload.platform;
  const shouldLog =
    block.kind === "post" && platform !== undefined && block.status === "done";

  if (!shouldLog) {
    for (const id of existing) await softDeleteActivity(id);
    return existing.length > 0;
  }

  if (existing.length > 0) return false;

  /* An exact name set at scheduling time wins over the platform heuristic,
     which picks by icon and cannot tell an Instagram reel from a story. */
  const types = await listActivityTypes();
  const named = block.payload.activityTypeName;
  const type =
    (named === undefined
      ? null
      : types.find((candidate) => !candidate.archived && candidate.name === named) ??
        null) ?? activityTypeForPlatform(types, platform);
  if (type === null) return false;

  const when = block.completedUtc ?? block.startUtc ?? Date.now();
  await insertActivity({
    activityTypeId: type.id,
    localDate: localDateOf(when, tz),
    source: "block",
    blockId,
    /* Invariant 16: an auto-logged row has to be tellable from a hand-typed
       one, and traceable back to what it published. */
    note: block.payload.contentItemId ?? null,
  });
  return true;
}

const ACTIVITY_TYPE_COLUMN: Record<string, string> = {
  name: "name",
  icon: "icon",
  category: "category",
  weight: "weight",
  dailyCap: "daily_cap",
  unit: "unit",
  archived: "archived",
  sortOrder: "sort_order",
};

export async function updateActivityType(
  id: string,
  patch: Partial<ActivityType>,
): Promise<void> {
  const current = (await listActivityTypes()).find((type) => type.id === id);
  if (current === undefined) throw new Error(`Activity type ${id} not found`);

  const changes: FieldChange[] = [];
  for (const [key, column] of Object.entries(ACTIVITY_TYPE_COLUMN)) {
    const field = key as keyof ActivityType;
    if (!(field in patch)) continue;
    changes.push({
      field: column,
      oldValue: toSql(current[field]),
      newValue: toSql(patch[field]),
    });
  }
  if (changes.length > 0) await applyUpdate("activity_type", id, changes);
}

export async function createActivityType(
  input: Omit<ActivityType, "id">,
): Promise<string> {
  const id = uuidv7();
  const now = Date.now();
  await applyInsert("activity_type", id, {
    sql: `INSERT INTO activity_types
            (id, name, icon, category, weight, daily_cap, unit, archived,
             sort_order, created_utc, updated_utc, hlc, device_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params: [
      id,
      input.name,
      input.icon,
      input.category,
      input.weight,
      input.dailyCap,
      input.unit,
      input.archived ? 1 : 0,
      input.sortOrder,
      now,
      now,
      "",
      "",
    ],
  });
  return id;
}

/* ----------------------------------------------------------------------------
   Settings
   ------------------------------------------------------------------------- */

export async function readSetting(key: string): Promise<string | null> {
  const rows = await query<{ value: string }>(
    "SELECT value FROM settings WHERE key = ?",
    [key],
  );
  return rows[0]?.value ?? null;
}

export async function writeSetting(key: string, value: string): Promise<void> {
  await execute(
    "INSERT OR REPLACE INTO settings (key, value, updated_utc) VALUES (?, ?, ?)",
    [key, value, Date.now()],
  );
}

const CONSTANTS_KEY = "momentum.constants";

export async function readMomentumConstants(): Promise<MomentumConstants> {
  const raw = await readSetting(CONSTANTS_KEY);
  if (raw === null) return DEFAULT_MOMENTUM_CONSTANTS;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object") return DEFAULT_MOMENTUM_CONSTANTS;
    // Spread over the defaults so a partial or older record still yields a
    // complete set rather than undefined arithmetic.
    return { ...DEFAULT_MOMENTUM_CONSTANTS, ...(parsed as Partial<MomentumConstants>) };
  } catch {
    return DEFAULT_MOMENTUM_CONSTANTS;
  }
}

export async function writeMomentumConstants(
  constants: MomentumConstants,
): Promise<void> {
  await writeSetting(CONSTANTS_KEY, JSON.stringify(constants));
}

/* ----------------------------------------------------------------------------
   Momentum cache
   ------------------------------------------------------------------------- */

/* Rows per statement at six parameters each, under the legacy 999 ceiling. */
const MOMENTUM_CHUNK_ROWS = 120;

export type RecomputeReport = {
  days: number;
  elapsedMs: number;
};

/* Wipes momentum_daily and rebuilds it from activity_log in one transaction.
   The read is deliberately unbounded: this is a full rebuild of a derived
   cache, not a calendar read, so invariant 7 does not apply to it. The hard
   DELETE is likewise fine, because momentum_daily has no deleted_utc: it is a
   cache, and SPEC 8.4 says it is never a source of truth. */
export async function recomputeMomentum(
  constants?: MomentumConstants,
): Promise<RecomputeReport> {
  const began = Date.now();
  const settings = constants ?? (await readMomentumConstants());
  const types = await listActivityTypes();

  const rows = await query<{
    local_date: string;
    activity_type_id: string;
    count: number;
  }>(
    `SELECT local_date, activity_type_id, count FROM activity_log
      WHERE deleted_utc IS NULL ORDER BY local_date`,
  );

  const logsByDate = new Map<string, ActivityCount[]>();
  for (const row of rows) {
    const existing = logsByDate.get(row.local_date);
    const entry = { activityTypeId: row.activity_type_id, count: row.count };
    if (existing === undefined) logsByDate.set(row.local_date, [entry]);
    else existing.push(entry);
  }

  const series = computeSeries({
    logsByDate,
    types: types.map((type) => ({
      id: type.id,
      weight: type.weight,
      dailyCap: type.dailyCap,
    })),
    constants: settings,
  });

  const computedUtc = Date.now();
  const steps: Step[] = [{ sql: "DELETE FROM momentum_daily", params: [] }];

  for (let index = 0; index < series.length; index += MOMENTUM_CHUNK_ROWS) {
    const chunk = series.slice(index, index + MOMENTUM_CHUNK_ROWS);
    const params: SqlValue[] = [];
    for (const day of chunk) {
      params.push(
        day.localDate,
        day.rawScore,
        day.multiplier,
        day.momentum,
        day.streak,
        computedUtc,
      );
    }
    steps.push({
      sql:
        `INSERT INTO momentum_daily
           (local_date, raw_score, multiplier, momentum, streak, computed_utc) VALUES ` +
        chunk.map(() => "(?, ?, ?, ?, ?, ?)").join(", "),
      params,
    });
  }

  await transaction(steps);
  return { days: series.length, elapsedMs: Date.now() - began };
}

export async function readMomentumDaily(
  fromLocalDate: string,
  toLocalDate: string,
): Promise<MomentumDay[]> {
  const rows = await query<{
    local_date: string;
    raw_score: number;
    multiplier: number;
    momentum: number;
    streak: number;
  }>(
    `SELECT local_date, raw_score, multiplier, momentum, streak
       FROM momentum_daily
      WHERE local_date >= ? AND local_date <= ?
      ORDER BY local_date`,
    [fromLocalDate, toLocalDate],
  );

  return rows.map((row) => ({
    localDate: row.local_date,
    rawScore: row.raw_score,
    multiplier: row.multiplier,
    momentum: row.momentum,
    streak: row.streak,
  }));
}

export type ActivityTotal = {
  activityTypeId: string;
  count: number;
  points: number;
};

/* Contribution by type over a date range, for the breakdown table. Capping is
   per day, so the points column is folded here rather than in SQL. */
export async function activityTotals(
  fromLocalDate: string,
  toLocalDate: string,
): Promise<ActivityTotal[]> {
  const types = await listActivityTypes();
  const byId = new Map(types.map((type) => [type.id, type]));
  const entries = await listActivityBetween(fromLocalDate, toLocalDate);

  const perDay = new Map<string, Map<string, number>>();
  for (const entry of entries) {
    const day = perDay.get(entry.localDate) ?? new Map<string, number>();
    day.set(entry.activityTypeId, (day.get(entry.activityTypeId) ?? 0) + entry.count);
    perDay.set(entry.localDate, day);
  }

  const totals = new Map<string, ActivityTotal>();
  for (const day of perDay.values()) {
    for (const [typeId, rawCount] of day) {
      const type = byId.get(typeId);
      if (type === undefined) continue;
      const counted = Math.min(rawCount, type.dailyCap);
      const running = totals.get(typeId) ?? { activityTypeId: typeId, count: 0, points: 0 };
      running.count += rawCount;
      running.points += counted * type.weight;
      totals.set(typeId, running);
    }
  }

  return [...totals.values()].sort((a, b) => b.points - a.points);
}

/* ----------------------------------------------------------------------------
   Recurrence
   ------------------------------------------------------------------------- */

export type RecurringSeed = {
  id: string;
  startUtc: number;
  endUtc: number;
  tz: string;
  rrule: string;
};

export async function listRecurringSeeds(): Promise<RecurringSeed[]> {
  const rows = await query<{
    id: string;
    start_utc: number;
    end_utc: number;
    tz: string;
    rrule: string;
  }>(
    `SELECT id, start_utc, end_utc, tz, rrule FROM blocks
      WHERE deleted_utc IS NULL AND rrule IS NOT NULL AND rrule <> ''
        AND start_utc IS NOT NULL AND end_utc IS NOT NULL`,
  );
  return rows.map((row) => ({
    id: row.id,
    startUtc: row.start_utc,
    endUtc: row.end_utc,
    tz: row.tz,
    rrule: row.rrule,
  }));
}

export async function listExceptionsFor(
  seriesId: string,
): Promise<ExceptionMarker[]> {
  const rows = await query<{ recurrence_original_start_utc: number; is_exception: number }>(
    `SELECT recurrence_original_start_utc, is_exception FROM blocks
      WHERE recurrence_parent_id = ? AND deleted_utc IS NULL AND is_exception <> 0
        AND recurrence_original_start_utc IS NOT NULL`,
    [seriesId],
  );
  return rows.map((row) => ({
    originalStartUtc: row.recurrence_original_start_utc,
    kind: row.is_exception === 2 ? "cancelled" : "override",
  }));
}

export type RecurrenceStateRow = {
  blockId: string;
  windowStartUtc: number;
  windowEndUtc: number;
  fingerprint: string;
};

export async function listRecurrenceState(): Promise<RecurrenceStateRow[]> {
  const rows = await query<{
    block_id: string;
    window_start_utc: number;
    window_end_utc: number;
    fingerprint: string;
  }>(`SELECT block_id, window_start_utc, window_end_utc, fingerprint FROM recurrence_state`);
  return rows.map((row) => ({
    blockId: row.block_id,
    windowStartUtc: row.window_start_utc,
    windowEndUtc: row.window_end_utc,
    fingerprint: row.fingerprint,
  }));
}

/* Rows per statement, kept well under the legacy 999 parameter ceiling at five
   parameters each rather than the modern 32766. */
export const OCCURRENCE_CHUNK_ROWS = 150;

export type OccurrenceBatch = {
  blockId: string;
  occurrences: readonly GeneratedOccurrence[];
  windowStartUtc: number;
  windowEndUtc: number;
  fingerprint: string;
  truncated: boolean;
};

/* Pure, so the positional parameter flattening that `transaction` performs can
   be tested without a database. A statement or parameter ordering mistake here
   writes wrong times with no error at all. */
export function occurrenceWriteSteps(
  batches: readonly OccurrenceBatch[],
  generatedUtc: number,
): Step[] {
  const steps: Step[] = [];

  for (const batch of batches) {
    // A hard delete, which does not violate invariant 5: `occurrences` is a
    // derived cache, which is why its schema carries no deleted_utc column.
    steps.push({
      sql: "DELETE FROM occurrences WHERE block_id = ?",
      params: [batch.blockId],
    });

    for (let index = 0; index < batch.occurrences.length; index += OCCURRENCE_CHUNK_ROWS) {
      const chunk = batch.occurrences.slice(index, index + OCCURRENCE_CHUNK_ROWS);
      const params: SqlValue[] = [];
      for (const entry of chunk) {
        params.push(
          occurrenceId(entry.blockId, entry.startUtc),
          entry.blockId,
          entry.startUtc,
          entry.endUtc,
          generatedUtc,
        );
      }
      steps.push({
        sql:
          `INSERT OR REPLACE INTO occurrences (id, block_id, start_utc, end_utc, generated_utc) VALUES ` +
          chunk.map(() => "(?, ?, ?, ?, ?)").join(", "),
        params,
      });
    }

    steps.push({
      sql: `INSERT OR REPLACE INTO recurrence_state
              (block_id, window_start_utc, window_end_utc, fingerprint,
               occurrence_count, truncated, generated_utc)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      params: [
        batch.blockId,
        batch.windowStartUtc,
        batch.windowEndUtc,
        batch.fingerprint,
        batch.occurrences.length,
        batch.truncated ? 1 : 0,
        generatedUtc,
      ],
    });
  }

  return steps;
}

export async function writeOccurrences(
  batches: readonly OccurrenceBatch[],
  generatedUtc: number,
): Promise<void> {
  const steps = occurrenceWriteSteps(batches, generatedUtc);
  if (steps.length > 0) await transaction(steps);
}

export async function deleteOccurrenceAt(
  seriesId: string,
  startUtc: number,
): Promise<void> {
  await execute("DELETE FROM occurrences WHERE block_id = ? AND start_utc = ?", [
    seriesId,
    startUtc,
  ]);
}

/* `occurrences` has no cascade and no tombstone, so rows for blocks that have
   been deleted, un-recurred, or left the window would otherwise accumulate. */
export async function sweepOccurrences(window: UtcRange): Promise<void> {
  await execute(
    `DELETE FROM occurrences WHERE block_id NOT IN
       (SELECT id FROM blocks WHERE deleted_utc IS NULL AND rrule IS NOT NULL AND rrule <> '')`,
  );
  await execute("DELETE FROM occurrences WHERE start_utc >= ? OR end_utc <= ?", [
    window.end,
    window.start,
  ]);
}

/* ----------------------------------------------------------------------------
   Backup and export
   ------------------------------------------------------------------------- */

/* Deliberately unbounded: an export is a full dump, not a calendar read, so
   architecture invariant 7 does not apply. */
export async function listAllBlocks(): Promise<Block[]> {
  const rows = await query<BlockRow>(
    `SELECT ${BLOCK_COLUMNS} FROM blocks
      WHERE deleted_utc IS NULL AND is_exception <> 2
      ORDER BY start_utc, id`,
  );
  return hydrate(rows);
}

export async function listAllActivity(): Promise<ActivityEntry[]> {
  return listActivityBetween("0000-00-00", "9999-99-99");
}

export async function listAllMomentum(): Promise<MomentumDay[]> {
  return readMomentumDaily("0000-00-00", "9999-99-99");
}

/* SPEC 11. VACUUM INTO takes an expression, but sqlite rejects a bound
   parameter here on some builds, so the path is inlined with quotes doubled.
   It comes from a folder picker, never from imported data. */
export async function vacuumInto(absolutePath: string): Promise<void> {
  const escaped = absolutePath.replace(/'/g, "''");
  await execute(`VACUUM INTO '${escaped}'`);
}

/* ----------------------------------------------------------------------------
   Recurrence edit scopes
   ------------------------------------------------------------------------- */

function fieldChanges(current: Block, patch: Partial<Block>): FieldChange[] {
  const changes: FieldChange[] = [];
  for (const [key, column] of Object.entries(COLUMN_OF)) {
    if (column === undefined) continue;
    const field = key as keyof Block;
    if (!(field in patch)) continue;
    changes.push({
      field: column,
      oldValue: encodeField(field, current[field]),
      newValue: encodeField(field, patch[field]),
    });
  }
  return changes;
}

export function isTemporalPatch(patch: Partial<Block>): boolean {
  return (
    patch.startUtc !== undefined ||
    patch.endUtc !== undefined ||
    patch.tz !== undefined ||
    patch.rrule !== undefined
  );
}

export async function listExceptionBlocks(seriesId: string): Promise<Block[]> {
  const rows = await query<BlockRow>(
    `SELECT ${BLOCK_COLUMNS} FROM blocks
      WHERE recurrence_parent_id = ? AND deleted_utc IS NULL AND is_exception <> 0`,
    [seriesId],
  );
  return hydrate(rows);
}

async function existingException(ref: OccurrenceRef): Promise<Block | null> {
  const rows = await query<BlockRow>(
    `SELECT ${BLOCK_COLUMNS} FROM blocks
      WHERE recurrence_parent_id = ? AND recurrence_original_start_utc = ?
        AND deleted_utc IS NULL AND is_exception <> 0`,
    [ref.seriesId, ref.originalStartUtc],
  );
  if (rows.length === 0) return null;
  const [block] = await hydrate(rows);
  return block ?? null;
}

function exceptionRow(
  seed: Block,
  ref: OccurrenceRef,
  role: ExceptionRole,
  patch: Partial<Block>,
): Block {
  const now = Date.now();
  return {
    ...seed,
    ...patch,
    id: uuidv7(),
    // An exception is a single instance, never a rule of its own.
    rrule: null,
    recurrenceParentId: ref.seriesId,
    exceptionRole: role,
    recurrenceOriginalStartUtc: ref.originalStartUtc,
    createdUtc: now,
    updatedUtc: now,
    deletedUtc: null,
  };
}

/* Edits one instance. The partial unique index allows at most one live
   exception per instant, so an existing one is updated rather than duplicated. */
export async function editOccurrence(
  ref: OccurrenceRef,
  patch: Partial<Block>,
): Promise<void> {
  const seed = await getBlock(ref.seriesId);
  if (seed === null) throw new Error(`Series ${ref.seriesId} not found`);

  const existing = await existingException(ref);
  if (existing !== null) {
    await updateBlock(existing.id, { ...patch, exceptionRole: "override" });
  } else {
    const row = exceptionRow(seed, ref, "override", patch);
    await applyInsert("block", row.id, insertStep(row));
  }
  await deleteOccurrenceAt(ref.seriesId, ref.originalStartUtc);
}

/* Deleting one instance writes a cancellation marker rather than removing
   anything, so undo tombstones the marker and the occurrence regenerates. */
export async function cancelOccurrence(ref: OccurrenceRef): Promise<void> {
  const seed = await getBlock(ref.seriesId);
  if (seed === null) throw new Error(`Series ${ref.seriesId} not found`);

  const existing = await existingException(ref);
  if (existing !== null) {
    await updateBlock(existing.id, { exceptionRole: "cancelled" });
  } else {
    const duration = (seed.endUtc ?? 0) - (seed.startUtc ?? 0);
    // Times stay at the original instant, so the row is self describing when
    // read straight out of the database.
    const row = exceptionRow(seed, ref, "cancelled", {
      startUtc: ref.originalStartUtc,
      endUtc: ref.originalStartUtc + duration,
    });
    await applyInsert("block", row.id, insertStep(row));
  }
  await deleteOccurrenceAt(ref.seriesId, ref.originalStartUtc);
}

/* Any temporal change moves every generated anchor, orphaning every exception
   pinned to an old one. Rather than re-anchoring them, which is silently wrong
   for a rule change and untestable, they are reset. The caller is expected to
   have confirmed the count first. */
export async function editSeries(
  seriesId: string,
  patch: Partial<Block>,
): Promise<number> {
  const current = await getBlock(seriesId);
  if (current === null) throw new Error(`Series ${seriesId} not found`);

  const exceptions = isTemporalPatch(patch) ? await listExceptionBlocks(seriesId) : [];
  const stamp = Date.now();

  const changes: EntityChange[] = [
    {
      op: "update",
      entity: "block",
      entityId: seriesId,
      changes: fieldChanges(current, patch),
    },
    ...exceptions.map((exception): EntityChange => ({
      op: "update",
      entity: "block",
      entityId: exception.id,
      changes: [{ field: "deleted_utc", oldValue: null, newValue: stamp }],
    })),
  ];

  await applyBatch(changes);
  return exceptions.length;
}

/* Deleting this and every later instance is a truncation, not a split: the head
   keeps its history and no tail is created. */
export async function truncateSeriesAt(ref: OccurrenceRef): Promise<void> {
  const seed = await getBlock(ref.seriesId);
  if (seed === null || seed.startUtc === null || seed.endUtc === null) return;
  if (seed.rrule === null) return;

  const split = splitRuleAt(
    {
      blockId: seed.id,
      startUtc: seed.startUtc,
      endUtc: seed.endUtc,
      tz: seed.tz,
      rrule: seed.rrule,
    },
    ref.originalStartUtc,
  );
  if (!split.ok) return;

  // Nothing before the split means the whole series goes.
  if (split.value.head === null) {
    await softDeleteBlock(ref.seriesId);
    return;
  }
  await editSeries(ref.seriesId, { rrule: split.value.head });
}

export type FutureEditResult = {
  tailId: string;
  resetExceptions: number;
};

/* Splits the series. The tail is a fork rather than a child: recurrence_parent_id
   means "this is an exception of X" and nothing else, and a later series edit on
   the tail must not walk back into the head. Provenance lives in the payload. */
export async function editFuture(
  ref: OccurrenceRef,
  patch: Partial<Block>,
): Promise<FutureEditResult | null> {
  const seed = await getBlock(ref.seriesId);
  if (seed === null || seed.startUtc === null || seed.endUtc === null) return null;
  if (seed.rrule === null) return null;

  const split = splitRuleAt(
    {
      blockId: seed.id,
      startUtc: seed.startUtc,
      endUtc: seed.endUtc,
      tz: seed.tz,
      rrule: seed.rrule,
    },
    ref.originalStartUtc,
  );
  if (!split.ok) return null;

  /* No head means the split point is the first instance, so this is just an
     edit of the whole series. Otherwise the head would end up with an UNTIL
     earlier than its own DTSTART: an empty series and an orphaned row. */
  if (split.value.head === null) {
    const reset = await editSeries(ref.seriesId, patch);
    return { tailId: ref.seriesId, resetExceptions: reset };
  }

  const now = Date.now();
  const duration = seed.endUtc - seed.startUtc;
  const tailStart = patch.startUtc ?? ref.originalStartUtc;
  const tailEnd = patch.endUtc ?? tailStart + duration;

  const tail: Block = {
    ...seed,
    ...patch,
    id: uuidv7(),
    startUtc: tailStart,
    endUtc: tailEnd,
    rrule: split.value.tail,
    recurrenceParentId: null,
    exceptionRole: "none",
    recurrenceOriginalStartUtc: null,
    payload: { ...seed.payload, splitFromId: seed.id, splitAtUtc: ref.originalStartUtc },
    createdUtc: now,
    updatedUtc: now,
    deletedUtc: null,
  };

  const later = (await listExceptionBlocks(ref.seriesId)).filter(
    (exception) =>
      exception.recurrenceOriginalStartUtc !== null &&
      exception.recurrenceOriginalStartUtc >= ref.originalStartUtc,
  );
  const temporal = isTemporalPatch(patch);

  const changes: EntityChange[] = [
    {
      op: "update",
      entity: "block",
      entityId: seed.id,
      changes: fieldChanges(seed, { rrule: split.value.head }),
    },
    { op: "insert", entity: "block", entityId: tail.id, step: insertStep(tail) },
    ...later.map((exception): EntityChange => ({
      op: "update",
      entity: "block",
      entityId: exception.id,
      changes: temporal
        ? [{ field: "deleted_utc", oldValue: null, newValue: now }]
        : [
            {
              field: "recurrence_parent_id",
              oldValue: exception.recurrenceParentId,
              newValue: tail.id,
            },
          ],
    })),
  ];

  await applyBatch(changes);
  return { tailId: tail.id, resetExceptions: temporal ? later.length : 0 };
}

/* ------------------------------------------------------------------ *
 * Content items and assets. Spec2 section 1.
 * ------------------------------------------------------------------ */

const CONTENT_FIELDS = [
  "id",
  "platform",
  "status",
  "title",
  "body",
  "payload",
  "block_id",
  "project_id",
  "posted_utc",
  "posted_url",
  "sort_order",
  "created_utc",
  "updated_utc",
  "deleted_utc",
] as const;

const CONTENT_COLUMNS = CONTENT_FIELDS.join(", ");

type ContentRow = {
  id: string;
  platform: string;
  status: string;
  title: string;
  body: string;
  payload: string;
  block_id: string | null;
  project_id: string | null;
  posted_utc: number | null;
  posted_url: string | null;
  sort_order: number;
  created_utc: number;
  updated_utc: number;
  deleted_utc: number | null;
};

function toContentItem(row: ContentRow): ContentItem {
  return {
    id: row.id,
    platform: oneOf(CONTENT_PLATFORMS, row.platform, "x"),
    status: oneOf(CONTENT_STATUSES, row.status, "idea"),
    title: row.title,
    body: row.body,
    payload: parsePayload(row.payload),
    blockId: row.block_id,
    projectId: row.project_id,
    postedUtc: row.posted_utc,
    postedUrl: row.posted_url,
    sortOrder: row.sort_order,
    createdUtc: row.created_utc,
    updatedUtc: row.updated_utc,
    deletedUtc: row.deleted_utc,
  };
}

const CONTENT_COLUMN_OF: Partial<Record<keyof ContentItem, string>> = {
  platform: "platform",
  status: "status",
  title: "title",
  body: "body",
  payload: "payload",
  blockId: "block_id",
  projectId: "project_id",
  postedUtc: "posted_utc",
  postedUrl: "posted_url",
  sortOrder: "sort_order",
  deletedUtc: "deleted_utc",
};

function encodeContentField(
  field: keyof ContentItem,
  value: ContentItem[keyof ContentItem] | undefined,
): SqlValue {
  if (field === "payload") return JSON.stringify(value ?? {});
  if (value === null || value === undefined) return null;
  if (typeof value === "number" || typeof value === "string") return value;
  return String(value);
}

function contentInsertStep(item: ContentItem): Step {
  return {
    sql: `INSERT INTO content_items
            (id, platform, status, title, body, payload, block_id, project_id,
             posted_utc, posted_url, sort_order, created_utc, updated_utc,
             deleted_utc, hlc, device_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params: [
      item.id,
      item.platform,
      item.status,
      item.title,
      item.body,
      JSON.stringify(item.payload),
      item.blockId,
      item.projectId,
      item.postedUtc,
      item.postedUrl,
      item.sortOrder,
      item.createdUtc,
      item.updatedUtc,
      item.deletedUtc,
      "",
      "",
    ],
  };
}

export async function insertContentItem(item: ContentItem): Promise<void> {
  await applyInsert("content_item", item.id, contentInsertStep(item));
}

export async function getContentItem(id: string): Promise<ContentItem | null> {
  const rows = await query<ContentRow>(
    `SELECT ${CONTENT_COLUMNS} FROM content_items
      WHERE id = ? AND deleted_utc IS NULL`,
    [id],
  );
  const row = rows[0];
  return row === undefined ? null : toContentItem(row);
}

export async function updateContentItem(
  id: string,
  patch: Partial<ContentItem>,
): Promise<void> {
  const current = await getContentItem(id);
  if (current === null) throw new Error(`Content item ${id} not found`);

  const changes: FieldChange[] = [];
  for (const [key, column] of Object.entries(CONTENT_COLUMN_OF)) {
    if (column === undefined) continue;
    const field = key as keyof ContentItem;
    if (!(field in patch)) continue;
    changes.push({
      field: column,
      oldValue: encodeContentField(field, current[field]),
      newValue: encodeContentField(field, patch[field]),
    });
  }

  if (changes.length > 0) await applyUpdate("content_item", id, changes);
}

/* No hard delete anywhere. Architecture invariant 5. */
export async function softDeleteContentItem(id: string): Promise<void> {
  await updateContentItem(id, { deletedUtc: Date.now() });
}

/* Bounded by platform, then narrowed by whatever the filter bar has set. The
   grid never asks for every content row in the database. */
export async function listContent(
  filter: ContentFilter,
  limit = 500,
): Promise<ContentItem[]> {
  const wheres = ["deleted_utc IS NULL", "platform = ?"];
  const params: SqlValue[] = [filter.platform];

  if (filter.statuses.length > 0) {
    wheres.push(`status IN (${filter.statuses.map(() => "?").join(", ")})`);
    params.push(...filter.statuses);
  }

  if (filter.projectId !== null) {
    wheres.push("project_id = ?");
    params.push(filter.projectId);
  }

  /* FTS decides which rows match the text; ordering is applied in the domain,
     so one comparator serves every sort option and stays testable. */
  const match = ftsQuery(filter.query);
  if (match !== null) {
    wheres.push(
      "rowid IN (SELECT rowid FROM content_fts WHERE content_fts MATCH ?)",
    );
    params.push(match);
  }

  params.push(limit);

  const rows = await query<ContentRow>(
    `SELECT ${CONTENT_COLUMNS} FROM content_items
      WHERE ${wheres.join(" AND ")}
      ORDER BY updated_utc DESC
      LIMIT ?`,
    params,
  );
  return rows.map(toContentItem);
}

/* Powers the sub-nav count badges. One grouped read rather than four. */
export async function countUnfinishedContent(): Promise<
  Record<ContentPlatform, number>
> {
  const rows = await query<{ platform: string; n: number }>(
    `SELECT platform, count(*) AS n FROM content_items
      WHERE deleted_utc IS NULL AND status IN ('idea', 'draft')
      GROUP BY platform`,
  );

  const counts: Record<ContentPlatform, number> = {
    x: 0,
    linkedin: 0,
    instagram: 0,
    youtube: 0,
  };
  for (const row of rows) {
    const platform = CONTENT_PLATFORMS.find((value) => value === row.platform);
    if (platform !== undefined) counts[platform] = row.n;
  }
  return counts;
}

export async function searchContent(
  term: string,
  limit = 50,
): Promise<ContentItem[]> {
  const match = ftsQuery(term);
  if (match === null) return [];
  const rows = await query<ContentRow>(
    `SELECT ${CONTENT_FIELDS.map((column) => `c.${column}`).join(", ")}
       FROM content_fts f
       JOIN content_items c ON c.rowid = f.rowid
      WHERE content_fts MATCH ?
        AND c.deleted_utc IS NULL
      ORDER BY rank
      LIMIT ?`,
    [match, limit],
  );
  return rows.map(toContentItem);
}

export async function contentItemForBlock(
  blockId: string,
): Promise<ContentItem | null> {
  const rows = await query<ContentRow>(
    `SELECT ${CONTENT_COLUMNS} FROM content_items
      WHERE block_id = ? AND deleted_utc IS NULL
      LIMIT 1`,
    [blockId],
  );
  const row = rows[0];
  return row === undefined ? null : toContentItem(row);
}

const ASSET_COLUMNS =
  "id, path, sha256, mime, width, height, bytes, origin, created_utc, deleted_utc";

const ASSET_ORIGINS = ["import", "generated", "capture"] as const;
const ASSET_ROLES = ["primary", "variant", "reference"] as const;

type AssetRow = {
  id: string;
  path: string;
  sha256: string;
  mime: string;
  width: number | null;
  height: number | null;
  bytes: number;
  origin: string;
  created_utc: number;
  deleted_utc: number | null;
};

function toAsset(row: AssetRow): Asset {
  return {
    id: row.id,
    path: row.path,
    sha256: row.sha256,
    mime: row.mime,
    width: row.width,
    height: row.height,
    bytes: row.bytes,
    origin: oneOf(ASSET_ORIGINS, row.origin, "import"),
    createdUtc: row.created_utc,
    deletedUtc: row.deleted_utc,
  };
}

export async function insertAsset(asset: Asset): Promise<void> {
  await applyInsert("asset", asset.id, {
    sql: `INSERT INTO assets
            (id, path, sha256, mime, width, height, bytes, origin,
             created_utc, deleted_utc, hlc, device_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params: [
      asset.id,
      asset.path,
      asset.sha256,
      asset.mime,
      asset.width,
      asset.height,
      asset.bytes,
      asset.origin,
      asset.createdUtc,
      asset.deletedUtc,
      "",
      "",
    ],
  });
}

/* The deduplication lookup. Invariant 11: importing the same bytes twice must
   produce one row, so every import goes through this first. */
export async function assetBySha(sha256: string): Promise<Asset | null> {
  const rows = await query<AssetRow>(
    `SELECT ${ASSET_COLUMNS} FROM assets
      WHERE sha256 = ? AND deleted_utc IS NULL`,
    [sha256],
  );
  const row = rows[0];
  return row === undefined ? null : toAsset(row);
}

export async function linkAsset(
  contentId: string,
  assetId: string,
  role: AssetRole = "primary",
  sortOrder = 0,
): Promise<void> {
  await execute(
    `INSERT OR REPLACE INTO content_assets (content_id, asset_id, role, sort_order)
     VALUES (?, ?, ?, ?)`,
    [contentId, assetId, role, sortOrder],
  );
}

/* content_assets is a join table with no user data of its own, so a real
   DELETE here does not breach invariant 5: the asset row and the item row both
   survive, only the link between them goes. */
export async function unlinkAsset(
  contentId: string,
  assetId: string,
  role: AssetRole,
): Promise<void> {
  await execute(
    `DELETE FROM content_assets
      WHERE content_id = ? AND asset_id = ? AND role = ?`,
    [contentId, assetId, role],
  );
}

export type LinkedAsset = Asset & { role: AssetRole };

export async function assetsForContent(
  contentId: string,
): Promise<LinkedAsset[]> {
  const rows = await query<AssetRow & { role: string }>(
    `SELECT ${ASSET_COLUMNS.split(", ")
      .map((column) => `a.${column}`)
      .join(", ")}, ca.role AS role
       FROM content_assets ca
       JOIN assets a ON a.id = ca.asset_id
      WHERE ca.content_id = ? AND a.deleted_utc IS NULL
      ORDER BY ca.sort_order, a.created_utc`,
    [contentId],
  );
  return rows.map((row) => ({
    ...toAsset(row),
    role: oneOf(ASSET_ROLES, row.role, "primary"),
  }));
}

/* ------------------------------------------------------------------ *
 * The generation layer. Spec1.1 sections 8 and 10.
 * ------------------------------------------------------------------ */

const GENERATOR_COLUMNS =
  "id, version, ruleset_id, name, kind, role, stage, enabled, layer, sort_order, " +
  "valid_from, valid_to, timezone, emits, config, dst, deleted_utc";

type GeneratorRow = {
  id: string;
  version: number;
  ruleset_id: string;
  name: string;
  kind: string;
  role: string;
  stage: string | null;
  enabled: number;
  layer: number;
  sort_order: number;
  valid_from: number | null;
  valid_to: number | null;
  timezone: string;
  emits: string;
  config: string;
  dst: string | null;
  deleted_utc: number | null;
};

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    /* A malformed config must not take the calendar down; the registry will
       refuse it by name when generation runs. */
    return {};
  }
}

function toGenerator(row: GeneratorRow): Generator {
  return {
    id: row.id,
    version: row.version,
    name: row.name,
    kind: row.kind as Generator["kind"],
    enabled: row.enabled !== 0,
    layer: row.layer,
    validFrom: row.valid_from,
    validTo: row.valid_to,
    timezone: row.timezone,
    emits: parseJson(row.emits) as Generator["emits"],
    config: parseJson(row.config),
    ...(row.dst === null ? {} : { dst: parseJson(row.dst) as Generator["dst"] }),
  };
}

function toModifier(row: GeneratorRow): Modifier {
  return {
    id: row.id,
    version: row.version,
    name: row.name,
    kind: row.kind as Modifier["kind"],
    enabled: row.enabled !== 0,
    order: row.sort_order,
    validFrom: row.valid_from,
    validTo: row.valid_to,
    timezone: row.timezone,
    config: parseJson(row.config),
  };
}

export type Ruleset = {
  id: string;
  name: string;
  enabled: boolean;
  sortOrder: number;
};

export async function listRulesets(): Promise<Ruleset[]> {
  const rows = await query<{
    id: string;
    name: string;
    enabled: number;
    sort_order: number;
  }>(
    `SELECT id, name, enabled, sort_order FROM rulesets
      WHERE deleted_utc IS NULL ORDER BY sort_order, name`,
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    enabled: row.enabled !== 0,
    sortOrder: row.sort_order,
  }));
}

export async function insertRuleset(ruleset: Ruleset): Promise<void> {
  const now = Date.now();
  await execute(
    `INSERT INTO rulesets (id, name, enabled, sort_order, created_utc, updated_utc, hlc, device_id)
     VALUES (?, ?, ?, ?, ?, ?, '', '')`,
    [ruleset.id, ruleset.name, ruleset.enabled ? 1 : 0, ruleset.sortOrder, now, now],
  );
}

/* Every version, not only the one in force. The engine picks per date, so a
   window spanning an edit renders the days before it with the old rule and the
   days after with the new one. */
export async function loadRuleset(rulesetId: string): Promise<ResolvedRuleset | null> {
  const meta = await query<{ id: string; name: string }>(
    `SELECT id, name FROM rulesets WHERE id = ? AND deleted_utc IS NULL`,
    [rulesetId],
  );
  const head = meta[0];
  if (head === undefined) return null;

  const rows = await query<GeneratorRow>(
    `SELECT ${GENERATOR_COLUMNS} FROM generators
      WHERE ruleset_id = ? AND deleted_utc IS NULL
      ORDER BY id, version`,
    [rulesetId],
  );

  return {
    id: head.id,
    name: head.name,
    generators: rows.filter((row) => row.role !== "modifier").map(toGenerator),
    modifiers: rows.filter((row) => row.role === "modifier").map(toModifier),
  };
}

export async function listGeneratorVersions(
  generatorId: string,
): Promise<Generator[]> {
  const rows = await query<GeneratorRow>(
    `SELECT ${GENERATOR_COLUMNS} FROM generators
      WHERE id = ? AND deleted_utc IS NULL ORDER BY version`,
    [generatorId],
  );
  return rows.map(toGenerator);
}

function generatorInsertStep(
  generator: Generator,
  rulesetId: string,
  nowUtc: number,
): Step {
  return {
    sql: `INSERT INTO generators
            (id, version, ruleset_id, name, kind, role, stage, enabled, layer,
             sort_order, valid_from, valid_to, timezone, emits, config, dst,
             created_utc, updated_utc, deleted_utc, hlc, device_id)
          VALUES (?, ?, ?, ?, ?, 'generator', NULL, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, NULL, '', '')`,
    params: [
      generator.id,
      generator.version,
      rulesetId,
      generator.name,
      generator.kind,
      generator.enabled ? 1 : 0,
      generator.layer,
      generator.validFrom,
      generator.validTo,
      generator.timezone,
      JSON.stringify(generator.emits),
      JSON.stringify(generator.config),
      generator.dst === undefined ? null : JSON.stringify(generator.dst),
      nowUtc,
      nowUtc,
    ],
  };
}

export type SaveGeneratorResult =
  | { ok: true; version: number; closed: number }
  | { ok: false; error: string };

/* Spec1.1 section 8. One transaction: the old version closes and the new one
   opens at the same instant, which is what makes overlapping versions
   impossible rather than merely unlikely. Edge case 16. */
export async function saveGeneratorVersion(
  rulesetId: string,
  next: Omit<Generator, "version" | "validFrom" | "validTo">,
  mode: SaveMode,
  atUtc: number,
  range?: { from: number; to: number },
): Promise<SaveGeneratorResult> {
  const existing = await listGeneratorVersions(next.id);

  const plan = planSave<Generator>({
    existing,
    next,
    mode,
    atUtc,
    ...(range === undefined ? {} : { range }),
  });

  const after = applyPlan(existing, plan);
  const overlap = findOverlap(after);
  if (overlap !== null) {
    return {
      ok: false,
      error: `Saving would leave versions ${overlap.left.version} and ${overlap.right.version} overlapping`,
    };
  }

  const steps: Step[] = [];

  for (const row of plan.closed) {
    steps.push({
      sql: `UPDATE generators SET valid_to = ?, updated_utc = ?
             WHERE id = ? AND version = ?`,
      params: [row.validTo, atUtc, row.id, row.version],
    });
  }

  for (const row of plan.rewritten) {
    steps.push({
      sql: `UPDATE generators SET name = ?, kind = ?, enabled = ?, layer = ?,
                   timezone = ?, emits = ?, config = ?, dst = ?, updated_utc = ?
             WHERE id = ? AND version = ?`,
      params: [
        row.name,
        row.kind,
        row.enabled ? 1 : 0,
        row.layer,
        row.timezone,
        JSON.stringify(row.emits),
        JSON.stringify(row.config),
        row.dst === undefined ? null : JSON.stringify(row.dst),
        atUtc,
        row.id,
        row.version,
      ],
    });
  }

  if (plan.inserted !== null) {
    steps.push(generatorInsertStep(plan.inserted, rulesetId, atUtc));
  }

  if (steps.length === 0) return { ok: true, version: 0, closed: 0 };

  await transaction(steps);
  return {
    ok: true,
    version: plan.inserted?.version ?? 0,
    closed: plan.closed.length,
  };
}

/* ---- overrides ---- */

export type StoredOverride = SlotOverride & {
  generatorId: string;
  localDate: string;
  ordinal: number;
};

export async function listOverrides(
  generatorIds?: readonly string[],
): Promise<StoredOverride[]> {
  const rows = await query<{
    slot_key: string;
    generator_id: string;
    local_date: string;
    ordinal: number;
    action: string;
    moved_start_utc: number | null;
    moved_end_utc: number | null;
  }>(
    `SELECT slot_key, generator_id, local_date, ordinal, action,
            moved_start_utc, moved_end_utc
       FROM slot_overrides WHERE deleted_utc IS NULL`,
  );

  const wanted =
    generatorIds === undefined ? null : new Set(generatorIds);

  return rows
    .filter((row) => wanted === null || wanted.has(row.generator_id))
    .map((row) => ({
      slotKey: row.slot_key,
      generatorId: row.generator_id,
      localDate: row.local_date,
      ordinal: row.ordinal,
      action: row.action as SlotOverride["action"],
      movedStartUtc: row.moved_start_utc,
      movedEndUtc: row.moved_end_utc,
    }));
}

export async function putOverride(override: StoredOverride): Promise<void> {
  const now = Date.now();
  await execute(
    `INSERT INTO slot_overrides
       (slot_key, generator_id, local_date, ordinal, action, moved_start_utc,
        moved_end_utc, created_utc, updated_utc, hlc, device_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '', '')
     ON CONFLICT(slot_key) DO UPDATE SET
       action = excluded.action,
       moved_start_utc = excluded.moved_start_utc,
       moved_end_utc = excluded.moved_end_utc,
       deleted_utc = NULL,
       updated_utc = excluded.updated_utc`,
    [
      override.slotKey,
      override.generatorId,
      override.localDate,
      override.ordinal,
      override.action,
      override.movedStartUtc ?? null,
      override.movedEndUtc ?? null,
      now,
      now,
    ],
  );
}

export async function clearOverride(slotKey: string): Promise<void> {
  await execute(
    `UPDATE slot_overrides SET deleted_utc = ?, updated_utc = ? WHERE slot_key = ?`,
    [Date.now(), Date.now(), slotKey],
  );
}

/* Edge case 9. An override whose generator is gone has nothing to attach to,
   but is not deleted at once: a generator can come back from an undo, and
   losing every skip on the way would be worse than keeping dead rows for a
   while. Ninety days is long enough for that and short enough to stay tidy. */
export const ORPHAN_GRACE_MS = 90 * 86_400_000;

export async function collectOrphanedOverrides(nowUtc: number): Promise<number> {
  const cutoff = nowUtc - ORPHAN_GRACE_MS;
  const rows = await query<{ slot_key: string }>(
    `SELECT o.slot_key FROM slot_overrides o
      WHERE o.deleted_utc IS NULL
        AND o.updated_utc < ?
        AND NOT EXISTS (
          SELECT 1 FROM generators g
           WHERE g.id = o.generator_id AND g.deleted_utc IS NULL
        )`,
    [cutoff],
  );

  for (const row of rows) await clearOverride(row.slot_key);
  return rows.length;
}

/* ---- bindings ---- */

export async function listBindings(): Promise<
  (SlotBinding & { generatorId: string })[]
> {
  const rows = await query<{
    slot_key: string;
    generator_id: string;
    content_id: string | null;
    block_id: string | null;
  }>(
    `SELECT slot_key, generator_id, content_id, block_id
       FROM slot_bindings WHERE deleted_utc IS NULL`,
  );
  return rows.map((row) => ({
    slotKey: row.slot_key,
    generatorId: row.generator_id,
    contentId: row.content_id,
    blockId: row.block_id,
  }));
}

export async function putBinding(
  slotKey: string,
  generatorId: string,
  contentId: string | null,
  blockId: string | null,
): Promise<void> {
  const now = Date.now();
  await execute(
    `INSERT INTO slot_bindings
       (slot_key, generator_id, content_id, block_id, bound_utc, created_utc,
        updated_utc, hlc, device_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, '', '')
     ON CONFLICT(slot_key) DO UPDATE SET
       content_id = excluded.content_id,
       block_id = excluded.block_id,
       deleted_utc = NULL,
       updated_utc = excluded.updated_utc`,
    [slotKey, generatorId, contentId, blockId, now, now, now],
  );
}

export async function clearBinding(slotKey: string): Promise<void> {
  await execute(
    `UPDATE slot_bindings SET deleted_utc = ?, updated_utc = ? WHERE slot_key = ?`,
    [Date.now(), Date.now(), slotKey],
  );
}

/* Edge case 25. A materialized block the user deleted must not come back. The
   binding goes with it, which returns the slot to virtual on the next pass,
   and nothing regenerates the block because only a binding would. */
export async function reconcileDeletedBlocks(): Promise<number> {
  const rows = await query<{ slot_key: string }>(
    `SELECT b.slot_key FROM slot_bindings b
       JOIN blocks bl ON bl.id = b.block_id
      WHERE b.deleted_utc IS NULL AND bl.deleted_utc IS NOT NULL`,
  );
  for (const row of rows) await clearBinding(row.slot_key);
  return rows.length;
}

/* Applies a rekey mapping in one transaction. Ordered so a key never collides
   with one still to move: every row goes to a temporary key first, then to its
   destination. Renaming in place would fail the moment two overrides swapped
   ordinals, which is exactly what inserting a time at the start of a day does. */
export async function applyRekeyPlan(plan: RekeyPlan): Promise<number> {
  if (plan.pairs.length === 0) return 0;

  const steps: Step[] = [];

  for (const pair of plan.pairs) {
    steps.push({
      sql: `UPDATE slot_overrides SET slot_key = ? WHERE slot_key = ?`,
      params: [`~${pair.toKey}`, pair.fromKey],
    });
  }

  for (const pair of plan.pairs) {
    steps.push({
      sql: `UPDATE slot_overrides SET slot_key = ?, ordinal = ?, updated_utc = ?
             WHERE slot_key = ?`,
      params: [pair.toKey, pair.toOrdinal, Date.now(), `~${pair.toKey}`],
    });
  }

  await transaction(steps);
  return plan.pairs.length;
}

/* "Skip all future" is a rule change, not a pile of overrides: it closes the
   version in force at that instant and opens nothing after it. Writing one
   override per remaining day would be thousands of rows all saying the same
   thing, and none of them would survive the rule being edited. */
export async function closeGeneratorAt(
  generatorId: string,
  atUtc: number,
): Promise<boolean> {
  const versions = await listGeneratorVersions(generatorId);
  const open = versions.filter(
    (row) =>
      (row.validTo === null || row.validTo > atUtc) &&
      (row.validFrom === null || row.validFrom < atUtc),
  );
  if (open.length === 0) return false;

  await transaction(
    open.map((row) => ({
      sql: `UPDATE generators SET valid_to = ?, updated_utc = ?
             WHERE id = ? AND version = ?`,
      params: [atUtc, Date.now(), row.id, row.version],
    })),
  );
  return true;
}

/* Spec1.1 section 13, item 7. Binding a slot materialises a block that knows
   where it came from: payload.generatedBy carries the generator, the slot key
   and the version, so a block can always be traced back to the rule that
   produced it. Invariant 22. */
export type MaterializeRequest = {
  slotKey: string;
  generatorId: string;
  generatorVersion: number;
  contentId: string;
  title: string;
  startUtc: number;
  endUtc: number;
  tz: string;
  platform?: string;
  projectId?: string | null;
  activityTypeName?: string;
};

function materializeSteps(
  request: MaterializeRequest,
  blockId: string,
  nowUtc: number,
): { block: Block; step: Step } {
  const block: Block = {
    ...newBlock({
      id: blockId,
      kind: "post",
      title: request.title === "" ? "Untitled" : request.title,
      startUtc: request.startUtc,
      endUtc: request.endUtc,
      tz: request.tz,
      nowUtc,
    }),
    projectId: request.projectId ?? null,
    payload: {
      ...(request.platform === undefined
        ? {}
        : { platform: request.platform as BlockPayload["platform"] }),
      ...(request.activityTypeName === undefined
        ? {}
        : { activityTypeName: request.activityTypeName }),
      contentItemId: request.contentId,
      generatedBy: {
        generatorId: request.generatorId,
        slotKey: request.slotKey,
        version: request.generatorVersion,
      },
    },
  };

  return { block, step: insertStep(block) };
}

/* Every block insert, every content link and every binding in one ops batch,
   so auto-filling thirty days is one entry in the undo history rather than
   ninety. Spec1.1 13: applied or rejected as one transaction. */
export async function applyAssignments(
  requests: readonly MaterializeRequest[],
): Promise<{ batch: string | null; blockIds: string[] }> {
  if (requests.length === 0) return { batch: null, blockIds: [] };

  const nowUtc = Date.now();
  const changes: EntityChange[] = [];
  const blockIds: string[] = [];
  const bindings: { slotKey: string; generatorId: string; contentId: string; blockId: string }[] =
    [];

  for (const request of requests) {
    const blockId = uuidv7();
    const { step } = materializeSteps(request, blockId, nowUtc);

    changes.push({ op: "insert", entity: "block", entityId: blockId, step });
    changes.push({
      op: "update",
      entity: "content_item",
      entityId: request.contentId,
      changes: [
        { field: "block_id", oldValue: null, newValue: blockId },
        { field: "status", oldValue: "ready", newValue: "scheduled" },
      ],
    });

    blockIds.push(blockId);
    bindings.push({
      slotKey: request.slotKey,
      generatorId: request.generatorId,
      contentId: request.contentId,
      blockId,
    });
  }

  const batch = await applyBatch(changes);

  /* Bindings are not ops logged: they are derived from the block, and undoing
     the batch tombstones the block, after which reconcileDeletedBlocks removes
     them. Writing them into the ops log too would make one action take two
     undos. */
  for (const binding of bindings) {
    await putBinding(binding.slotKey, binding.generatorId, binding.contentId, binding.blockId);
  }

  return { batch, blockIds };
}
