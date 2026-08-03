import { newBlock, type Block } from "../domain/block";
import { activityTypeNameFor, type ContentItem } from "../domain/content";
import { uuidv7 } from "../domain/id";
import { DEFAULT_TZ } from "../domain/time";
import {
  contentItemForBlock,
  getBlock,
  getContentItem,
  insertBlock,
  syncBlockActivity,
  updateBlock,
  updateContentItem,
} from "../db/repository";

/* Spec2 1.1: the item is the artifact, the block is the committed time. They
   link rather than duplicate, per invariant 15.

   There is exactly one place that writes momentum, and it is not here.
   Completing a post block already logs it, from phase 7, so a second insert on
   the item side would double count, which is precisely what invariant 16
   forbids. Everything below drives the block and lets syncBlockActivity be the
   only writer. */

const DEFAULT_DURATION_MS = 10 * 60 * 1000;

export type ScheduleRequest = {
  item: ContentItem;
  startUtc: number;
  endUtc?: number;
  tz?: string;
  nowUtc?: number;
};

/* Creates the post block for an item and links both directions. The activity
   type is resolved now, not at completion, because the item knows whether it is
   a reel or a story and the block will not. */
export async function scheduleItem(request: ScheduleRequest): Promise<Block> {
  const { item, startUtc } = request;
  const tz = request.tz ?? DEFAULT_TZ;
  const endUtc = request.endUtc ?? startUtc + DEFAULT_DURATION_MS;

  const existingId = item.blockId;
  if (existingId !== null) {
    const existing = await getBlock(existingId);
    if (existing !== null) {
      await updateBlock(existingId, { startUtc, endUtc, tz });
      await updateContentItem(item.id, { status: "scheduled" });
      return { ...existing, startUtc, endUtc, tz };
    }
  }

  /* newBlock owns the defaults every block shares, including the category that
     follows from the kind, so the fields it does not take are set after it
     rather than duplicated into its input type. */
  const block: Block = {
    ...newBlock({
      id: uuidv7(),
      kind: "post",
      title: item.title === "" ? "Untitled" : item.title,
      startUtc,
      endUtc,
      tz,
      nowUtc: request.nowUtc ?? startUtc,
    }),
    projectId: item.projectId,
    payload: {
      platform: item.platform,
      activityTypeName: activityTypeNameFor(item),
      contentItemId: item.id,
    },
  };

  await insertBlock(block);
  await updateContentItem(item.id, { blockId: block.id, status: "scheduled" });
  return block;
}

export async function unscheduleItem(itemId: string): Promise<void> {
  const item = await getContentItem(itemId);
  if (item === null || item.blockId === null) return;
  await updateContentItem(itemId, { blockId: null, status: "ready" });
}

/* Marking posted drives the block to done, which is what logs the activity.
   An item posted without ever being scheduled still gets a block, stamped at
   the moment it went out: the calendar is the record of what happened, not only
   of what was planned, and routing through it keeps one logging path. */
export async function markPosted(
  itemId: string,
  options: { nowUtc: number; tz?: string; url?: string | null } ,
): Promise<void> {
  const item = await getContentItem(itemId);
  if (item === null) return;

  const tz = options.tz ?? DEFAULT_TZ;
  let blockId = item.blockId;

  if (blockId === null) {
    const block = await scheduleItem({
      item,
      startUtc: options.nowUtc,
      tz,
      nowUtc: options.nowUtc,
    });
    blockId = block.id;
  }

  await updateBlock(blockId, {
    status: "done",
    completedUtc: options.nowUtc,
  });

  await updateContentItem(itemId, {
    status: "posted",
    postedUtc: options.nowUtc,
    postedUrl: options.url ?? item.postedUrl,
  });

  await syncBlockActivity(blockId, tz);
}

/* Reverting soft-deletes the activity row, so the momentum curve stays honest.
   Spec2 section 6. Driven through the block for the same reason as above. */
export async function revertPosted(
  itemId: string,
  tz: string = DEFAULT_TZ,
): Promise<void> {
  const item = await getContentItem(itemId);
  if (item === null) return;

  if (item.blockId !== null) {
    await updateBlock(item.blockId, { status: "open", completedUtc: null });
    await syncBlockActivity(item.blockId, tz);
  }

  await updateContentItem(itemId, {
    status: item.blockId === null ? "ready" : "scheduled",
    postedUtc: null,
  });
}

/* The other direction: completing the block on the calendar marks the item
   posted, without logging a second time, because syncBlockActivity has already
   run by the time this is called. */
export async function syncItemFromBlock(
  blockId: string,
  nowUtc: number,
): Promise<boolean> {
  const item = await contentItemForBlock(blockId);
  if (item === null) return false;

  const block = await getBlock(blockId);
  if (block === null) return false;

  const done = block.status === "done";
  if (done && item.status !== "posted") {
    await updateContentItem(item.id, {
      status: "posted",
      postedUtc: block.completedUtc ?? nowUtc,
    });
    return true;
  }

  if (!done && item.status === "posted") {
    await updateContentItem(item.id, { status: "scheduled", postedUtc: null });
    return true;
  }

  return false;
}
