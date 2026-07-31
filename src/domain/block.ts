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
};

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
  payload: BlockPayload;
  sortOrder: number;
  createdUtc: number;
  updatedUtc: number;
  completedUtc: number | null;
  deletedUtc: number | null;
};

export type ScheduledBlock = Block & { startUtc: number; endUtc: number };

/* A block with no start time is unscheduled and belongs to the backlog, so the
   calendar has to narrow before it can position anything. */
export function isScheduled(block: Block): block is ScheduledBlock {
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
