import { useMemo } from "react";
import { generate } from "../../domain/generation/engine";
import { localDateIn } from "../../domain/generation/tz";
import type { Generator, ResolvedRuleset } from "../../domain/generation/types";

/* Spec1.1 12.4. The next fourteen days as the current draft would produce
   them, updating on keystroke with nothing saved.

   Additions and removals against the saved rule are marked, because the
   question an editor has to answer is not "what will this do" but "what will
   this do differently", and a preview that cannot show the difference sends
   you to the calendar to compare by eye. */

const DAYS = 14;
const MS_PER_DAY = 86_400_000;

type PreviewStripProps = {
  ruleset: ResolvedRuleset;
  saved: Generator | null;
  draft: Generator;
  fromUtc: number;
  tz: string;
};

export default function PreviewStrip({
  ruleset,
  saved,
  draft,
  fromUtc,
  tz,
}: PreviewStripProps) {
  const window = useMemo(
    () => ({ startUtc: fromUtc, endUtc: fromUtc + DAYS * MS_PER_DAY }),
    [fromUtc],
  );

  /* Only the generator being edited, not the whole ruleset: a strip showing
     every rule would not answer the question the editor is asking. */
  const withDraft = useMemo<ResolvedRuleset>(
    () => ({ ...ruleset, generators: [draft], modifiers: ruleset.modifiers ?? [] }),
    [ruleset, draft],
  );

  const withSaved = useMemo<ResolvedRuleset>(
    () => ({
      ...ruleset,
      generators: saved === null ? [] : [saved],
      modifiers: ruleset.modifiers ?? [],
    }),
    [ruleset, saved],
  );

  const { days, added, removed } = useMemo(() => {
    const next = generate(withDraft, window);
    const before = generate(withSaved, window);

    const beforeKeys = new Set(before.map((slot) => `${slot.localDate}|${slot.startUtc}`));
    const nextKeys = new Set(next.map((slot) => `${slot.localDate}|${slot.startUtc}`));

    const byDate = new Map<string, { total: number; added: number }>();
    for (const slot of next) {
      const bucket = byDate.get(slot.localDate) ?? { total: 0, added: 0 };
      bucket.total += 1;
      if (!beforeKeys.has(`${slot.localDate}|${slot.startUtc}`)) bucket.added += 1;
      byDate.set(slot.localDate, bucket);
    }

    const dates: string[] = [];
    for (let index = 0; index < DAYS; index += 1) {
      dates.push(localDateIn(fromUtc + index * MS_PER_DAY, tz));
    }

    return {
      days: dates.map((date) => ({ date, ...(byDate.get(date) ?? { total: 0, added: 0 }) })),
      added: next.filter(
        (slot) => !beforeKeys.has(`${slot.localDate}|${slot.startUtc}`),
      ).length,
      removed: before.filter(
        (slot) => !nextKeys.has(`${slot.localDate}|${slot.startUtc}`),
      ).length,
    };
  }, [withDraft, withSaved, window, fromUtc, tz]);

  return (
    <div className="flex flex-col gap-2 border-t border-hair pt-2">
      <div className="flex items-center gap-2">
        <span className="text-micro uppercase text-tertiary">Next 14 days</span>
        <div className="flex-1" />
        {added > 0 && (
          <span className="text-micro text-cat-admin">{`+${added}`}</span>
        )}
        {removed > 0 && (
          <span className="text-micro text-cat-deadline">{`-${removed}`}</span>
        )}
      </div>

      <div className="flex items-end gap-1">
        {days.map((day) => (
          <div key={day.date} className="flex min-w-0 flex-1 flex-col items-center gap-1">
            <span
              className={`w-full rounded-block ${
                day.added > 0 ? "bg-cat-admin-weak" : "bg-surface"
              }`}
              style={{
                height: `calc(var(--preview-bar-base) + var(--preview-bar-step) * ${Math.min(day.total, 8)})`,
              }}
              aria-hidden
            />
            <span className="text-micro tabular-nums text-tertiary">{day.total}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
