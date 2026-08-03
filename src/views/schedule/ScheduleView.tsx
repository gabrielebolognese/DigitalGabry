import { useCallback, useEffect, useMemo, useState } from "react";
import { emit } from "@tauri-apps/api/event";
import { GripVertical, Plus } from "lucide-react";
import { generate } from "../../domain/generation/engine";
import { checkNoCycles } from "../../domain/generation/graph";
import { describeGenerator } from "../../domain/generation/registry";
import { planRekey } from "../../domain/generation/rekey";
import { latestVersion, type SaveMode } from "../../domain/generation/versioning";
import type { Generator, ResolvedRuleset } from "../../domain/generation/types";
import { uuidv7 } from "../../domain/id";
import { DEFAULT_TZ } from "../../domain/time";
import {
  insertRuleset,
  listOverrides,
  listRulesets,
  loadRuleset,
  saveGeneratorVersion,
  applyRekeyPlan,
  listBindings,
} from "../../db/repository";
import { BLOCKS_CHANGED } from "../../store/events";
import { SkeletonList } from "../../components/Skeleton";
import ImpactDialog, { type Impact } from "./ImpactDialog";
import FillPanel from "./FillPanel";
import PreviewStrip from "./PreviewStrip";
import WeeklyGridEditor, { type GridTimes } from "./WeeklyGridEditor";

/* Spec1.1 12.4 defines these editor surfaces but not where they live, which is
   a gap. A rail item rather than a Settings section: the weekly grid, the rule
   list and the live preview are a working surface, not a preference, and
   burying them under Settings would make editing a schedule feel like
   configuring one. */

const MS_PER_DAY = 86_400_000;

function newGridGenerator(): Generator {
  return {
    id: uuidv7(),
    version: 1,
    name: "New rule",
    kind: "weekly-grid",
    enabled: true,
    layer: 50,
    validFrom: null,
    validTo: null,
    timezone: DEFAULT_TZ,
    emits: { kind: "post", platform: "x", category: "content", durationMinutes: 10 },
    config: { times: {} },
  };
}

export default function ScheduleView({ tz = DEFAULT_TZ }: { tz?: string }) {
  const [ruleset, setRuleset] = useState<ResolvedRuleset | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Generator | null>(null);
  const [impact, setImpact] = useState<Impact | null>(null);
  const [mode, setMode] = useState<SaveMode>("from-today");
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState(0);
  const [dragId, setDragId] = useState<string | null>(null);

  const [nowUtc] = useState(() => Date.now());

  const reload = useCallback(() => setToken((value) => value + 1), []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        let rulesets = await listRulesets();
        if (rulesets.length === 0) {
          await insertRuleset({
            id: uuidv7(),
            name: "My schedule",
            enabled: true,
            sortOrder: 0,
          });
          rulesets = await listRulesets();
        }
        const first = rulesets[0];
        if (first === undefined) return;
        const loaded = await loadRuleset(first.id);
        if (!cancelled) setRuleset(loaded);
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "Could not load the rules");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token]);

  /* One row per generator, not per version: a family of versions is one rule
     as far as the list is concerned. */
  const families = useMemo(() => {
    const byId = new Map<string, Generator[]>();
    for (const generator of ruleset?.generators ?? []) {
      const bucket = byId.get(generator.id);
      if (bucket === undefined) byId.set(generator.id, [generator]);
      else bucket.push(generator);
    }
    return [...byId.values()]
      .map((versions) => ({ current: latestVersion(versions), versions }))
      .filter(
        (entry): entry is { current: Generator; versions: Generator[] } =>
          entry.current !== null,
      )
      .sort((left, right) => right.current.layer - left.current.layer);
  }, [ruleset]);

  const selected = families.find((entry) => entry.current.id === selectedId) ?? null;

  useEffect(() => {
    if (selected === null) setDraft(null);
    else if (draft === null || draft.id !== selected.current.id) {
      setDraft(selected.current);
    }
  }, [selected, draft]);

  const slotsPerWeek = useCallback(
    (generator: Generator): number => {
      if (ruleset === null) return 0;
      return generate(
        { ...ruleset, generators: [generator], modifiers: [] },
        { startUtc: nowUtc, endUtc: nowUtc + 7 * MS_PER_DAY },
      ).length;
    },
    [ruleset, nowUtc],
  );

  const createRule = useCallback(async () => {
    if (ruleset === null) return;
    const generator = newGridGenerator();
    const result = await saveGeneratorVersion(
      ruleset.id,
      generator,
      "all-time",
      Date.now(),
    );
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSelectedId(generator.id);
    reload();
  }, [ruleset, reload]);

  /* Everything the user is about to change, counted before it changes.
     Invariant 24. */
  const buildImpact = useCallback(async (): Promise<Impact | null> => {
    if (ruleset === null || draft === null || selected === null) return null;

    const window = { startUtc: nowUtc, endUtc: nowUtc + 90 * MS_PER_DAY };
    const before = generate(
      { ...ruleset, generators: [selected.current], modifiers: [] },
      window,
    );
    const after = generate({ ...ruleset, generators: [draft], modifiers: [] }, window);

    const beforeKeys = new Set(before.map((slot) => slot.key));
    const afterKeys = new Set(after.map((slot) => slot.key));
    const changed = [
      ...before.filter((slot) => !afterKeys.has(slot.key)),
      ...after.filter((slot) => !beforeKeys.has(slot.key)),
    ];

    const bindings = await listBindings();
    const bound = new Set(bindings.map((binding) => binding.slotKey));

    const overrides = (await listOverrides([draft.id])).map((override) => ({
      slotKey: override.slotKey,
      localDate: override.localDate,
      ordinal: override.ordinal,
    }));

    const rekey = planRekey(
      draft.id,
      draft.kind,
      selected.current.config,
      draft.config,
      overrides,
    );

    return {
      futureSlots: changed.length,
      filled: before
        .filter((slot) => bound.has(slot.key))
        .map((slot) => ({
          key: slot.key,
          label: `${slot.localDate} ${slot.intent.platform ?? slot.intent.kind}`,
        })),
      rekeyed: rekey.pairs.length,
      orphanedOverrides: rekey.orphaned.length,
    };
  }, [ruleset, draft, selected, nowUtc]);

  const requestSave = useCallback(async () => {
    if (ruleset === null || draft === null) return;

    const others = (ruleset.generators ?? []).filter(
      (generator) => generator.id !== draft.id,
    );
    const check = checkNoCycles([...others, draft]);
    if (!check.ok) {
      setError(check.error);
      return;
    }

    setError(null);
    setImpact(await buildImpact());
  }, [ruleset, draft, buildImpact]);

  const confirmSave = useCallback(async () => {
    if (ruleset === null || draft === null || selected === null) return;

    const overrides = (await listOverrides([draft.id])).map((override) => ({
      slotKey: override.slotKey,
      localDate: override.localDate,
      ordinal: override.ordinal,
    }));
    const rekey = planRekey(
      draft.id,
      draft.kind,
      selected.current.config,
      draft.config,
      overrides,
    );

    const result = await saveGeneratorVersion(ruleset.id, draft, mode, Date.now());
    if (!result.ok) {
      setError(result.error);
      setImpact(null);
      return;
    }

    /* After the save, not before: if the version write failed there is nothing
       for the remapped overrides to attach to. */
    if (rekey.pairs.length > 0) await applyRekeyPlan(rekey);

    setImpact(null);
    await emit(BLOCKS_CHANGED);
    reload();
  }, [ruleset, draft, selected, mode, reload]);

  const reorder = useCallback(
    async (fromId: string, toId: string) => {
      if (ruleset === null || fromId === toId) return;
      const target = families.find((entry) => entry.current.id === toId);
      const moved = families.find((entry) => entry.current.id === fromId);
      if (target === undefined || moved === undefined) return;

      /* Layers are a number, so reordering is assigning the dragged rule the
         layer of the one it was dropped on, nudged so the two cannot tie. */
      const nextLayer = Math.max(
        0,
        Math.min(100, target.current.layer + (moved.current.layer < target.current.layer ? 1 : -1)),
      );

      const result = await saveGeneratorVersion(
        ruleset.id,
        { ...moved.current, layer: nextLayer },
        "all-time",
        Date.now(),
      );
      if (!result.ok) setError(result.error);
      reload();
    },
    [ruleset, families, reload],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shell-header flex shrink-0 items-center gap-2 border-b border-hair px-3">
        <span className="text-title text-primary">Schedule</span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => void createRule()}
          className="motion-hover flex items-center gap-1 rounded-control border border-line px-2 py-1 text-meta text-primary hover:bg-hover"
        >
          <Plus className="icon-content shrink-0" aria-hidden />
          New rule
        </button>
      </header>

      {error !== null && (
        <span className="border-b border-hair px-3 py-2 text-meta text-cat-deadline">
          {error}
        </span>
      )}

      <div className="flex min-h-0 flex-1">
        <div className="flex w-72 shrink-0 flex-col gap-1 overflow-y-auto border-r border-hair p-2">
          {loading ? (
            <SkeletonList label="Loading rules" rows={4} rowClassName="h-12 w-full" />
          ) : families.length === 0 ? (
            <span className="px-2 py-1 text-meta text-tertiary">
              No rules yet, start with a new one
            </span>
          ) : (
            families.map((entry) => (
              <div
                key={entry.current.id}
                draggable
                onDragStart={() => setDragId(entry.current.id)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  if (dragId !== null) void reorder(dragId, entry.current.id);
                  setDragId(null);
                }}
                onClick={() => setSelectedId(entry.current.id)}
                className={`motion-hover flex cursor-default items-start gap-2 rounded-control px-2 py-1 ${
                  entry.current.id === selectedId
                    ? "bg-selected"
                    : "hover:bg-hover"
                }`}
              >
                <GripVertical
                  className="icon-content mt-1 shrink-0 text-disabled"
                  aria-hidden
                />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-meta text-primary">
                    {entry.current.name}
                  </span>
                  <span className="truncate text-micro text-tertiary">
                    {describeGenerator(entry.current)}
                  </span>
                  <span className="text-micro tabular-nums text-disabled">
                    {`${slotsPerWeek(entry.current)} a week · layer ${entry.current.layer} · v${entry.current.version}`}
                  </span>
                </span>
              </div>
            ))
          )}
        </div>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
          {ruleset !== null && (
            <FillPanel
              ruleset={ruleset}
              tz={tz}
              nowUtc={nowUtc}
              onChanged={reload}
            />
          )}

          {draft === null || ruleset === null ? (
            <span className="text-meta text-tertiary">
              Pick a rule to edit it, or make a new one
            </span>
          ) : (
            <>
              <input
                aria-label="Rule name"
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                className="rounded-control border border-line bg-surface px-2 py-1 text-body text-primary"
              />

              {draft.kind === "weekly-grid" ? (
                <WeeklyGridEditor
                  times={
                    ((draft.config as { times?: GridTimes } | null)?.times ?? {}) as GridTimes
                  }
                  onChange={(times) => setDraft({ ...draft, config: { times } })}
                />
              ) : (
                <span className="text-meta text-tertiary">
                  {`${draft.kind} rules have no visual editor yet, ${describeGenerator(draft)}`}
                </span>
              )}

              <PreviewStrip
                ruleset={ruleset}
                saved={selected?.current ?? null}
                draft={draft}
                fromUtc={nowUtc}
                tz={tz}
              />

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void requestSave()}
                  className="motion-hover rounded-control border border-line px-2 py-1 text-meta text-primary hover:bg-hover"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => setDraft(selected?.current ?? null)}
                  className="motion-hover rounded-control px-2 py-1 text-meta text-tertiary hover:text-secondary"
                >
                  Discard
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {impact !== null && (
        <ImpactDialog
          impact={impact}
          mode={mode}
          onModeChange={setMode}
          onConfirm={() => void confirmSave()}
          onCancel={() => setImpact(null)}
        />
      )}
    </div>
  );
}
