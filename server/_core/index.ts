import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { createCorsMiddleware } from "./cors";
import { clearLegacySessionCookie } from "./cookies";
import { cancelDisposableSession, getDisposableSession, startDisposableSession } from "../execution";

async function startServer() {
  const app = express();
  const server = createServer(app);

  app.use(createCorsMiddleware());
  app.use(clearLegacySessionCookie());

  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  registerStorageProxy(app);
  registerOAuthRoutes(app);

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, timestamp: Date.now() });
  });
  app.post("/api/execution/start", (req, res) => {
    const projectName = typeof req.body?.projectName === "string" ? req.body.projectName.slice(0, 80) : "Untitled project";
    const fileName = typeof req.body?.fileName === "string" ? req.body.fileName.slice(0, 120) : "main.ts";
    res.json(startDisposableSession(projectName, fileName));
  });
  app.get("/api/execution/:id", (req, res) => {
    const session = getDisposableSession(req.params.id);
    if (!session) return res.status(404).json({ error: "Execution session not found" });
    return res.json(session);
  });
  app.post("/api/execution/:id/cancel", (req, res) => {
    const session = cancelDisposableSession(req.params.id);
    if (!session) return res.status(404).json({ error: "Execution session not found" });
    return res.json(session);
  });

  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    }),
  );

  const port = parseInt(process.env.PORT || "3000");
  server.listen(port, () => {
    console.log("[api] server listening");
  });
}

startServer().catch(() => {
  console.error("[api] server failed to start");
});
