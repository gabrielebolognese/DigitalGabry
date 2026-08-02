/* Subsequence matching for the command palette. Blocks are ranked by SQLite's
   FTS, which tokenises on whole words; commands and views are a short static
   list where typing "gomo" should still reach "Go to momentum". This covers
   the second case, and re-ranks the first. */

export type FuzzyResult = {
  score: number;
  positions: readonly number[];
};

const BOUNDARY = /[\s\-_/:.,]/;

const CONSECUTIVE_BONUS = 3;
const START_BONUS = 4;
const WORD_START_BONUS = 2;
const GAP_PENALTY = 0.2;
const MAX_GAP_PENALTY = 3;
const COVERAGE_WEIGHT = 2;

/* Greedy left to right rather than an optimal alignment. Targets here are a
   command label or a block title, short enough that the leftmost match is the
   one a person means, and greedy keeps this cheap enough to run on every
   keystroke over every block on screen. */
export function fuzzyMatch(query: string, target: string): FuzzyResult | null {
  const needle = query.trim().toLowerCase();
  if (needle === "") return { score: 0, positions: [] };

  const haystack = target.toLowerCase();
  const positions: number[] = [];
  let score = 0;
  let cursor = 0;
  let previous = -2;

  for (const char of needle) {
    // A space in the query separates words rather than standing for a
    // character to find, so "go mo" and "gomo" rank the same target.
    if (char === " ") continue;

    const index = haystack.indexOf(char, cursor);
    if (index === -1) return null;

    let charScore = 1;
    if (index === previous + 1) charScore += CONSECUTIVE_BONUS;
    if (index === 0) charScore += START_BONUS;
    else if (BOUNDARY.test(haystack.charAt(index - 1))) charScore += WORD_START_BONUS;

    const gap = index - (previous + 1);
    charScore -= Math.min(gap, MAX_GAP_PENALTY) * GAP_PENALTY;

    score += charScore;
    positions.push(index);
    previous = index;
    cursor = index + 1;
  }

  /* Without this a long title that happens to contain the letters outranks a
     short label that is almost entirely the query. */
  if (haystack.length > 0) {
    score += (positions.length / haystack.length) * COVERAGE_WEIGHT;
  }

  return { score, positions };
}

/* Sort is stable, so items that score equally keep the order they were
   declared in. That is what leaves the command list in its authored order
   while the query is empty. */
export function fuzzyRank<T>(
  query: string,
  items: readonly T[],
  keyOf: (item: T) => string,
): T[] {
  const scored: { item: T; score: number }[] = [];

  for (const item of items) {
    const match = fuzzyMatch(query, keyOf(item));
    if (match !== null) scored.push({ item, score: match.score });
  }

  scored.sort((left, right) => right.score - left.score);
  return scored.map((entry) => entry.item);
}
