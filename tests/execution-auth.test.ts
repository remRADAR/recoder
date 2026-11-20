import { describe, expect, it } from "vitest";
import { canUseLocalExecutionFallback } from "../server/execution-auth";

describe("local execution fallback policy", () => {
  it("refuses production even when the development flag is present", () => {
    expect(canUseLocalExecutionFallback({ isProduction: true, enabled: true, ip: "127.0.0.1", hostname: "localhost" })).toBe(false);
    expect(canUseLocalExecutionFallback({ isProduction: false, enabled: true, ip: "203.0.113.10", hostname: "localhost" })).toBe(false);
  });

  it("allows only explicitly enabled same-host loopback development", () => {
    expect(canUseLocalExecutionFallback({ isProduction: false, enabled: true, ip: "127.0.0.1", hostname: "localhost" })).toBe(true);
    expect(canUseLocalExecutionFallback({ isProduction: false, enabled: false, ip: "127.0.0.1", hostname: "localhost" })).toBe(false);
  });
});
