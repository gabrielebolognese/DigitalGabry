import { load } from "@tauri-apps/plugin-store";

/* The key lives in the OS app data directory through tauri-plugin-store, never
   in the database, never in the repository, and never in a log line. SPEC 9. */
const STORE_FILE = "settings.json";
const API_KEY = "anthropic.apiKey";

async function store() {
  return load(STORE_FILE, { autoSave: true });
}

export async function readApiKey(): Promise<string | null> {
  try {
    const value = await (await store()).get<string>(API_KEY);
    return typeof value === "string" && value.trim() !== "" ? value : null;
  } catch {
    return null;
  }
}

export async function writeApiKey(value: string): Promise<void> {
  const settings = await store();
  const trimmed = value.trim();
  if (trimmed === "") await settings.delete(API_KEY);
  else await settings.set(API_KEY, trimmed);
  await settings.save();
}

/* Enough to confirm a key is present without ever rendering it. */
export function maskKey(value: string): string {
  return value.length <= 8 ? "set" : `set, ending ${value.slice(-4)}`;
}
