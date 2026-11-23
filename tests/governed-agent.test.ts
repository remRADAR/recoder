import { describe, expect, it, vi } from "vitest";
import { createDefaultCapabilityRegistry } from "../lib/agents/capabilities";
import { createGovernedTask } from "../lib/agents/governed";

describe("capability registry", () => {
  it("lists built-in and disabled open-source capability entries", () => {
    const registry = createDefaultCapabilityRegistry();
    expect(registry.list({ source: "builtin" }).map((item) => item.id)).toContain("recoder.workspace.write");
    expect(registry.get("recoder.mcp.invoke")).toMatchObject({ source: "open-source", enabled: false, requiresApproval: true });
    expect(registry.list({ enabled: true }).every((item) => item.enabled)).toBe(true);
  });

  it("rejects duplicate capability ids", () => {
    const registry = createDefaultCapabilityRegistry();
    expect(() => registry.register(registry.get("recoder.workspace.read")!)).toThrow("already registered");
  });
});

describe("governed agent tasks", () => {
  it("blocks writes until explicitly approved, then verifies the task", async () => {
    const execute = vi.fn(async () => undefined);
    const verify = vi.fn(async () => undefined);
    const task = createGovernedTask({
      surface: "native",
      plan: { id: "task-1", agentId: "agent-1", task: "Update and run", operations: [
        { id: "read-1", capabilityId: "recoder.workspace.read", summary: "Inspect files" },
        { id: "write-1", capabilityId: "recoder.workspace.write", summary: "Update main.js", resource: "main.js" },
      ] },
      execute,
      verify,
    });

    expect((await task.run()).phase).toBe("awaiting_approval");
    expect(execute).not.toHaveBeenCalled();
    expect(task.getState().events.at(-1)?.text).toContain("waiting for approval");

    task.approve(["write-1"]);
    const result = await task.run();
    expect(result.phase).toBe("completed");
    expect(execute).toHaveBeenCalledTimes(2);
    expect(verify).toHaveBeenCalledOnce();
    expect(result.completedOperationIds).toEqual(["read-1", "write-1"]);
  });

  it("rejects disabled or unavailable capabilities before execution", () => {
    const registry = createDefaultCapabilityRegistry();
    expect(() => createGovernedTask({ surface: "web", registry, plan: { id: "task-2", agentId: "agent-1", task: "Use MCP", operations: [{ id: "mcp-1", capabilityId: "recoder.mcp.invoke", summary: "Call MCP" }] }, execute: async () => undefined })).toThrow("disabled");
    expect(() => createGovernedTask({ surface: "web", plan: { id: "task-3", agentId: "agent-1", task: "Run code", operations: [{ id: "run-1", capabilityId: "recoder.runtime.run", summary: "Run main.js" }] }, execute: async () => undefined })).toThrow("unavailable");
  });

  it("keeps a failed task recoverable and records the failing operation", async () => {
    const task = createGovernedTask({
      surface: "native",
      plan: { id: "task-4", agentId: "agent-1", task: "Edit", operations: [{ id: "write-1", capabilityId: "recoder.workspace.write", summary: "Write file" }] },
      execute: async () => { throw new Error("write rejected"); },
    });
    task.approve();
    const result = await task.run();
    expect(result.phase).toBe("failed");
    expect(result.error).toBe("write rejected");
    expect(result.completedOperationIds).toEqual([]);
  });
});
