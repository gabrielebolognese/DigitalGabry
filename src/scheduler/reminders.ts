import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { formatTime, MINUTES_PER_HOUR } from "../domain/time";
import { listBlocksInRange } from "../db/repository";

const TICK_MS = 60_000;

/* How far either side of now the tick looks. Behind, so a reminder due while
   the app was closed still fires once; ahead, only far enough to catch the
   next minute's worth. */
const LOOK_BACK_MS = 60 * MINUTES_PER_HOUR * 1000;
const LOOK_AHEAD_MS = 5 * 60_000;

const STORAGE_KEY = "digitalgabry.fired-reminders";

function loadFired(): Set<string> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return new Set();
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? new Set(parsed.filter((entry): entry is string => typeof entry === "string"))
      : new Set();
  } catch {
    return new Set();
  }
}

/* Persisted, so a restart does not fire everything again. Trimmed to the most
   recent entries because this only has to outlive a restart, not a year. */
function saveFired(fired: Set<string>): void {
  const recent = [...fired].slice(-500);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(recent));
}

async function ensurePermission(): Promise<boolean> {
  if (await isPermissionGranted()) return true;
  return (await requestPermission()) === "granted";
}

async function tick(tz: string, fired: Set<string>): Promise<void> {
  const now = Date.now();
  const entries = await listBlocksInRange({
    start: now - LOOK_BACK_MS,
    end: now + LOOK_AHEAD_MS,
  });

  let changed = false;

  for (const entry of entries) {
    const minutes = entry.payload.reminderMinutes;
    if (typeof minutes !== "number" || entry.startUtc === null) continue;
    if (entry.status === "done" || entry.status === "cancelled") continue;

    const dueAt = entry.startUtc - minutes * 60_000;
    if (dueAt > now) continue;

    // Keyed on the instance and its due moment, so a recurring series fires
    // once per occurrence rather than once for the whole rule.
    const key = `${entry.entryId}:${dueAt}`;
    if (fired.has(key)) continue;

    fired.add(key);
    changed = true;

    sendNotification({
      title: entry.title.trim() === "" ? "Untitled" : entry.title,
      body: formatTime(entry.startUtc, tz),
    });
  }

  if (changed) saveFired(fired);
}

/* Returns the stop function, so the caller owns the lifetime. */
export function startReminders(tz: string): () => void {
  const fired = loadFired();
  let stopped = false;

  const run = (): void => {
    if (stopped) return;
    void tick(tz, fired).catch(() => {
      // A failed tick must not take the scheduler down with it; the next one
      // covers the same window anyway.
    });
  };

  void ensurePermission().then((granted) => {
    if (granted) run();
  });

  const timer = window.setInterval(run, TICK_MS);

  return () => {
    stopped = true;
    window.clearInterval(timer);
  };
}
