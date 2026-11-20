import { describe, expect, it, vi } from "vitest";
import { createInitialSnapshot, updateFile, validateWorkspaceSnapshot, MAX_WORKSPACE_SNAPSHOT_BYTES, utf8ByteLength } from "../lib/workspace/core";
import { persistWorkspaceSnapshot, serializeWorkspaceSnapshot } from "../lib/workspace/persistence";

describe("workspace persistence safety", () => {
  it("rejects oversized snapshots before invoking the writer", async () => {
    const initial = createInitialSnapshot();
    const oversized = updateFile(initial, initial.activeFileId, "x".repeat(MAX_WORKSPACE_SNAPSHOT_BYTES));
    const writer = vi.fn(async () => undefined);
    await expect(persistWorkspaceSnapshot(oversized, writer)).rejects.toThrow("2 MB");
    expect(writer).not.toHaveBeenCalled();
  });

  it("preserves the last successful write across a transient failure and retry", async () => {
    const snapshot = createInitialSnapshot();
    const writes: string[] = [];
    let attempts = 0;
    const writer = vi.fn(async (serialized: string) => { attempts += 1; if (attempts === 1) throw new Error("transient"); writes.push(serialized); });
    await persistWorkspaceSnapshot(snapshot, writer, 1);
    expect(writer).toHaveBeenCalledTimes(2);
    expect(writes).toHaveLength(1);
    expect(JSON.parse(writes[0]).activeProjectId).toBe(snapshot.activeProjectId);
  });

  it("uses UTF-8 byte accounting for multibyte content", () => {
    expect(utf8ByteLength("☃")).toBeGreaterThan("☃".length);
    expect(() => serializeWorkspaceSnapshot({ ...createInitialSnapshot(), projects: [] })).toThrow("invalid");
    expect(validateWorkspaceSnapshot(createInitialSnapshot())).toBeUndefined();
  });
});
