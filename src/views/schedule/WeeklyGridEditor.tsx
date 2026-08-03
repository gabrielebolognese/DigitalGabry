import { useState } from "react";
import { X } from "lucide-react";
import { WEEKDAY_KEYS, type WeekdayKey } from "../../domain/generation/weekdays";

/* Spec1.1 12.4, the primary editor surface, because explicit times per weekday
   is the case that actually gets used. */

const DAY_LABELS: Record<WeekdayKey, string> = {
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
  sat: "Sat",
  sun: "Sun",
};

const COLUMN_ORDER: readonly WeekdayKey[] = [
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
];

export type GridTimes = Partial<Record<WeekdayKey, string[]>>;

/* Accepts 8, 08, 8:30 and 20:00, because being made to type a colon and a
   leading zero to add a slot is the kind of friction that stops a schedule
   being edited at all. */
export function parseLooseTime(input: string): string | null {
  const text = input.trim();
  if (text === "") return null;

  const colon = /^(\d{1,2}):(\d{2})$/.exec(text);
  if (colon !== null) {
    const hour = Number(colon[1]);
    const minute = Number(colon[2]);
    if (hour > 23 || minute > 59) return null;
    return `${String(hour).padStart(2, "0")}:${colon[2]}`;
  }

  const bare = /^(\d{1,2})$/.exec(text);
  if (bare !== null) {
    const hour = Number(bare[1]);
    if (hour > 23) return null;
    return `${String(hour).padStart(2, "0")}:00`;
  }

  const compact = /^(\d{1,2})(\d{2})$/.exec(text);
  if (compact !== null) {
    const hour = Number(compact[1]);
    const minute = Number(compact[2]);
    if (hour > 23 || minute > 59) return null;
    return `${String(hour).padStart(2, "0")}:${compact[2]}`;
  }

  return null;
}

export function sortTimes(times: readonly string[]): string[] {
  return [...new Set(times)].sort();
}

type WeeklyGridEditorProps = {
  times: GridTimes;
  onChange: (times: GridTimes) => void;
};

export default function WeeklyGridEditor({ times, onChange }: WeeklyGridEditorProps) {
  const [adding, setAdding] = useState<WeekdayKey | null>(null);
  const [draft, setDraft] = useState("");
  const [dragging, setDragging] = useState<{ day: WeekdayKey; time: string } | null>(null);

  const total = COLUMN_ORDER.reduce((sum, day) => sum + (times[day] ?? []).length, 0);

  const setDay = (day: WeekdayKey, next: readonly string[]): void => {
    onChange({ ...times, [day]: sortTimes(next) });
  };

  const commitDraft = (day: WeekdayKey): void => {
    const parsed = parseLooseTime(draft);
    if (parsed !== null) setDay(day, [...(times[day] ?? []), parsed]);
    setDraft("");
    setAdding(null);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="text-micro uppercase text-tertiary">Times</span>
        <div className="flex-1" />
        <span className="text-micro tabular-nums text-tertiary">{`${total} a week`}</span>
      </div>

      <div className="flex items-start gap-1">
        {COLUMN_ORDER.map((day) => {
          const dayTimes = times[day] ?? [];

          return (
            <div
              key={day}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                if (dragging === null || dragging.day === day) return;
                setDay(day, [...dayTimes, dragging.time]);
                onChange({
                  ...times,
                  [day]: sortTimes([...dayTimes, dragging.time]),
                  [dragging.day]: sortTimes(
                    (times[dragging.day] ?? []).filter((time) => time !== dragging.time),
                  ),
                });
                setDragging(null);
              }}
              className="flex min-w-0 flex-1 flex-col gap-1 rounded-control border border-hair p-1"
            >
              <span className="text-center text-micro uppercase text-tertiary">
                {DAY_LABELS[day]}
              </span>

              {dayTimes.map((time) => (
                <span
                  key={time}
                  draggable
                  onDragStart={() => setDragging({ day, time })}
                  onDragEnd={() => setDragging(null)}
                  className="group flex items-center justify-between rounded-block bg-surface px-1 py-1 text-micro tabular-nums text-primary"
                >
                  {time}
                  <button
                    type="button"
                    aria-label={`Remove ${time} on ${DAY_LABELS[day]}`}
                    onClick={() =>
                      setDay(day, dayTimes.filter((candidate) => candidate !== time))
                    }
                    className="motion-hover hidden text-tertiary hover:text-primary group-hover:flex"
                  >
                    <X className="icon-content" aria-hidden />
                  </button>
                </span>
              ))}

              {adding === day ? (
                <input
                  autoFocus
                  value={draft}
                  aria-label={`Add a time on ${DAY_LABELS[day]}`}
                  placeholder="8:30"
                  onChange={(event) => setDraft(event.target.value)}
                  onBlur={() => commitDraft(day)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      commitDraft(day);
                    } else if (event.key === "Escape") {
                      event.preventDefault();
                      setDraft("");
                      setAdding(null);
                    }
                  }}
                  className="w-full rounded-block border border-accent-border bg-surface px-1 text-micro tabular-nums text-primary"
                />
              ) : (
                <button
                  type="button"
                  aria-label={`Add a time on ${DAY_LABELS[day]}`}
                  onClick={() => {
                    setDraft("");
                    setAdding(day);
                  }}
                  className="motion-hover rounded-block px-1 py-1 text-micro text-tertiary hover:bg-hover hover:text-primary"
                >
                  +
                </button>
              )}

              <span className="text-center text-micro tabular-nums text-disabled">
                {dayTimes.length}
              </span>
            </div>
          );
        })}
      </div>

      <span className="text-micro text-disabled">
        Drag a time to another day to move it
      </span>
    </div>
  );
}

export { WEEKDAY_KEYS };
