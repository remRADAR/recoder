export type PlatformSurface = "native" | "web";

export type SourceFile = {
  id: string;
  name: string;
  language: "typescript" | "javascript" | "markdown" | "text";
  content: string;
  updatedAt: number;
};

export type Project = {
  id: string;
  name: string;
  createdAt: number;
  files: SourceFile[];
};

export type WorkspaceSnapshot = {
  version: 1;
  activeProjectId: string;
  activeFileId: string;
  projects: Project[];
};

export type ExecutionStatus = "idle" | "starting" | "running" | "completed" | "cancelled" | "failed";

export type ExecutionEvent = {
  id: number;
  at: number;
  stream: "stdout" | "stderr" | "system";
  text: string;
};

export type ExecutionSession = {
  id: string;
  status: Exclude<ExecutionStatus, "idle" | "starting">;
  startedAt: number;
  finishedAt?: number;
  events: ExecutionEvent[];
  isolation: "simulated-disposable";
  resourceLimitMs: number;
};

export type ExecutionProvider = {
  start: (input: { project: Project; file: SourceFile }) => Promise<ExecutionSession>;
  cancel: (sessionId: string) => Promise<void>;
  get: (sessionId: string) => Promise<ExecutionSession>;
};

export const DEFAULT_PROJECT: Project = {
  id: "project-demo",
  name: "Untitled project",
  createdAt: 0,
  files: [
    {
      id: "file-main",
      name: "main.ts",
      language: "typescript",
      content: `export function greet(name: string) {\n  return \`Hello, \${name}!\`;\n}\n\nconsole.log(greet("Recoder"));\n`,
      updatedAt: 0,
    },
    {
      id: "file-readme",
      name: "README.md",
      language: "markdown",
      content: "# Untitled project\n\nA small mobile coding workspace.\n",
      updatedAt: 0,
    },
  ],
};
