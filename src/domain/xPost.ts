/* Spec2 section 2. The rules around an X post's length, kept pure so the card
   and the editor cannot disagree about when a counter turns amber. */

/* The platform maximum. A hard stop: text beyond this cannot be typed, because
   discovering it at paste time on x.com means rewriting the end of a post you
   thought was finished. */
export const HARD_LIMIT = 280;

/* Editable in Settings. Purely a target: it changes the counter's colour and
   nothing else, so a deliberately longer post is never blocked. Spec2 2.2. */
export const DEFAULT_SOFT_LIMIT = 150;

export type CounterStage = "under" | "near" | "over";

/* Under 80 percent of the soft limit is quiet, 80 to 100 is a warning, past it
   is loud. Staged against the soft limit rather than the hard one, since the
   hard one cannot be reached. */
export function counterStage(length: number, softLimit: number): CounterStage {
  if (softLimit <= 0) return "under";
  const ratio = length / softLimit;
  if (ratio < 0.8) return "under";
  if (ratio <= 1) return "near";
  return "over";
}

export const STAGE_CLASS: Record<CounterStage, string> = {
  under: "text-tertiary",
  near: "text-cat-deadline",
  over: "text-cat-build",
};

/* Counts what X counts closely enough to be useful: code points rather than
   UTF-16 units, so an emoji is one character and not two. Exact parity with
   the platform's weighted counting is not attempted, and claiming it would be
   worse than being plainly approximate. */
export function postLength(text: string): number {
  return [...text].length;
}

/* Truncates to the hard limit without splitting a surrogate pair or a combined
   emoji, which slicing by index would. */
export function clampToHardLimit(text: string): string {
  const characters = [...text];
  return characters.length <= HARD_LIMIT
    ? text
    : characters.slice(0, HARD_LIMIT).join("");
}

export function isOverHardLimit(text: string): boolean {
  return postLength(text) > HARD_LIMIT;
}

export type XPayload = {
  charLimit?: number;
  /* Reserved for thread support, unused in v1. Spec2 2.1. */
  threadParentId?: string;
  altText?: string;
};

export function softLimitOf(payload: XPayload, fallback: number): number {
  const limit = payload.charLimit;
  return typeof limit === "number" && limit > 0 ? limit : fallback;
}

/* The composer the "post this" flow opens. Spec2 2.4 is explicit that v1 does
   not post through the API: the write endpoints are paid and rate limited, and
   the auth flow is real complexity for a feature that saves one drag. */
export const X_COMPOSER_URL = "https://x.com/compose/post";
