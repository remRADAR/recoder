import { DEFAULT_PROJECT, type Project, type SourceFile, type WorkspaceSnapshot } from "../../shared/recoder";

const now = () => Date.now();

export function createInitialSnapshot(): WorkspaceSnapshot {
  const project = { ...DEFAULT_PROJECT, createdAt: now(), files: DEFAULT_PROJECT.files.map((file) => ({ ...file, updatedAt: now() })) };
  return { version: 1, activeProjectId: project.id, activeFileId: project.files[0].id, projects: [project] };
}

export function updateFile(snapshot: WorkspaceSnapshot, fileId: string, content: string): WorkspaceSnapshot {
  return { ...snapshot, projects: snapshot.projects.map((project) => ({ ...project, files: project.files.map((file) => file.id === fileId ? { ...file, content, updatedAt: now() } : file) })) };
}

export function createProject(snapshot: WorkspaceSnapshot, name: string): WorkspaceSnapshot {
  const projectId = `project-${now()}`;
  const fileId = `file-${now()}`;
  const project: Project = { id: projectId, name: name.trim() || "Untitled project", createdAt: now(), files: [{ id: fileId, name: "main.ts", language: "typescript", content: "console.log(\"Hello from Recoder\");\n", updatedAt: now() }] };
  return { ...snapshot, activeProjectId: projectId, activeFileId: fileId, projects: [...snapshot.projects, project] };
}

export function createFile(snapshot: WorkspaceSnapshot, projectId: string, name: string): WorkspaceSnapshot {
  const fileId = `file-${now()}`;
  const file: SourceFile = { id: fileId, name: name.trim() || "untitled.ts", language: name.endsWith(".md") ? "markdown" : "typescript", content: "", updatedAt: now() };
  return { ...snapshot, activeFileId: fileId, projects: snapshot.projects.map((project) => project.id === projectId ? { ...project, files: [...project.files, file] } : project) };
}
