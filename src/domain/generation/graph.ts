import { batchProductionSchema, derivedSchema, rotationSchema } from "./kinds/composite";
import type { Generator } from "./types";

/* Spec1.1 edge case 8: circular derivation is detected at save time and
   rejected, rather than discovered when generation runs out of stack.

   There are two ways generators can point at each other, and both have to be
   followed. rotation and batch-production name a generator by id. A derived
   generator names no one: it matches blocks by kind and platform, so it is
   downstream of anything that emits what it triggers on. The second kind is
   the one that actually bites, because nothing in the config looks like a
   reference. */

export type Edge = { from: string; to: string; via: string };

function emitsMatchTrigger(
  source: Generator,
  trigger: { kind?: string; platform?: string },
): boolean {
  if (trigger.kind !== undefined && source.emits.kind !== trigger.kind) return false;
  if (trigger.platform !== undefined && source.emits.platform !== trigger.platform) {
    return false;
  }
  // A trigger constraining nothing matches everything, including its own source.
  return trigger.kind !== undefined || trigger.platform !== undefined;
}

export function edgesOf(generators: readonly Generator[]): Edge[] {
  const edges: Edge[] = [];
  const byId = new Map<string, Generator>();
  for (const generator of generators) byId.set(generator.id, generator);

  for (const generator of generators) {
    if (generator.kind === "rotation") {
      const parsed = rotationSchema.safeParse(generator.config);
      if (parsed.success && byId.has(parsed.data.sourceGeneratorId)) {
        edges.push({
          from: parsed.data.sourceGeneratorId,
          to: generator.id,
          via: "rotation",
        });
      }
      continue;
    }

    if (generator.kind === "batch-production") {
      const parsed = batchProductionSchema.safeParse(generator.config);
      if (parsed.success) {
        for (const sourceId of parsed.data.sourceGeneratorIds) {
          if (byId.has(sourceId)) {
            edges.push({ from: sourceId, to: generator.id, via: "batch-production" });
          }
        }
      }
      continue;
    }

    if (generator.kind === "derived") {
      const parsed = derivedSchema.safeParse(generator.config);
      if (!parsed.success) continue;

      for (const other of generators) {
        if (other.id === generator.id) continue;
        if (emitsMatchTrigger(other, parsed.data.trigger)) {
          edges.push({ from: other.id, to: generator.id, via: "derived" });
        }
      }

      /* A derived generator whose own output matches its own trigger is a
         one-node cycle, which is the easiest of these to write by accident. */
      if (
        parsed.data.offsets.some((offset) =>
          emitsMatchTrigger(
            { ...generator, emits: { ...generator.emits, ...offset.emits } },
            parsed.data.trigger,
          ),
        )
      ) {
        edges.push({ from: generator.id, to: generator.id, via: "derived" });
      }
    }
  }

  return edges;
}

/* The cycle itself, not just whether there is one, because the message has to
   name the generators involved for the rejection to be actionable. */
export function findCycle(generators: readonly Generator[]): string[] | null {
  const edges = edgesOf(generators);
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    const bucket = outgoing.get(edge.from);
    if (bucket === undefined) outgoing.set(edge.from, [edge.to]);
    else bucket.push(edge.to);
  }

  const state = new Map<string, "visiting" | "done">();
  const stack: string[] = [];

  function walk(id: string): string[] | null {
    const seen = state.get(id);
    if (seen === "done") return null;
    if (seen === "visiting") {
      const start = stack.indexOf(id);
      return [...stack.slice(start === -1 ? 0 : start), id];
    }

    state.set(id, "visiting");
    stack.push(id);

    for (const next of outgoing.get(id) ?? []) {
      const cycle = walk(next);
      if (cycle !== null) return cycle;
    }

    stack.pop();
    state.set(id, "done");
    return null;
  }

  const ids = [...new Set(generators.map((generator) => generator.id))].sort();
  for (const id of ids) {
    const cycle = walk(id);
    if (cycle !== null) return cycle;
  }

  return null;
}

export type SaveCheck = { ok: true } | { ok: false; error: string };

export function checkNoCycles(generators: readonly Generator[]): SaveCheck {
  const cycle = findCycle(generators);
  if (cycle === null) return { ok: true };
  return {
    ok: false,
    error: `These generators trigger each other in a loop: ${cycle.join(" to ")}`,
  };
}
