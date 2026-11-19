import { randomUUID } from "node:crypto";
import type { ExecutionEvent, ExecutionSession } from "../shared/recoder";

type MutableSession = ExecutionSession & { timer?: ReturnType<typeof setTimeout> };
const sessions = new Map<string, MutableSession>();
const LIMIT_MS = 5_000;

function publicSession(session: MutableSession): ExecutionSession {
  const { timer: _timer, ...safe } = session;
  return { ...safe, events: [...safe.events] };
}

function event(session: MutableSession, stream: ExecutionEvent["stream"], text: string) {
  session.events.push({ id: session.events.length + 1, at: Date.now(), stream, text });
}

export function startDisposableSession(projectName: string, fileName: string): ExecutionSession {
  const id = randomUUID();
  const session: MutableSession = { id, status: "running", startedAt: Date.now(), events: [], isolation: "simulated-disposable", resourceLimitMs: LIMIT_MS };
  sessions.set(id, session);
  event(session, "system", `Disposable proof started for ${projectName}/${fileName}`);
  event(session, "stdout", "remote> preparing bounded execution session");
  session.timer = setTimeout(() => {
    if (session.status !== "running") return;
    event(session, "stdout", "remote> execution complete: hello from the isolated proof");
    session.status = "completed";
    session.finishedAt = Date.now();
  }, 1_200);
  setTimeout(() => {
    if (session.status === "running") {
      event(session, "stderr", "remote> resource limit reached");
      session.status = "failed";
      session.finishedAt = Date.now();
    }
    sessions.delete(id);
  }, LIMIT_MS);
  return publicSession(session);
}

export function getDisposableSession(id: string): ExecutionSession | null {
  const session = sessions.get(id);
  return session ? publicSession(session) : null;
}

export function cancelDisposableSession(id: string): ExecutionSession | null {
  const session = sessions.get(id);
  if (!session) return null;
  if (session.status === "running") {
    if (session.timer) clearTimeout(session.timer);
    event(session, "system", "remote> cancellation acknowledged");
    session.status = "cancelled";
    session.finishedAt = Date.now();
  }
  return publicSession(session);
}
