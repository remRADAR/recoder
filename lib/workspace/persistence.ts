import type { WorkspaceSnapshot } from "../../shared/recoder";
import { validateWorkspaceSnapshot, utf8ByteLength } from "./core";

export const MAX_IMPORT_BYTES = 1 * 1024 * 1024;

export type SavePhase = "idle" | "dirty" | "saving" | "saved" | "failed";
export type SaveCoordinatorState = {
  latestSequence: number;
  pendingSnapshot: WorkspaceSnapshot | null;
  error: Error | null;
  phase: SavePhase;
};

export function serializeWorkspaceSnapshot(snapshot: WorkspaceSnapshot): string {
  validateWorkspaceSnapshot(snapshot);
  return JSON.stringify(snapshot);
}

export async function persistWorkspaceSnapshot(snapshot: WorkspaceSnapshot, writer: (serialized: string) => Promise<void>, retries = 0): Promise<void> {
  const serialized = serializeWorkspaceSnapshot(snapshot);
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      await writer(serialized);
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Workspace save failed");
}

export function createSaveCoordinator(
  writer: (snapshot: WorkspaceSnapshot) => Promise<void>,
  onStateChange?: (state: SaveCoordinatorState) => void,
) {
  let state: SaveCoordinatorState = { latestSequence: 0, pendingSnapshot: null, error: null, phase: "idle" };
  const listeners = new Set<(state: SaveCoordinatorState) => void>();
  const notify = () => onStateChange?.({ ...state });
  const save = (snapshot: WorkspaceSnapshot): Promise<void> => {
    const sequence = state.latestSequence + 1;
    state = { latestSequence: sequence, pendingSnapshot: snapshot, error: null, phase: "saving" };
    notify();
    listeners.forEach((listener) => listener({ ...state }));
    return writer(snapshot).then(() => {
      if (state.latestSequence !== sequence) return;
      state = { ...state, pendingSnapshot: null, error: null, phase: "saved" };
      notify();
      listeners.forEach((listener) => listener({ ...state }));
    }).catch((error: unknown) => {
      if (state.latestSequence === sequence) {
        state = { ...state, pendingSnapshot: snapshot, error: error instanceof Error ? error : new Error("Workspace save failed"), phase: "failed" };
        notify();
        listeners.forEach((listener) => listener({ ...state }));
      }
      throw error;
    });
  };
  return {
    save,
    retry: () => state.pendingSnapshot ? save(state.pendingSnapshot) : Promise.resolve(),
    getState: () => ({ ...state }),
    subscribe: (listener: (state: SaveCoordinatorState) => void) => { listeners.add(listener); return () => listeners.delete(listener); },
  };
}

export async function readImportedTextAsset(
  asset: { uri: string; name?: string; size?: unknown },
  reader: (uri: string) => Promise<string>,
): Promise<{ name: string; content: string }> {
  if (typeof asset.size === "number" && Number.isFinite(asset.size) && asset.size > MAX_IMPORT_BYTES) throw new Error("Imported file exceeds the 1 MB limit");
  const content = await reader(asset.uri);
  if (utf8ByteLength(content) > MAX_IMPORT_BYTES) throw new Error("Imported file exceeds the 1 MB limit");
  return { name: asset.name || "imported.txt", content };
}
