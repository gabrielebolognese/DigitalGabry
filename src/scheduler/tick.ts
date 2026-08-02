import { localDateOf, wallClockOf } from "../domain/time";
import { readBackupSettings, runBackup, runExport } from "../backup/run";

/* SPEC 11: nightly at 03:00 local. */
export const NIGHTLY_HOUR = 3;

const CHECK_MS = 60_000;

/* True once the local clock has passed 03:00 on a day the job has not run.
   Comparing against the last run's local date rather than scheduling a timer
   for 03:00 means a machine that was asleep at 3am still catches up on wake,
   and a machine left running for a week does not miss a night. */
export function isNightlyDue(
  nowUtc: number,
  lastRunUtc: number | null,
  tz: string,
): boolean {
  if (wallClockOf(nowUtc, tz).hour < NIGHTLY_HOUR) return false;
  if (lastRunUtc === null) return true;
  return localDateOf(lastRunUtc, tz) !== localDateOf(nowUtc, tz);
}

async function tick(tz: string): Promise<void> {
  const settings = await readBackupSettings();
  const now = Date.now();

  if (isNightlyDue(now, settings.lastBackupUtc, tz)) {
    await runBackup(now, tz);
  }

  // Re-read: the backup run rewrote the settings record.
  const afterBackup = await readBackupSettings();
  if (isNightlyDue(now, afterBackup.lastExportUtc, tz)) {
    await runExport(now, tz);
  }
}

/* The first check waits rather than firing on mount. On the first launch of a
   day the job is due, and a VACUUM plus a full export starting while the
   calendar is still painting is the one thing here that can be felt. Nothing
   is lost by waiting: the window it is catching up on is the whole day. */
const FIRST_CHECK_DELAY_MS = 5_000;

export function startNightlyJobs(tz: string): () => void {
  let stopped = false;

  const run = (): void => {
    if (stopped) return;
    void tick(tz).catch(() => {
      // A failed night is not worth taking the app down for; the next check
      // covers the same window.
    });
  };

  let interval: number | null = null;
  const firstCheck = window.setTimeout(() => {
    run();
    interval = window.setInterval(run, CHECK_MS);
  }, FIRST_CHECK_DELAY_MS);

  return () => {
    stopped = true;
    window.clearTimeout(firstCheck);
    if (interval !== null) window.clearInterval(interval);
  };
}
