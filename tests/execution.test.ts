import { afterEach, describe, expect, it, vi } from "vitest";
import { cancelDisposableSession, getDisposableSession, sessionLimits, startDisposableSession, truncateOutput } from "../server/execution";

afterEach(() => vi.useRealTimers());

describe("disposable execution proof", () => {
  it("does not accept source commands and supports cancellation", () => {
    const session = startDisposableSession(1, "Demo", "main.ts");
    expect(session).not.toBeNull();
    if (!session) return;
    expect(session.isolation).toBe("simulated-disposable");
    expect(session.resourceLimitMs).toBeLessThanOrEqual(5000);
    expect(session.events.some((event) => event.text.includes("source is not executed"))).toBe(true);
    const cancelled = cancelDisposableSession(1, session.id);
    expect(cancelled?.status).toBe("cancelled");
    expect(getDisposableSession(1, session.id)?.events.some((event) => event.text.includes("shell"))).toBe(false);
  });

  it("expires sessions and enforces per-owner concurrency", () => {
    vi.useFakeTimers();
    const sessions = [1, 1, 1].map((owner) => startDisposableSession(owner, "Demo", "main.ts"));
    expect(sessions.every(Boolean)).toBe(true);
    const limited = startDisposableSession(1, "Demo", "overflow.ts");
    expect(limited).toBeNull();
    vi.advanceTimersByTime(sessionLimits().ttlMs + 1);
    expect(getDisposableSession(1, sessions[0]?.id ?? "00000000-0000-0000-0000-000000000000")).toBeNull();
  });

  it("truncates output by UTF-8 bytes without splitting characters", () => {
    const output = truncateOutput("☃".repeat(100), 10);
    expect(new TextEncoder().encode(output).byteLength).toBeLessThanOrEqual(10);
    expect(output).not.toContain("\uFFFD");
  });
});
