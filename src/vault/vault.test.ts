import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Asset } from "../domain/content";

/* Covers the deduplication control flow, which is the acceptance criterion for
   the vault: importing the same image twice must produce exactly one row. The
   IO around it is mocked, so what is under test is the ordering that makes the
   guarantee hold, hash first and look up before writing anything. */

const invoke = vi.fn();
const insertAsset = vi.fn();
let stored: Asset | null = null;

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
  convertFileSrc: (path: string) => `asset://${path}`,
}));

vi.mock("@tauri-apps/api/path", () => ({
  appDataDir: async () => "C:/appdata",
  join: async (...parts: string[]) => parts.join("/"),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  revealItemInDir: vi.fn(),
}));

vi.mock("../db/repository", () => ({
  assetBySha: async () => stored,
  insertAsset: async (asset: Asset) => {
    insertAsset(asset);
    stored = asset;
  },
}));

const { importAsset } = await import("./vault");

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);

describe("importAsset", () => {
  beforeEach(() => {
    stored = null;
    invoke.mockReset();
    insertAsset.mockReset();
  });

  it("writes the file and inserts one row the first time", async () => {
    const result = await importAsset({
      bytes: PNG,
      mime: "image/png",
      folder: "x",
      nowUtc: 1000,
    });

    expect(result.created).toBe(true);
    expect(insertAsset).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls[0]?.[0]).toBe("write_binary_file");
  });

  it("importing the same bytes again writes nothing and inserts nothing", async () => {
    const first = await importAsset({
      bytes: PNG,
      mime: "image/png",
      folder: "x",
      nowUtc: 1000,
    });
    invoke.mockReset();
    insertAsset.mockReset();

    const second = await importAsset({
      bytes: PNG,
      mime: "image/png",
      folder: "x",
      nowUtc: 2000,
    });

    expect(second.created).toBe(false);
    expect(second.asset.id).toBe(first.asset.id);
    expect(insertAsset).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("deduplicates across folders, since the hash is the identity", async () => {
    await importAsset({ bytes: PNG, mime: "image/png", folder: "x", nowUtc: 1 });
    const second = await importAsset({
      bytes: PNG,
      mime: "image/png",
      folder: "linkedin",
      nowUtc: 2,
    });
    expect(second.created).toBe(false);
  });

  it("stores a path relative to the vault root, per invariant 11", async () => {
    const { asset } = await importAsset({
      bytes: PNG,
      mime: "image/png",
      folder: "x",
      nowUtc: 1,
    });
    expect(asset.path.startsWith("assets/x/")).toBe(true);
    expect(asset.path).not.toContain("C:/appdata");
  });

  it("refuses a file that is not an image the vault can store", async () => {
    await expect(
      importAsset({
        bytes: PNG,
        mime: "application/pdf",
        folder: "x",
        nowUtc: 1,
      }),
    ).rejects.toThrow(/not an image/);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("records the byte length rather than trusting the caller", async () => {
    const { asset } = await importAsset({
      bytes: PNG,
      mime: "image/png",
      folder: "x",
      nowUtc: 1,
    });
    expect(asset.bytes).toBe(PNG.byteLength);
    expect(asset.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});
