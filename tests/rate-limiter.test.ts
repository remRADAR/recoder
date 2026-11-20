import { afterEach, describe, expect, it } from "vitest";
import { exerciseRateLimiterForTests, rateLimiterMemoryStats, resetRateLimiterForTests } from "../server/execution-routes";

afterEach(() => resetRateLimiterForTests());

describe("execution rate limiter memory bounds", () => {
  it("bounds high-cardinality keys without evicting active keys", () => {
    for (let index = 0; index < 10_000; index += 1) expect(exerciseRateLimiterForTests("ip", `active-${index}`, 100_000)).toBe(true);
    expect(exerciseRateLimiterForTests("ip", "attacker-new-key", 100_000)).toBe(false);
    expect(rateLimiterMemoryStats().ipKeys).toBeLessThanOrEqual(10_000);
  });

  it("prunes expired inactive keys and admits a new key afterward", () => {
    for (let index = 0; index < 10_000; index += 1) exerciseRateLimiterForTests("ip", `old-${index}`, 100_000);
    expect(exerciseRateLimiterForTests("ip", "new-before-expiry", 100_000)).toBe(false);
    expect(exerciseRateLimiterForTests("ip", "new-after-expiry", 161_000)).toBe(true);
    expect(rateLimiterMemoryStats().ipKeys).toBe(1);
  });

  it("bounds owner-key cardinality independently", () => {
    for (let index = 0; index < 10_001; index += 1) exerciseRateLimiterForTests("owner", index, 200_000);
    expect(rateLimiterMemoryStats().ownerKeys).toBeLessThanOrEqual(10_000);
  });
});
