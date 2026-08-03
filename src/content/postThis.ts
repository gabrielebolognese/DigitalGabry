import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { writeText, writeImage } from "@tauri-apps/plugin-clipboard-manager";
import { X_COMPOSER_URL } from "../domain/xPost";

/* Spec2 3.5: the same export as X. LinkedIn has no compose deep link, so this
   is the feed, where the composer is one click away. */
export const LINKEDIN_FEED_URL = "https://www.linkedin.com/feed/";
import { localDateOf } from "../domain/time";
import type { Asset, ContentItem } from "../domain/content";
import { outboxFileName, joinPath } from "../vault/paths";
import { outboxDir, pruneOutbox, resolveAssetPath } from "../vault/vault";

/* Spec2 section 2.4, in exactly the order the specification fixes. The order
   matters: the text has to be on the clipboard before the browser opens, or
   the user arrives at an empty composer and has to come back.

   Deliberately not the X API. Spec2 2.4 rules it out for v1: the write
   endpoints are paid and rate limited, and the auth flow is real complexity
   for a feature whose whole job is to save one drag. */

export type PostThisResult = {
  outboxPath: string | null;
  imageStaged: boolean;
  prunedOlderFiles: number;
};

export type PostThisRequest = {
  item: ContentItem;
  asset: Asset | null;
  nowUtc: number;
  tz: string;
};

function composerFor(platform: string): string {
  return platform === "linkedin" ? LINKEDIN_FEED_URL : X_COMPOSER_URL;
}

export async function postThis(request: PostThisRequest): Promise<PostThisResult> {
  const { item, asset, nowUtc, tz } = request;

  // 1. The text, first, so the composer is never reached before it is ready.
  await writeText(item.body === "" ? item.title : item.body);

  let outboxPath: string | null = null;
  let pruned = 0;

  if (asset !== null) {
    /* 2. Staged under a name a human can find in a file manager, not the
       content hash the vault stores it under. */
    const dir = await outboxDir();
    await invoke("ensure_dir", { path: dir });

    const extension = asset.path.slice(asset.path.lastIndexOf(".") + 1);
    const name = outboxFileName(localDateOf(nowUtc, tz), item.title, extension);

    await invoke("copy_file", {
      from: await resolveAssetPath(asset),
      toDir: dir,
      toName: name,
    });
    outboxPath = joinPath(dir, name);

    // Cleared on each run, so the outbox does not become an archive.
    pruned = await pruneOutbox();

    // 3. Revealed and selected, ready to drag.
    await invoke("reveal_path", { path: outboxPath });
  }

  // 4. The composer.
  await openUrl(composerFor(item.platform));

  return { outboxPath, imageStaged: asset !== null, prunedOlderFiles: pruned };
}

/* The toast's other path. Both have to exist, because the clipboard cannot
   usefully serve text and an image to the same paste: taking the image means
   giving up the text, so the choice is the user's rather than ours. */
export async function copyImageInstead(asset: Asset): Promise<void> {
  await writeImage(await resolveAssetPath(asset));
}

/* Spec2 4.4. Instagram has no useful web composer, so the flow differs: the
   script goes to a file and to the clipboard, and the folder is revealed.
   How it reaches the phone, by cloud folder, cable or message, is deliberately
   outside the app's scope. */
export async function sendToPhone(
  item: ContentItem,
  scriptText: string,
  nowUtc: number,
  tz: string,
): Promise<string> {
  const dir = await outboxDir();
  await invoke("ensure_dir", { path: dir });

  const name = outboxFileName(localDateOf(nowUtc, tz), item.title, "txt");
  await invoke("write_text_file", { dir, name, contents: scriptText });

  await writeText(scriptText);
  await invoke("reveal_path", { path: joinPath(dir, name) });

  return joinPath(dir, name);
}
