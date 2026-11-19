import { describe, expect, it } from "vitest";
import { cancelDisposableSession, getDisposableSession, startDisposableSession } from "../server/execution";

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
});
