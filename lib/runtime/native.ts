import { requireNativeModule } from "expo-modules-core";
import type { ExecutionSession, LocalServer, Project, RuntimeEvent, SourceFile } from "@/shared/recoder";
import { EXECUTION_TIMEOUT_MS, MAX_OUTPUT_BYTES } from "@/shared/runtime";
export { EXECUTION_TIMEOUT_MS, MAX_OUTPUT_BYTES } from "@/shared/runtime";

type RuntimeSubscription = { remove: () => void };
export type NativeRuntimeModule = {
  addListener(eventName: "runtimeOutput", listener: (event: RuntimeEvent) => void): RuntimeSubscription;
  executeJavaScript(input: { sessionId: string; code: string; timeoutMs: number; maxOutputBytes: number }): Promise<ExecutionSession>;
  cancelExecution(input: { sessionId: string }): Promise<void>;
  startLocalServer(input: { serverId: string; files: Record<string, string> }): Promise<LocalServer>;
  stopLocalServer(input: { serverId: string }): Promise<void>;
};

let moduleRef: NativeRuntimeModule | null | undefined;
let emitter: NativeRuntimeModule | null = null;

export function getNativeRuntime(): NativeRuntimeModule | null {
  if (moduleRef !== undefined) return moduleRef;
  try {
    moduleRef = requireNativeModule<NativeRuntimeModule>("RecoderRuntime");
    emitter = moduleRef;
  } catch {
    moduleRef = null;
  }
  return moduleRef;
}

export function subscribeRuntime(listener: (event: RuntimeEvent) => void): () => void {
  const runtime = getNativeRuntime();
  if (!runtime || !emitter) return () => undefined;
  const subscription = emitter.addListener("runtimeOutput", listener);
  return () => subscription.remove();
}

export function createNativeProvider(): { provider: import("@/shared/recoder").ExecutionProvider; available: boolean } {
  const runtime = getNativeRuntime();
  if (!runtime) return { provider: unavailableProvider, available: false };
  const sessions = new Map<string, ExecutionSession>();
  return {
    available: true,
    provider: {
      subscribe: subscribeRuntime,
      async start({ project, file }) {
        const id = `${project.id}-${file.id}-${Date.now()}`;
        const running: ExecutionSession = {
          id,
          status: "running",
          startedAt: Date.now(),
          events: [{ id: 0, at: Date.now(), stream: "system", text: "Executing locally on the device." }],
          isolation: "device-webview-context",
          resourceLimitMs: EXECUTION_TIMEOUT_MS,
          outputLimitBytes: MAX_OUTPUT_BYTES,
        };
        sessions.set(id, running);
        const result = await runtime.executeJavaScript({ sessionId: id, code: file.content, timeoutMs: EXECUTION_TIMEOUT_MS, maxOutputBytes: MAX_OUTPUT_BYTES });
        const merged = { ...result, events: [...running.events, ...result.events] };
        sessions.set(id, merged);
        return merged;
      },
      async cancel(sessionId) {
        await runtime.cancelExecution({ sessionId });
        const existing = sessions.get(sessionId);
        if (existing) sessions.set(sessionId, { ...existing, status: "cancelled", finishedAt: Date.now() });
      },
      async get(sessionId) {
        const existing = sessions.get(sessionId);
        if (!existing) throw new Error("Unknown execution session");
        return existing;
      },
    },
  };
}

const unavailableProvider = {
  async start() { throw new Error("The device-native runtime is unavailable. Build a development client with Expo prebuild."); },
  async cancel() { throw new Error("The device-native runtime is unavailable."); },
  async get() { throw new Error("The device-native runtime is unavailable."); },
};

export async function startPreview(project: Project): Promise<LocalServer> {
  const runtime = getNativeRuntime();
  if (!runtime) throw new Error("The local server is unavailable. Build a development client with Expo prebuild.");
  const files = Object.fromEntries(project.files.map((file) => [file.name, file.content]));
  return runtime.startLocalServer({ serverId: `${project.id}-${Date.now()}`, files });
}

export async function stopPreview(serverId: string): Promise<void> {
  const runtime = getNativeRuntime();
  if (!runtime) return;
  await runtime.stopLocalServer({ serverId });
}
