import { requireNativeModule } from "expo-modules-core";

import type { ExecutionProvider } from "@/lib/execution/provider";

/**
 * Shape of the native runtime module exposed by the iOS/Android shells.
 * Kept structural so the web build can type-check without the native module.
 */
export interface NativeRuntimeModule {
  addListener: (event: string, handler: (payload: unknown) => void) => { remove: () => void };
  run: (request: unknown) => Promise<unknown>;
  cancel: (runId: string) => Promise<void>;
}

let moduleRef: NativeRuntimeModule | null | undefined;

/**
 * True while rendering on the server (static export / SSR).
 *
 * `expo-modules-core`'s web build returns an empty object from
 * `requireNativeModule` when `window` is undefined, so a module-scope call to
 * `createNativeProvider()` would invoke `{}.addListener(...)` and throw. That
 * throw happens while the route module is being evaluated, which aborts the
 * whole route during static rendering and surfaces as React error #419.
 */
const isServerRender = typeof window === "undefined";

/**
 * Resolve the native runtime module, or null when it is unavailable.
 *
 * Returns null during server rendering without touching the native registry,
 * and treats a module that lacks the expected methods as unavailable rather
 * than letting a later call fail.
 */
export function getNativeRuntime(): NativeRuntimeModule | null {
  if (moduleRef !== undefined) return moduleRef;
  if (isServerRender) {
    // Do not cache: the client bundle re-evaluates this module after hydration.
    return null;
  }
  try {
    const candidate = requireNativeModule<NativeRuntimeModule>("RecoderRuntime");
    moduleRef = typeof candidate?.addListener === "function" ? candidate : null;
  } catch {
    moduleRef = null;
  }
  return moduleRef;
}

/**
 * Provider used when the native runtime is not present (web, or a shell that
 * has not registered the module). Every method reports unavailability rather
 * than throwing, so callers can degrade gracefully.
 */
const unavailableProvider: ExecutionProvider = {
  id: "native",
  label: "Device runtime",
  available: false,
  async run() {
    return {
      ok: false,
      code: "runtime_unavailable",
      message: "The device runtime is not available in this environment.",
    };
  },
  async cancel() {
    return;
  },
};

/**
 * Build the native execution provider.
 *
 * Safe to call at module scope: it never throws when the native module is
 * absent, which is what previously aborted route evaluation during static
 * rendering.
 */
export function createNativeProvider(): { provider: ExecutionProvider; available: boolean } {
  const runtime = getNativeRuntime(); if (!runtime) return { provider: unavailableProvider, available: false };

  const provider: ExecutionProvider = {
    id: "native",
    label: "Device runtime",
    available: true,
    async run(request) {
      return runtime.run(request);
    },
    async cancel(runId) {
      await runtime.cancel(runId);
    },
  };

  return { provider, available: true };
}
