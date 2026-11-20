import "dotenv/config";
import express, { type Request } from "express";
import { createServer } from "http";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { createCorsMiddleware } from "./cors";
import { clearLegacySessionCookie } from "./cookies";
import { sdk } from "./sdk";
import { ENV } from "./env";
import { registerExecutionRoutes } from "../execution-routes";
import { canUseLocalExecutionFallback } from "../execution-auth";

let localFallbackActivations = 0;

async function executionOwner(req: Request) {
  try {
    const user = await sdk.authenticateRequest(req);
    if (user) return user.id;
  } catch {
    // Fall through to the explicitly gated local development mode.
  }
  if (canUseLocalExecutionFallback({ isProduction: ENV.isProduction, enabled: process.env.RECODER_ALLOW_LOCAL_EXECUTION === "true", ip: req.ip, hostname: req.hostname })) {
    localFallbackActivations += 1;
    console.warn(`[Auth] local execution fallback accepted (count=${localFallbackActivations}, same-host loopback only)`);
    return 0;
  }
  return null;
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  if (process.env.RECODER_ALLOW_LOCAL_EXECUTION === "true") console.warn(ENV.isProduction ? "[Auth] local execution fallback disabled in production" : "[Auth] local execution fallback enabled for development loopback requests only; same-host reverse proxy required");

  app.use(createCorsMiddleware());
  app.use(clearLegacySessionCookie());
  registerExecutionRoutes(app, executionOwner);

  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ limit: "1mb", extended: true }));

  registerStorageProxy(app);
  registerOAuthRoutes(app);

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, timestamp: Date.now() });
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
