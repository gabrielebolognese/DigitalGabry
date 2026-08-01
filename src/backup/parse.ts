import {
  BLOCK_CATEGORIES,
  BLOCK_KINDS,
  BLOCK_STATUSES,
  type BlockCategory,
  type BlockKind,
  type BlockStatus,
} from "../domain/block";
import { utcFromWallClock } from "../domain/time";

/* Import is one directional and explicitly not sync. SPEC 11 is clear that
   Markdown is never read back as a source of truth; this exists to bring
   outside data in once, not to round trip.

   Nothing here throws. A malformed line becomes a reported error and the rest
   of the file still imports, so one bad row cannot take the whole file, or the
   existing database, down with it. */

export type ImportDraft = {
  title: string;
  kind: BlockKind;
  category: BlockCategory;
  status: BlockStatus;
  startUtc: number | null;
  endUtc: number | null;
  description: string | null;
  tags: string[];
};

export type ImportIssue = {
  line: number;
  reason: string;
};

export type ImportResult = {
  drafts: ImportDraft[];
  errors: ImportIssue[];
};

function oneOf<T extends string>(
  allowed: readonly string[],
  value: string,
  fallback: T,
): T {
  const lower = value.trim().toLowerCase();
  return allowed.includes(lower) ? (lower as T) : fallback;
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const CLOCK = /^(\d{1,2}):(\d{2})$/;

function atLocal(
  date: string,
  clock: string,
  tz: string,
): number | null {
  const dateMatch = DATE.exec(date.trim());
  const clockMatch = CLOCK.exec(clock.trim());
  if (dateMatch === null || clockMatch === null) return null;

  const hour = Number(clockMatch[1]);
  const minute = Number(clockMatch[2]);
  if (hour > 23 || minute > 59) return null;

  return utcFromWallClock(
    {
      year: Number(dateMatch[1]),
      month: Number(dateMatch[2]),
      day: Number(dateMatch[3]),
      hour,
      minute,
      second: 0,
    },
    tz,
  );
}

/* Parses the shape monthMarkdown writes. */
export function parseMarkdownExport(text: string, tz: string): ImportResult {
  const drafts: ImportDraft[] = [];
  const errors: ImportIssue[] = [];
  let day: string | null = null;

  const lines = text.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    const line = raw.trim();
    const lineNumber = index + 1;

    if (line.startsWith("## ")) {
      const candidate = line.slice(3).trim().split(/\s+/)[0] ?? "";
      day = DATE.test(candidate) ? candidate : null;
      if (day === null) errors.push({ line: lineNumber, reason: "Unreadable date heading" });
      continue;
    }

    if (line.startsWith("> ")) {
      const last = drafts[drafts.length - 1];
      if (last !== undefined) last.description = line.slice(2).trim();
      continue;
    }

    if (!line.startsWith("- ")) continue;

    if (day === null) {
      errors.push({ line: lineNumber, reason: "Block before any date heading" });
      continue;
    }

    const fields = line
      .slice(2)
      .split("|")
      .map((field) => field.trim());

    if (fields.length < 5) {
      errors.push({ line: lineNumber, reason: "Expected time, kind, category, status, title" });
      continue;
    }

    const [time, kind, category, status, ...rest] = fields;
    const [from, to] = time.split("-").map((part) => part.trim());
    const startUtc = atLocal(day, from ?? "", tz);
    const endUtc = atLocal(day, to ?? "", tz);

    if (startUtc === null || endUtc === null) {
      errors.push({ line: lineNumber, reason: `Unreadable time range "${time}"` });
      continue;
    }

    const titleField = rest.join(" | ").trim();
    const tags = [...titleField.matchAll(/#([^\s#]+)/g)].map((match) => match[1]);
    const title = titleField.replace(/#[^\s#]+/g, "").trim();

    if (title === "") {
      errors.push({ line: lineNumber, reason: "Missing title" });
      continue;
    }

    drafts.push({
      title,
      kind: oneOf<BlockKind>(BLOCK_KINDS, kind, "task"),
      category: oneOf<BlockCategory>(BLOCK_CATEGORIES, category, "build"),
      status: oneOf<BlockStatus>(BLOCK_STATUSES, status, "open"),
      startUtc,
      endUtc,
      description: null,
      tags,
    });
  }

  return { drafts, errors };
}

/* Minimal RFC-4180 style splitter: quoted fields, doubled quotes inside. */
function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quoted) {
      if (char === '"') {
        if (line[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ",") {
      fields.push(field);
      field = "";
    } else field += char;
  }

  fields.push(field);
  return fields.map((value) => value.trim());
}

/* Columns are matched by header name, so column order does not matter.
   `start` and `end` accept "YYYY-MM-DD HH:mm" or the ISO "T" separator. */
export function parseCsv(text: string, tz: string): ImportResult {
  const drafts: ImportDraft[] = [];
  const errors: ImportIssue[] = [];

  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
  if (lines.length === 0) return { drafts, errors };

  const header = splitCsvLine(lines[0]).map((name) => name.toLowerCase());
  const column = (name: string): number => header.indexOf(name);

  const titleAt = column("title");
  const startAt = column("start");
  const endAt = column("end");

  if (titleAt === -1) {
    errors.push({ line: 1, reason: "Missing a title column" });
    return { drafts, errors };
  }

  for (let index = 1; index < lines.length; index += 1) {
    const fields = splitCsvLine(lines[index]);
    const lineNumber = index + 1;
    const title = (fields[titleAt] ?? "").trim();

    if (title === "") {
      errors.push({ line: lineNumber, reason: "Missing title" });
      continue;
    }

    const readStamp = (value: string | undefined): number | null => {
      if (value === undefined || value.trim() === "") return null;
      const [date, clock] = value.trim().split(/[T ]/);
      return atLocal(date ?? "", clock ?? "00:00", tz);
    };

    const startUtc = startAt === -1 ? null : readStamp(fields[startAt]);
    const endUtc = endAt === -1 ? null : readStamp(fields[endAt]);

    if (startAt !== -1 && (fields[startAt] ?? "").trim() !== "" && startUtc === null) {
      errors.push({ line: lineNumber, reason: "Unreadable start" });
      continue;
    }

    drafts.push({
      title,
      kind: oneOf<BlockKind>(BLOCK_KINDS, fields[column("kind")] ?? "", "task"),
      category: oneOf<BlockCategory>(BLOCK_CATEGORIES, fields[column("category")] ?? "", "build"),
      status: oneOf<BlockStatus>(BLOCK_STATUSES, fields[column("status")] ?? "", "open"),
      startUtc,
      // A start with no end gets an hour, so the block is renderable.
      endUtc: endUtc ?? (startUtc === null ? null : startUtc + 60 * 60 * 1000),
      description: null,
      tags: [],
    });
  }

  return { drafts, errors };
}

export function parseImport(
  text: string,
  fileName: string,
  tz: string,
): ImportResult {
  return fileName.toLowerCase().endsWith(".csv")
    ? parseCsv(text, tz)
    : parseMarkdownExport(text, tz);
}
