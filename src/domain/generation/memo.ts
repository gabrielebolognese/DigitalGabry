import { hashString } from "./prng";
import { generateDetailed } from "./engine";
import type {
  GenerateOptions,
  GenerationReport,
  GenerationWindow,
  ResolvedRuleset,
  SlotBinding,
  SlotOverride,
  WorldState,
} from "./types";

/* Spec1.1 section 11: generate is memoised on the ruleset version, the window
   and a hash of the world state, and invalidated on any generator, override,
   binding or block change intersecting the window.

   The key is built from what generation actually reads. Hashing the whole
   world would invalidate on every unrelated edit; hashing too little would
   serve a stale schedule, which is worse than being slow. */

const MAX_ENTRIES = 32;

function hashRuleset(ruleset: ResolvedRuleset): string {
  const parts: string[] = [ruleset.id];
  for (const generator of ruleset.generators) {
    parts.push(
      generator.id,
      String(generator.version),
      generator.enabled ? "1" : "0",
      String(generator.layer),
      String(generator.validFrom ?? ""),
      String(generator.validTo ?? ""),
      generator.timezone,
      JSON.stringify(generator.emits),
      JSON.stringify(generator.config),
      JSON.stringify(generator.dst ?? ""),
    );
  }
  for (const modifier of ruleset.modifiers ?? []) {
    parts.push(
      modifier.id,
      String(modifier.version),
      modifier.enabled ? "1" : "0",
      String(modifier.order),
      JSON.stringify(modifier.config),
    );
  }
  return String(hashString(parts.join("")));
}

/* Only the blocks that could change the answer, and only their scheduling
   fields. A block's title changing cannot move a slot, so it must not
   invalidate: an editor that reflows the calendar on every keystroke is how a
   cache stops being worth having. */
function hashWorld(world: WorldState, window: GenerationWindow, slack: number): string {
  const parts: string[] = [];
  const from = window.startUtc - slack;
  const to = window.endUtc + slack;

  const relevant = world.blocks
    .filter(
      (block) =>
        block.startUtc !== null && block.startUtc >= from && block.startUtc <= to,
    )
    .sort((left, right) => (left.startUtc ?? 0) - (right.startUtc ?? 0));

  for (const block of relevant) {
    parts.push(
      block.id,
      String(block.startUtc),
      String(block.endUtc),
      block.kind,
      block.status ?? "",
      block.platform ?? "",
      block.tags.join(","),
    );
  }

  for (const entry of world.momentum) parts.push(entry.date, String(entry.value));
  for (const holiday of world.holidays) parts.push(holiday);

  return String(hashString(parts.join("")));
}

function hashList(
  overrides: readonly SlotOverride[],
  bindings: readonly SlotBinding[],
): string {
  const parts: string[] = [];
  for (const override of [...overrides].sort((a, b) => (a.slotKey < b.slotKey ? -1 : 1))) {
    parts.push(
      override.slotKey,
      override.action,
      String(override.movedStartUtc ?? ""),
      String(override.movedEndUtc ?? ""),
    );
  }
  for (const binding of [...bindings].sort((a, b) => (a.slotKey < b.slotKey ? -1 : 1))) {
    parts.push(binding.slotKey, binding.contentId ?? "", binding.blockId ?? "");
  }
  return String(hashString(parts.join("")));
}

export function memoKey(
  ruleset: ResolvedRuleset,
  window: GenerationWindow,
  overrides: readonly SlotOverride[],
  bindings: readonly SlotBinding[],
  world: WorldState,
  options: GenerateOptions,
): string {
  const slack = 190 * 86_400_000;
  return [
    hashRuleset(ruleset),
    window.startUtc,
    window.endUtc,
    hashList(overrides, bindings),
    hashWorld(world, window, slack),
    options.trace === true ? "t" : "",
  ].join("|");
}

export type MemoStats = { hits: number; misses: number };

export class GenerationCache {
  private readonly entries = new Map<string, GenerationReport>();
  readonly stats: MemoStats = { hits: 0, misses: 0 };

  get(
    ruleset: ResolvedRuleset,
    window: GenerationWindow,
    overrides: readonly SlotOverride[] = [],
    bindings: readonly SlotBinding[] = [],
    world: WorldState = { now: 0, blocks: [], contentItems: [], momentum: [], holidays: [] },
    options: GenerateOptions = {},
  ): GenerationReport {
    const key = memoKey(ruleset, window, overrides, bindings, world, options);
    const hit = this.entries.get(key);

    if (hit !== undefined) {
      this.stats.hits += 1;
      /* Move to the end so eviction drops what has not been asked for
         recently rather than what was stored longest ago. */
      this.entries.delete(key);
      this.entries.set(key, hit);
      return hit;
    }

    this.stats.misses += 1;
    const report = generateDetailed(ruleset, window, overrides, bindings, world, options);
    this.entries.set(key, report);

    if (this.entries.size > MAX_ENTRIES) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }

    return report;
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}
