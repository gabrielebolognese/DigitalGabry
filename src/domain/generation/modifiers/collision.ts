import { z } from "zod";
import { BLOCK_KINDS } from "../../block";
import { isProtected, matchesScope, scopeSchema } from "../scope";
import type { ModifierModule } from "./index";
import type { BlockLike, Slot } from "../types";

/* Stage 6. Spec1.1 section 5.6. How a slot behaves when it lands on top of
   something already on the calendar. */

const MS_PER_MINUTE = 60_000;

export const collisionSchema = z.object({
  against: z
    .object({
      kinds: z.array(z.enum(BLOCK_KINDS)).optional(),
      tags: z.array(z.string()).optional(),
    })
    .default({}),
  policy: z
    .enum(["skip", "shift-later", "shift-earlier", "shrink", "allow", "replace"])
    .default("skip"),
  maxShiftMinutes: z.number().int().min(0).max(1440).default(120),
  appliesTo: scopeSchema,
});

export type CollisionConfig = z.infer<typeof collisionSchema>;

type Busy = { startUtc: number; endUtc: number };

function blocksToAvoid(
  config: CollisionConfig,
  blocks: readonly BlockLike[],
): Busy[] {
  const kinds = config.against.kinds;
  const tags = config.against.tags;

  return blocks
    .filter((block): block is BlockLike & Busy => {
      if (block.startUtc === null || block.endUtc === null) return false;
      if (kinds !== undefined && kinds.length > 0 && !kinds.includes(block.kind)) {
        return false;
      }
      if (tags !== undefined && tags.length > 0) {
        return block.tags.some((tag) => tags.includes(tag));
      }
      return true;
    })
    .map((block) => ({ startUtc: block.startUtc, endUtc: block.endUtc }))
    .sort((left, right) => left.startUtc - right.startUtc);
}

function hit(slot: Slot, busy: readonly Busy[]): Busy | undefined {
  return busy.find(
    (block) => slot.startUtc < block.endUtc && slot.endUtc > block.startUtc,
  );
}

export const collision: ModifierModule<CollisionConfig> = {
  kind: "collision",
  stage: "resolve",
  schema: collisionSchema,

  apply(config, slots, context) {
    if (config.policy === "allow") return slots;

    const busy = blocksToAvoid(config, context.world.blocks);
    if (busy.length === 0) return slots;

    const kept: Slot[] = [];

    for (const slot of slots) {
      if (isProtected(slot) || !matchesScope(slot, config.appliesTo)) {
        kept.push(slot);
        continue;
      }

      const collided = hit(slot, busy);
      if (collided === undefined) {
        kept.push(slot);
        continue;
      }

      /* replace applies to generated slots only, never to a user created
         block. A generator may never destroy manual work. Invariant 19, and
         Spec1.1 5.6 states it outright. Against a real block it degrades to
         skip rather than doing the thing it is forbidden to do. */
      if (config.policy === "skip" || config.policy === "replace") {
        context.drop(
          slot,
          config.policy === "replace"
            ? "collides with a real block, which a generator may never replace"
            : "collides with an existing block",
        );
        continue;
      }

      const duration = slot.endUtc - slot.startUtc;
      const maxShift = config.maxShiftMinutes * MS_PER_MINUTE;

      if (config.policy === "shrink") {
        if (collided.startUtc > slot.startUtc) {
          slot.endUtc = collided.startUtc;
          context.note(slot, "shrunk to end before the block it met");
          kept.push(slot);
        } else {
          context.drop(slot, "wholly covered by an existing block");
        }
        continue;
      }

      const target =
        config.policy === "shift-earlier"
          ? collided.startUtc - duration
          : collided.endUtc;

      if (Math.abs(target - slot.startUtc) > maxShift) {
        context.drop(
          slot,
          `clearing the collision needed more than ${config.maxShiftMinutes}m of shift`,
        );
        continue;
      }

      slot.startUtc = target;
      slot.endUtc = target + duration;

      /* Moving out of one block can land on the next. One retry, then give up,
         rather than a loop whose termination depends on the calendar. */
      const again = hit(slot, busy);
      if (again !== undefined) {
        context.drop(slot, "no clear space near this time");
        continue;
      }

      context.note(slot, "shifted clear of an existing block");
      kept.push(slot);
    }

    return kept;
  },

  describe(config) {
    return `On collision, ${config.policy}`;
  },
};
