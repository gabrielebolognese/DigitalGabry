export type BlockKind = "task" | "post" | "event" | "focus" | "deadline" | "note";

export type BlockStatus = "open" | "in_progress" | "done" | "cancelled";

export type BlockCategory =
  | "build"
  | "content"
  | "admin"
  | "personal"
  | "deadline";

export type Platform =
  | "x"
  | "linkedin"
  | "youtube"
  | "instagram"
  | "tiktok"
  | "github"
  | "blog";

export type BlockPayload = {
  platform?: Platform;
  url?: string;
  assetPath?: string;
  publishState?: string;
  /* SPEC 6.1 describes payload as holding "kind specific fields such as ...",
     so it is extensible by design. These four are added in phase 6. */
  priority?: "low" | "normal" | "high";
  reminderMinutes?: number;
  splitFromId?: string;
  splitAtUtc?: number;
  /* Phase 11. Set when a block was created by scheduling a content item, so
     completing it logs against the type Spec2 section 6 names rather than the
     platform heuristic, which cannot tell an Instagram reel from a story. */
  activityTypeName?: string;
  contentItemId?: string;
};

/* 0 none, 1 override, 2 cancellation on the is_exception column. A cancelled
   occurrence is a row rather than a deletion, which is what lets undo restore
   it by tombstoning the marker. */
export type ExceptionRole = "none" | "override" | "cancelled";

export type Block = {
  id: string;
  kind: BlockKind;
  title: string;
  description: string | null;
  startUtc: number | null;
  endUtc: number | null;
  tz: string;
  allDay: boolean;
  status: BlockStatus;
  category: BlockCategory;
  projectId: string | null;
  tags: string[];
  rrule: string | null;
  recurrenceParentId: string | null;
  exceptionRole: ExceptionRole;
  recurrenceOriginalStartUtc: number | null;
  payload: BlockPayload;
  sortOrder: number;
  createdUtc: number;
  updatedUtc: number;
  completedUtc: number | null;
  deletedUtc: number | null;
};

export type ScheduledBlock = Block & { startUtc: number; endUtc: number };

/* What the calendar actually renders. Every instance of a series shares its
   parent's id, so the id cannot double as the entry identity: a cache keyed by
   it would collapse a daily rule into a single entry, and a React key built
   from it would repeat. entryId identifies the instance, id still points at the
   row a mutation has to touch. */
export type CalendarEntry = Block & {
  readonly entryId: string;
  readonly occurrenceStartUtc: number | null;
};

export function isRecurringSeed(block: Block): boolean {
  return block.rrule !== null && block.rrule !== "";
}

/* A block with no start time is unscheduled and belongs to the backlog, so the
   calendar has to narrow before it can position anything. Generic, so
   narrowing a CalendarEntry does not throw away its entryId. */
export function isScheduled<T extends Block>(
  block: T,
): block is T & { startUtc: number; endUtc: number } {
  return block.startUtc !== null && block.endUtc !== null;
}

export function isCompleted(block: Block): boolean {
  return block.status === "done";
}

export function isOverdue(block: Block, nowUtc: number): boolean {
  return !isCompleted(block) && block.endUtc !== null && block.endUtc < nowUtc;
}

export const DEFAULT_CATEGORY: Record<BlockKind, BlockCategory> = {
  task: "build",
  post: "content",
  event: "admin",
  focus: "build",
  deadline: "deadline",
  note: "personal",
};

export const BLOCK_KINDS: readonly BlockKind[] = [
  "task",
  "post",
  "event",
  "focus",
  "deadline",
  "note",
];

export const BLOCK_STATUSES: readonly BlockStatus[] = [
  "open",
  "in_progress",
  "done",
  "cancelled",
];

export const BLOCK_CATEGORIES: readonly BlockCategory[] = [
  "build",
  "content",
  "admin",
  "personal",
  "deadline",
];

export const PLATFORMS: readonly Platform[] = [
  "x",
  "linkedin",
  "youtube",
  "instagram",
  "tiktok",
  "github",
  "blog",
];

export type NewBlockInput = {
  id: string;
  startUtc: number;
  endUtc: number;
  tz: string;
  nowUtc: number;
  kind?: BlockKind;
  title?: string;
};

/* The id is supplied rather than generated here, because domain stays free of
   the crypto and platform concerns that id generation drags in. */
export function newBlock(input: NewBlockInput): ScheduledBlock {
  const kind = input.kind ?? "task";

  return {
    id: input.id,
    kind,
    title: input.title ?? "",
    description: null,
    startUtc: input.startUtc,
    endUtc: input.endUtc,
    tz: input.tz,
    allDay: false,
    status: "open",
    category: DEFAULT_CATEGORY[kind],
    projectId: null,
    tags: [],
    rrule: null,
    recurrenceParentId: null,
    exceptionRole: "none",
    recurrenceOriginalStartUtc: null,
    payload: {},
    sortOrder: 0,
    createdUtc: input.nowUtc,
    updatedUtc: input.nowUtc,
    completedUtc: null,
    deletedUtc: null,
  };
}
