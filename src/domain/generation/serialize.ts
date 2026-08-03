import { moduleFor, parseConfig } from "./registry";
import { modifierModuleFor } from "./modifiers/index";
import type { Generator, Modifier, ResolvedRuleset } from "./types";

/* Spec1.1 section 14. A ruleset exports and imports as one JSON document with
   a version field and no ids tied to the local install, which gives backup,
   sharing and shipped presets from the same code.

   Refuses rather than guesses. Edge case 24: an unknown generator kind is a
   named error and nothing is applied, not a partial import that leaves the
   user with half a schedule and no way to tell which half. */

export const RULESET_FORMAT_VERSION = 1;

export type RulesetDocument = {
  format: number;
  name: string;
  generators: readonly Omit<Generator, "version">[];
  modifiers: readonly Omit<Modifier, "version">[];
};

/* Keys sorted at every level, so re-exporting an unchanged ruleset produces
   byte identical output and a diff shows only real changes. The same reason
   backup/format.ts sorts. */
function sortedValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedValue);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortedValue((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

export function exportRuleset(ruleset: ResolvedRuleset): string {
  /* Only the version in force is exported. Carrying history across installs
     would import someone else's past, which means nothing here. */
  const latest = new Map<string, Generator>();
  for (const generator of ruleset.generators) {
    const current = latest.get(generator.id);
    if (current === undefined || generator.version > current.version) {
      latest.set(generator.id, generator);
    }
  }

  const document: RulesetDocument = {
    format: RULESET_FORMAT_VERSION,
    name: ruleset.name,
    generators: [...latest.values()]
      .sort((left, right) => (left.id < right.id ? -1 : 1))
      .map(({ version: _version, ...rest }) => rest),
    modifiers: (ruleset.modifiers ?? [])
      .slice()
      .sort((left, right) => (left.id < right.id ? -1 : 1))
      .map(({ version: _version, ...rest }) => rest),
  };

  return `${JSON.stringify(sortedValue(document), null, 2)}\n`;
}

export type ImportResult =
  | { ok: true; ruleset: ResolvedRuleset }
  | { ok: false; error: string };

export function importRuleset(text: string, id: string): ImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "That file is not valid JSON" };
  }

  if (parsed === null || typeof parsed !== "object") {
    return { ok: false, error: "That file does not contain a ruleset" };
  }

  const document = parsed as Partial<RulesetDocument>;

  if (typeof document.format !== "number") {
    return { ok: false, error: "The ruleset has no format version" };
  }
  if (document.format > RULESET_FORMAT_VERSION) {
    return {
      ok: false,
      error: `This ruleset was written by a newer version of the app, format ${document.format}`,
    };
  }
  if (!Array.isArray(document.generators)) {
    return { ok: false, error: "The ruleset has no generators" };
  }

  const generators: Generator[] = [];
  for (const raw of document.generators) {
    const candidate = { ...raw, version: 1 } as Generator;

    if (moduleFor(candidate.kind) === null) {
      return {
        ok: false,
        error: `This ruleset uses a generator kind this version does not know: ${String(candidate.kind)}`,
      };
    }

    const config = parseConfig(candidate);
    if (!config.ok) {
      return {
        ok: false,
        error: `Generator "${candidate.name}" has an invalid configuration: ${config.error}`,
      };
    }

    generators.push(candidate);
  }

  const modifiers: Modifier[] = [];
  for (const raw of document.modifiers ?? []) {
    const candidate = { ...raw, version: 1 } as Modifier;
    const module = modifierModuleFor(candidate.kind);
    if (module === null) {
      return {
        ok: false,
        error: `This ruleset uses a modifier this version does not know: ${String(candidate.kind)}`,
      };
    }
    const config = module.parse(candidate.config);
    if (!config.ok) {
      return {
        ok: false,
        error: `Modifier "${candidate.name}" has an invalid configuration: ${config.error}`,
      };
    }
    modifiers.push(candidate);
  }

  return {
    ok: true,
    ruleset: { id, name: document.name ?? "Imported", generators, modifiers },
  };
}
