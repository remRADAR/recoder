import { describe, expect, it, vi } from "vitest";
import { runAgentTask } from "../lib/agents/runtime";
import type { Project, WorkspaceSnapshot } from "@/shared/recoder";

vi.mock("@/lib/agents/config", () => ({
  getAgentRuntimeConfig: vi.fn(async () => ({ kind: "openai", model: "gpt-test", baseUrl: "https://provider.test/v1", apiKey: "secret" })),
}));

describe("agent workspace runtime", () => {
  it("applies a model write tool call to the workspace and then completes", async () => {
    const project: Project = { id: "project-1", name: "Demo", createdAt: 0, files: [{ id: "file-1", name: "main.js", language: "javascript", content: "old", updatedAt: 0 }] };
    const workspace: WorkspaceSnapshot = { version: 1, activeProjectId: project.id, activeFileId: "file-1", projects: [project] };
    const responses = [
      { choices: [{ message: { role: "assistant", content: "I will update the file.", tool_calls: [{ id: "call-1", type: "function", function: { name: "write_file", arguments: JSON.stringify({ path: "main.js", content: "new" }) } }] } }] },
      { choices: [{ message: { role: "assistant", content: "Updated main.js successfully." } }] },
    ];
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify(responses.shift()), { status: 200, headers: { "content-type": "application/json" } }));
    try {
      const result = await runAgentTask({ agent: { id: "agent-1", name: "Coder", providerId: "provider-1", model: "gpt-test", systemPrompt: "Be concise.", enabled: true }, project, workspace, task: "Update main.js", runFile: async () => "ran", requestApproval: async () => true });
      expect(result.text).toContain("Updated main.js");
      expect(result.workspace.projects[0].files[0].content).toBe("new");
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(String(fetchMock.mock.calls[0]?.[1]?.body)).not.toContain("secret");
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("returns a governed rejection to the model without mutating the workspace", async () => {
    const project: Project = { id: "project-1", name: "Demo", createdAt: 0, files: [{ id: "file-1", name: "main.js", language: "javascript", content: "old", updatedAt: 0 }] };
    const workspace: WorkspaceSnapshot = { version: 1, activeProjectId: project.id, activeFileId: "file-1", projects: [project] };
    const responses = [
      { choices: [{ message: { role: "assistant", content: "I need to update the file.", tool_calls: [{ id: "call-rejected", type: "function", function: { name: "write_file", arguments: JSON.stringify({ path: "main.js", content: "unsafe change" }) } }] } }] },
      { choices: [{ message: { role: "assistant", content: "The change was not applied." } }] },
    ];
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify(responses.shift()), { status: 200, headers: { "content-type": "application/json" } }));
    try {
      const result = await runAgentTask({ agent: { id: "agent-1", name: "Coder", providerId: "provider-1", model: "gpt-test", systemPrompt: "Be concise.", enabled: true }, project, workspace, task: "Update main.js", runFile: async () => "ran", requestApproval: async () => false });
      expect(result.workspace.projects[0].files[0].content).toBe("old");
      expect(result.events.some((event) => event.kind === "error" && event.text.includes("rejected"))).toBe(true);
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("gates code execution with the runtime capability", async () => {
    const project: Project = { id: "project-1", name: "Demo", createdAt: 0, files: [{ id: "file-1", name: "main.js", language: "javascript", content: "console.log(1)", updatedAt: 0 }] };
    const workspace: WorkspaceSnapshot = { version: 1, activeProjectId: project.id, activeFileId: "file-1", projects: [project] };
    const responses = [
      { choices: [{ message: { role: "assistant", content: "I will run it.", tool_calls: [{ id: "call-run", type: "function", function: { name: "run_file", arguments: JSON.stringify({ path: "main.js" }) } }] } }] },
      { choices: [{ message: { role: "assistant", content: "Execution finished." } }] },
    ];
    const approvals: string[] = [];
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify(responses.shift()), { status: 200, headers: { "content-type": "application/json" } }));
    try {
      const result = await runAgentTask({ agent: { id: "agent-1", name: "Coder", providerId: "provider-1", model: "gpt-test", systemPrompt: "Be concise.", enabled: true }, project, workspace, task: "Run main.js", runFile: async () => "ran", requestApproval: async ({ capability }) => { approvals.push(capability.id); return true; } });
      expect(result.text).toContain("Execution finished");
      expect(approvals).toEqual(["recoder.runtime.run"]);
    } finally {
      fetchMock.mockRestore();
    }
  });
});
