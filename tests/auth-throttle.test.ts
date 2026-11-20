import { describe, expect, it } from "vitest";
import { LastSignedInThrottle, shouldWriteLastSignedIn } from "../server/_core/sdk";

describe("authentication write throttle", () => {
  it("allows the first write and suppresses sub-minute refresh writes", () => {
    expect(shouldWriteLastSignedIn(undefined, 100_000)).toBe(true);
    expect(shouldWriteLastSignedIn(100_000, 100_001)).toBe(false);
    expect(shouldWriteLastSignedIn(100_000, 160_000)).toBe(true);
  });

  it("reserves before await so concurrent first requests produce one write", async () => {
    const throttle = new LastSignedInThrottle();
    const writes: Promise<void>[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const request = async () => {
      const token = throttle.reserve("user-1", 100_000);
      if (!token) return;
      writes.push(gate.then(() => { throttle.complete("user-1", token); }));
    };
    await Promise.all([request(), request()]);
    expect(writes).toHaveLength(1);
    release();
    await Promise.all(writes);
    expect(throttle.reserve("user-1", 100_001)).toBeNull();
    const failed = throttle.reserve("user-1", 160_001);
    expect(failed).not.toBeNull();
    if (failed) throttle.fail("user-1", failed);
    expect(throttle.reserve("user-1", 160_002)).not.toBeNull();
  });

  it("expires inactive entries and refuses new keys when active capacity is full", () => {
    const throttle = new LastSignedInThrottle();
    for (let index = 0; index < 10_000; index += 1) {
      const token = throttle.reserve(`user-${index}`, 200_000);
      expect(token).not.toBeNull();
      if (token) throttle.complete(`user-${index}`, token);
    }
    expect(throttle.reserve("active-overflow", 200_000)).toBeNull();
    expect(throttle.size()).toBe(10_000);
    expect(throttle.reserve("after-expiry", 321_000)).not.toBeNull();
    expect(throttle.size()).toBe(1);
  });
});
