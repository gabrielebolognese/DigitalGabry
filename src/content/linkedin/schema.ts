import { z } from "zod";

/* Spec2 3.3. Every string carries a hard character limit, enforced here rather
   than hoped for in the prompt.

   This is what prevents the single most common failure mode: a headline that
   overflows its box. A model asked nicely for "about sixty characters" will
   give you seventy-four often enough to matter, and the only place that shows
   up is a broken image you find by looking at it. */

export const LINKEDIN_FORMATS = [
  "feature-spotlight",
  "contrarian",
  "build-log",
  "numbers",
  "problem-first",
] as const;

export type LinkedInFormat = (typeof LINKEDIN_FORMATS)[number];

export const LINKEDIN_LAYOUTS = [
  "headline",
  "headline-bullets",
  "code",
  "metric",
  "split",
] as const;

export type LinkedInLayout = (typeof LINKEDIN_LAYOUTS)[number];

export const ACCENTS = ["amber", "orange", "neutral"] as const;

export const linkedInImageSpecSchema = z.object({
  eyebrow: z.string().max(24).optional(),
  headline: z.string().min(1).max(60),
  subheadline: z.string().max(90).optional(),
  bullets: z.array(z.string().max(48)).max(4).optional(),
  codeSnippet: z
    .object({
      language: z.string().max(20),
      lines: z.array(z.string().max(52)).max(8),
    })
    .optional(),
  metric: z
    .object({
      value: z.string().max(12),
      label: z.string().max(30),
    })
    .optional(),
  badge: z.string().max(16).optional(),
  accent: z.enum(ACCENTS),
  layout: z.enum(LINKEDIN_LAYOUTS),
});

export type LinkedInImageSpec = z.infer<typeof linkedInImageSpecSchema>;

export type LinkedInPayload = {
  format?: LinkedInFormat;
  imageSpec?: LinkedInImageSpec;
  templateId?: LinkedInLayout;
  promptHash?: string;
  generatedAt?: number;
  /* Kept so a generation can be inspected after it failed validation, rather
     than the user being told only that something went wrong. */
  lastRawResponse?: string;
};

/* The retry message. Naming the field and the overshoot is the difference
   between a retry that fixes it and one that rolls the dice again. */
export function describeIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.join(".") || "the object";
      if (issue.code === "too_big" && typeof issue.maximum === "number") {
        return `${path} must be at most ${issue.maximum} characters`;
      }
      if (issue.code === "too_small") return `${path} must not be empty`;
      return `${path}: ${issue.message}`;
    })
    .join("; ");
}

/* Models return JSON wrapped in fences often enough that stripping them is not
   optional, however firmly the prompt says not to. Defensive rather than
   trusting: the instruction stays in the prompt and this runs anyway. */
export function stripFences(text: string): string {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n?```$/.exec(trimmed);
  if (fenced !== null) return (fenced[1] ?? "").trim();

  /* A model sometimes writes a sentence before the object. Falling back to the
     outermost braces recovers those without accepting arbitrary prose. */
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first !== -1 && last > first) return trimmed.slice(first, last + 1);

  return trimmed;
}

export type SpecParse =
  | { ok: true; spec: LinkedInImageSpec }
  | { ok: false; error: string; raw: string };

export function parseSpec(raw: string): SpecParse {
  const text = stripFences(raw);

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "The response was not valid JSON", raw };
  }

  const result = linkedInImageSpecSchema.safeParse(parsed);
  if (!result.success) {
    return { ok: false, error: describeIssues(result.error), raw };
  }
  return { ok: true, spec: result.data };
}

/* Which templates suit a spec, most appropriate first. Generating three
   variants from one call is only worth it if the three are plausible. */
export function templatesFor(spec: LinkedInImageSpec): LinkedInLayout[] {
  const ordered: LinkedInLayout[] = [spec.layout];

  if (spec.metric !== undefined) ordered.push("metric");
  if (spec.codeSnippet !== undefined) ordered.push("code", "split");
  if ((spec.bullets?.length ?? 0) > 0) ordered.push("headline-bullets", "split");
  ordered.push("headline");

  return [...new Set(ordered)].slice(0, 3);
}
