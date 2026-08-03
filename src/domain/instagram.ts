/* Spec2 section 4. The script model for the Instagram video manager, kept pure
   so the running total in the header and the text sent to a phone cannot
   disagree about how long a script is. */

export const INSTAGRAM_FORMATS = ["reel", "carousel", "story"] as const;
export type InstagramFormat = (typeof INSTAGRAM_FORMATS)[number];

export const SECTION_KINDS = ["hook", "context", "body", "payoff", "cta"] as const;
export type SectionKind = (typeof SECTION_KINDS)[number];

/* Colour coded by kind using the five category colours. Spec2 4.3. */
export const KIND_TONE: Record<SectionKind, string> = {
  hook: "text-cat-build",
  context: "text-cat-content",
  body: "text-cat-admin",
  payoff: "text-cat-personal",
  cta: "text-cat-deadline",
};

export type ScriptSection = {
  id: string;
  kind: SectionKind;
  text: string;
  /* What is on screen during this line. */
  bRoll?: string;
  /* A manual override of the estimate, in seconds. */
  seconds?: number;
};

export type Reference = {
  id: string;
  url: string;
  note: string;
  assetId?: string;
  addedUtc: number;
};

export type InstagramPayload = {
  format?: InstagramFormat;
  idea?: string;
  references?: Reference[];
  script?: ScriptSection[];
  hookVariants?: string[];
  audioNote?: string;
  /* Derived, never stored as truth: recomputed from the sections every time,
     so a stale value cannot outlive the script it described. Spec2 4.1. */
  estimatedSeconds?: number;
};

export const MAX_HOOK_VARIANTS = 3;

/* Spec2 4.3. The realistic rate for scripted short form delivery, which is
   slower than reading and faster than conversation. */
export const WORDS_PER_SECOND = 2.6;

export function wordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed === "" ? 0 : trimmed.split(/\s+/).length;
}

export function estimateSeconds(text: string): number {
  return wordCount(text) / WORDS_PER_SECOND;
}

/* An override wins outright. Zero is a legitimate override, so the check is
   for undefined rather than for falsiness. */
export function sectionSeconds(section: ScriptSection): number {
  return section.seconds === undefined ? estimateSeconds(section.text) : section.seconds;
}

/* Summed per section rather than estimated over the joined text. The two are
   not the same once an override exists, and the header showing one number
   while the sections show another is exactly the kind of quiet contradiction
   that makes a tool feel untrustworthy. */
export function totalSeconds(sections: readonly ScriptSection[]): number {
  return sections.reduce((sum, section) => sum + sectionSeconds(section), 0);
}

export const WARN_SECONDS = 90;
export const LONG_SECONDS = 180;

export function durationTone(seconds: number): string {
  if (seconds > LONG_SECONDS) return "text-cat-build";
  if (seconds > WARN_SECONDS) return "text-cat-deadline";
  return "text-tertiary";
}

export function formatDuration(seconds: number): string {
  const whole = Math.round(seconds);
  const minutes = Math.floor(whole / 60);
  return `${minutes}:${String(whole % 60).padStart(2, "0")}`;
}

/* Moves a section, carrying everything with it. The acceptance criterion is
   that a per-section override survives a reorder, which it does because the
   whole object moves rather than the text being copied between slots. */
export function reorderSections(
  sections: readonly ScriptSection[],
  fromIndex: number,
  toIndex: number,
): ScriptSection[] {
  if (
    fromIndex === toIndex ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= sections.length ||
    toIndex >= sections.length
  ) {
    return [...sections];
  }

  const next = [...sections];
  const [moved] = next.splice(fromIndex, 1);
  if (moved === undefined) return [...sections];
  next.splice(toIndex, 0, moved);
  return next;
}

/* Tab cycles the kind, so the whole structure can be set without leaving the
   keyboard. Spec2 4.3. */
export function nextKind(kind: SectionKind): SectionKind {
  const index = SECTION_KINDS.indexOf(kind);
  return SECTION_KINDS[(index + 1) % SECTION_KINDS.length] ?? "hook";
}

/* A new section takes the kind of the one before it, except after a hook,
   which is followed once and then not again. */
export function kindAfter(previous: ScriptSection | undefined): SectionKind {
  if (previous === undefined) return "hook";
  return previous.kind === "hook" ? "context" : previous.kind;
}

export function newSection(id: string, kind: SectionKind): ScriptSection {
  return { id, kind, text: "" };
}

/* Spec2 4.4. Formatted for reading while filming, which is a different
   document from the one on screen: kind labels so a position in the script is
   findable at a glance, one line per section, and the b-roll in brackets so it
   cannot be read aloud by mistake. */
export function formatScriptForFilming(
  payload: InstagramPayload,
  title: string,
): string {
  const sections = payload.script ?? [];
  const lines: string[] = [title === "" ? "Untitled" : title];

  if (payload.idea !== undefined && payload.idea !== "") {
    lines.push("", payload.idea);
  }

  lines.push("", `${formatDuration(totalSeconds(sections))} estimated`, "");

  for (const section of sections) {
    lines.push(section.kind.toUpperCase());
    lines.push(section.text === "" ? "..." : section.text);
    if (section.bRoll !== undefined && section.bRoll !== "") {
      lines.push(`[${section.bRoll}]`);
    }
    lines.push("");
  }

  if (payload.audioNote !== undefined && payload.audioNote !== "") {
    lines.push(`AUDIO: ${payload.audioNote}`);
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

/* Pasting a URL is how a reference gets added, so this has to be lenient about
   what a person actually copies. */
export function looksLikeUrl(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed === "" || /\s/.test(trimmed)) return false;
  try {
    const parsed = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`);
    return parsed.hostname.includes(".");
  } catch {
    return false;
  }
}

export function normaliseUrl(text: string): string {
  const trimmed = text.trim();
  return trimmed.startsWith("http") ? trimmed : `https://${trimmed}`;
}
