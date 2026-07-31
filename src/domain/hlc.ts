export type Hlc = string;

export type HlcParts = {
  wallMs: number;
  counter: number;
  deviceId: string;
};

/* SPEC 6.4 gives the shape {wallMs}:{counter}:{deviceId} but no widths. Both
   numbers are zero padded here so that plain string comparison, which is what
   SQLite does on the hlc column and its index, orders clocks correctly. */
const WALL_DIGITS = 15;
const COUNTER_DIGITS = 5;

export function formatHlc(wallMs: number, counter: number, deviceId: string): Hlc {
  const wall = String(wallMs).padStart(WALL_DIGITS, "0");
  const count = String(counter).padStart(COUNTER_DIGITS, "0");
  return `${wall}:${count}:${deviceId}`;
}

export function parseHlc(value: Hlc): HlcParts | null {
  const separator = value.indexOf(":");
  if (separator < 0) return null;
  const second = value.indexOf(":", separator + 1);
  if (second < 0) return null;

  const wallMs = Number.parseInt(value.slice(0, separator), 10);
  const counter = Number.parseInt(value.slice(separator + 1, second), 10);
  const deviceId = value.slice(second + 1);

  if (!Number.isFinite(wallMs) || !Number.isFinite(counter) || deviceId === "") {
    return null;
  }
  return { wallMs, counter, deviceId };
}

export type HlcClock = {
  next: () => Hlc;
  observe: (remote: Hlc) => void;
  peek: () => HlcParts;
};

/* A hybrid logical clock never moves backwards, even when the system clock
   does. Without that, an ntp correction or a manual clock change would let a
   later edit carry an earlier stamp and lose to the edit it supersedes. */
export function createHlcClock(
  deviceId: string,
  now: () => number = Date.now,
): HlcClock {
  let wallMs = 0;
  let counter = 0;

  return {
    next(): Hlc {
      const observed = now();
      if (observed > wallMs) {
        wallMs = observed;
        counter = 0;
      } else {
        counter += 1;
      }
      return formatHlc(wallMs, counter, deviceId);
    },

    observe(remote: Hlc): void {
      const parsed = parseHlc(remote);
      if (parsed === null) return;

      const observed = now();
      const highest = Math.max(wallMs, parsed.wallMs, observed);

      if (highest === wallMs && highest === parsed.wallMs) {
        counter = Math.max(counter, parsed.counter) + 1;
      } else if (highest === wallMs) {
        counter += 1;
      } else if (highest === parsed.wallMs) {
        counter = parsed.counter + 1;
      } else {
        counter = 0;
      }
      wallMs = highest;
    },

    peek(): HlcParts {
      return { wallMs, counter, deviceId };
    },
  };
}
