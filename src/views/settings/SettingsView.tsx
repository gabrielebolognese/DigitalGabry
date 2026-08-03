import { useCallback, useEffect, useState } from "react";
import { emit } from "@tauri-apps/api/event";
import { DEFAULT_TZ } from "../../domain/time";
import { open } from "@tauri-apps/plugin-dialog";
import { pictureDir as pictures } from "@tauri-apps/api/path";
import { DEFAULT_SOFT_LIMIT, HARD_LIMIT } from "../../domain/xPost";
import { readPrompt, resetPrompt, writePrompt } from "../../content/linkedin/prompt";
import { maskKey, readApiKey, writeApiKey } from "../../panel/apiKey";
import {
  readBackupSettings,
  runBackup,
  runExport,
  runImport,
  writeBackupSettings,
  type BackupSettings,
} from "../../backup/run";
import { API_KEY_CHANGED } from "../../store/events";
import type { MomentumConstants } from "../../domain/momentum";
import { useMomentum } from "../../store/useMomentum";
import ActivityTypeTable from "./ActivityTypeTable";

const CELL =
  "w-full rounded-control border border-line bg-surface px-2 py-1 text-body text-primary";

type ConstantField = {
  key: keyof MomentumConstants;
  label: string;
  step: string;
  hint: string;
};

const CONSTANT_FIELDS: readonly ConstantField[] = [
  { key: "lambda", label: "Decay", step: "0.01", hint: "Half life in days follows from this" },
  { key: "streakIncrement", label: "Streak increment", step: "0.001", hint: "Added per streak day" },
  { key: "streakMultiplierCap", label: "Streak cap", step: "0.05", hint: "Ceiling on the multiplier" },
  { key: "streakThreshold", label: "Streak threshold", step: "1", hint: "Raw score a day needs to count" },
];

export default function SettingsView({ tz = DEFAULT_TZ }: { tz?: string }) {
  const momentum = useMomentum(tz);
  const [draft, setDraft] = useState<MomentumConstants | null>(null);

  const [keyDraft, setKeyDraft] = useState("");
  const [keyState, setKeyState] = useState<string | null>(null);
  const [keyBusy, setKeyBusy] = useState(false);

  const refreshKeyState = useCallback(async () => {
    const stored = await readApiKey();
    setKeyState(stored === null ? null : maskKey(stored));
  }, []);

  useEffect(() => {
    void refreshKeyState();
  }, [refreshKeyState]);

  /* The value is written straight to the store and never held in state beyond
     the keystroke, never logged, and never rendered back. SPEC 9. */
  const saveKey = useCallback(async () => {
    setKeyBusy(true);
    try {
      await writeApiKey(keyDraft);
      setKeyDraft("");
      await refreshKeyState();
      await emit(API_KEY_CHANGED);
    } finally {
      setKeyBusy(false);
    }
  }, [keyDraft, refreshKeyState]);

  const [prompt, setPrompt] = useState<string | null>(null);
  const [promptNote, setPromptNote] = useState<string | null>(null);

  useEffect(() => {
    void readPrompt().then(setPrompt);
  }, []);

  const [backup, setBackup] = useState<BackupSettings | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupNote, setBackupNote] = useState<string | null>(null);

  useEffect(() => {
    void readBackupSettings().then(setBackup);
  }, []);

  const saveBackup = useCallback(async (next: BackupSettings) => {
    setBackup(next);
    await writeBackupSettings(next);
  }, []);

  const pickFolder = useCallback(
    async (field: "backupDir" | "exportDir") => {
      if (backup === null) return;
      const chosen = await open({ directory: true, defaultPath: backup[field] });
      if (typeof chosen !== "string") return;
      await saveBackup({ ...backup, [field]: chosen });
    },
    [backup, saveBackup],
  );

  const withBusy = useCallback(async (work: () => Promise<string>) => {
    setBackupBusy(true);
    setBackupNote(null);
    try {
      setBackupNote(await work());
      setBackup(await readBackupSettings());
    } catch (cause) {
      setBackupNote(cause instanceof Error ? cause.message : "That did not work");
    } finally {
      setBackupBusy(false);
    }
  }, []);

  const values = draft ?? momentum.constants;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shell-header flex shrink-0 items-center gap-2 border-b border-hair px-3">
        <span className="text-title text-primary">Settings</span>
        <div className="flex-1" />
        {momentum.recomputing && (
          <span className="text-micro text-tertiary">Recomputing momentum</span>
        )}
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-3">
        <div className="flex flex-col gap-2">
          <span className="text-micro uppercase text-tertiary">Anthropic API key</span>
          <span className="text-meta text-tertiary">
            {keyState === null
              ? "No key stored, the assistant panel is disabled"
              : `Key ${keyState}`}
          </span>

          <div className="flex items-center gap-2">
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              className={CELL}
              value={keyDraft}
              placeholder={keyState === null ? "sk-ant-..." : "Replace the stored key"}
              aria-label="Anthropic API key"
              onChange={(event) => setKeyDraft(event.target.value)}
            />
            <button
              type="button"
              disabled={keyBusy || keyDraft.trim() === ""}
              onClick={() => void saveKey()}
              className="motion-hover shrink-0 rounded-control border border-line px-2 py-1 text-meta text-primary hover:bg-hover"
            >
              Save key
            </button>
          </div>
        </div>

        {backup !== null && (
          <div className="flex flex-col gap-2">
            <span className="text-micro uppercase text-tertiary">Backups and export</span>

            {(
              [
                ["backupDir", "Backup folder", backup.lastBackupUtc],
                ["exportDir", "Export folder", backup.lastExportUtc],
              ] as const
            ).map(([field, label, lastRun]) => (
              <div key={field} className="flex flex-col gap-1">
                <span className="text-micro uppercase text-tertiary">{label}</span>
                <div className="flex items-center gap-2">
                  <input readOnly className={CELL} value={backup[field]} aria-label={label} />
                  <button
                    type="button"
                    onClick={() => void pickFolder(field)}
                    className="motion-hover shrink-0 rounded-control border border-line px-2 py-1 text-meta text-primary hover:bg-hover"
                  >
                    Choose
                  </button>
                </div>
                <span className="text-micro text-disabled">
                  {lastRun === null ? "Never run" : `Last run ${new Date(lastRun).toLocaleString()}`}
                </span>
              </div>
            ))}

            <label className="flex flex-col gap-1">
              <span className="text-micro uppercase text-tertiary">Outbox folder</span>
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  className={CELL}
                  aria-label="Outbox folder"
                  value={backup.outboxDir ?? "Inside the vault"}
                />
                <button
                  type="button"
                  onClick={() => {
                    void open({ directory: true }).then((chosen) => {
                      if (typeof chosen === "string") {
                        void saveBackup({ ...backup, outboxDir: chosen });
                      }
                    });
                  }}
                  className="motion-hover shrink-0 rounded-control border border-line px-2 py-1 text-meta text-primary hover:bg-hover"
                >
                  Choose
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void pictures().then((path) =>
                      saveBackup({ ...backup, outboxDir: path }),
                    );
                  }}
                  className="motion-hover shrink-0 rounded-control px-2 py-1 text-meta text-secondary hover:bg-hover hover:text-primary"
                >
                  Use Pictures
                </button>
              </div>
              <span className="text-micro text-disabled">
                Where "post this" stages an image, ready to drag into the composer
              </span>
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-micro uppercase text-tertiary">
                X character target
              </span>
              <input
                type="number"
                min={1}
                max={280}
                className={CELL}
                value={backup.xSoftLimit ?? DEFAULT_SOFT_LIMIT}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  if (Number.isFinite(next) && next >= 1 && next <= HARD_LIMIT) {
                    void saveBackup({ ...backup, xSoftLimit: Math.floor(next) });
                  }
                }}
              />
              <span className="text-micro text-disabled">
                {`Only changes the counter colour. The ${HARD_LIMIT} platform maximum is always enforced`}
              </span>
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-micro uppercase text-tertiary">Snapshots kept</span>
              <input
                type="number"
                min={1}
                className={CELL}
                value={backup.retention}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  if (Number.isFinite(next) && next >= 1) {
                    void saveBackup({ ...backup, retention: Math.floor(next) });
                  }
                }}
              />
            </label>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={backupBusy}
                onClick={() =>
                  void withBusy(async () => {
                    const report = await runBackup(Date.now(), tz);
                    return `Snapshot ${report.file}, pruned ${report.pruned.length}`;
                  })
                }
                className="motion-hover rounded-control border border-line px-2 py-1 text-meta text-primary hover:bg-hover"
              >
                Back up now
              </button>

              <button
                type="button"
                disabled={backupBusy}
                onClick={() =>
                  void withBusy(async () => {
                    const report = await runExport(Date.now(), tz);
                    return `Exported ${report.months} months, git ${report.git}`;
                  })
                }
                className="motion-hover rounded-control border border-line px-2 py-1 text-meta text-primary hover:bg-hover"
              >
                Export now
              </button>

              <button
                type="button"
                disabled={backupBusy}
                onClick={() =>
                  void withBusy(async () => {
                    const chosen = await open({
                      multiple: false,
                      filters: [{ name: "Blocks", extensions: ["md", "csv"] }],
                    });
                    if (typeof chosen !== "string") return "Import cancelled";
                    const report = await runImport(chosen, tz, Date.now());
                    return report.errors.length === 0
                      ? `Imported ${report.imported} blocks`
                      : `Imported ${report.imported} blocks, ${report.errors.length} rows skipped`;
                  })
                }
                className="motion-hover rounded-control border border-line px-2 py-1 text-meta text-secondary hover:bg-hover hover:text-primary"
              >
                Import a file
              </button>
            </div>

            {backupNote !== null && (
              <span className="text-meta text-secondary">{backupNote}</span>
            )}
            <span className="text-micro text-disabled">
              Export is one directional, it is never read back as a source of truth
            </span>
          </div>
        )}

        {/* Spec2 3.2: editable here rather than baked into the build, because
            iterating on a prompt is the main way this gets better and needing
            a rebuild to change a sentence means it does not get iterated on. */}
        {prompt !== null && (
          <div className="flex flex-col gap-2">
            <span className="text-micro uppercase text-tertiary">
              LinkedIn image prompt
            </span>
            <textarea
              rows={10}
              className={`${CELL} font-mono text-micro`}
              aria-label="LinkedIn image system prompt"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
            />
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  void writePrompt(prompt).then(() => setPromptNote("Saved"));
                }}
                className="motion-hover rounded-control border border-line px-2 py-1 text-meta text-primary hover:bg-hover"
              >
                Save prompt
              </button>
              <button
                type="button"
                onClick={() => {
                  void resetPrompt().then((text) => {
                    setPrompt(text);
                    setPromptNote("Back to the bundled default");
                  });
                }}
                className="motion-hover rounded-control px-2 py-1 text-meta text-tertiary hover:text-secondary"
              >
                Reset to default
              </button>
              {promptNote !== null && (
                <span className="text-meta text-secondary">{promptNote}</span>
              )}
            </div>
          </div>
        )}

        <ActivityTypeTable types={momentum.types} onChanged={momentum.rebuild} />

        <div className="flex flex-col gap-2">
          <span className="text-micro uppercase text-tertiary">Momentum constants</span>
          <span className="text-meta text-tertiary">
            Changing any of these rewrites the whole curve from the activity log
          </span>

          <div className="grid grid-cols-2 gap-2">
            {CONSTANT_FIELDS.map((field) => (
              <label key={field.key} className="flex flex-col gap-1">
                <span className="text-micro uppercase text-tertiary">{field.label}</span>
                <input
                  type="number"
                  step={field.step}
                  className={CELL}
                  value={values[field.key]}
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    if (!Number.isFinite(next)) return;
                    setDraft({ ...values, [field.key]: next });
                  }}
                />
                <span className="text-micro text-disabled">{field.hint}</span>
              </label>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={draft === null || momentum.recomputing}
              onClick={() => {
                if (draft === null) return;
                void momentum.saveConstants(draft).then(() => setDraft(null));
              }}
              className="motion-hover rounded-control border border-line px-2 py-1 text-meta text-primary hover:bg-hover"
            >
              Save and recompute
            </button>

            {draft !== null && (
              <button
                type="button"
                onClick={() => setDraft(null)}
                className="motion-hover rounded-control px-2 py-1 text-meta text-tertiary hover:text-secondary"
              >
                Discard
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
