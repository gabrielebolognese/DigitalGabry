import { useState } from "react";
import { Plus } from "lucide-react";
import { BLOCK_CATEGORIES, type BlockCategory } from "../../domain/block";
import { iconForActivity } from "../../components/activityIcon";
import {
  createActivityType,
  updateActivityType,
  type ActivityType,
} from "../../db/repository";

const CELL =
  "w-full rounded-control border border-line bg-surface px-2 py-1 text-body text-primary";

type ActivityTypeTableProps = {
  types: readonly ActivityType[];
  onChanged: () => Promise<void>;
};

export default function ActivityTypeTable({ types, onChanged }: ActivityTypeTableProps) {
  const [busy, setBusy] = useState(false);

  /* Committed on blur rather than on change: every save rebuilds the whole
     momentum cache, and doing that per keystroke would be absurd. */
  async function commit(id: string, patch: Partial<ActivityType>): Promise<void> {
    setBusy(true);
    try {
      await updateActivityType(id, patch);
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function addRow(): Promise<void> {
    setBusy(true);
    try {
      await createActivityType({
        name: "New activity",
        icon: "send",
        category: "build",
        weight: 1,
        dailyCap: 10,
        unit: "count",
        archived: false,
        sortOrder: types.length,
      });
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-micro uppercase text-tertiary">Activity types</span>

      <table className="w-full text-meta">
        <thead>
          <tr className="text-micro uppercase text-tertiary">
            <th className="py-1 text-left font-medium">Name</th>
            <th className="py-1 text-left font-medium">Category</th>
            <th className="py-1 text-right font-medium">Weight</th>
            <th className="py-1 text-right font-medium">Daily cap</th>
            <th className="py-1 text-right font-medium">Archived</th>
          </tr>
        </thead>
        <tbody>
          {types.map((type) => {
            const Icon = iconForActivity(type.icon);
            return (
              <tr key={type.id} className="border-t border-hair">
                <td className="py-1">
                  <div className="flex items-center gap-2">
                    <Icon className="icon-content shrink-0 text-tertiary" aria-hidden={true} />
                    <input
                      className={CELL}
                      defaultValue={type.name}
                      aria-label="Name"
                      onBlur={(event) => {
                        if (event.target.value !== type.name) {
                          void commit(type.id, { name: event.target.value });
                        }
                      }}
                    />
                  </div>
                </td>
                <td className="py-1">
                  <select
                    className={CELL}
                    value={type.category}
                    aria-label="Category"
                    onChange={(event) =>
                      void commit(type.id, {
                        category: event.target.value as BlockCategory,
                      })
                    }
                  >
                    {BLOCK_CATEGORIES.map((category) => (
                      <option key={category} value={category}>
                        {category}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-1">
                  <input
                    type="number"
                    step="0.5"
                    className={`${CELL} text-right`}
                    defaultValue={type.weight}
                    aria-label="Weight"
                    onBlur={(event) => {
                      const next = Number(event.target.value);
                      if (Number.isFinite(next) && next !== type.weight) {
                        void commit(type.id, { weight: next });
                      }
                    }}
                  />
                </td>
                <td className="py-1">
                  <input
                    type="number"
                    className={`${CELL} text-right`}
                    defaultValue={type.dailyCap}
                    aria-label="Daily cap"
                    onBlur={(event) => {
                      const next = Number(event.target.value);
                      if (Number.isFinite(next) && next !== type.dailyCap) {
                        void commit(type.id, { dailyCap: next });
                      }
                    }}
                  />
                </td>
                <td className="py-1 text-right">
                  <input
                    type="checkbox"
                    checked={type.archived}
                    aria-label="Archived"
                    onChange={(event) =>
                      void commit(type.id, { archived: event.target.checked })
                    }
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <button
        type="button"
        disabled={busy}
        onClick={() => void addRow()}
        className="motion-hover flex items-center gap-1 self-start rounded-control border border-line px-2 py-1 text-meta text-secondary hover:bg-hover hover:text-primary"
      >
        <Plus className="icon-content" aria-hidden={true} />
        Add activity type
      </button>
    </div>
  );
}
