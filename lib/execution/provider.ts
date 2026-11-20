import { getApiBaseUrl } from "@/constants/oauth";
import type { ExecutionProvider, ExecutionSession, Project, SourceFile } from "@/shared/recoder";

const api = () => getApiBaseUrl();

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${api()}${path}`, { ...init, credentials: "include", headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  if (!response.ok) throw new Error(`Execution request failed (${response.status})`);
  return response.json() as Promise<T>;
}

export const disposableRemoteProvider: ExecutionProvider = {
  async start(input: { project: Project; file: SourceFile }) {
    return request<ExecutionSession>("/api/execution/start", { method: "POST", body: JSON.stringify({ projectName: input.project.name, fileName: input.file.name }) });
  },
  async cancel(sessionId: string) {
    await request(`/api/execution/${encodeURIComponent(sessionId)}/cancel`, { method: "POST" });
  },
  async get(sessionId: string) {
    return request<ExecutionSession>(`/api/execution/${encodeURIComponent(sessionId)}`);
  },
};
