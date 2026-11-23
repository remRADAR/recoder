import { DEFAULT_PROJECT, type Project, type SourceFile, type WorkspaceSnapshot } from "../../shared/recoder";

export const MAX_WORKSPACE_SNAPSHOT_BYTES = 2 * 1024 * 1024;
const now = () => Date.now();
let workspaceUuidProvider: (() => string | undefined) | null = null;
export function configureWorkspaceUuidProvider(provider: () => string | undefined) { workspaceUuidProvider = provider; }
const id = (prefix: string) => { let random: string | undefined; try { random = workspaceUuidProvider?.(); } catch { random = undefined; } if (!random) random = globalThis.crypto?.randomUUID?.(); random ??= `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`; return `${prefix}-${random}`; };
export function utf8ByteLength(value: string): number { return new TextEncoder().encode(value).byteLength; }
export function validateWorkspaceSnapshot(snapshot: WorkspaceSnapshot): void { if (!snapshot || snapshot.version !== 1 || !Array.isArray(snapshot.projects) || snapshot.projects.length === 0) throw new Error("Workspace snapshot is invalid"); if (utf8ByteLength(JSON.stringify(snapshot)) > MAX_WORKSPACE_SNAPSHOT_BYTES) throw new Error("Workspace snapshot exceeds the 2 MB limit"); }
export function createInitialSnapshot(): WorkspaceSnapshot { const project = { ...DEFAULT_PROJECT, createdAt: now(), files: DEFAULT_PROJECT.files.map((file) => ({ ...file, updatedAt: now() })) }; return { version: 1, activeProjectId: project.id, activeFileId: project.files[0].id, projects: [project] }; }
export function updateFile(snapshot: WorkspaceSnapshot, fileId: string, content: string): WorkspaceSnapshot { return { ...snapshot, projects: snapshot.projects.map((project) => ({ ...project, files: project.files.map((file) => file.id === fileId ? { ...file, content, updatedAt: now() } : file) })) }; }
export function validateFileName(name: string): string {
  const cleanName = name.trim();
  if (!cleanName) throw new Error("File name cannot be empty");
  if (/[\\/\u0000-\u001f\u007f]/.test(cleanName)) throw new Error("File name contains invalid characters");
  return cleanName;
}
export function repairActiveFile(snapshot: WorkspaceSnapshot): WorkspaceSnapshot {
  const activeProject = snapshot.projects.find((project) => project.id === snapshot.activeProjectId) ?? snapshot.projects[0];
  const activeFile = activeProject?.files.find((file) => file.id === snapshot.activeFileId) ?? activeProject?.files[0];
  return activeProject && activeFile && activeProject.id === snapshot.activeProjectId && activeFile.id === snapshot.activeFileId
    ? snapshot
    : { ...snapshot, activeProjectId: activeProject.id, activeFileId: activeFile.id };
}
export function renameFile(snapshot: WorkspaceSnapshot, fileId: string, name: string): WorkspaceSnapshot {
  const cleanName = validateFileName(name);
  const project = snapshot.projects.find((item) => item.files.some((file) => file.id === fileId));
  if (!project) throw new Error("File not found");
  if (project.files.some((file) => file.id !== fileId && file.name.toLowerCase() === cleanName.toLowerCase())) throw new Error("A file with that name already exists");
  return { ...snapshot, projects: snapshot.projects.map((item) => item.id !== project.id ? item : { ...item, files: item.files.map((file) => file.id === fileId ? { ...file, name: cleanName } : file) }) };
}
export function deleteFile(snapshot: WorkspaceSnapshot, projectId: string, fileId: string): WorkspaceSnapshot {
  const project = snapshot.projects.find((item) => item.id === projectId);
  if (!project) throw new Error("Project not found");
  if (!project.files.some((file) => file.id === fileId)) throw new Error("File not found");
  if (project.files.length === 1) throw new Error("A project must keep at least one file");
  const fileIndex = project.files.findIndex((file) => file.id === fileId);
  const files = project.files.filter((file) => file.id !== fileId);
  const next = { ...snapshot, projects: snapshot.projects.map((item) => item.id === projectId ? { ...item, files } : item) };
  if (snapshot.activeProjectId !== projectId || snapshot.activeFileId !== fileId) return next;
  return { ...next, activeFileId: files[Math.min(fileIndex, files.length - 1)].id };
}
export function createProject(snapshot: WorkspaceSnapshot, name: string): WorkspaceSnapshot { const projectId = id("project"); const fileId = id("file"); const htmlId = id("file"); const project: Project = { id: projectId, name: name.trim() || "Untitled project", createdAt: now(), files: [{ id: fileId, name: "main.js", language: "javascript", content: "console.log(\"Hello from Recoder\");\n", updatedAt: now() }, { id: htmlId, name: "index.html", language: "text", content: "<!doctype html><html><body><h1>Recoder preview</h1></body></html>\n", updatedAt: now() }] }; return { ...snapshot, activeProjectId: projectId, activeFileId: fileId, projects: [...snapshot.projects, project] }; }
const languageForName = (name: string): SourceFile["language"] => { const lower = name.toLowerCase(); return lower.endsWith(".md") ? "markdown" : lower.endsWith(".html") ? "text" : lower.endsWith(".js") ? "javascript" : "typescript"; };
export function createFile(snapshot: WorkspaceSnapshot, projectId: string, name: string): WorkspaceSnapshot { const cleanName = validateFileName(name || "untitled.js"); const language = languageForName(cleanName); const project = snapshot.projects.find((item) => item.id === projectId); if (!project) throw new Error("Project not found"); if (project.files.some((file) => file.name.toLowerCase() === cleanName.toLowerCase())) throw new Error("A file with that name already exists"); const file: SourceFile = { id: id("file"), name: cleanName, language, content: language === "javascript" ? "console.log(\"Hello from Recoder\");\n" : language === "text" ? "<!doctype html><html><body></body></html>\n" : "", updatedAt: now() }; return { ...snapshot, activeFileId: file.id, projects: snapshot.projects.map((item) => item.id === projectId ? { ...item, files: [...item.files, file] } : item) }; }
