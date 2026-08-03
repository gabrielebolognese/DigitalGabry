import { z, type ZodType } from "zod";
import type { TzContext } from "../tz";
import type {
  Drop,
  Modifier,
  ModifierKind,
  ModifierStage,
  Slot,
  WorldState,
} from "../types";

/* Modifiers do not emit slots. They transform, filter or constrain the set the
   generators produced, and each declares the stage it runs in so the pipeline
   order in Spec1.1 section 6 is a property of the data rather than of the call
   order in engine.ts. */

export type ModifierContext = {
  modifier: Modifier;
  world: WorldState;
  tz: TzContext;
  /* A modifier that removes a slot says why. Spec1.1 5.3 and edge cases 5, 6
     and 17 all turn on the reason reaching the preview. */
  drop: (slot: Slot, reason: string) => void;
  notice: (kind: string, message: string) => void;
  note: (slot: Slot, detail: string) => void;
};

export type ModifierModule<Config> = {
  kind: ModifierKind;
  stage: ModifierStage;
  schema: ZodType<Config>;
  apply: (config: Config, slots: Slot[], context: ModifierContext) => Slot[];
  describe: (config: Config) => string;
};

type ErasedModifierModule = {
  kind: ModifierKind;
  stage: ModifierStage;
  parse: (raw: unknown) => { ok: true; config: unknown } | { ok: false; error: string };
  apply: (config: unknown, slots: Slot[], context: ModifierContext) => Slot[];
  describe: (config: unknown) => string;
};

const REGISTRY = new Map<ModifierKind, ErasedModifierModule>();

/* Same erasure boundary as the generator registry, and for the same reason:
   one cast where the value came from this module's own schema, rather than an
   untyped map that loses checking everywhere. */
export function registerModifier<Config>(module: ModifierModule<Config>): void {
  REGISTRY.set(module.kind, {
    kind: module.kind,
    stage: module.stage,
    parse: (raw) => {
      const result = module.schema.safeParse(raw);
      if (result.success) return { ok: true, config: result.data };
      return {
        ok: false,
        error: result.error.issues
          .map((issue) => `${issue.path.join(".") || "config"}: ${issue.message}`)
          .join("; "),
      };
    },
    apply: (config, slots, context) => module.apply(config as Config, slots, context),
    describe: (config) => module.describe(config as Config),
  });
}

export function modifierModuleFor(kind: ModifierKind): ErasedModifierModule | null {
  return REGISTRY.get(kind) ?? null;
}

export function describeModifier(modifier: Modifier): string {
  const module = modifierModuleFor(modifier.kind);
  if (module === null) return modifier.kind;
  const parsed = module.parse(modifier.config);
  return parsed.ok ? module.describe(parsed.config) : "Invalid configuration";
}

export type { Drop };

export const modeSchema = z.enum(["remove", "shift-out", "shrink"]);
