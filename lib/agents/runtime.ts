import { getAgentRuntimeConfig, type AgentProfile } from "@/lib/agents/config";
import type { Project, SourceFile, WorkspaceSnapshot } from "@/shared/recoder";

type ChatMessage = { role: "system" | "user" | "assistant" | "tool"; content: string; tool_call_id?: string; tool_calls?: ToolCall[] };
type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
type ChatResponse = { choices?: Array<{ message?: { role?: "assistant"; content?: string | null; tool_calls?: ToolCall[] } }> };

type AgentToolName = "list_files" | "read_file" | "write_file" | "append_file" | "run_file";
type AgentTool = { type: "function"; function: { name: AgentToolName; description: string; parameters: Record<string, unknown> } };

export type AgentRuntimeEvent = { id: number; kind: "status" | "tool" | "assistant" | "error"; text: string; at: number };
export type AgentTaskResult = { text: string; workspace: WorkspaceSnapshot; events: AgentRuntimeEvent[] };

type RunAgentTaskInput = {
  agent: AgentProfile;
  project: Project;
  workspace: WorkspaceSnapshot;
  task: string;
  runFile: (file: SourceFile) => Promise<string>;
  onEvent?: (event: AgentRuntimeEvent) => void;
};

const MAX_TURNS = 8;
const MAX_READ_CHARS = 30_000;
const MAX_WRITE_CHARS = 80_000;
const tools: AgentTool[] = [
  { type: "function", function: { name: "list_files", description: "List files in the active project.", parameters: { type: "object", properties: {}, additionalProperties: false } } },
  { type: "function", function: { name: "read_file", description: "Read a file from the active project.", parameters: { type: "object", properties: { path: { type: "string", description: "Relative project file path" } }, required: ["path"], additionalProperties: false } } },
  { type: "function", function: { name: "write_file", description: "Replace a file in the active project. Use only when the user asks for an edit.", parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"], additionalProperties: false } } },
  { type: "function", function: { name: "append_file", description: "Append text to a file in the active project. Use only when the user asks for an edit.", parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"], additionalProperties: false } } },
  { type: "function", function: { name: "run_file", description: "Run a JavaScript file through the existing bounded device runtime.", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"], additionalProperties: false } } },
];

function emit(events: AgentRuntimeEvent[], input: Omit<AgentRuntimeEvent, "id" | "at">, onEvent?: (event: AgentRuntimeEvent) => void) {
  const event = { ...input, id: events.length + 1, at: Date.now() };
  events.push(event);
  onEvent?.(event);
}

function endpoint(baseUrl: string, kind: string) {
  const defaults: Record<string, string> = { openai: "https://api.openai.com/v1", "openai-compatible": "https://api.openai.com/v1" };
  const root = (baseUrl.trim() || defaults[kind] || "").replace(/\/$/, "");
  if (!root) throw new Error("This provider needs an OpenAI-compatible base URL for agent tasks.");
  return root.endsWith("/chat/completions") ? root : `${root}/chat/completions`;
}

function parseArguments(call: ToolCall): Record<string, string> {
  try {
    const value = JSON.parse(call.function.arguments);
    return value && typeof value === "object" ? value as Record<string, string> : {};
  } catch {
    return {};
  }
}

function findFile(project: Project, path: string) {
  const normalized = path.replace(/^\.\//, "");
  return project.files.find((file) => file.name === normalized);
}

function updateProject(workspace: WorkspaceSnapshot, projectId: string, path: string, content: string, append: boolean) {
  const project = workspace.projects.find((item) => item.id === projectId);
  if (!project) throw new Error("Active project not found.");
  const file = findFile(project, path);
  if (!file) throw new Error(`File not found: ${path}`);
  if (content.length > MAX_WRITE_CHARS) throw new Error(`Write blocked: content exceeds ${MAX_WRITE_CHARS} characters.`);
  const nextContent = append ? `${file.content}${content}` : content;
  return {
    ...workspace,
    projects: workspace.projects.map((item) => item.id === projectId ? { ...item, files: item.files.map((candidate) => candidate.id === file.id ? { ...candidate, content: nextContent, updatedAt: Date.now() } : candidate) } : item),
  };
}

async function callProvider(config: { baseUrl: string; kind: string; model: string; apiKey: string }, messages: ChatMessage[]): Promise<ChatResponse> {
  const response = await fetch(endpoint(config.baseUrl, config.kind), {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({ model: config.model, messages, tools, tool_choice: "auto", max_tokens: 2_500 }),
  });
  if (!response.ok) throw new Error(`Agent provider failed (${response.status}).`);
  return response.json() as Promise<ChatResponse>;
}

async function executeTool(name: AgentToolName, args: Record<string, string>, current: { workspace: WorkspaceSnapshot; project: Project }, runFile: (file: SourceFile) => Promise<string>) {
  if (name === "list_files") return JSON.stringify(current.project.files.map((file) => ({ path: file.name, language: file.language, updatedAt: file.updatedAt })));
  const path = args.path?.trim();
  if (!path) throw new Error("Tool requires a relative file path.");
  const file = findFile(current.project, path);
  if (!file) throw new Error(`File not found: ${path}`);
  if (name === "read_file") return file.content.slice(0, MAX_READ_CHARS);
  if (name === "write_file" || name === "append_file") {
    if (typeof args.content !== "string") throw new Error("Tool requires file content.");
    current.workspace = updateProject(current.workspace, current.project.id, path, args.content, name === "append_file");
    current.project = current.workspace.projects.find((item) => item.id === current.project.id) ?? current.project;
    return `Updated ${path}.`;
  }
  if (name === "run_file") return runFile(file);
  throw new Error(`Unsupported agent tool: ${name}`);
}

export async function runAgentTask(input: RunAgentTaskInput): Promise<AgentTaskResult> {
  const config = await getAgentRuntimeConfig(input.agent.id);
  if (!config) throw new Error("Agent provider credentials are unavailable. Configure the provider in AI settings first.");
  if (!input.task.trim()) throw new Error("Describe a task for the coding agent.");
  if (!["openai", "openai-compatible"].includes(config.kind)) throw new Error("Agent tool execution currently requires an OpenAI-compatible provider endpoint. Set a compatible base URL for this provider.");

  const events: AgentRuntimeEvent[] = [];
  const current = { workspace: input.workspace, project: input.project };
  const system = `${input.agent.systemPrompt}\n\nYou are operating inside the Recoder mobile IDE. You may inspect and edit only the active project through the provided tools. Keep edits scoped, explain what changed, and never claim a task succeeded unless a tool confirms it. The user has authorized workspace read/write for this task. Execution remains bounded by the device runtime.`;
  const messages: ChatMessage[] = [{ role: "system", content: system }, { role: "user", content: input.task }];
  emit(events, { kind: "status", text: `Running ${input.agent.name} with workspace tools…` }, input.onEvent);

  for (let turn = 0; turn < MAX_TURNS; turn += 1) {
    const response = await callProvider(config, messages);
    const message = response.choices?.[0]?.message;
    if (!message) throw new Error("Agent provider returned no message.");
    const calls = message.tool_calls ?? [];
    messages.push({ role: "assistant", content: message.content ?? "", tool_calls: calls });
    if (message.content) emit(events, { kind: "assistant", text: message.content }, input.onEvent);
    if (!calls.length) return { text: message.content ?? "Task completed.", workspace: current.workspace, events };
    for (const call of calls) {
      const name = call.function.name as AgentToolName;
      const args = parseArguments(call);
      emit(events, { kind: "tool", text: `${name}${args.path ? ` · ${args.path}` : ""}` }, input.onEvent);
      try {
        const result = await executeTool(name, args, current, input.runFile);
        messages.push({ role: "tool", tool_call_id: call.id, content: result.slice(0, MAX_READ_CHARS) });
      } catch (error) {
        const messageText = error instanceof Error ? error.message : "Tool failed.";
        emit(events, { kind: "error", text: messageText }, input.onEvent);
        messages.push({ role: "tool", tool_call_id: call.id, content: `ERROR: ${messageText}` });
      }
    }
  }
  throw new Error("Agent reached the bounded tool-call limit without finishing.");
}
