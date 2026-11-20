import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { cancelDisposableSession, getDisposableSession, startDisposableSession } from "./execution";

const executionStartSchema = z.object({ projectName: z.string().trim().min(1).max(80), fileName: z.string().trim().min(1).max(120).regex(/^[a-zA-Z0-9._/-]+$/) }).strict();
const executionIdSchema = z.string().uuid();
const RATE_WINDOW_MS = 1_000;
const RATE_LIMIT_PER_IP = 20;
const RATE_LIMIT_PER_OWNER = 20;
const RATE_KEY_TTL_MS = 60_000;
const MAX_RATE_KEYS = 10_000;
const PRUNE_EVERY_OPERATIONS = 64;
type RateKey = string | number;
type HitMap = Map<RateKey, number[]>;
const ipHits: HitMap = new Map();
const ownerHits: HitMap = new Map();
let rateOperations = 0;
export type ExecutionAuthenticator = (req: Request) => Promise<number | null>;

function pruneInactive(hits: HitMap, now: number) {
  for (const [key, timestamps] of hits) {
    const latest = timestamps[timestamps.length - 1] ?? 0;
    if (now - latest >= RATE_KEY_TTL_MS) hits.delete(key);
  }
  if (hits.size <= MAX_RATE_KEYS) return;
  const inactive = [...hits.entries()]
    .filter(([, timestamps]) => now - (timestamps[timestamps.length - 1] ?? 0) >= RATE_WINDOW_MS)
    .sort(([, left], [, right]) => (left[left.length - 1] ?? 0) - (right[right.length - 1] ?? 0));
  for (const [key] of inactive) {
    if (hits.size <= MAX_RATE_KEYS) break;
    hits.delete(key);
  }
}

function allowed(hits: HitMap, key: RateKey, limit: number, now = Date.now()) {
  rateOperations += 1;
  const current = hits.get(key);
  const recent = (current ?? []).filter((at) => now - at < RATE_WINDOW_MS);
  if (rateOperations % PRUNE_EVERY_OPERATIONS === 0 || hits.size > MAX_RATE_KEYS || (!current && hits.size >= MAX_RATE_KEYS)) pruneInactive(hits, now);
  if (!current && hits.size >= MAX_RATE_KEYS) return false;
  if (recent.length >= limit) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  return true;
}

export function rateLimiterMemoryStats() {
  return { ipKeys: ipHits.size, ownerKeys: ownerHits.size };
}

export function resetRateLimiterForTests() {
  ipHits.clear();
  ownerHits.clear();
  rateOperations = 0;
}

export function exerciseRateLimiterForTests(kind: "ip" | "owner", key: string | number, now: number) {
  return allowed(kind === "ip" ? ipHits : ownerHits, key, RATE_LIMIT_PER_IP, now);
}

export function registerExecutionRoutes(app: Express, authenticate: ExecutionAuthenticator) {
  const executionBody = express.json({ limit: "8kb" });
  const rateLimit = async (req: Request, res: Response, next: NextFunction) => {
    const ip = req.socket.remoteAddress ?? "unknown";
    if (!allowed(ipHits, ip, RATE_LIMIT_PER_IP)) return res.status(429).json({ error: "Execution request rate limit exceeded" });
    const ownerId = await authenticate(req);
    if (ownerId !== null && !allowed(ownerHits, ownerId, RATE_LIMIT_PER_OWNER)) return res.status(429).json({ error: "Execution owner rate limit exceeded" });
    (req as Request & { executionOwner?: number | null }).executionOwner = ownerId;
    next();
  };
  const owner = (req: Request & { executionOwner?: number | null }) => req.executionOwner ?? null;
  app.post("/api/execution/start", rateLimit, executionBody, async (req, res) => {
    const ownerId = owner(req);
    if (ownerId === null) return res.status(401).json({ error: "Authentication required" });
    const input = executionStartSchema.safeParse(req.body);
    if (!input.success) return res.status(400).json({ error: "Invalid execution input" });
    const session = startDisposableSession(ownerId, input.data.projectName, input.data.fileName);
    if (!session) return res.status(429).json({ error: "Execution capacity reached" });
    return res.json(session);
  });
  app.get("/api/execution/:id", rateLimit, async (req, res) => {
    const ownerId = owner(req);
    if (ownerId === null) return res.status(401).json({ error: "Authentication required" });
    const id = executionIdSchema.safeParse(req.params.id);
    if (!id.success) return res.status(400).json({ error: "Invalid execution session ID" });
    const session = getDisposableSession(ownerId, id.data);
    if (!session) return res.status(404).json({ error: "Execution session not found" });
    return res.json(session);
  });
  app.post("/api/execution/:id/cancel", rateLimit, executionBody, async (req, res) => {
    const ownerId = owner(req);
    if (ownerId === null) return res.status(401).json({ error: "Authentication required" });
    const id = executionIdSchema.safeParse(req.params.id);
    if (!id.success) return res.status(400).json({ error: "Invalid execution session ID" });
    const session = cancelDisposableSession(ownerId, id.data);
    if (!session) return res.status(404).json({ error: "Execution session not found" });
    return res.json(session);
  });
}
