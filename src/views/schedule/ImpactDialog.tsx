import type { SaveMode } from "../../domain/generation/versioning";

/* Spec1.1 12.4, and invariant 24: no schedule change is saved without an
   impact preview when it affects filled or overridden slots.

   The point is not the count. It is that a schedule edit is the one action in
   this app that can quietly undo work already done, by moving a slot someone
   has attached content to, and there is no way to notice afterwards. */

export type Impact = {
  futureSlots: number;
  filled: { key: string; label: string }[];
  rekeyed: number;
  orphanedOverrides: number;
};

type ImpactDialogProps = {
  impact: Impact;
  mode: SaveMode;
  onModeChange: (mode: SaveMode) => void;
  onConfirm: () => void;
  onCancel: () => void;
};

const MODES: readonly { id: SaveMode; label: string; detail: string }[] = [
  {
    id: "from-today",
    label: "From today forward",
    detail: "Closes the current rule today and opens a new one. History is kept.",
  },
  {
    id: "all-time",
    label: "All time",
    detail: "Rewrites history. Past weeks will render with the new rule.",
  },
  {
    id: "date-range",
    label: "Date range only",
    detail: "A bounded version, leaving earlier and later rules intact.",
  },
];

export default function ImpactDialog({
  impact,
  mode,
  onModeChange,
  onConfirm,
  onCancel,
}: ImpactDialogProps) {
  return (
    <div
      role="dialog"
      aria-label="Confirm schedule change"
      aria-modal="true"
      className="scrim fixed inset-0 z-50 flex items-center justify-center"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onCancel();
        }
      }}
    >
      <div className="flex w-96 flex-col gap-3 rounded-panel border border-line bg-elevated p-3">
        <span className="text-title text-primary">Save this change</span>

        <span className="text-meta text-secondary">
          {`This affects ${impact.futureSlots} future ${
            impact.futureSlots === 1 ? "slot" : "slots"
          }.`}
        </span>

        {impact.filled.length > 0 && (
          <div className="flex flex-col gap-1">
            <span className="text-micro uppercase text-cat-deadline">
              {`${impact.filled.length} already filled with content`}
            </span>
            {impact.filled.slice(0, 5).map((entry) => (
              <span key={entry.key} className="truncate text-meta text-secondary">
                {entry.label}
              </span>
            ))}
            {impact.filled.length > 5 && (
              <span className="text-micro text-tertiary">
                {`and ${impact.filled.length - 5} more`}
              </span>
            )}
          </div>
        )}

        {impact.rekeyed > 0 && (
          <span className="text-meta text-secondary">
            {`${impact.rekeyed} manual ${
              impact.rekeyed === 1 ? "override" : "overrides"
            } will be remapped to the nearest time.`}
          </span>
        )}

        {impact.orphanedOverrides > 0 && (
          <span className="text-meta text-cat-deadline">
            {`${impact.orphanedOverrides} ${
              impact.orphanedOverrides === 1 ? "override has" : "overrides have"
            } no matching time and will be dropped.`}
          </span>
        )}

        <div className="flex flex-col gap-1 border-t border-hair pt-2">
          {MODES.map((option) => (
            <label
              key={option.id}
              className="motion-hover flex cursor-default items-start gap-2 rounded-control px-2 py-1 hover:bg-hover"
            >
              <input
                type="radio"
                name="save-mode"
                checked={mode === option.id}
                onChange={() => onModeChange(option.id)}
                className="mt-1"
              />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-meta text-primary">{option.label}</span>
                <span className="text-micro text-tertiary">{option.detail}</span>
              </span>
            </label>
          ))}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-hair pt-2">
          <button
            type="button"
            onClick={onCancel}
            className="motion-hover rounded-control px-2 py-1 text-meta text-tertiary hover:text-secondary"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="motion-hover rounded-control border border-line px-2 py-1 text-meta text-primary hover:bg-hover"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
