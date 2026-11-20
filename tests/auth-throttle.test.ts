import { describe, expect, it } from "vitest";
import { shouldWriteLastSignedIn } from "../server/_core/sdk";

describe("authentication write throttle", () => {
  it("allows the first write and suppresses sub-minute refresh writes", () => {
    expect(shouldWriteLastSignedIn(undefined, 100_000)).toBe(true);
    expect(shouldWriteLastSignedIn(100_000, 100_001)).toBe(false);
    expect(shouldWriteLastSignedIn(100_000, 160_000)).toBe(true);
  });
});
