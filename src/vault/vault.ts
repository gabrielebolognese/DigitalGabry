import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { appDataDir } from "@tauri-apps/api/path";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { uuidv7 } from "../domain/id";
import type { Asset, AssetOrigin } from "../domain/content";
import { assetBySha, insertAsset } from "../db/repository";
import {
  OUTBOX_FOLDER,
  VAULT_FOLDER,
  assetRelativePath,
  hexOf,
  isSupportedImage,
  joinPath,
  splitRelativePath,
  type AssetFolder,
} from "./paths";

/* The IO half of the vault. The arithmetic is in paths.ts and is tested there;
   this file only moves bytes and rows. */

let cachedRoot: string | null = null;

export async function vaultRoot(): Promise<string> {
  if (cachedRoot === null) {
    cachedRoot = joinPath(await appDataDir(), VAULT_FOLDER);
  }
  return cachedRoot;
}

export async function outboxDir(): Promise<string> {
  return joinPath(await vaultRoot(), OUTBOX_FOLDER);
}

/* sha256 through WebCrypto rather than a package or a Rust crate. Import is
   already asynchronous, so the async digest costs nothing here. The pure
   generation engine could not use this, but the vault is not the engine. */
async function sha256Of(bytes: Uint8Array): Promise<string> {
  // A fresh buffer, because a Uint8Array view may be a window onto a larger
  // one and digesting the whole backing store would hash the wrong bytes.
  const copy = new Uint8Array(bytes);
  return hexOf(await crypto.subtle.digest("SHA-256", copy));
}

/* Reads intrinsic dimensions in the webview. createImageBitmap decodes without
   attaching anything to the document, so nothing flashes on screen. */
async function dimensionsOf(
  bytes: Uint8Array,
  mime: string,
): Promise<{ width: number | null; height: number | null }> {
  try {
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: mime }));
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    // An SVG or a format the webview will not decode still deserves a row.
    return { width: null, height: null };
  }
}

export type ImportRequest = {
  bytes: Uint8Array;
  mime: string;
  folder: AssetFolder;
  origin?: AssetOrigin;
  nowUtc: number;
};

export type ImportResult = {
  asset: Asset;
  /* False when the bytes were already in the vault. The caller uses this to
     report "already imported" rather than claiming it copied something. */
  created: boolean;
};

/* Hash first, look up second, copy only if new. Doing it in this order is what
   makes a second import of the same bytes a no-op rather than a duplicate row
   with a duplicate file beside it. */
export async function importAsset(request: ImportRequest): Promise<ImportResult> {
  if (!isSupportedImage(request.mime)) {
    throw new Error(`${request.mime} is not an image the vault can store`);
  }

  const sha256 = await sha256Of(request.bytes);
  const existing = await assetBySha(sha256);
  if (existing !== null) return { asset: existing, created: false };

  const relative = assetRelativePath(request.folder, sha256, request.mime);
  const { dir, name } = splitRelativePath(relative);
  const root = await vaultRoot();

  await invoke("write_binary_file", {
    dir: joinPath(root, dir),
    name,
    bytes: Array.from(request.bytes),
  });

  const { width, height } = await dimensionsOf(request.bytes, request.mime);

  const asset: Asset = {
    id: uuidv7(),
    path: relative,
    sha256,
    mime: request.mime,
    width,
    height,
    bytes: request.bytes.byteLength,
    origin: request.origin ?? "import",
    createdUtc: request.nowUtc,
    deletedUtc: null,
  };

  await insertAsset(asset);
  return { asset, created: true };
}

/* The absolute path, resolved at read time from the stored relative one. */
export async function resolveAssetPath(asset: Asset): Promise<string> {
  return joinPath(await vaultRoot(), asset.path);
}

/* What an <img src> can actually load. The asset protocol is scoped to the
   vault in tauri.conf.json. */
export async function resolveAssetUrl(asset: Asset): Promise<string> {
  return convertFileSrc(await resolveAssetPath(asset));
}

export async function revealInOutbox(fileName?: string): Promise<void> {
  const dir = await outboxDir();
  await invoke("ensure_dir", { path: dir });
  await revealItemInDir(fileName === undefined ? dir : joinPath(dir, fileName));
}

const OUTBOX_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export async function pruneOutbox(): Promise<number> {
  return invoke<number>("prune_older_than", {
    dir: await outboxDir(),
    maxAgeMs: OUTBOX_MAX_AGE_MS,
  });
}
