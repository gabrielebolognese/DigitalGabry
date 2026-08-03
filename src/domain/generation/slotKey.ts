/* Slot identity. Spec1.1 section 7 defines this as base58(sha256(...)), which
   PLAN.md corrects: a pure synchronous engine cannot reach WebCrypto, which is
   async and DOM bound, and this key is local identity rather than a security
   boundary. The plain tuple keeps the semantics the specification asks for and
   makes the database and the explainer readable.

   Identity is (generator, local date, ordinal within that day), deliberately
   not the timestamp. Moving a time from 08:00 to 09:00 keeps the slot's
   identity, so a skip applied to it still applies. Keying on the timestamp
   would make the skip evaporate and the slot come back. */

export const KEY_SEPARATOR = "|";

export function slotKeyOf(
  generatorId: string,
  localDate: string,
  ordinal: number,
): string {
  return `${generatorId}${KEY_SEPARATOR}${localDate}${KEY_SEPARATOR}${ordinal}`;
}

/* Derived slots key on the trigger instead, so they stay stable when the thing
   that produced them moves. Spec1.1 section 7. */
export function derivedSlotKeyOf(
  generatorId: string,
  triggerId: string,
  offsetIndex: number,
): string {
  return `${generatorId}${KEY_SEPARATOR}${triggerId}${KEY_SEPARATOR}${offsetIndex}`;
}

export type ParsedSlotKey = {
  generatorId: string;
  localDate: string;
  ordinal: number;
};

/* Parsed from the right. A generator id is a UUIDv7 today and contains no
   separator, but the date and the ordinal never can, so reading backwards
   survives an id that one day does. */
export function parseSlotKey(key: string): ParsedSlotKey | null {
  const lastCut = key.lastIndexOf(KEY_SEPARATOR);
  if (lastCut <= 0) return null;

  const middleCut = key.lastIndexOf(KEY_SEPARATOR, lastCut - 1);
  if (middleCut <= 0) return null;

  const ordinal = Number(key.slice(lastCut + 1));
  if (!Number.isInteger(ordinal) || ordinal < 0) return null;

  const localDate = key.slice(middleCut + 1, lastCut);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate)) return null;

  return { generatorId: key.slice(0, middleCut), localDate, ordinal };
}

/* Which ordinals a rekey migration has to remap. Spec1.1 section 7 requires
   that editing a config which shifts ordinals reports its mapping rather than
   silently misaligning every override after the insertion point. Nearest time
   wins, and each old ordinal maps at most once. */
export function rekeyByNearestTime(
  oldMinutes: readonly number[],
  newMinutes: readonly number[],
): Map<number, number> {
  const mapping = new Map<number, number>();
  const taken = new Set<number>();

  /* Closest pairs first, so a genuine match is never stolen by an earlier
     ordinal that merely had no better option. */
  const pairs: { old: number; next: number; distance: number }[] = [];
  for (const [oldIndex, oldValue] of oldMinutes.entries()) {
    for (const [newIndex, newValue] of newMinutes.entries()) {
      pairs.push({
        old: oldIndex,
        next: newIndex,
        distance: Math.abs(oldValue - newValue),
      });
    }
  }
  pairs.sort(
    (left, right) =>
      left.distance - right.distance || left.old - right.old || left.next - right.next,
  );

  for (const pair of pairs) {
    if (mapping.has(pair.old) || taken.has(pair.next)) continue;
    mapping.set(pair.old, pair.next);
    taken.add(pair.next);
  }

  return mapping;
}
