import { requireNativeModule } from "expo-modules-core";
import type { ExecutionProvider, ExecutionSession, LocalServer, Project, RuntimeEvent, SourceFile } from "@/shared/recoder";
import { EXECUTION_TIMEOUT_MS, MAX_ACTIVE_EXECUTIONS, MAX_OUTPUT_BYTES, isNativeTimeoutError } from "@/shared/runtime";
export { EXECUTION_TIMEOUT_MS, MAX_OUTPUT_BYTES } from "@/shared/runtime";

type RuntimeSubscription = { remove: () => void };
export type NativeRuntimeModule = { addListener(eventName: "runtimeOutput", listener: (event: RuntimeEvent) => void): RuntimeSubscription; executeJavaScript(input: { sessionId: string; code: string; timeoutMs: number; maxOutputBytes: number }): Promise<ExecutionSession>; cancelExecution(input: { sessionId: string }): Promise<void>; startLocalServer(input: { serverId: string; files: Record<string, string> }): Promise<LocalServer>; stopLocalServer(input: { serverId: string }): Promise<void> };
let moduleRef: NativeRuntimeModule | null | undefined;
function isNativeRuntimeModule(value: unknown): value is NativeRuntimeModule {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return ["addListener", "executeJavaScript", "cancelExecution", "startLocalServer", "stopLocalServer"].every((key) => typeof candidate[key] === "function");
}
export function getNativeRuntime(): NativeRuntimeModule | null {
  if (moduleRef !== undefined) return moduleRef;
  try {
    const candidate = requireNativeModule<NativeRuntimeModule>("RecoderRuntime");
    moduleRef = isNativeRuntimeModule(candidate) ? candidate : null;
  } catch {
    moduleRef = null;
  }
  return moduleRef;
}
export function subscribeRuntime(listener: (event: RuntimeEvent) => void): () => void { const runtime = getNativeRuntime(); if (!runtime) return () => undefined; const subscription = runtime.addListener("runtimeOutput", listener); return () => subscription.remove(); }
const unavailableProvider: ExecutionProvider = { async start() { throw new Error("The device-native runtime is unavailable. Build a development client with Expo prebuild."); }, async cancel() { throw new Error("The device-native runtime is unavailable."); }, async get() { throw new Error("The device-native runtime is unavailable."); } };
export function createNativeProvider(): { provider: ExecutionProvider; available: boolean } {
  const runtime = getNativeRuntime(); if (!runtime) return { provider: unavailableProvider, available: false };
  const sessions = new Map<string, ExecutionSession>(); const cleanupTimers = new Map<string, ReturnType<typeof setTimeout>>(); const active = new Set<string>(); const listeners = new Set<(event: RuntimeEvent) => void>();
  const unsubscribeNative = subscribeRuntime((event) => { const current = sessions.get(event.sessionId); if (!current || current.status !== "running") return; const next = { ...current, events: [...current.events, { id: event.id, at: event.at, stream: event.stream, text: event.text }], outputTruncated: current.outputTruncated || event.outputTruncated }; sessions.set(event.sessionId, next); listeners.forEach((listener) => listener(event)); });
  const terminal = (id: string, status: ExecutionSession["status"], result?: ExecutionSession) => { const current = sessions.get(id); if (!current || ["cancelled", "timed_out", "completed", "failed"].includes(current.status)) return current; const next = { ...(result ?? current), status, finishedAt: result?.finishedAt ?? Date.now(), events: result?.events?.length ? result.events : current.events }; sessions.set(id, next); active.delete(id); cleanupTimers.set(id, setTimeout(() => { cleanupTimers.delete(id); sessions.delete(id); }, 30_000)); return next; };
  const provider: ExecutionProvider = { subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; }, async start({ project, file }) { if (active.size >= MAX_ACTIVE_EXECUTIONS) throw new Error("Two device executions are already active."); const id = `${project.id}-${file.id}-${Date.now()}-${Math.random().toString(36).slice(2)}`; const startedAt = Date.now(); const running: ExecutionSession = { id, status: "running", startedAt, events: [{ id: 0, at: startedAt, stream: "system", text: "Executing locally on the device." }], isolation: "device-webview-context", resourceLimitMs: EXECUTION_TIMEOUT_MS, outputLimitBytes: MAX_OUTPUT_BYTES }; sessions.set(id, running); active.add(id); try { const result = await runtime.executeJavaScript({ sessionId: id, code: file.content, timeoutMs: EXECUTION_TIMEOUT_MS, maxOutputBytes: MAX_OUTPUT_BYTES }); return terminal(id, result.status === "timed_out" ? "timed_out" : result.status, result) ?? result; } catch (error) { const timedOut = isNativeTimeoutError(error); const final = terminal(id, timedOut ? "timed_out" : "failed"); if (timedOut && final) return final; throw error; } }, async cancel(id) { const current = sessions.get(id); if (!current || current.status !== "running") return; terminal(id, "cancelled"); await runtime.cancelExecution({ sessionId: id }); }, async get(id) { const session = sessions.get(id); if (!session) throw new Error("Unknown execution session"); return session; } };
  void unsubscribeNative;
  return { provider, available: true };
}
export async function startPreview(project: Project): Promise<LocalServer> { const runtime = getNativeRuntime(); if (!runtime) throw new Error("The local server is unavailable. Build a development client with Expo prebuild."); const files = Object.fromEntries(project.files.map((file) => [file.name, file.content])); if (!files["index.html"]) files["index.html"] = "<!doctype html><html><body><h1>Recoder preview</h1></body></html>"; return runtime.startLocalServer({ serverId: `${project.id}-${Date.now()}`, files }); }
export async function stopPreview(serverId: string): Promise<void> { await getNativeRuntime()?.stopLocalServer({ serverId }); }
