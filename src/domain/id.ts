const UUID_BYTES = 16;

/* rand_a, the 12 bits after the version nibble, is used as a monotonic counter
   rather than randomness. Two ids minted in the same millisecond then still
   sort in issue order, which is the whole reason for choosing v7 over v4. */
const MAX_COUNTER = 0x0fff;

const HEX = Array.from({ length: 256 }, (_, value) =>
  value.toString(16).padStart(2, "0"),
);

function formatUuid(bytes: Uint8Array): string {
  let out = "";
  for (let index = 0; index < UUID_BYTES; index += 1) {
    if (index === 4 || index === 6 || index === 8 || index === 10) out += "-";
    out += HEX[bytes[index]];
  }
  return out;
}

export type UuidV7Generator = (timestampMs?: number) => string;

/* A generator rather than a bare function, so tests can take a fresh clock
   instead of inheriting whatever millisecond the previous test landed on. */
export function createUuidV7(): UuidV7Generator {
  let lastMs = -1;
  let counter = 0;

  return function uuidv7(timestampMs: number = Date.now()): string {
    if (timestampMs > lastMs) {
      lastMs = timestampMs;
      counter = 0;
    } else {
      // The clock stood still or went backwards. Keep issuing ids that sort
      // after the previous one rather than trusting the wall clock.
      counter += 1;
      if (counter > MAX_COUNTER) {
        lastMs += 1;
        counter = 0;
      }
    }

    const bytes = new Uint8Array(UUID_BYTES);
    crypto.getRandomValues(bytes);

    const ms = lastMs;
    bytes[0] = Math.floor(ms / 2 ** 40) & 0xff;
    bytes[1] = Math.floor(ms / 2 ** 32) & 0xff;
    bytes[2] = Math.floor(ms / 2 ** 24) & 0xff;
    bytes[3] = Math.floor(ms / 2 ** 16) & 0xff;
    bytes[4] = Math.floor(ms / 2 ** 8) & 0xff;
    bytes[5] = ms & 0xff;

    bytes[6] = 0x70 | ((counter >> 8) & 0x0f);
    bytes[7] = counter & 0xff;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    return formatUuid(bytes);
  };
}

export const uuidv7: UuidV7Generator = createUuidV7();

export function timestampOf(id: string): number {
  const hex = id.replace(/-/g, "").slice(0, 12);
  return Number.parseInt(hex, 16);
}
