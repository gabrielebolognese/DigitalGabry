import { useEffect, useState } from "react";
import {
  isRegistered,
  register,
  unregister,
} from "@tauri-apps/plugin-global-shortcut";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import AppShell from "./components/AppShell";
import type { ViewId } from "./components/Rail";
import { DEFAULT_TZ } from "./domain/time";
import { startReminders } from "./scheduler/reminders";
import { startNightlyJobs } from "./scheduler/tick";

const CAPTURE_SHORTCUT = "CommandOrControl+Shift+Space";

async function showCaptureWindow(): Promise<void> {
  const capture = await WebviewWindow.getByLabel("capture");
  if (capture === null) return;
  await capture.show();
  await capture.setFocus();
}

export default function App() {
  const [view, setView] = useState<ViewId>("calendar");

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        await register(CAPTURE_SHORTCUT, (event) => {
          // The handler fires for both press and release, so without this the
          // window would be shown twice per keystroke.
          if (event.state !== "Pressed") return;
          void showCaptureWindow();
        });

        /* Registration succeeds silently when another application already owns
           the combination, and the handler simply never runs. isRegistered is
           the only way to notice. */
        if (!cancelled && !(await isRegistered(CAPTURE_SHORTCUT))) {
          console.warn(
            `[shortcut] ${CAPTURE_SHORTCUT} is held by another application, quick capture will not open`,
          );
        }
      } catch (cause) {
        console.warn("[shortcut] could not register quick capture", cause);
      }
    })();

    return () => {
      cancelled = true;
      void unregister(CAPTURE_SHORTCUT).catch(() => undefined);
    };
  }, []);

  useEffect(() => startReminders(DEFAULT_TZ), []);
  useEffect(() => startNightlyJobs(DEFAULT_TZ), []);

  return <AppShell view={view} onViewChange={setView} />;
}
