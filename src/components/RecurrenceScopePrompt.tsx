import type { EditScope } from "../domain/recurrence";

type ScopeAction = "edit" | "delete";

type RecurrenceScopePromptProps = {
  action: ScopeAction;
  onChoose: (scope: EditScope) => void;
  onCancel: () => void;
};

const CHOICES: ReadonlyArray<{ scope: EditScope; label: string }> = [
  { scope: "occurrence", label: "This occurrence" },
  { scope: "future", label: "This and future" },
  { scope: "series", label: "All occurrences" },
];

export default function RecurrenceScopePrompt({
  action,
  onChoose,
  onCancel,
}: RecurrenceScopePromptProps) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={action === "delete" ? "Delete repeating block" : "Edit repeating block"}
      className="scrim absolute inset-0 z-30 flex items-center justify-center"
      onKeyDown={(event) => {
        if (event.key === "Escape") onCancel();
      }}
    >
      <div className="flex w-72 flex-col gap-1 rounded-panel border border-line bg-elevated p-3">
        <span className="text-title text-primary">
          {action === "delete" ? "Delete repeating block" : "Edit repeating block"}
        </span>
        <span className="mb-2 text-meta text-secondary">
          {action === "delete"
            ? "Choose how much of the series to remove"
            : "Choose how much of the series to change"}
        </span>

        {CHOICES.map((choice) => (
          <button
            key={choice.scope}
            type="button"
            autoFocus={choice.scope === "occurrence"}
            onClick={() => onChoose(choice.scope)}
            className="motion-hover rounded-control border border-transparent px-2 py-1 text-left text-body text-primary hover:border-line hover:bg-hover"
          >
            {choice.label}
          </button>
        ))}

        <button
          type="button"
          onClick={onCancel}
          className="motion-hover mt-2 self-start rounded-control px-2 py-1 text-meta text-tertiary hover:text-secondary"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
