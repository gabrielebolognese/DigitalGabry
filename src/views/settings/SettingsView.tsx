import { useState } from "react";
import { DEFAULT_TZ } from "../../domain/time";
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
