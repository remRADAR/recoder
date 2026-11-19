import { describe, expect, it } from "vitest";
import { cancelDisposableSession, getDisposableSession, startDisposableSession } from "../server/execution";

describe("disposable execution proof", () => {
  it("does not accept source commands and supports cancellation", () => {
    const session = startDisposableSession("Demo", "main.ts");
    expect(session.isolation).toBe("simulated-disposable");
    expect(session.resourceLimitMs).toBeLessThanOrEqual(5000);
    const cancelled = cancelDisposableSession(session.id);
    expect(cancelled?.status).toBe("cancelled");
    expect(getDisposableSession(session.id)?.events.some((event) => event.text.includes("shell"))).toBe(false);
  });
});
