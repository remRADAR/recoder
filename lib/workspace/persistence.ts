import type { WorkspaceSnapshot } from "../../shared/recoder";
import { validateWorkspaceSnapshot } from "./core";

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
