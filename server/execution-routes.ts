import type { Express, Request } from "express";
import { z } from "zod";
import { cancelDisposableSession, getDisposableSession, startDisposableSession } from "./execution";

const executionStartSchema = z.object({ projectName: z.string().trim().min(1).max(80), fileName: z.string().trim().min(1).max(120).regex(/^[a-zA-Z0-9._/-]+$/) }).strict();
const executionIdSchema = z.string().uuid();
export type ExecutionAuthenticator = (req: Request) => Promise<number | null>;

export function registerExecutionRoutes(app: Express, authenticate: ExecutionAuthenticator) {
  app.post("/api/execution/start", async (req, res) => {
    const ownerId = await authenticate(req);
    if (ownerId === null) return res.status(401).json({ error: "Authentication required" });
    const input = executionStartSchema.safeParse(req.body);
    if (!input.success) return res.status(400).json({ error: "Invalid execution input" });
    const session = startDisposableSession(ownerId, input.data.projectName, input.data.fileName);
    if (!session) return res.status(429).json({ error: "Execution capacity reached" });
    return res.json(session);
  });
  app.get("/api/execution/:id", async (req, res) => {
    const ownerId = await authenticate(req);
    if (ownerId === null) return res.status(401).json({ error: "Authentication required" });
    const id = executionIdSchema.safeParse(req.params.id);
    if (!id.success) return res.status(400).json({ error: "Invalid execution session ID" });
    const session = getDisposableSession(ownerId, id.data);
    if (!session) return res.status(404).json({ error: "Execution session not found" });
    return res.json(session);
  });
  app.post("/api/execution/:id/cancel", async (req, res) => {
    const ownerId = await authenticate(req);
    if (ownerId === null) return res.status(401).json({ error: "Authentication required" });
    const id = executionIdSchema.safeParse(req.params.id);
    if (!id.success) return res.status(400).json({ error: "Invalid execution session ID" });
    const session = cancelDisposableSession(ownerId, id.data);
    if (!session) return res.status(404).json({ error: "Execution session not found" });
    return res.json(session);
  });
}
