import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { GenerationCache } from "../domain/generation/memo";
import type {
  GenerationReport,
  ResolvedRuleset,
  Slot,
  SlotBinding,
  SlotOverride,
} from "../domain/generation/types";
import type { CalendarEntry } from "../domain/block";
import type { UtcRange } from "../domain/time";
import {
  listBindings,
  listOverrides,
  listRulesets,
  loadRuleset,
  putOverride,
  clearOverride,
  closeGeneratorAt,
  reconcileDeletedBlocks,
} from "../db/repository";
import { parseSlotKey } from "../domain/generation/slotKey";
import { BLOCKS_CHANGED } from "./events";

/* The calendar's second source of truth. Slots are computed and never stored,
   so this is the only place they come from, and the memo means scrolling back
   to a week already seen costs a map lookup rather than a full pass.

   Rulesets, overrides and bindings are read once and kept; the window changes
   far more often than the rules do, and re-reading them on every scroll would
   make the cache pointless. */

const EMPTY_REPORT: GenerationReport = { slots: [], dropped: [], notices: [] };

export type SlotsApi = {
  slots: Slot[];
  report: GenerationReport;
  loading: boolean;
  /* Which rulesets and generators are visible. Display only: hiding a layer
     never changes what is generated. Spec1.1 12.2. */
  hidden: ReadonlySet<string>;
  toggleHidden: (id: string) => void;
  showAll: () => void;
  hideAll: () => void;
  allHidden: boolean;
  ruleset: ResolvedRuleset | null;
  skipOnce: (slot: Slot) => Promise<void>;
  skipFuture: (slot: Slot) => Promise<void>;
  pin: (slot: Slot) => Promise<void>;
  moveSlot: (slot: Slot, startUtc: number, endUtc: number) => Promise<void>;
  resetToRule: (slot: Slot) => Promise<void>;
  refresh: () => void;
};

const HIDDEN_KEY = "digitalgabry.hidden-layers";

function readHidden(): Set<string> {
  const raw = window.localStorage.getItem(HIDDEN_KEY);
  if (raw === null) return new Set();
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed.map(String)) : new Set();
  } catch {
    return new Set();
  }
}

export function useSlots(range: UtcRange, blocks: readonly CalendarEntry[]): SlotsApi {
  const [ruleset, setRuleset] = useState<ResolvedRuleset | null>(null);
  const [overrides, setOverrides] = useState<readonly SlotOverride[]>([]);
  const [bindings, setBindings] = useState<readonly SlotBinding[]>([]);
  const [loading, setLoading] = useState(true);
  const [hidden, setHidden] = useState<Set<string>>(readHidden);
  const [rulesToken, setRulesToken] = useState(0);

  const cache = useRef(new GenerationCache());

  const refresh = useCallback(() => setRulesToken((token) => token + 1), []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const rulesets = await listRulesets();
        const first = rulesets[0];
        if (first === undefined) {
          if (!cancelled) {
            setRuleset(null);
            setLoading(false);
          }
          return;
        }

        /* Edge case 25. A block the user deleted must not come back, so its
           binding goes first: with the binding gone the slot returns to
           virtual, and nothing regenerates the block because only a binding
           would. Done before the read, or the stale binding would be loaded
           and the deleted block would appear to still be there. */
        await reconcileDeletedBlocks();

        const [loaded, storedOverrides, storedBindings] = await Promise.all([
          loadRuleset(first.id),
          listOverrides(),
          listBindings(),
        ]);

        if (cancelled) return;
        setRuleset(loaded);
        setOverrides(storedOverrides);
        setBindings(storedBindings);
      } catch {
        /* A generation layer that cannot load leaves a plain calendar rather
           than an error: the blocks are still the user's real schedule. */
        if (!cancelled) setRuleset(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [rulesToken]);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    void listen(BLOCKS_CHANGED, () => {
      cache.current.clear();
      refresh();
    }).then((off) => {
      unlisten = off;
    });
    return () => unlisten?.();
  }, [refresh]);

  useEffect(() => {
    window.localStorage.setItem(HIDDEN_KEY, JSON.stringify([...hidden]));
  }, [hidden]);

  /* The world the engine reads. Only the fields that can move a slot, so a
     title being edited does not invalidate the memo. */
  const world = useMemo(
    () => ({
      now: range.start,
      blocks: blocks.map((entry) => ({
        id: entry.id,
        startUtc: entry.startUtc,
        endUtc: entry.endUtc,
        kind: entry.kind,
        tags: entry.tags,
        title: entry.title,
        status: entry.status,
        ...(entry.payload.platform === undefined
          ? {}
          : { platform: entry.payload.platform }),
      })),
      contentItems: [],
      momentum: [],
      holidays: [],
    }),
    [blocks, range.start],
  );

  const report = useMemo(() => {
    if (ruleset === null) return EMPTY_REPORT;
    return cache.current.get(
      ruleset,
      { startUtc: range.start, endUtc: range.end },
      overrides,
      bindings,
      world,
      /* Trace is what the explainer reads, so it is on in the app rather than
         only in tests. A week is a few hundred slots; the cost is paid once
         per window and then memoised. */
      { trace: true },
    );
  }, [ruleset, range.start, range.end, overrides, bindings, world]);

  const visible = useMemo(
    () =>
      report.slots.filter(
        (slot) => !hidden.has(slot.generatorId) && !hidden.has("*"),
      ),
    [report.slots, hidden],
  );

  const writeOverride = useCallback(
    async (slot: Slot, action: SlotOverride["action"], moved?: { start: number; end: number }) => {
      const parsed = parseSlotKey(slot.key);
      await putOverride({
        slotKey: slot.key,
        generatorId: slot.generatorId,
        localDate: parsed?.localDate ?? slot.localDate,
        ordinal: parsed?.ordinal ?? slot.ordinal,
        action,
        movedStartUtc: moved?.start ?? null,
        movedEndUtc: moved?.end ?? null,
      });
      const stored = await listOverrides();
      setOverrides(stored);
      cache.current.clear();
    },
    [],
  );

  const api: SlotsApi = {
    slots: visible,
    report,
    loading,
    hidden,
    allHidden: hidden.has("*"),

    toggleHidden: useCallback((id: string) => {
      setHidden((current) => {
        const next = new Set(current);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    }, []),

    showAll: useCallback(() => setHidden(new Set()), []),
    hideAll: useCallback(() => setHidden(new Set(["*"])), []),

    ruleset,

    skipOnce: useCallback((slot: Slot) => writeOverride(slot, "skip"), [writeOverride]),

    /* A rule change rather than a pile of overrides: it closes the version in
       force at this instant. One override per remaining day would be thousands
       of rows all saying the same thing, and none would survive a rule edit. */
    skipFuture: useCallback(
      async (slot: Slot) => {
        await closeGeneratorAt(slot.generatorId, slot.startUtc);
        cache.current.clear();
        refresh();
      },
      [refresh],
    ),

    pin: useCallback((slot: Slot) => writeOverride(slot, "pin"), [writeOverride]),

    moveSlot: useCallback(
      (slot: Slot, startUtc: number, endUtc: number) =>
        writeOverride(slot, "move", { start: startUtc, end: endUtc }),
      [writeOverride],
    ),

    resetToRule: useCallback(async (slot: Slot) => {
      await clearOverride(slot.key);
      const stored = await listOverrides();
      setOverrides(stored);
      cache.current.clear();
    }, []),

    refresh,
  };

  return api;
}
