import express from "express";
import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { registerExecutionRoutes } from "../server/execution-routes";

let server: Server | null = null;
async function createTestServer() {
  const app = express();
  app.use(express.json());
  registerExecutionRoutes(app, async (req) => {
    const value = req.header("x-test-user");
    return value ? Number(value) : null;
  });
  server = app.listen(0);
  await new Promise<void>((resolve) => server?.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing test port");
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  if (!server) return;
  await new Promise<void>((resolve, reject) => server?.close((error) => error ? reject(error) : resolve()));
  server = null;
});

describe("execution HTTP security boundary", () => {
  it("rejects unauthenticated and malformed requests", async () => {
    const base = await createTestServer();
    const unauthenticated = await fetch(`${base}/api/execution/start`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectName: "Demo", fileName: "main.ts" }) });
    expect(unauthenticated.status).toBe(401);
    const malformed = await fetch(`${base}/api/execution/start`, { method: "POST", headers: { "content-type": "application/json", "x-test-user": "1" }, body: JSON.stringify({ projectName: "<script>", fileName: "main.ts", command: "rm -rf /" }) });
    expect(malformed.status).toBe(400);
  });

  it("enforces owner-only reads and cancellation", async () => {
    const base = await createTestServer();
    const started = await fetch(`${base}/api/execution/start`, { method: "POST", headers: { "content-type": "application/json", "x-test-user": "1" }, body: JSON.stringify({ projectName: "Demo", fileName: "main.ts" }) });
    expect(started.status).toBe(200);
    const session = await started.json() as { id: string };
    const crossUserRead = await fetch(`${base}/api/execution/${session.id}`, { headers: { "x-test-user": "2" } });
    expect(crossUserRead.status).toBe(404);
    const crossUserCancel = await fetch(`${base}/api/execution/${session.id}/cancel`, { method: "POST", headers: { "x-test-user": "2" } });
    expect(crossUserCancel.status).toBe(404);
    const ownerCancel = await fetch(`${base}/api/execution/${session.id}/cancel`, { method: "POST", headers: { "x-test-user": "1" } });
    expect(ownerCancel.status).toBe(200);
    expect((await ownerCancel.json()).status).toBe("cancelled");
  });
});
