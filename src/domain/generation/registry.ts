import type { ZodType } from "zod";
import type {
  Candidate,
  GenerationWindow,
  Generator,
  GeneratorKind,
  WorldState,
} from "./types";
import type { TzResolver } from "./tz";

/* Spec1.1 section 11: adding a generator kind must require exactly one new
   file and one registry line, with no change to the pipeline. Invariant 23.

   That is why emit returns candidates rather than slots. Ordinals, keys,
   ordering and trace are the engine's business; a kind that assigned its own
   would be a second numbering scheme able to disagree with the first. */

export type EmitContext = {
  generator: Generator;
  /* Local dates covering the window plus the kind's declared lookback and one
     day of lookahead, in the generator's timezone. */
  dates: readonly string[];
  resolve: TzResolver;
  world: WorldState;
  window: GenerationWindow;
  /* A kind that cannot place what it was asked for says so rather than
     returning an empty array and leaving the user to guess. Edge case 17. */
  notice: (kind: string, message: string) => void;
  /* Local midnight, memoised for the pass. Kinds that reason about a whole day
     need it and must not open a second conversion path to get it. */
  midnightUtc: (localDate: string) => number;
  localDateOf: (utcMs: number) => string;
};

export type KindModule<Config> = {
  kind: GeneratorKind;
  schema: ZodType<Config>;
  /* Declared, never unbounded. Spec1.1 section 3 forbids a lookback that makes
     viewport generation impossible. */
  lookbackDays: number;
  emit: (config: Config, context: EmitContext) => Candidate[];
  describe: (config: Config) => string;
};

export type ParsedConfig =
  | { ok: true; config: unknown }
  | { ok: false; error: string };

/* Every kind has a different config type, so the registry has to erase it to
   store them together. The erasure happens once, here, where the value being
   cast is the one this module's own schema just produced, rather than by
   typing the whole registry as `any` and losing the checking everywhere. */
type ErasedKindModule = {
  kind: GeneratorKind;
  lookbackDays: number;
  parse: (raw: unknown) => ParsedConfig;
  emit: (config: unknown, context: EmitContext) => Candidate[];
  describe: (config: unknown) => string;
};

const REGISTRY = new Map<GeneratorKind, ErasedKindModule>();

export function register<Config>(module: KindModule<Config>): void {
  REGISTRY.set(module.kind, {
    kind: module.kind,
    lookbackDays: module.lookbackDays,

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

    // Safe: the only configs reaching these came from parse above.
    emit: (config, context) => module.emit(config as Config, context),
    describe: (config) => module.describe(config as Config),
  });
}

export function moduleFor(kind: GeneratorKind): ErasedKindModule | null {
  return REGISTRY.get(kind) ?? null;
}

export function registeredKinds(): GeneratorKind[] {
  return [...REGISTRY.keys()].sort();
}

/* Validation happens once per generator per pass, not per slot. A config that
   does not validate emits nothing and says why, rather than throwing and
   taking the whole calendar down with it. Edge case 1. */
export function parseConfig(generator: Generator): ParsedConfig {
  const module = moduleFor(generator.kind);
  if (module === null) {
    return { ok: false, error: `Unknown generator kind: ${generator.kind}` };
  }
  return module.parse(generator.config);
}

export function describeGenerator(generator: Generator): string {
  const module = moduleFor(generator.kind);
  if (module === null) return generator.kind;
  const parsed = parseConfig(generator);
  return parsed.ok ? module.describe(parsed.config) : "Invalid configuration";
}
