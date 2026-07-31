import { describe, expect, it } from "vitest";
import { createHlcClock, formatHlc, parseHlc } from "./hlc";

describe("formatHlc and parseHlc", () => {
  it("round trips", () => {
    expect(parseHlc(formatHlc(1_774_000_000_000, 7, "laptop"))).toEqual({
      wallMs: 1_774_000_000_000,
      counter: 7,
      deviceId: "laptop",
    });
  });

  it("pads so string order matches clock order", () => {
    expect(formatHlc(9, 1, "d") < formatHlc(10, 0, "d")).toBe(true);
    expect(formatHlc(10, 9, "d") < formatHlc(10, 10, "d")).toBe(true);
  });

  it("rejects malformed input", () => {
    expect(parseHlc("nope")).toBeNull();
    expect(parseHlc("123:456")).toBeNull();
    expect(parseHlc("123:456:")).toBeNull();
  });
});

describe("createHlcClock", () => {
  it("makes two rapid calls strictly increasing", () => {
    const clock = createHlcClock("device-a", () => 1_000);
    const first = clock.next();
    const second = clock.next();
    expect(second > first).toBe(true);
  });

  it("never moves backwards when the system clock does", () => {
    let wall = 5_000;
    const clock = createHlcClock("device-a", () => wall);

    const before = clock.next();
    wall = 1_000; // ntp correction, or the user changing the clock
    const after = clock.next();
    const later = clock.next();

    expect(after > before).toBe(true);
    expect(later > after).toBe(true);
    expect(clock.peek().wallMs).toBe(5_000);
  });

  it("stays monotonic across a long backwards jump", () => {
    let wall = 10_000;
    const clock = createHlcClock("device-a", () => wall);
    const stamps = [clock.next()];
    for (let step = 0; step < 50; step += 1) {
      wall -= 100;
      stamps.push(clock.next());
    }
    expect([...stamps].sort()).toEqual(stamps);
  });

  it("advances past a remote clock that is ahead", () => {
    const clock = createHlcClock("device-a", () => 1_000);
    clock.observe(formatHlc(9_000, 3, "device-b"));
    expect(clock.peek().wallMs).toBe(9_000);
    expect(clock.next() > formatHlc(9_000, 3, "device-b")).toBe(true);
  });

  it("breaks a tie with a remote clock by taking the higher counter", () => {
    const clock = createHlcClock("device-a", () => 1_000);
    clock.next();
    clock.observe(formatHlc(1_000, 5, "device-b"));
    expect(clock.peek().counter).toBe(6);
  });

  it("ignores a malformed remote stamp", () => {
    const clock = createHlcClock("device-a", () => 1_000);
    clock.next();
    const before = clock.peek();
    clock.observe("garbage");
    expect(clock.peek()).toEqual(before);
  });
});
