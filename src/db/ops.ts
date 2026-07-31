import { createHlcClock } from "../domain/hlc";
import { uuidv7 } from "../domain/id";
import { query, transaction, type SqlValue, type Step } from "./client";

export type Entity = "block" | "project" | "tag" | "activity_type" | "activity_log";

const TABLES: Record<Entity, string> = {
  block: "blocks",
  project: "projects",
  tag: "tags",
  activity_type: "activity_types",
  activity_log: "activity_log",
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

const clock = createHlcClock(deviceId());

/* Seeds the clock from the highest stamp already on disk, so a restart cannot
   reissue a stamp that has been used before. */
export async function primeClock(): Promise<void> {
  const rows = await query<{ hlc: string | null }>(
    "SELECT MAX(hlc) AS hlc FROM ops",
  );
  const highest = rows[0]?.hlc;
  if (typeof highest === "string" && highest !== "") clock.observe(highest);
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
      clock.next(),
      deviceId(),
      createdUtc,
      batch,
    ],
  };
}

/* One ops row per changed field, written in the same transaction as the
   mutation itself. Architecture invariant 6. */
export async function applyUpdate(
  entity: Entity,
  entityId: string,
  changes: readonly FieldChange[],
): Promise<string | null> {
  const changed = changes.filter((change) => change.oldValue !== change.newValue);
  if (changed.length === 0) return null;

  const table = TABLES[entity];
  const batch = uuidv7();
  const now = Date.now();

  const assignments = changed
    .map((change) => `${assertIdentifier(change.field)} = ?`)
    .join(", ");

  const steps: Step[] = [
    {
      sql: `UPDATE ${table}
            SET ${assignments}, updated_utc = ?, hlc = ?, device_id = ?
            WHERE id = ?`,
      params: [
        ...changed.map((change) => change.newValue),
        now,
        clock.next(),
        deviceId(),
        entityId,
      ],
    },
    ...changed.map((change) => opStep(entity, entityId, change, batch, now)),
  ];

  await transaction(steps);
  return batch;
}

export async function applyInsert(
  entity: Entity,
  entityId: string,
  insert: Step,
): Promise<string> {
  const batch = uuidv7();
  const now = Date.now();

  await transaction([
    insert,
    opStep(
      entity,
      entityId,
      { field: CREATE_FIELD, oldValue: null, newValue: entityId },
      batch,
      now,
    ),
  ]);

  return batch;
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
