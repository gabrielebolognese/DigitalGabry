import type {
  Block,
  BlockCategory,
  BlockKind,
  Platform,
  ScheduledBlock,
} from "../domain/block";
import { MINUTES_PER_HOUR, daysOfWeek, type UtcRange } from "../domain/time";

const MS_PER_MINUTE = 60_000;

type Draft = {
  day: number;
  startMin: number;
  durationMin: number;
  kind: BlockKind;
  category: BlockCategory;
  title: string;
  description?: string;
  platform?: Platform;
  done?: boolean;
};

const at = (hour: number, minute = 0): number => hour * MINUTES_PER_HOUR + minute;

/* One week covering every kind, every category, every platform, the three
   density tiers, a two way and a three way overlap, a cluster that overflows
   the three lane cap, and both the completed and overdue states. */
const DRAFTS: readonly Draft[] = [
  // Monday
  { day: 0, startMin: at(8), durationMin: 45, kind: "focus", category: "build", title: "Deep work, renderer pipeline", description: "Finish the tile cache and measure the frame budget before touching anything else." },
  { day: 0, startMin: at(9, 30), durationMin: 15, kind: "task", category: "build", title: "Reply to X mentions" },
  { day: 0, startMin: at(10), durationMin: 180, kind: "focus", category: "build", title: "Occurrence materializer", description: "Rolling 18 month window, rebuild on rrule change, never expand at query time." },
  { day: 0, startMin: at(14), durationMin: 60, kind: "event", category: "admin", title: "School admin call" },
  { day: 0, startMin: at(16, 30), durationMin: 30, kind: "post", category: "content", title: "Ship note thread", platform: "x" },

  // Tuesday, a five way overlap that spills past the lane cap
  { day: 1, startMin: at(9), durationMin: 120, kind: "post", category: "content", title: "Record long form, local first apps", description: "Cover the sync story, the offline guarantees, and why the schema is ready first." , platform: "youtube" },
  { day: 1, startMin: at(9, 30), durationMin: 60, kind: "task", category: "build", title: "Fix render bug" },
  { day: 1, startMin: at(10), durationMin: 45, kind: "post", category: "content", title: "Parenting DAG post", platform: "linkedin" },
  { day: 1, startMin: at(10, 15), durationMin: 30, kind: "task", category: "build", title: "Review PR" },
  { day: 1, startMin: at(10, 30), durationMin: 30, kind: "note", category: "personal", title: "Idea, momentum decay tuning" },
  { day: 1, startMin: at(18), durationMin: 60, kind: "task", category: "personal", title: "Training session" },

  // Wednesday
  { day: 2, startMin: at(8, 30), durationMin: 15, kind: "task", category: "admin", title: "Standup" },
  { day: 2, startMin: at(9), durationMin: 90, kind: "post", category: "content", title: "Reel, desk setup", platform: "instagram" },
  { day: 2, startMin: at(12), durationMin: 60, kind: "event", category: "personal", title: "Lunch with Marco" },
  { day: 2, startMin: at(15), durationMin: 45, kind: "post", category: "content", title: "Short, three tools I keep", platform: "tiktok" },
  { day: 2, startMin: at(17), durationMin: 30, kind: "post", category: "build", title: "Push commits", platform: "github" },

  // Thursday
  { day: 3, startMin: at(9), durationMin: 240, kind: "focus", category: "build", title: "Momentum engine", description: "Pure scoring fold first, unit tests before any pixel of the chart exists." },
  { day: 3, startMin: at(14), durationMin: 60, kind: "post", category: "content", title: "Render Journal article", platform: "blog" },
  { day: 3, startMin: at(16), durationMin: 30, kind: "task", category: "admin", title: "Send invoices", done: true },

  // Friday
  { day: 4, startMin: at(8), durationMin: 30, kind: "task", category: "admin", title: "Inbox to zero", done: true },
  { day: 4, startMin: at(9), durationMin: 60, kind: "post", category: "content", title: "Weekly recap", platform: "linkedin" },
  { day: 4, startMin: at(11), durationMin: 45, kind: "task", category: "personal", title: "Order bike parts" },
  { day: 4, startMin: at(17), durationMin: 30, kind: "deadline", category: "deadline", title: "Tax filing deadline" },

  // Saturday
  { day: 5, startMin: at(10), durationMin: 120, kind: "task", category: "personal", title: "Gym and swim" },
  { day: 5, startMin: at(15), durationMin: 60, kind: "note", category: "personal", title: "Weekly review" },

  // Sunday
  { day: 6, startMin: at(11), durationMin: 180, kind: "focus", category: "build", title: "Ship v0.1", description: "Cut the branch, run the invariant greps, tag it, then stop touching it." },
  { day: 6, startMin: at(19), durationMin: 45, kind: "post", category: "content", title: "Short, what momentum measures", platform: "youtube" },
];

export function createMockBlocks(range: UtcRange, tz: string): Block[] {
  const dayStarts = daysOfWeek(range.start, tz);
  const stamp = range.start;

  return DRAFTS.map((draft, index): ScheduledBlock => {
    const startUtc = dayStarts[draft.day] + draft.startMin * MS_PER_MINUTE;
    const endUtc = startUtc + draft.durationMin * MS_PER_MINUTE;
    const done = draft.done === true;

    return {
      id: `mock-${String(index + 1).padStart(2, "0")}`,
      kind: draft.kind,
      title: draft.title,
      description: draft.description ?? null,
      startUtc,
      endUtc,
      tz,
      allDay: false,
      status: done ? "done" : "open",
      category: draft.category,
      projectId: null,
      payload: draft.platform === undefined ? {} : { platform: draft.platform },
      sortOrder: index,
      createdUtc: stamp,
      updatedUtc: stamp,
      completedUtc: done ? endUtc : null,
      deletedUtc: null,
    };
  }).filter((block) => block.startUtc < range.end && block.endUtc > range.start);
}
