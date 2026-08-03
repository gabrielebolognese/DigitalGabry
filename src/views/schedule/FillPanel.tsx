import { useCallback, useEffect, useMemo, useState } from "react";
import { emit } from "@tauri-apps/api/event";
import { save, open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import {
  DEFAULT_AUTOFILL,
  capacityReport,
  planAutoFill,
  sparkline,
  type AssignableContent,
  type AutoFillPlan,
  type AutoFillStrategy,
} from "../../domain/generation/assign";
import { generate } from "../../domain/generation/engine";
import { localDatesBetween } from "../../domain/generation/tz";
import { exportRuleset, importRuleset } from "../../domain/generation/serialize";
import { PRESETS } from "../../domain/generation/presets";
import { activityTypeNameFor, type ContentItem } from "../../domain/content";
import type { ResolvedRuleset } from "../../domain/generation/types";
import {
  applyAssignments,
  listBindings,
  listContent,
  saveGeneratorVersion,
} from "../../db/repository";
import { BLOCKS_CHANGED } from "../../store/events";

/* Spec1.1 sections 13 and 14: auto-fill with its dry run, the capacity report,
   and ruleset portability. */

const MS_PER_DAY = 86_400_000;
const HORIZON_DAYS = 14;

const CONTROL =
  "motion-hover rounded-control border border-line px-2 py-1 text-meta text-primary hover:bg-hover";

const STRATEGIES: readonly { id: AutoFillStrategy; label: string }[] = [
  { id: "oldest-first", label: "Oldest first" },
  { id: "newest-first", label: "Newest first" },
  { id: "round-robin-project", label: "Round robin by project" },
  { id: "priority", label: "Priority" },
];

type FillPanelProps = {
  ruleset: ResolvedRuleset;
  tz: string;
  nowUtc: number;
  onChanged: () => void;
};

export default function FillPanel({ ruleset, tz, nowUtc, onChanged }: FillPanelProps) {
  const [content, setContent] = useState<readonly ContentItem[]>([]);
  const [bound, setBound] = useState<ReadonlySet<string>>(new Set());
  const [strategy, setStrategy] = useState<AutoFillStrategy>("oldest-first");
  const [plan, setPlan] = useState<AutoFillPlan | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const window = useMemo(
    () => ({ startUtc: nowUtc, endUtc: nowUtc + HORIZON_DAYS * MS_PER_DAY }),
    [nowUtc],
  );

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const platforms = ["x", "linkedin", "instagram", "youtube"] as const;
      const all: ContentItem[] = [];
      for (const platform of platforms) {
        all.push(
          ...(await listContent({
            platform,
            statuses: ["ready"],
            projectId: null,
            query: "",
            sort: "created",
          })),
        );
      }
      const bindings = await listBindings();
      if (cancelled) return;
      setContent(all);
      setBound(new Set(bindings.map((binding) => binding.slotKey)));
    })();

    return () => {
      cancelled = true;
    };
  }, [nowUtc]);

  const slots = useMemo(() => {
    const bindingList = [...bound].map((slotKey) => ({ slotKey, contentId: "bound" }));
    return generate(ruleset, window, [], bindingList);
  }, [ruleset, window, bound]);

  const assignable = useMemo<AssignableContent[]>(
    () =>
      content.map((item) => ({
        id: item.id,
        platform: item.platform,
        status: item.status,
        title: item.title,
        projectId: item.projectId,
        createdUtc: item.createdUtc,
        updatedUtc: item.updatedUtc,
      })),
    [content],
  );

  const dates = useMemo(
    () => localDatesBetween(window.startUtc, window.endUtc - 1, tz),
    [window, tz],
  );

  const report = useMemo(
    () => capacityReport(slots, assignable, dates),
    [slots, assignable, dates],
  );

  /* Always a dry run first. Never silently assigns: Spec1.1 13. */
  const preview = useCallback(() => {
    setNote(null);
    setPlan(planAutoFill(slots, assignable, { ...DEFAULT_AUTOFILL, strategy }));
  }, [slots, assignable, strategy]);

  const apply = useCallback(async () => {
    if (plan === null || plan.assignments.length === 0) return;

    const byId = new Map(content.map((item) => [item.id, item]));

    /* The whole set in one batch, so thirty days of auto-fill is one entry in
       the undo history rather than ninety. */
    await applyAssignments(
      plan.assignments.map((assignment) => {
        const item = byId.get(assignment.content.id);
        return {
          slotKey: assignment.slotKey,
          generatorId: assignment.slot.generatorId,
          generatorVersion: assignment.slot.generatorVersion,
          contentId: assignment.content.id,
          title: assignment.content.title,
          startUtc: assignment.slot.startUtc,
          endUtc: assignment.slot.endUtc,
          tz,
          ...(assignment.slot.intent.platform === undefined
            ? {}
            : { platform: assignment.slot.intent.platform }),
          projectId: assignment.content.projectId,
          ...(item === undefined
            ? {}
            : { activityTypeName: activityTypeNameFor(item) }),
        };
      }),
    );

    setNote(`Filled ${plan.assignments.length}`);
    setPlan(null);
    await emit(BLOCKS_CHANGED);
    onChanged();
  }, [plan, content, tz, onChanged]);

  const exportToFile = useCallback(async () => {
    const path = await save({
      defaultPath: `${ruleset.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.json`,
      filters: [{ name: "Ruleset", extensions: ["json"] }],
    });
    if (typeof path !== "string") return;

    const cut = path.lastIndexOf("/") === -1 ? path.lastIndexOf("\\") : path.lastIndexOf("/");
    await invoke("write_text_file", {
      dir: path.slice(0, cut),
      name: path.slice(cut + 1),
      contents: exportRuleset(ruleset),
    });
    setNote("Exported");
  }, [ruleset]);

  const importFromFile = useCallback(async () => {
    const path = await open({
      multiple: false,
      filters: [{ name: "Ruleset", extensions: ["json"] }],
    });
    if (typeof path !== "string") return;

    const text = await invoke<string>("read_text_file", { path });
    const parsed = importRuleset(text, ruleset.id);

    /* Refuses rather than guesses, by name. Edge case 24: a partial import
       leaves half a schedule and no way to tell which half. */
    if (!parsed.ok) {
      setNote(parsed.error);
      return;
    }

    for (const generator of parsed.ruleset.generators) {
      await saveGeneratorVersion(ruleset.id, generator, "all-time", Date.now());
    }
    setNote(`Imported ${parsed.ruleset.generators.length} rules, disabled`);
    onChanged();
  }, [ruleset, onChanged]);

  const seedPreset = useCallback(
    async (name: string) => {
      const preset = PRESETS.find((candidate) => candidate.name === name);
      if (preset === undefined) return;

      const parsed = importRuleset(JSON.stringify(preset), ruleset.id);
      if (!parsed.ok) {
        setNote(parsed.error);
        return;
      }
      for (const generator of parsed.ruleset.generators) {
        await saveGeneratorVersion(ruleset.id, generator, "all-time", Date.now());
      }
      setNote(`Added "${name}", switched off`);
      onChanged();
    },
    [ruleset, onChanged],
  );

  return (
    <div className="flex flex-col gap-3 border-t border-hair pt-3">
      <div className="flex flex-col gap-2">
        <span className="text-micro uppercase text-tertiary">
          {`Next ${HORIZON_DAYS} days`}
        </span>

        {report.length === 0 ? (
          <span className="text-meta text-tertiary">No slots and nothing ready</span>
        ) : (
          report.map((row) => (
            <div key={row.platform} className="flex items-baseline gap-2">
              <span className="w-20 shrink-0 truncate text-meta text-primary">
                {row.platform}
              </span>
              <span className="w-16 shrink-0 text-micro tabular-nums text-tertiary">
                {`${row.slots} slots`}
              </span>
              <span className="w-16 shrink-0 text-micro tabular-nums text-tertiary">
                {`${row.ready} ready`}
              </span>
              <span
                className={`w-16 shrink-0 text-micro tabular-nums ${
                  row.balance < 0 ? "text-cat-deadline" : "text-cat-admin"
                }`}
              >
                {row.balance < 0 ? `${-row.balance} short` : `${row.balance} spare`}
              </span>
              <span className="font-mono text-micro text-secondary">
                {sparkline(row.perDay)}
              </span>
            </div>
          ))
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Fill strategy"
          value={strategy}
          onChange={(event) => setStrategy(event.target.value as AutoFillStrategy)}
          className="rounded-control border border-line bg-surface px-2 py-1 text-meta text-primary"
        >
          {STRATEGIES.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>

        <button type="button" onClick={preview} className={CONTROL}>
          Preview fill
        </button>
        <button type="button" onClick={() => void exportToFile()} className={CONTROL}>
          Export rules
        </button>
        <button type="button" onClick={() => void importFromFile()} className={CONTROL}>
          Import rules
        </button>

        <select
          aria-label="Add a preset"
          value=""
          onChange={(event) => {
            if (event.target.value !== "") void seedPreset(event.target.value);
          }}
          className="rounded-control border border-line bg-surface px-2 py-1 text-meta text-primary"
        >
          <option value="">Add a preset</option>
          {PRESETS.map((preset) => (
            <option key={preset.name} value={preset.name}>
              {preset.name}
            </option>
          ))}
        </select>
      </div>

      {note !== null && <span className="text-meta text-secondary">{note}</span>}

      {plan !== null && (
        <div className="flex flex-col gap-2 rounded-panel border border-line bg-surface p-2">
          <span className="text-meta text-primary">
            {`${plan.assignments.length} to fill, ${plan.unfilled.length} left empty`}
          </span>

          <div className="flex max-h-48 flex-col gap-1 overflow-y-auto">
            {plan.assignments.map((assignment) => (
              <span key={assignment.slotKey} className="truncate text-micro text-secondary">
                {`${assignment.slot.localDate} ${assignment.slot.intent.platform ?? ""} to "${
                  assignment.content.title === "" ? "Untitled" : assignment.content.title
                }"`}
              </span>
            ))}
            {plan.unfilled.slice(0, 5).map((entry) => (
              <span key={entry.slotKey} className="truncate text-micro text-tertiary">
                {`${entry.slot.localDate} stays empty, ${entry.reason.toLowerCase()}`}
              </span>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={plan.assignments.length === 0}
              onClick={() => void apply()}
              className={CONTROL}
            >
              Apply all
            </button>
            <button
              type="button"
              onClick={() => setPlan(null)}
              className="motion-hover rounded-control px-2 py-1 text-meta text-tertiary hover:text-secondary"
            >
              Reject
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
