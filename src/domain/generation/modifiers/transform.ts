import { z } from "zod";
import { randomIntFor, randomNormalFor } from "../prng";
import { isProtected, matchesScope, scopeSchema } from "../scope";
import type { ModifierModule } from "./index";

/* Stage 3, in this order: jitter then snap. Spec1.1 5.5 says snap runs after
   jitter deliberately, so a jittered time still lands on the grid when the
   user wants one. */

const MS_PER_MINUTE = 60_000;

export const jitterSchema = z.object({
  rangeMinutes: z.number().int().min(0).max(720),
  seed: z.string().default("digitalgabry"),
  distribution: z.enum(["uniform", "normal"]).default("uniform"),
  appliesTo: scopeSchema,
});

export type JitterConfig = z.infer<typeof jitterSchema>;

export const jitter: ModifierModule<JitterConfig> = {
  kind: "jitter",
  stage: "transform",
  schema: jitterSchema,

  apply(config, slots, context) {
    if (config.rangeMinutes === 0) return slots;

    for (const slot of slots) {
      if (isProtected(slot) || !matchesScope(slot, config.appliesTo)) continue;

      /* Keyed by the slot's own coordinates, never by its position in a run.
         That is what makes the same slot jitter identically across restarts
         and across devices, and independently of the window it was found in.
         Edge case 20. */
      const offset =
        config.distribution === "normal"
          ? Math.round(
              randomNormalFor(
                config.seed,
                slot.generatorId,
                slot.localDate,
                slot.ordinal,
                config.rangeMinutes,
              ),
            )
          : randomIntFor(
              config.seed,
              slot.generatorId,
              slot.localDate,
              slot.ordinal,
              -config.rangeMinutes,
              config.rangeMinutes,
            );

      if (offset === 0) continue;
      const shift = offset * MS_PER_MINUTE;
      slot.startUtc += shift;
      slot.endUtc += shift;
      context.note(slot, `jittered ${offset >= 0 ? "+" : ""}${offset}m, seed ${config.seed}`);
    }

    return slots;
  },

  describe(config) {
    return `Up to ${config.rangeMinutes}m ${config.distribution} jitter`;
  },
};

export const snapSchema = z.object({
  toMinutes: z.number().int().min(1).max(720),
  direction: z.enum(["nearest", "up", "down"]).default("nearest"),
  appliesTo: scopeSchema,
});

export type SnapConfig = z.infer<typeof snapSchema>;

export const snap: ModifierModule<SnapConfig> = {
  kind: "snap",
  stage: "transform",
  schema: snapSchema,

  apply(config, slots, context) {
    for (const slot of slots) {
      if (isProtected(slot) || !matchesScope(slot, config.appliesTo)) continue;

      /* Snapped against local midnight, not against the UTC epoch. Zones offset
         by a half or quarter hour would otherwise land on a grid that is
         correct in UTC and visibly wrong on screen. */
      const midnight = context.tz.midnightUtc(slot.localDate);
      const minutes = (slot.startUtc - midnight) / MS_PER_MINUTE;

      const snapped =
        config.direction === "up"
          ? Math.ceil(minutes / config.toMinutes) * config.toMinutes
          : config.direction === "down"
            ? Math.floor(minutes / config.toMinutes) * config.toMinutes
            : Math.round(minutes / config.toMinutes) * config.toMinutes;

      if (snapped === minutes) continue;
      const duration = slot.endUtc - slot.startUtc;
      slot.startUtc = midnight + snapped * MS_PER_MINUTE;
      slot.endUtc = slot.startUtc + duration;
      context.note(slot, `snapped ${config.direction} to ${config.toMinutes}m`);
    }

    return slots;
  },

  describe(config) {
    return `Snap ${config.direction} to ${config.toMinutes}m`;
  },
};
