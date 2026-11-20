import { DEFAULT_PROJECT, type Project, type SourceFile, type WorkspaceSnapshot } from "../../shared/recoder";

export const MAX_WORKSPACE_SNAPSHOT_BYTES = 2 * 1024 * 1024;

const now = () => Date.now();
const id = (prefix: string) => {
  const runtimeCrypto = globalThis.crypto as (Crypto & { randomUUID?: () => string }) | undefined;
  const random = runtimeCrypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${random}`;
};

export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function validateWorkspaceSnapshot(snapshot: WorkspaceSnapshot): void {
  if (!snapshot || snapshot.version !== 1 || !Array.isArray(snapshot.projects) || snapshot.projects.length === 0) throw new Error("Workspace snapshot is invalid");
  if (utf8ByteLength(JSON.stringify(snapshot)) > MAX_WORKSPACE_SNAPSHOT_BYTES) throw new Error("Workspace snapshot exceeds the 2 MB limit");
}

export function createInitialSnapshot(): WorkspaceSnapshot {
  const project = { ...DEFAULT_PROJECT, createdAt: now(), files: DEFAULT_PROJECT.files.map((file) => ({ ...file, updatedAt: now() })) };
  return { version: 1, activeProjectId: project.id, activeFileId: project.files[0].id, projects: [project] };
}

export function updateFile(snapshot: WorkspaceSnapshot, fileId: string, content: string): WorkspaceSnapshot {
  return { ...snapshot, projects: snapshot.projects.map((project) => ({ ...project, files: project.files.map((file) => file.id === fileId ? { ...file, content, updatedAt: now() } : file) })) };
}

export function createProject(snapshot: WorkspaceSnapshot, name: string): WorkspaceSnapshot {
  const projectId = id("project");
  const fileId = id("file");
  const project: Project = { id: projectId, name: name.trim() || "Untitled project", createdAt: now(), files: [{ id: fileId, name: "main.ts", language: "typescript", content: "console.log(\"Hello from Recoder\");\n", updatedAt: now() }] };
  return { ...snapshot, activeProjectId: projectId, activeFileId: fileId, projects: [...snapshot.projects, project] };
}

export function createFile(snapshot: WorkspaceSnapshot, projectId: string, name: string): WorkspaceSnapshot {
  const file: SourceFile = { id: id("file"), name: name.trim() || "untitled.ts", language: name.endsWith(".md") ? "markdown" : "typescript", content: "", updatedAt: now() };
  return { ...snapshot, activeFileId: file.id, projects: snapshot.projects.map((project) => project.id === projectId ? { ...project, files: [...project.files, file] } : project) };
}
