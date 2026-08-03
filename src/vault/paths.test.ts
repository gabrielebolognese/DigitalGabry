import { describe, expect, it } from "vitest";
import {
  assetRelativePath,
  extensionForMime,
  hexOf,
  isSupportedImage,
  outboxFileName,
  slugify,
  splitRelativePath,
} from "./paths";

describe("vault paths", () => {
  it("shards on the first two hex characters and names the file after the hash", () => {
    const sha = "ab".repeat(32);
    expect(assetRelativePath("x", sha, "image/png")).toBe(`assets/x/ab/${sha}.png`);
  });

  it("is relative, never absolute, per invariant 11", () => {
    const path = assetRelativePath("linkedin", "cd".repeat(32), "image/jpeg");
    expect(path.startsWith("/")).toBe(false);
    expect(path).not.toMatch(/^[A-Za-z]:/);
  });

  it("knows the image types the vault stores", () => {
    expect(extensionForMime("image/png")).toBe("png");
    expect(extensionForMime("image/jpeg")).toBe("jpg");
    expect(extensionForMime("IMAGE/PNG")).toBe("png");
    expect(extensionForMime("image/png; charset=binary")).toBe("png");
    expect(isSupportedImage("application/pdf")).toBe(false);
    expect(isSupportedImage("image/webp")).toBe(true);
  });

  it("splits a relative path into the parts the write command wants", () => {
    expect(splitRelativePath("assets/x/ab/cd.png")).toEqual({
      dir: "assets/x/ab",
      name: "cd.png",
    });
    expect(splitRelativePath("loose.png")).toEqual({ dir: "", name: "loose.png" });
  });

  it("makes outbox names readable, because a person drags them out of a folder", () => {
    expect(outboxFileName("2026-08-03", "Ship the renderer!", "png")).toBe(
      "2026-08-03-ship-the-renderer.png",
    );
  });

  it("never produces an empty slug", () => {
    expect(slugify("")).toBe("untitled");
    expect(slugify("!!!")).toBe("untitled");
    expect(slugify("   ")).toBe("untitled");
  });

  it("does not leave a trailing dash when it truncates", () => {
    const slug = slugify("a".repeat(40) + " " + "b".repeat(40));
    expect(slug.endsWith("-")).toBe(false);
    expect(slug.length).toBeLessThanOrEqual(48);
  });

  it("hashes to lowercase hex, since the unique index compares the string", () => {
    const bytes = new Uint8Array([0, 15, 16, 255]).buffer;
    expect(hexOf(bytes)).toBe("000f10ff");
  });
});
