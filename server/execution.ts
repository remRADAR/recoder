import { randomUUID } from "node:crypto";
import type { ExecutionEvent, ExecutionSession } from "../shared/recoder";

type OwnerId = number;
type MutableSession = ExecutionSession & { ownerId: OwnerId; timer?: ReturnType<typeof setTimeout>; expiryTimer?: ReturnType<typeof setTimeout> };

const sessions = new Map<string, MutableSession>();
const LIMIT_MS = 5_000;
const SESSION_TTL_MS = 30_000;
const MAX_ACTIVE_GLOBAL = 8;
const MAX_ACTIVE_PER_OWNER = 3;
const MAX_OUTPUT_BYTES = 16_000;

function publicSession(session: MutableSession): ExecutionSession {
  const { timer: _timer, expiryTimer: _expiryTimer, ownerId: _ownerId, ...safe } = session;
  return { ...safe, events: [...safe.events] };
}

function event(session: MutableSession, stream: ExecutionEvent["stream"], text: string) {
  const currentBytes = session.events.reduce((total, item) => total + item.text.length, 0);
  if (currentBytes >= MAX_OUTPUT_BYTES) return;
  session.events.push({ id: session.events.length + 1, at: Date.now(), stream, text: text.slice(0, MAX_OUTPUT_BYTES - currentBytes) });
}

function activeSessions() {
  return [...sessions.values()].filter((session) => session.status === "running");
}

function dispose(id: string) {
  const session = sessions.get(id);
  if (!session) return;
  if (session.timer) clearTimeout(session.timer);
  if (session.expiryTimer) clearTimeout(session.expiryTimer);
  sessions.delete(id);
}

export function startDisposableSession(ownerId: OwnerId, projectName: string, fileName: string): ExecutionSession | null {
  const active = activeSessions();
  if (active.length >= MAX_ACTIVE_GLOBAL || active.filter((session) => session.ownerId === ownerId).length >= MAX_ACTIVE_PER_OWNER) return null;
  const id = randomUUID();
  const session: MutableSession = {
    id,
    ownerId,
    status: "running",
    startedAt: Date.now(),
    events: [],
    isolation: "simulated-disposable",
    resourceLimitMs: LIMIT_MS,
  };
  sessions.set(id, session);
  event(session, "system", `Simulated disposable session started for ${projectName}/${fileName}`);
  event(session, "stdout", "simulation> preparing bounded lifecycle proof; source is not executed");
  session.timer = setTimeout(() => {
    if (session.status !== "running") return;
    event(session, "stdout", "simulation> output stream complete; no project code was executed");
    session.status = "completed";
    session.finishedAt = Date.now();
  }, 1_200);
  session.expiryTimer = setTimeout(() => dispose(id), SESSION_TTL_MS);
  return publicSession(session);
}

export function getDisposableSession(ownerId: OwnerId, id: string): ExecutionSession | null {
  const session = sessions.get(id);
  return session && session.ownerId === ownerId ? publicSession(session) : null;
}

export function cancelDisposableSession(ownerId: OwnerId, id: string): ExecutionSession | null {
  const session = sessions.get(id);
  if (!session || session.ownerId !== ownerId) return null;
  if (session.status === "running") {
    if (session.timer) clearTimeout(session.timer);
    event(session, "system", "simulation> cancellation acknowledged");
    session.status = "cancelled";
    session.finishedAt = Date.now();
  }
  return publicSession(session);
}

export function sessionLimits() {
  return { limitMs: LIMIT_MS, ttlMs: SESSION_TTL_MS, maxActiveGlobal: MAX_ACTIVE_GLOBAL, maxActivePerOwner: MAX_ACTIVE_PER_OWNER, maxOutputBytes: MAX_OUTPUT_BYTES };
}
