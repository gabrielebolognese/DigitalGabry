import Database from "@tauri-apps/plugin-sql";
import { splitStatements } from "./statements";

/* Lives in the OS app data directory, never in a cloud synced folder, because
   cloud sync corrupts WAL databases. SPEC 11. */
const DB_URL = "sqlite:digitalgabry.db";

const MIGRATIONS_TABLE = "_migrations";

export type SqlValue = string | number | null;

export type Step = {
  sql: string;
  params: SqlValue[];
};

const MIGRATION_SOURCES: Record<string, unknown> = import.meta.glob(
  "./migrations/*.sql",
  { query: "?raw", import: "default", eager: true },
);

function migrationFiles(): Array<{ name: string; sql: string }> {
  const files: Array<{ name: string; sql: string }> = [];
  for (const [path, source] of Object.entries(MIGRATION_SOURCES)) {
    if (typeof source !== "string") continue;
    files.push({ name: path.slice(path.lastIndexOf("/") + 1), sql: source });
  }
  // Numbered file names, so plain string order is apply order.
  files.sort((a, b) => a.name.localeCompare(b.name));
  return files;
}

let connection: Promise<Database> | null = null;

async function connect(): Promise<Database> {
  const db = await Database.load(DB_URL);

  /* sqlx already opens SQLite with WAL and foreign keys on. synchronous is
     set here because SPEC 11 asks for NORMAL rather than the FULL default.
     Pragmas are per connection and the plugin pools connections, so this
     holds for the connection it lands on rather than the whole pool. */
  await db.execute("PRAGMA journal_mode = WAL");
  await db.execute("PRAGMA synchronous = NORMAL");
  await db.execute("PRAGMA foreign_keys = ON");

  await migrate(db);
  return db;
}

export function getDb(): Promise<Database> {
  if (connection === null) connection = connect();
  return connection;
}

async function migrate(db: Database): Promise<void> {
  await db.execute(
    `CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
       name        TEXT PRIMARY KEY,
       applied_utc INTEGER NOT NULL
     )`,
  );

  const applied = await db.select<Array<{ name: string }>>(
    `SELECT name FROM ${MIGRATIONS_TABLE}`,
  );
  const done = new Set(applied.map((row) => row.name));

  for (const file of migrationFiles()) {
    if (done.has(file.name)) continue;

    for (const statement of splitStatements(file.sql)) {
      try {
        await db.execute(statement);
      } catch (cause) {
        throw new Error(
          `Migration ${file.name} failed on: ${statement.slice(0, 120)}\n${String(cause)}`,
        );
      }
    }

    await db.execute(
      `INSERT INTO ${MIGRATIONS_TABLE} (name, applied_utc) VALUES (?, ?)`,
      [file.name, Date.now()],
    );
  }
}

export async function query<T>(sql: string, params: SqlValue[] = []): Promise<T[]> {
  const db = await getDb();
  return db.select<T[]>(sql, params);
}

export async function execute(sql: string, params: SqlValue[] = []): Promise<void> {
  const db = await getDb();
  await db.execute(sql, params);
}

/* The plugin pools connections, so BEGIN and COMMIT issued as separate calls
   are not guaranteed to reach the same connection. Sending the whole unit as
   one call is what keeps a mutation and its ops rows atomic, which is
   architecture invariant 6. */
export async function transaction(steps: readonly Step[]): Promise<void> {
  if (steps.length === 0) return;

  const db = await getDb();
  const sql = ["BEGIN IMMEDIATE", ...steps.map((step) => step.sql), "COMMIT"]
    .map((statement) => statement.trim().replace(/;$/, ""))
    .join(";\n")
    .concat(";");
  const params = steps.flatMap((step) => step.params);

  try {
    await db.execute(sql, params);
  } catch (cause) {
    // Leave no half open transaction on the connection this landed on.
    await db.execute("ROLLBACK").catch(() => undefined);
    throw cause instanceof Error ? cause : new Error(String(cause));
  }
}

export async function tableExists(name: string): Promise<boolean> {
  const rows = await query<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    [name],
  );
  return rows.length > 0;
}
