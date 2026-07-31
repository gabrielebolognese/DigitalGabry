import { describe, expect, it } from "vitest";
import { createUuidV7, timestampOf } from "./id";

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("uuidv7", () => {
  it("produces a well formed version 7 uuid", () => {
    const uuidv7 = createUuidV7();
    for (let index = 0; index < 100; index += 1) {
      expect(uuidv7()).toMatch(UUID_V7);
    }
  });

  it("embeds the millisecond timestamp in the leading 48 bits", () => {
    const uuidv7 = createUuidV7();
    const stamp = 1_774_000_000_000;
    expect(timestampOf(uuidv7(stamp))).toBe(stamp);
  });

  it("sorts lexicographically in issue order", () => {
    const uuidv7 = createUuidV7();
    const ids = [
      uuidv7(1_000),
      uuidv7(2_000),
      uuidv7(3_000),
      uuidv7(1_000_000),
    ];
    expect([...ids].sort()).toEqual(ids);
  });

  it("stays strictly increasing inside one millisecond", () => {
    const uuidv7 = createUuidV7();
    const ids = Array.from({ length: 500 }, () => uuidv7(1_774_000_000_000));
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("stays strictly increasing when the clock moves backwards", () => {
    const uuidv7 = createUuidV7();
    const before = uuidv7(2_000);
    const after = uuidv7(1_000);
    expect(after > before).toBe(true);
  });

  it("does not collide across many calls", () => {
    const uuidv7 = createUuidV7();
    const ids = new Set(Array.from({ length: 10_000 }, () => uuidv7()));
    expect(ids.size).toBe(10_000);
  });
});
