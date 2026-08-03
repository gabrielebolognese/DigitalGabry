import type { ContentPlatform } from "../domain/content";

/* Pure path arithmetic for the asset vault, kept apart from the IO in vault.ts
   the same way backup/format.ts is kept apart from backup/run.ts. Nothing here
   touches the disk, so all of it is testable without a running app. */

export const VAULT_FOLDER = "vault";
export const OUTBOX_FOLDER = "outbox";

/* Spec2 1.5 names a folder per platform plus a shared reference folder. */
export type AssetFolder = ContentPlatform | "reference";

const MIME_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
  "image/svg+xml": "svg",
};

export function extensionForMime(mime: string): string {
  return MIME_EXTENSIONS[mime.toLowerCase().split(";")[0]?.trim() ?? ""] ?? "bin";
}

export function isSupportedImage(mime: string): boolean {
  return extensionForMime(mime) !== "bin";
}

/* Content addressed, sharded on the first two hex characters. Sharding keeps
   any one directory small enough that a file manager stays usable, and the
   name being the hash is what makes a second import of the same bytes a no-op.
   Always relative to the vault root: invariant 11 forbids persisting an
   absolute path, so that moving the vault is one setting rather than a rewrite
   of every row. */
export function assetRelativePath(
  folder: AssetFolder,
  sha256: string,
  mime: string,
): string {
  const shard = sha256.slice(0, 2);
  return `assets/${folder}/${shard}/${sha256}.${extensionForMime(mime)}`;
}

/* Splits a relative path back into the directory and file name the write
   command wants, without pulling in a path library. */
export function splitRelativePath(
  relative: string,
): { dir: string; name: string } {
  const cut = relative.lastIndexOf("/");
  return cut === -1
    ? { dir: "", name: relative }
    : { dir: relative.slice(0, cut), name: relative.slice(cut + 1) };
}

export function joinPath(...parts: readonly string[]): string {
  return parts
    .filter((part) => part !== "")
    .map((part) => part.replace(/[\\/]+$/, ""))
    .join("/");
}

/* Readable rather than content addressed, because a human is about to look at
   this in a file manager and drag it into a browser. Spec2 2.4. */
export function outboxFileName(
  localDate: string,
  title: string,
  extension: string,
): string {
  return `${localDate}-${slugify(title)}.${extension}`;
}

export function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/, "");
  return slug === "" ? "untitled" : slug;
}

/* Lowercase hex, because the unique index compares the string and two spellings
   of the same digest would defeat deduplication entirely. */
export function hexOf(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  let hex = "";
  for (const byte of view) hex += byte.toString(16).padStart(2, "0");
  return hex;
}
