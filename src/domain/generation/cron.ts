/* Five field cron, hand rolled. Spec1.1 section 4.7 wants it for users who
   think in cron; a parser for this is about eighty lines and does not justify
   a dependency, and every library that does it also brings its own timezone
   handling, which would be a second authority disagreeing with domain/time.ts.

   Fields, in order: minute hour day-of-month month day-of-week.
   Supported: * , - / and names for month and weekday. Sunday is 0 and 7.
   Not supported, deliberately: @reboot, @yearly and friends, L, W, #, ?. */

export type CronFields = {
  minutes: ReadonlySet<number>;
  hours: ReadonlySet<number>;
  daysOfMonth: ReadonlySet<number>;
  months: ReadonlySet<number>;
  daysOfWeek: ReadonlySet<number>;
  /* Cron's own quirk: with both day fields restricted, a date matching either
     one matches. With only one restricted, only that one is consulted. */
  domRestricted: boolean;
  dowRestricted: boolean;
};

export type CronParse =
  | { ok: true; fields: CronFields }
  | { ok: false; error: string };

const MONTH_NAMES = [
  "jan", "feb", "mar", "apr", "may", "jun",
  "jul", "aug", "sep", "oct", "nov", "dec",
];

const DAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function nameToNumber(token: string, names: readonly string[], offset: number): number | null {
  const index = names.indexOf(token.toLowerCase());
  return index === -1 ? null : index + offset;
}

function parseField(
  raw: string,
  min: number,
  max: number,
  names: readonly string[] = [],
  nameOffset = 0,
): { values: Set<number>; restricted: boolean } | null {
  const values = new Set<number>();
  const restricted = raw.trim() !== "*";

  for (const part of raw.split(",")) {
    const piece = part.trim();
    if (piece === "") return null;

    const [rangePart, stepPart] = piece.split("/");
    if (rangePart === undefined) return null;

    const step = stepPart === undefined ? 1 : Number(stepPart);
    if (!Number.isInteger(step) || step < 1) return null;

    let from: number;
    let to: number;

    if (rangePart === "*") {
      from = min;
      to = max;
    } else if (rangePart.includes("-")) {
      const [left, right] = rangePart.split("-");
      const start = toNumber(left, names, nameOffset);
      const end = toNumber(right, names, nameOffset);
      if (start === null || end === null) return null;
      from = start;
      to = end;
    } else {
      const single = toNumber(rangePart, names, nameOffset);
      if (single === null) return null;
      from = single;
      /* A bare value with a step means "from here to the end", which is how
         every cron implementation reads 5/10. */
      to = stepPart === undefined ? single : max;
    }

    if (from < min || to > max || to < from) return null;
    for (let value = from; value <= to; value += step) values.add(value);
  }

  return values.size === 0 ? null : { values, restricted };
}

function toNumber(
  token: string | undefined,
  names: readonly string[],
  offset: number,
): number | null {
  if (token === undefined || token === "") return null;
  const named = nameToNumber(token, names, offset);
  if (named !== null) return named;
  const value = Number(token);
  return Number.isInteger(value) ? value : null;
}

export function parseCron(expression: string): CronParse {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) {
    return {
      ok: false,
      error: `Expected five fields, found ${fields.length}`,
    };
  }

  const [minuteRaw, hourRaw, domRaw, monthRaw, dowRaw] = fields as [
    string, string, string, string, string,
  ];

  const minutes = parseField(minuteRaw, 0, 59);
  const hours = parseField(hourRaw, 0, 23);
  const daysOfMonth = parseField(domRaw, 1, 31);
  const months = parseField(monthRaw, 1, 12, MONTH_NAMES, 1);
  const daysOfWeek = parseField(dowRaw, 0, 7, DAY_NAMES, 0);

  if (minutes === null) return { ok: false, error: `Bad minute field: ${minuteRaw}` };
  if (hours === null) return { ok: false, error: `Bad hour field: ${hourRaw}` };
  if (daysOfMonth === null) return { ok: false, error: `Bad day of month field: ${domRaw}` };
  if (months === null) return { ok: false, error: `Bad month field: ${monthRaw}` };
  if (daysOfWeek === null) return { ok: false, error: `Bad day of week field: ${dowRaw}` };

  // Sunday is both 0 and 7; normalise so a lookup never has to know that.
  const dow = new Set(daysOfWeek.values);
  if (dow.has(7)) dow.add(0);

  return {
    ok: true,
    fields: {
      minutes: minutes.values,
      hours: hours.values,
      daysOfMonth: daysOfMonth.values,
      months: months.values,
      daysOfWeek: dow,
      domRestricted: daysOfMonth.restricted,
      dowRestricted: daysOfWeek.restricted,
    },
  };
}

/* Does a local date match the date part of the expression. */
export function cronMatchesDate(fields: CronFields, localDate: string): boolean {
  const [year, month, day] = localDate.split("-").map(Number);
  if (!fields.months.has(month ?? 1)) return false;

  const weekday = new Date(
    Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1),
  ).getUTCDay();

  const domHit = fields.daysOfMonth.has(day ?? 1);
  const dowHit = fields.daysOfWeek.has(weekday);

  /* Both restricted means either may match; this is cron's documented
     behaviour and surprises everyone exactly once. */
  if (fields.domRestricted && fields.dowRestricted) return domHit || dowHit;
  if (fields.domRestricted) return domHit;
  if (fields.dowRestricted) return dowHit;
  return true;
}

/* The minutes past midnight the expression fires at, sorted. */
export function cronMinutesOfDay(fields: CronFields): number[] {
  const out: number[] = [];
  for (const hour of [...fields.hours].sort((a, b) => a - b)) {
    for (const minute of [...fields.minutes].sort((a, b) => a - b)) {
      out.push(hour * 60 + minute);
    }
  }
  return out.sort((left, right) => left - right);
}
