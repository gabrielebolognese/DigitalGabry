import { invoke } from "@tauri-apps/api/core";
import { appDataDir, join } from "@tauri-apps/api/path";
import { load } from "@tauri-apps/plugin-store";
import { newBlock } from "../domain/block";
import { uuidv7 } from "../domain/id";
import { localDateOf } from "../domain/time";
import {
  insertBlock,
  listAllActivity,
  listAllBlocks,
  listAllMomentum,
  listActivityTypes,
  listProjects,
  vacuumInto,
} from "../db/repository";
import {
  groupByMonth,
  monthFileName,
  monthMarkdown,
  snapshotName,
  stableJson,
} from "./format";
import { parseImport, type ImportIssue } from "./parse";

const STORE_FILE = "settings.json";
const SETTINGS_KEY = "backup.settings";

export const DEFAULT_RETENTION = 30;

export type BackupSettings = {
  backupDir: string;
  exportDir: string;
  retention: number;
  lastBackupUtc: number | null;
  lastExportUtc: number | null;
  /* Phase 12. Where "post this" stages an image for dragging, and the soft
     character target. Both live here because this is already the settings
     record the app reads at start; a second one would be a second thing to
     keep in step. */
  outboxDir?: string;
  xSoftLimit?: number;
};

export async function defaultSettings(): Promise<BackupSettings> {
  const base = await appDataDir();
  return {
    // Defaults sit beside the database in the app data directory. SPEC gives
    // the folder names but not their parent.
    backupDir: await join(base, "backups"),
    exportDir: await join(base, "export"),
    retention: DEFAULT_RETENTION,
    lastBackupUtc: null,
    lastExportUtc: null,
  };
}

export async function readBackupSettings(): Promise<BackupSettings> {
  const fallback = await defaultSettings();
  try {
    const store = await load(STORE_FILE, { autoSave: true });
    const stored = await store.get<Partial<BackupSettings>>(SETTINGS_KEY);
    return stored === undefined || stored === null ? fallback : { ...fallback, ...stored };
  } catch {
    return fallback;
  }
}

export async function writeBackupSettings(settings: BackupSettings): Promise<void> {
  const store = await load(STORE_FILE, { autoSave: true });
  await store.set(SETTINGS_KEY, settings);
  await store.save();
}

export type BackupReport = {
  file: string;
  pruned: string[];
};

/* SPEC 11: VACUUM INTO a dated snapshot, keep the last N. */
export async function runBackup(nowUtc: number, tz: string): Promise<BackupReport> {
  const settings = await readBackupSettings();
  await invoke("ensure_dir", { path: settings.backupDir });

  const file = snapshotName(nowUtc, tz);
  await vacuumInto(await join(settings.backupDir, file));

  const pruned = await invoke<string[]>("prune_snapshots", {
    dir: settings.backupDir,
    keep: settings.retention,
  });

  await writeBackupSettings({ ...settings, lastBackupUtc: nowUtc });
  return { file, pruned };
}

export type ExportReport = {
  months: number;
  git: string;
};

/* One Markdown file per month plus three JSON files, all written with stable
   ordering so an unchanged export produces an empty diff. SPEC 11. */
export async function runExport(nowUtc: number, tz: string): Promise<ExportReport> {
  const settings = await readBackupSettings();
  await invoke("ensure_dir", { path: settings.exportDir });

  const blocks = await listAllBlocks();
  const months = groupByMonth(blocks, tz);

  for (const [monthKey, monthBlocks] of [...months.entries()].sort()) {
    await invoke("write_text_file", {
      dir: settings.exportDir,
      name: monthFileName(monthKey),
      contents: monthMarkdown(monthKey, monthBlocks, tz),
    });
  }

  const [projects, activity, momentum, types] = await Promise.all([
    listProjects(),
    listAllActivity(),
    listAllMomentum(),
    listActivityTypes(),
  ]);

  const files: Array<[string, unknown]> = [
    ["projects.json", projects],
    ["activity.json", { types, entries: activity }],
    ["momentum.json", momentum],
  ];

  for (const [name, value] of files) {
    await invoke("write_text_file", {
      dir: settings.exportDir,
      name,
      contents: stableJson(value),
    });
  }

  /* Committed with the ISO date as the message. Silently skipped when the
     folder is not a repository. */
  const git = await invoke<string>("git_commit_export", {
    dir: settings.exportDir,
    message: localDateOf(nowUtc, tz),
  });

  await writeBackupSettings({ ...settings, lastExportUtc: nowUtc });
  return { months: months.size, git };
}

export type ImportReport = {
  imported: number;
  errors: ImportIssue[];
};

/* One directional and explicitly not sync. Only rows that parsed cleanly are
   inserted, so a malformed file leaves what is already there untouched. */
export async function runImport(
  path: string,
  tz: string,
  nowUtc: number,
): Promise<ImportReport> {
  const text = await invoke<string>("read_text_file", { path });
  const fileName = path.replace(/\\/g, "/").split("/").pop() ?? path;
  const { drafts, errors } = parseImport(text, fileName, tz);

  let imported = 0;
  for (const draft of drafts) {
    const seed = newBlock({
      id: uuidv7(),
      startUtc: draft.startUtc ?? 0,
      endUtc: draft.endUtc ?? 0,
      tz,
      nowUtc,
      kind: draft.kind,
      title: draft.title,
    });

    await insertBlock({
      ...seed,
      startUtc: draft.startUtc,
      endUtc: draft.endUtc,
      status: draft.status,
      category: draft.category,
      description: draft.description,
      tags: draft.tags,
    });
    imported += 1;
  }

  return { imported, errors };
}
