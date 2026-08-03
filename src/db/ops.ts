import { createHlcClock } from "../domain/hlc";
import { uuidv7 } from "../domain/id";
import { query, transaction, type SqlValue, type Step } from "./client";

export type Entity =
  | "block"
  | "project"
  | "tag"
  | "activity_type"
  | "activity_log"
  | "content_item"
  | "asset";

const TABLES: Record<Entity, string> = {
  block: "blocks",
  project: "projects",
  tag: "tags",
  activity_type: "activity_types",
  activity_log: "activity_log",
  content_item: "content_items",
  asset: "assets",
};

/* A creation is recorded as one lifecycle op rather than one op per column.
   Undoing a create has to tombstone the row, not blank every field, and a
   per column log of an insert cannot express that. Updates stay field level,
   which is the case that matters for merging concurrent edits. */
export const CREATE_FIELD = "__create__";

export type FieldChange = {
  field: string;
  oldValue: SqlValue;
  newValue: SqlValue;
};

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

const DEVICE_KEY = "digitalgabry.device-id";

function deviceId(): string {
  const stored = window.localStorage.getItem(DEVICE_KEY);
  if (stored !== null && stored !== "") return stored;
  const created = uuidv7();
  window.localStorage.setItem(DEVICE_KEY, created);
  return created;
}

/* Built on first use rather than at module load. deviceId reaches for
   localStorage, and doing that while the module is evaluating makes this file,
   and everything that imports it, unloadable outside a browser. */
let clockInstance: ReturnType<typeof createHlcClock> | null = null;

function clock(): ReturnType<typeof createHlcClock> {
  if (clockInstance === null) clockInstance = createHlcClock(deviceId());
  return clockInstance;
}

/* Seeds the clock from the highest stamp already on disk, so a restart cannot
   reissue a stamp that has been used before. */
export async function primeClock(): Promise<void> {
  const rows = await query<{ hlc: string | null }>(
    "SELECT MAX(hlc) AS hlc FROM ops",
  );
  const highest = rows[0]?.hlc;
  if (typeof highest === "string" && highest !== "") clock().observe(highest);
}

function assertIdentifier(value: string): string {
  if (!IDENTIFIER.test(value)) {
    throw new Error(`Unsafe column name in ops log: ${value}`);
  }
  return value;
}

function opStep(
  entity: Entity,
  entityId: string,
  change: FieldChange,
  batch: string,
  createdUtc: number,
): Step {
  return {
    sql: `INSERT INTO ops
            (id, entity, entity_id, field, old_value, new_value, hlc, device_id, created_utc, batch)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params: [
      uuidv7(),
      entity,
      entityId,
      change.field,
      change.oldValue,
      change.newValue,
      clock().next(),
      deviceId(),
      createdUtc,
      batch,
    ],
  };
}

export type EntityChange =
  | { op: "insert"; entity: Entity; entityId: string; step: Step }
  | { op: "update"; entity: Entity; entityId: string; changes: readonly FieldChange[] };

/* One batch id, one transaction, spanning as many entities as the caller needs.
   Splitting a recurring series is a head update plus a tail insert plus an
   exception repoint; as three separate batches that would take three undos and
   a crash between them would leave a bounded head with no tail.

   One ops row per changed field, written in the same transaction as the
   mutation itself. Architecture invariant 6. */
export async function applyBatch(
  changes: readonly EntityChange[],
): Promise<string | null> {
  const batch = uuidv7();
  const now = Date.now();
  const steps: Step[] = [];

  for (const change of changes) {
    if (change.op === "insert") {
      steps.push(change.step);
      steps.push(
        opStep(
          change.entity,
          change.entityId,
          { field: CREATE_FIELD, oldValue: null, newValue: change.entityId },
          batch,
          now,
        ),
      );
      continue;
    }

    const changed = change.changes.filter(
      (field) => field.oldValue !== field.newValue,
    );
    if (changed.length === 0) continue;

    const assignments = changed
      .map((field) => `${assertIdentifier(field.field)} = ?`)
      .join(", ");

    steps.push({
      sql: `UPDATE ${TABLES[change.entity]}
            SET ${assignments}, updated_utc = ?, hlc = ?, device_id = ?
            WHERE id = ?`,
      params: [
        ...changed.map((field) => field.newValue),
        now,
        clock().next(),
        deviceId(),
        change.entityId,
      ],
    });

    for (const field of changed) {
      steps.push(opStep(change.entity, change.entityId, field, batch, now));
    }
  }

  if (steps.length === 0) return null;
  await transaction(steps);
  return batch;
}

export async function applyUpdate(
  entity: Entity,
  entityId: string,
  changes: readonly FieldChange[],
): Promise<string | null> {
  return applyBatch([{ op: "update", entity, entityId, changes }]);
}

export async function applyInsert(
  entity: Entity,
  entityId: string,
  insert: Step,
): Promise<string | null> {
  return applyBatch([{ op: "insert", entity, entityId, step: insert }]);
}

type OpRow = {
  id: string;
  entity: Entity;
  entity_id: string;
  field: string;
  old_value: SqlValue;
  new_value: SqlValue;
  batch: string;
};

function reverseSteps(ops: readonly OpRow[], forward: boolean): Step[] {
  return ops.map((op) => {
    const table = TABLES[op.entity];
    if (op.field === CREATE_FIELD) {
      return {
        sql: `UPDATE ${table} SET deleted_utc = ? WHERE id = ?`,
        params: [forward ? null : Date.now(), op.entity_id],
      };
    }
    return {
      sql: `UPDATE ${table} SET ${assertIdentifier(op.field)} = ? WHERE id = ?`,
      params: [forward ? op.new_value : op.old_value, op.entity_id],
    };
  });
}

/* Undo and redo walk the ops log rather than a React state stack, so history
   survives a restart and stays consistent with what sync would replay. */
export async function undo(): Promise<string | null> {
  const latest = await query<{ batch: string }>(
    "SELECT batch FROM ops WHERE undone = 0 ORDER BY hlc DESC LIMIT 1",
  );
  const batch = latest[0]?.batch;
  if (batch === undefined) return null;

  const ops = await query<OpRow>(
    "SELECT id, entity, entity_id, field, old_value, new_value, batch FROM ops WHERE batch = ? AND undone = 0",
    [batch],
  );
  if (ops.length === 0) return null;

  await transaction([
    ...reverseSteps(ops, false),
    { sql: "UPDATE ops SET undone = ? WHERE batch = ?", params: [Date.now(), batch] },
  ]);

  return batch;
}

export async function redo(): Promise<string | null> {
  const latest = await query<{ batch: string }>(
    "SELECT batch FROM ops WHERE undone > 0 ORDER BY undone DESC LIMIT 1",
  );
  const batch = latest[0]?.batch;
  if (batch === undefined) return null;

  const ops = await query<OpRow>(
    "SELECT id, entity, entity_id, field, old_value, new_value, batch FROM ops WHERE batch = ? AND undone > 0",
    [batch],
  );
  if (ops.length === 0) return null;

  await transaction([
    ...reverseSteps(ops, true),
    { sql: "UPDATE ops SET undone = 0 WHERE batch = ?", params: [batch] },
  ]);

  return batch;
}

export async function countOpsFor(entityId: string): Promise<number> {
  const rows = await query<{ n: number }>(
    "SELECT count(*) AS n FROM ops WHERE entity_id = ?",
    [entityId],
  );
  return rows[0]?.n ?? 0;
}
