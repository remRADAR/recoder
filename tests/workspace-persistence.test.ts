import { describe, expect, it, vi } from "vitest";
import { createInitialSnapshot, updateFile, validateWorkspaceSnapshot, MAX_WORKSPACE_SNAPSHOT_BYTES, utf8ByteLength } from "../lib/workspace/core";
import { createSaveCoordinator, MAX_IMPORT_BYTES, persistWorkspaceSnapshot, readImportedTextAsset, serializeWorkspaceSnapshot } from "../lib/workspace/persistence";

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

  it("rejects an oversized reported asset before reading it", async () => {
    const reader = vi.fn(async () => "should not be read");
    await expect(readImportedTextAsset({ uri: "file://large", size: MAX_IMPORT_BYTES + 1 }, reader)).rejects.toThrow("1 MB");
    expect(reader).not.toHaveBeenCalled();
  });

  it("still rejects oversized content when asset metadata is missing", async () => {
    const reader = vi.fn(async () => "x".repeat(MAX_IMPORT_BYTES + 1));
    await expect(readImportedTextAsset({ uri: "file://unknown-size" }, reader)).rejects.toThrow("1 MB");
    expect(reader).toHaveBeenCalledOnce();
  });

  it("does not let a late failed save replace a newer successful save", async () => {
    const first = createInitialSnapshot();
    const second = { ...first, activeFileId: "file-readme" };
    let resolveFirst!: () => void;
    let rejectFirst!: (error: Error) => void;
    let resolveSecond!: () => void;
    const writer = vi.fn((snapshot: typeof first) => new Promise<void>((resolve, reject) => {
      if (snapshot === first) { resolveFirst = resolve; rejectFirst = reject; } else { resolveSecond = resolve; }
    }));
    const coordinator = createSaveCoordinator(writer);
    const saveA = coordinator.save(first);
    const saveB = coordinator.save(second);
    resolveSecond();
    await saveB;
    rejectFirst(new Error("late A failure"));
    await expect(saveA).rejects.toThrow("late A failure");
    expect(coordinator.getState().pendingSnapshot).toBeNull();
    expect(coordinator.getState().error).toBeNull();
    expect(writer).toHaveBeenCalledTimes(2);
    void resolveFirst;
  });
});
