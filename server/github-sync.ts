import express, { type Express, type Request, type Response } from "express";
import { z } from "zod";
import type { WorkspaceSnapshot } from "../shared/recoder";
import { validateWorkspaceSnapshot, MAX_WORKSPACE_SNAPSHOT_BYTES, utf8ByteLength } from "../lib/workspace/core";
import { ENV } from "./_core/env";

type AuthenticatedUser = { id: number; openId: string };
type Authenticator = (req: Request) => Promise<AuthenticatedUser | null>;
type GithubContent = { sha: string; content: string };
const syncBody = express.json({ limit: `${Math.ceil(MAX_WORKSPACE_SNAPSHOT_BYTES / 1024 / 1024 * 1.25)}mb` });
const updateSchema = z.object({ snapshot: z.unknown(), sha: z.string().regex(/^[a-f0-9]{40}$/).nullable() }).strict();

export class GithubSyncError extends Error {
  constructor(public readonly status: number, message: string, public readonly code: "not_configured" | "conflict" | "upstream" | "invalid") {
    super(message);
  }
}

function configured() {
  return Boolean(ENV.githubToken && ENV.githubRepository && ENV.githubBranch && ENV.githubWorkspacePath);
}
function apiUrl(path: string) { return `https://api.github.com/repos/${ENV.githubRepository}/contents/${path}`; }
function headers() { return { Accept: "application/vnd.github+json", Authorization: `Bearer ${ENV.githubToken}`, "X-GitHub-Api-Version": "2022-11-28" }; }
function encode(snapshot: WorkspaceSnapshot) { return Buffer.from(JSON.stringify(snapshot), "utf8").toString("base64"); }
function decode(content: string): WorkspaceSnapshot {
  const snapshot = JSON.parse(Buffer.from(content.replace(/\s/g, ""), "base64").toString("utf8")) as WorkspaceSnapshot;
  validateWorkspaceSnapshot(snapshot);
  return snapshot;
}
function assertConfigured() { if (!configured()) throw new GithubSyncError(503, "GitHub sync is not configured on the server", "not_configured"); }
async function githubRequest(path: string, init?: RequestInit): Promise<globalThis.Response> {
  const response = await fetch(apiUrl(path), { ...init, headers: { ...headers(), ...(init?.headers ?? {}) } });
  return response;
}
async function readRemote(): Promise<GithubContent | null> {
  const response = await githubRequest(ENV.githubWorkspacePath);
  if (response.status === 404) return null;
  if (!response.ok) throw new GithubSyncError(502, `GitHub read failed (${response.status})`, "upstream");
  const payload = await response.json() as { sha?: unknown; content?: unknown };
  if (typeof payload.sha !== "string" || typeof payload.content !== "string") throw new GithubSyncError(502, "GitHub returned an invalid workspace document", "upstream");
  return { sha: payload.sha, content: payload.content };
}
export async function getGithubWorkspace() {
  assertConfigured();
  const remote = await readRemote();
  if (!remote) return { snapshot: null, sha: null } as const;
  return { snapshot: decode(remote.content), sha: remote.sha };
}
export async function putGithubWorkspace(snapshot: WorkspaceSnapshot, expectedSha: string | null) {
  assertConfigured();
  validateWorkspaceSnapshot(snapshot);
  if (utf8ByteLength(JSON.stringify(snapshot)) > MAX_WORKSPACE_SNAPSHOT_BYTES) throw new GithubSyncError(413, "Workspace snapshot exceeds the 2 MB limit", "invalid");
  const remote = await readRemote();
  if ((remote?.sha ?? null) !== (expectedSha ?? null)) throw new GithubSyncError(409, "The GitHub workspace changed elsewhere; pull it before saving", "conflict");
  const response = await githubRequest(ENV.githubWorkspacePath, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: `chore(recoder): save workspace`, content: encode(snapshot), branch: ENV.githubBranch, ...(expectedSha ? { sha: expectedSha } : {}) }),
  });
  if (response.status === 409) throw new GithubSyncError(409, "GitHub rejected the workspace update because it changed elsewhere", "conflict");
  if (!response.ok) throw new GithubSyncError(502, `GitHub write failed (${response.status})`, "upstream");
  const payload = await response.json() as { content?: { sha?: unknown } };
  const sha = payload.content?.sha;
  if (typeof sha !== "string") throw new GithubSyncError(502, "GitHub returned no commit SHA", "upstream");
  return { sha };
}

function owner(req: Request & { githubOwner?: AuthenticatedUser | null }) { return req.githubOwner ?? null; }
export function registerGithubSyncRoutes(app: Express, authenticate: Authenticator) {
  const auth = async (req: Request, res: Response, next: () => void) => {
    try {
      const userId = await authenticate(req);
      if (userId === null) return res.status(401).json({ error: "Authentication required" });
      if (ENV.ownerOpenId && userId.openId !== ENV.ownerOpenId) return res.status(403).json({ error: "GitHub sync is restricted to the configured owner" });
      (req as Request & { githubOwner?: AuthenticatedUser | null }).githubOwner = userId;
      return next();
    } catch { return res.status(401).json({ error: "Authentication required" }); }
  };
  app.get("/api/github-sync/config", auth, (req, res) => {
    if (owner(req) === null) return res.status(401).json({ error: "Authentication required" });
    return res.json({ enabled: configured(), repository: configured() ? ENV.githubRepository : null, branch: configured() ? ENV.githubBranch : null, path: configured() ? ENV.githubWorkspacePath : null });
  });
  app.get("/api/github-sync/workspace", auth, async (_req, res) => {
    try { return res.json(await getGithubWorkspace()); }
    catch (error) { return sendError(res, error); }
  });
  app.put("/api/github-sync/workspace", auth, syncBody, async (req, res) => {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid workspace sync payload" });
    try {
      const snapshot = parsed.data.snapshot as WorkspaceSnapshot;
      const result = await putGithubWorkspace(snapshot, parsed.data.sha);
      return res.json(result);
    } catch (error) { return sendError(res, error); }
  });
}
function sendError(res: Response, error: unknown) {
  if (error instanceof GithubSyncError) return res.status(error.status).json({ error: error.message, code: error.code });
  return res.status(500).json({ error: "GitHub sync failed" });
}
