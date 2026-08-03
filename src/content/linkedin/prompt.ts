import { invoke } from "@tauri-apps/api/core";
import { appDataDir } from "@tauri-apps/api/path";
import { hashString } from "../../domain/generation/prng";
import { joinPath } from "../../vault/paths";

/* Spec2 3.2. The system prompt lives on disk, seeded on first run from a
   bundled default and editable in Settings.

   Never baked into the build: iterating on a prompt is the main way this
   feature gets better, and needing a rebuild to change a sentence means it
   does not get iterated on. */

export const PROMPT_FOLDER = "prompts";
export const PROMPT_FILE = "linkedin-image.md";

export const DEFAULT_PROMPT = `You turn a LinkedIn post into a specification for an image that will sit beside it.

Return ONLY a JSON object. No prose, no explanation, no markdown fences.

The object has these fields:

- headline: string, required, at most 60 characters. The one thing a reader
  should take away. Not a summary of the post.
- eyebrow: string, optional, at most 24 characters, an uppercase label such as
  "BUILD LOG" or "PERFORMANCE".
- subheadline: string, optional, at most 90 characters.
- bullets: array of at most 4 strings, each at most 48 characters.
- codeSnippet: optional object { language: string, lines: array of at most 8
  strings, each at most 52 characters }.
- metric: optional object { value: string at most 12 characters, label: string
  at most 30 characters }. Use for a single number worth leading with.
- badge: string, optional, at most 16 characters.
- accent: one of "amber", "orange", "neutral".
- layout: one of "headline", "headline-bullets", "code", "metric", "split".

Rules:

- Character limits are hard. Count them. A field one character over is
  rejected and the whole generation is wasted.
- Pick the layout that fits the content, not the one that sounds best. A post
  with a number worth leading with is "metric". A post about code is "code".
  A post with a list is "headline-bullets". When unsure, "headline".
- Only include codeSnippet if the post is genuinely about code.
- Only include metric if there is a real number in the post.
- Write in the voice of the post. Do not add enthusiasm the author did not have.
- No emoji.
`;

export async function promptPath(): Promise<string> {
  return joinPath(await appDataDir(), PROMPT_FOLDER, PROMPT_FILE);
}

/* Seeded on first read rather than at start, so a fresh install does not write
   a file until the feature is actually used. */
export async function readPrompt(): Promise<string> {
  const path = await promptPath();
  try {
    const existing = await invoke<string>("read_text_file", { path });
    if (existing.trim() !== "") return existing;
  } catch {
    // Not there yet, which is the normal first-run case.
  }

  await writePrompt(DEFAULT_PROMPT);
  return DEFAULT_PROMPT;
}

export async function writePrompt(contents: string): Promise<void> {
  const base = await appDataDir();
  await invoke("write_text_file", {
    dir: joinPath(base, PROMPT_FOLDER),
    name: PROMPT_FILE,
    contents,
  });
}

export async function resetPrompt(): Promise<string> {
  await writePrompt(DEFAULT_PROMPT);
  return DEFAULT_PROMPT;
}

/* Stored beside every generated image, so an image can be traced back to the
   exact prompt that produced it even after the prompt has been edited.
   Invariant 14. */
export function promptHashOf(prompt: string): string {
  return hashString(prompt).toString(16);
}
