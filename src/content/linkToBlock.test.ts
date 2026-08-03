import { beforeEach, describe, expect, it, vi } from "vitest";
import { newBlock, type Block } from "../domain/block";
import { newContentItem, type ContentItem } from "../domain/content";

/* The acceptance criterion this covers is invariant 16: momentum is logged
   exactly once per publication. Completing a post block already logged it from
   phase 7, so the risk is a second write on the content side. These tests hold
   the fake activity log to one row and fail loudly if anything writes twice. */

const blocks = new Map<string, Block>();
const items = new Map<string, ContentItem>();
let activityRows: { blockId: string; typeName: string }[] = [];

vi.mock("../db/repository", () => ({
  getBlock: async (id: string) => blocks.get(id) ?? null,
  insertBlock: async (block: Block) => {
    blocks.set(block.id, block);
  },
  updateBlock: async (id: string, patch: Partial<Block>) => {
    const current = blocks.get(id);
    if (current !== undefined) blocks.set(id, { ...current, ...patch });
  },
  getContentItem: async (id: string) => items.get(id) ?? null,
  updateContentItem: async (id: string, patch: Partial<ContentItem>) => {
    const current = items.get(id);
    if (current !== undefined) items.set(id, { ...current, ...patch });
  },
  contentItemForBlock: async (blockId: string) =>
    [...items.values()].find((item) => item.blockId === blockId) ?? null,

  /* Stands in for the real one, which inserts when a post block is done and
     soft-deletes when it is not. Idempotent in exactly the same way. */
  syncBlockActivity: async (blockId: string) => {
    const block = blocks.get(blockId);
    if (block === undefined) return false;
    const shouldLog = block.kind === "post" && block.status === "done";
    const existing = activityRows.filter((row) => row.blockId === blockId);

    if (!shouldLog) {
      activityRows = activityRows.filter((row) => row.blockId !== blockId);
      return existing.length > 0;
    }
    if (existing.length > 0) return false;
    activityRows.push({
      blockId,
      typeName: block.payload.activityTypeName ?? "unknown",
    });
    return true;
  },
}));

const { markPosted, revertPosted, scheduleItem, syncItemFromBlock } = await import(
  "./linkToBlock"
);

const NOW = Date.parse("2026-08-03T10:00:00Z");

function seedItem(overrides: Partial<ContentItem> = {}): ContentItem {
  const item = {
    ...newContentItem({ id: "item-1", platform: "x", nowUtc: NOW }),
    status: "ready" as const,
    ...overrides,
  };
  items.set(item.id, item);
  return item;
}

describe("scheduleItem", () => {
  beforeEach(() => {
    blocks.clear();
    items.clear();
    activityRows = [];
  });

  it("links both directions and moves the item to scheduled", async () => {
    const item = seedItem();
    const block = await scheduleItem({ item, startUtc: NOW, nowUtc: NOW });

    expect(items.get(item.id)?.blockId).toBe(block.id);
    expect(items.get(item.id)?.status).toBe("scheduled");
    expect(block.payload.contentItemId).toBe(item.id);
    expect(block.kind).toBe("post");
  });

  it("resolves the activity type at scheduling, when the format is still known", async () => {
    const reel = seedItem({
      id: "reel",
      platform: "instagram",
      payload: { format: "reel" },
    });
    const story = seedItem({
      id: "story",
      platform: "instagram",
      payload: { format: "story" },
    });

    const reelBlock = await scheduleItem({ item: reel, startUtc: NOW, nowUtc: NOW });
    const storyBlock = await scheduleItem({ item: story, startUtc: NOW, nowUtc: NOW });

    expect(reelBlock.payload.activityTypeName).toBe("Instagram reel");
    expect(storyBlock.payload.activityTypeName).toBe("Instagram story");
  });

  it("moves the existing block rather than creating a second one", async () => {
    const item = seedItem();
    const first = await scheduleItem({ item, startUtc: NOW, nowUtc: NOW });
    const linked = items.get(item.id);
    expect(linked).toBeDefined();

    await scheduleItem({ item: linked as ContentItem, startUtc: NOW + 3_600_000, nowUtc: NOW });

    expect(blocks.size).toBe(1);
    expect(blocks.get(first.id)?.startUtc).toBe(NOW + 3_600_000);
  });
});

describe("marking posted", () => {
  beforeEach(() => {
    blocks.clear();
    items.clear();
    activityRows = [];
  });

  it("logs exactly one activity row", async () => {
    const item = seedItem();
    await scheduleItem({ item, startUtc: NOW, nowUtc: NOW });
    await markPosted(item.id, { nowUtc: NOW });

    expect(activityRows).toHaveLength(1);
    expect(items.get(item.id)?.status).toBe("posted");
  });

  it("still logs one row when the item was never scheduled", async () => {
    const item = seedItem();
    await markPosted(item.id, { nowUtc: NOW });

    expect(activityRows).toHaveLength(1);
    expect(items.get(item.id)?.blockId).not.toBeNull();
  });

  it("marking posted twice does not log twice", async () => {
    const item = seedItem();
    await markPosted(item.id, { nowUtc: NOW });
    await markPosted(item.id, { nowUtc: NOW + 1000 });

    expect(activityRows).toHaveLength(1);
  });

  it("logs against the type the item resolved, not the platform default", async () => {
    const item = seedItem({ platform: "instagram", payload: { format: "story" } });
    await markPosted(item.id, { nowUtc: NOW });

    expect(activityRows[0]?.typeName).toBe("Instagram story");
  });

  it("reverting removes the row and leaves nothing behind", async () => {
    const item = seedItem();
    await markPosted(item.id, { nowUtc: NOW });
    expect(activityRows).toHaveLength(1);

    await revertPosted(item.id);

    expect(activityRows).toHaveLength(0);
    expect(items.get(item.id)?.status).not.toBe("posted");
    expect(items.get(item.id)?.postedUtc).toBeNull();
  });

  it("posting again after a revert logs one row, not two", async () => {
    const item = seedItem();
    await markPosted(item.id, { nowUtc: NOW });
    await revertPosted(item.id);
    await markPosted(item.id, { nowUtc: NOW + 5000 });

    expect(activityRows).toHaveLength(1);
  });
});

describe("syncItemFromBlock", () => {
  beforeEach(() => {
    blocks.clear();
    items.clear();
    activityRows = [];
  });

  it("completing the block on the calendar marks the item posted", async () => {
    const item = seedItem();
    const block = await scheduleItem({ item, startUtc: NOW, nowUtc: NOW });

    blocks.set(block.id, { ...block, status: "done", completedUtc: NOW });
    const changed = await syncItemFromBlock(block.id, NOW);

    expect(changed).toBe(true);
    expect(items.get(item.id)?.status).toBe("posted");
  });

  it("un-completing it takes the item back to scheduled", async () => {
    const item = seedItem();
    const block = await scheduleItem({ item, startUtc: NOW, nowUtc: NOW });
    await markPosted(item.id, { nowUtc: NOW });

    blocks.set(block.id, { ...block, status: "open", completedUtc: null });
    await syncItemFromBlock(block.id, NOW);

    expect(items.get(item.id)?.status).toBe("scheduled");
  });

  it("does nothing for a block with no item behind it", async () => {
    const loose = newBlock({
      id: "loose",
      startUtc: NOW,
      endUtc: NOW + 1000,
      tz: "Europe/Rome",
      nowUtc: NOW,
    });
    blocks.set(loose.id, loose);

    expect(await syncItemFromBlock(loose.id, NOW)).toBe(false);
  });
});
