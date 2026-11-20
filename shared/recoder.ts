export type PlatformSurface = "native" | "web";
export type SourceFile = { id: string; name: string; language: "typescript" | "javascript" | "markdown" | "text"; content: string; updatedAt: number };
export type Project = { id: string; name: string; createdAt: number; files: SourceFile[] };
export type WorkspaceSnapshot = { version: 1; activeProjectId: string; activeFileId: string; projects: Project[] };
export type ExecutionStatus = "idle" | "starting" | "running" | "completed" | "cancelled" | "failed" | "timed_out";
export type ExecutionStream = "stdout" | "stderr" | "system";
export type ExecutionEvent = { id: number; at: number; stream: ExecutionStream; text: string };
export type ExecutionSession = { id: string; status: Exclude<ExecutionStatus, "idle" | "starting">; startedAt: number; finishedAt?: number; events: ExecutionEvent[]; isolation: "device-webview-context" | "simulated-disposable"; resourceLimitMs: number; outputLimitBytes: number; outputTruncated?: boolean };
export type RuntimeEvent = { sessionId: string; id: number; at: number; stream: ExecutionStream; text: string; outputTruncated?: boolean };
export type LocalServer = { id: string; url: string; root: string; startedAt: number };
export type ExecutionProvider = { start: (input: { project: Project; file: SourceFile }) => Promise<ExecutionSession>; cancel: (sessionId: string) => Promise<void>; get: (sessionId: string) => Promise<ExecutionSession>; subscribe?: (listener: (event: RuntimeEvent) => void) => () => void };

export const DEFAULT_PROJECT: Project = {
  id: "project-demo", name: "Untitled project", createdAt: 0,
  files: [
    { id: "file-main", name: "main.js", language: "javascript", content: `console.log("Hello from Recoder");\nconsole.error("stderr is captured too");\n`, updatedAt: 0 },
    { id: "file-index", name: "index.html", language: "text", content: `<!doctype html><html><body><h1>Recoder preview</h1><p>Edit index.html and start local preview.</p></body></html>\n`, updatedAt: 0 },
    { id: "file-readme", name: "README.md", language: "markdown", content: "# Untitled project\n\nA local mobile coding workspace.\n", updatedAt: 0 },
  ],
};
