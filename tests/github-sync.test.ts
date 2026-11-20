import express from "express";
import type { Server } from "node:http";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createInitialSnapshot } from "../lib/workspace/core";

let server: Server | null = null;
let registerGithubSyncRoutes: typeof import("../server/github-sync").registerGithubSyncRoutes;

beforeAll(async () => {
  process.env.RECODER_GITHUB_TOKEN = "test-token";
  process.env.RECODER_GITHUB_REPOSITORY = "remRADAR/recoder";
  process.env.RECODER_GITHUB_BRANCH = "main";
  process.env.RECODER_GITHUB_WORKSPACE_PATH = ".recoder/workspace.json";
  vi.resetModules();
  ({ registerGithubSyncRoutes } = await import("../server/github-sync"));
});

afterEach(async () => {
  vi.unstubAllGlobals();
  if (!server) return;
  await new Promise<void>((resolve, reject) => server?.close((error) => error ? reject(error) : resolve()));
  server = null;
});

async function createTestServer() {
  const app = express();
  registerGithubSyncRoutes(app, async (req) => req.header("x-test-user") ? { id: 1, openId: "test-owner" } : null);
  server = app.listen(0);
  await new Promise<void>((resolve) => server?.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing test port");
  return `http://127.0.0.1:${address.port}`;
}

describe("GitHub workspace sync", () => {
  it("requires an authenticated app session", async () => {
    const base = await createTestServer();
    const response = await fetch(`${base}/api/github-sync/config`);
    expect(response.status).toBe(401);
  });

  it("reports configured repository metadata without exposing the token", async () => {
    const base = await createTestServer();
    const response = await fetch(`${base}/api/github-sync/config`, { headers: { "x-test-user": "1" } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ enabled: true, repository: "remRADAR/recoder", branch: "main", path: ".recoder/workspace.json" });
  });

  it("creates a missing document and rejects a stale SHA before writing", async () => {
    const requests: Request[] = [];
    const realFetch = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!String(input).startsWith("https://api.github.com/")) return realFetch(input, init);
      requests.push(new Request(input, init));
      if (!init?.method || init.method === "GET") return new Response(null, { status: 404 });
      return Response.json({ content: { sha: "a".repeat(40) } });
    }));
    const base = await createTestServer();
    const snapshot = createInitialSnapshot();
    const created = await fetch(`${base}/api/github-sync/workspace`, { method: "PUT", headers: { "content-type": "application/json", "x-test-user": "1" }, body: JSON.stringify({ snapshot, sha: null }) });
    expect(created.status).toBe(200);
    expect(requests.map((request) => request.method)).toEqual(["GET", "PUT"]);
    const stale = await fetch(`${base}/api/github-sync/workspace`, { method: "PUT", headers: { "content-type": "application/json", "x-test-user": "1" }, body: JSON.stringify({ snapshot, sha: "b".repeat(40) }) });
    expect(stale.status).toBe(409);
  });
});
