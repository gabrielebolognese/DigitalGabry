import { parseSpec, type LinkedInImageSpec } from "./schema";
import { promptHashOf, readPrompt } from "./prompt";

/* Spec2 3.2, step one of the pipeline: post text in, validated spec out.

   The model returns a typed object and local React templates render it to
   pixels. That split is deliberate: brand tokens live in code, so every image
   is exactly on brand, and a headline can be fixed after generation without
   regenerating the whole picture. A model asked for HTML drifts between calls
   and fails silently at render time, which you find out by looking at a broken
   image. */

const API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";

/* Structured extraction rather than deep reasoning, which is what Spec2 3.2
   picks this model for. */
export const MODEL = "claude-sonnet-4-6";

const MAX_TOKENS = 1024;

export type GenerateRequest = {
  apiKey: string;
  postText: string;
  format?: string;
  /* "more technical", "lead with the number". Appended rather than replacing
     the instruction, so a nudge cannot lose the character limits. */
  nudge?: string;
};

export type GenerateResult =
  | { ok: true; spec: LinkedInImageSpec; promptHash: string; raw: string }
  /* The raw response travels with the failure. Being told only that something
     went wrong, with the output discarded, leaves nothing to repair by hand.
     Invariant 13. */
  | { ok: false; error: string; raw: string | null };

type ContentBlock = { type: string; text?: string };

function textOf(body: unknown): string {
  const blocks = (body as { content?: ContentBlock[] } | null)?.content ?? [];
  return blocks
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text ?? "")
    .join("");
}

async function callOnce(
  request: GenerateRequest,
  systemPrompt: string,
  correction: string | null,
): Promise<{ raw: string } | { error: string }> {
  const instruction = [
    request.format === undefined ? null : `The post format is "${request.format}".`,
    request.nudge === undefined || request.nudge.trim() === ""
      ? null
      : `Also: ${request.nudge.trim()}`,
    "Post text follows.",
    request.postText,
    correction === null
      ? null
      : `Your previous answer was rejected. ${correction}. Return corrected JSON only.`,
  ]
    .filter((line): line is string => line !== null)
    .join("\n\n");

  let response: Response;
  try {
    response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": request.apiKey,
        "anthropic-version": API_VERSION,
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        /* The system prompt is long and identical on every call, so it is sent
           as a cached block. Across a batch this is most of the cost. */
        system: [
          {
            type: "text",
            text: systemPrompt,
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: [{ role: "user", content: instruction }],
      }),
    });
  } catch (cause) {
    return {
      error: cause instanceof Error ? cause.message : "The request could not be sent",
    };
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    return { error: `The API returned ${response.status}. ${detail.slice(0, 200)}` };
  }

  const body: unknown = await response.json().catch(() => null);
  const raw = textOf(body);
  if (raw.trim() === "") return { error: "The API returned an empty response" };
  return { raw };
}

/* One retry, with the specific field errors appended, then the raw output is
   surfaced for manual repair. Never a silent failure and never an endless
   loop: a model that got the limits wrong twice will not get them right on the
   fifth attempt, and each attempt costs. */
export async function generateSpec(
  request: GenerateRequest,
): Promise<GenerateResult> {
  const systemPrompt = await readPrompt();
  const promptHash = promptHashOf(systemPrompt);

  const first = await callOnce(request, systemPrompt, null);
  if ("error" in first) return { ok: false, error: first.error, raw: null };

  const parsed = parseSpec(first.raw);
  if (parsed.ok) {
    return { ok: true, spec: parsed.spec, promptHash, raw: first.raw };
  }

  const second = await callOnce(request, systemPrompt, parsed.error);
  if ("error" in second) {
    return { ok: false, error: second.error, raw: first.raw };
  }

  const retried = parseSpec(second.raw);
  if (retried.ok) {
    return { ok: true, spec: retried.spec, promptHash, raw: second.raw };
  }

  return {
    ok: false,
    error: `The model could not produce a valid spec. ${retried.error}`,
    raw: second.raw,
  };
}
