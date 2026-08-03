import type { Platform } from "./block";

/* The four surfaces Spec2 covers. A narrowing of Platform rather than a second
   list, so a content item can never carry a platform a block could not. */
export type ContentPlatform = Extract<
  Platform,
  "x" | "linkedin" | "instagram" | "youtube"
>;

export const CONTENT_PLATFORMS: readonly ContentPlatform[] = [
  "x",
  "linkedin",
  "instagram",
  "youtube",
];

export const PLATFORM_LABELS: Record<ContentPlatform, string> = {
  x: "X",
  linkedin: "LinkedIn",
  instagram: "Instagram",
  youtube: "YouTube",
};

/* Spec2 1.3. One pipeline for every platform; they differ only in which states
   they use, which is why this is one union rather than four. */
export type ContentStatus =
  | "idea"
  | "draft"
  | "ready"
  | "scheduled"
  | "posted"
  | "archived"
  | "scripted"
  | "filmed"
  | "edited";

export const CONTENT_STATUSES: readonly ContentStatus[] = [
  "idea",
  "draft",
  "scripted",
  "filmed",
  "edited",
  "ready",
  "scheduled",
  "posted",
  "archived",
];

const SHARED_STATUSES: readonly ContentStatus[] = [
  "idea",
  "draft",
  "ready",
  "scheduled",
  "posted",
  "archived",
];

/* scripted, filmed and edited are production states, so they exist only where
   something is actually produced before it is published. Spec2 1.3. */
const PRODUCTION_STATUSES: readonly ContentStatus[] = [
  "scripted",
  "filmed",
  "edited",
];

export function statusesFor(platform: ContentPlatform): readonly ContentStatus[] {
  const production =
    platform === "instagram" || platform === "youtube" ? PRODUCTION_STATUSES : [];
  return CONTENT_STATUSES.filter(
    (status) => SHARED_STATUSES.includes(status) || production.includes(status),
  );
}

export const STATUS_LABELS: Record<ContentStatus, string> = {
  idea: "Idea",
  draft: "Draft",
  ready: "Ready",
  scheduled: "Scheduled",
  posted: "Posted",
  archived: "Archived",
  scripted: "Scripted",
  filmed: "Filmed",
  edited: "Edited",
};

/* Chip colour. Spec2 1.3 names only posted and archived, so the rest map onto
   the category palette by how far along the pipeline they are: content while
   being written, build once production has started, admin when finished. */
export type StatusTone = "content" | "build" | "admin" | "personal" | "disabled";

export const STATUS_TONES: Record<ContentStatus, StatusTone> = {
  idea: "personal",
  draft: "content",
  scripted: "build",
  filmed: "build",
  edited: "build",
  ready: "content",
  scheduled: "admin",
  posted: "admin",
  archived: "disabled",
};

/* An item is unfinished when it still needs work, which is what the sub-nav
   count badge means. Spec2 1.2 defines it as idea or draft. */
export function isUnfinished(status: ContentStatus): boolean {
  return status === "idea" || status === "draft";
}

export type ContentPayload = Record<string, unknown>;

export type ContentItem = {
  id: string;
  platform: ContentPlatform;
  status: ContentStatus;
  title: string;
  body: string;
  payload: ContentPayload;
  blockId: string | null;
  projectId: string | null;
  postedUtc: number | null;
  postedUrl: string | null;
  sortOrder: number;
  createdUtc: number;
  updatedUtc: number;
  deletedUtc: number | null;
};

export type AssetOrigin = "import" | "generated" | "capture";

export type Asset = {
  id: string;
  /* Relative to the vault root, never absolute. Invariant 11: moving the vault
     must be one setting rather than a rewrite of every row. */
  path: string;
  sha256: string;
  mime: string;
  width: number | null;
  height: number | null;
  bytes: number;
  origin: AssetOrigin;
  createdUtc: number;
  deletedUtc: number | null;
};

export type AssetRole = "primary" | "variant" | "reference";

export type ContentSort = "updated" | "created" | "scheduled" | "status";

export type ContentFilter = {
  platform: ContentPlatform;
  statuses: readonly ContentStatus[];
  projectId: string | null;
  query: string;
  sort: ContentSort;
};

export type NewContentInput = {
  id: string;
  platform: ContentPlatform;
  status?: ContentStatus;
  title?: string;
  body?: string;
  payload?: ContentPayload;
  projectId?: string | null;
  sortOrder?: number;
  nowUtc: number;
};

export function newContentItem(input: NewContentInput): ContentItem {
  return {
    id: input.id,
    platform: input.platform,
    status: input.status ?? "idea",
    title: input.title ?? "",
    body: input.body ?? "",
    payload: input.payload ?? {},
    blockId: null,
    projectId: input.projectId ?? null,
    postedUtc: null,
    postedUrl: null,
    sortOrder: input.sortOrder ?? 0,
    createdUtc: input.nowUtc,
    updatedUtc: input.nowUtc,
    deletedUtc: null,
  };
}

/* Spec2 section 6. The activity type each publication logs against, by name,
   because ids are seeded per install. Instagram splits on payload.format, and
   YouTube defaults to long form until its specification lands. */
export function activityTypeNameFor(item: ContentItem): string {
  switch (item.platform) {
    case "x":
      return "X post";
    case "linkedin":
      return "LinkedIn post";
    case "youtube":
      return "YouTube long form";
    case "instagram":
      return item.payload["format"] === "story"
        ? "Instagram story"
        : "Instagram reel";
  }
}

/* Sorting is deterministic, so a redraw never reshuffles equal rows. Every
   comparator falls back to id. */
export function compareContent(
  left: ContentItem,
  right: ContentItem,
  sort: ContentSort,
  blockStartOf: (item: ContentItem) => number | null,
): number {
  const tie = (): number => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);

  switch (sort) {
    case "updated":
      return right.updatedUtc - left.updatedUtc || tie();
    case "created":
      return right.createdUtc - left.createdUtc || tie();
    case "status":
      return (
        CONTENT_STATUSES.indexOf(left.status) -
          CONTENT_STATUSES.indexOf(right.status) || tie()
      );
    case "scheduled": {
      const leftAt = blockStartOf(left);
      const rightAt = blockStartOf(right);
      // Unscheduled items sort last rather than first, so the column reads as
      // a timeline of what is coming.
      if (leftAt === null && rightAt === null) return tie();
      if (leftAt === null) return 1;
      if (rightAt === null) return -1;
      return leftAt - rightAt || tie();
    }
  }
}
