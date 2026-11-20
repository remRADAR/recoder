import { describe, expect, it } from "vitest";
import { createFile, createInitialSnapshot, createProject, deleteFile, renameFile, updateFile } from "../lib/workspace/core";

describe("workspace state", () => {
  it("creates a project and updates a file without mutating the previous snapshot", () => {
    const initial = createInitialSnapshot();
    const next = createProject(initial, "Demo");
    expect(next.projects).toHaveLength(2);
    const withFile = createFile(next, next.activeProjectId, "notes.md");
    const changed = updateFile(withFile, withFile.activeFileId, "# Notes");
    expect(changed.projects.at(-1)?.files.at(-1)?.content).toBe("# Notes");
    expect(initial.projects).toHaveLength(1);
  });

  it("generates distinct identifiers for rapid consecutive projects and files", () => {
    const initial = createInitialSnapshot();
    const first = createProject(initial, "One");
    const second = createProject(first, "Two");
    const withFirstFile = createFile(second, second.activeProjectId, "a.ts");
    const withSecondFile = createFile(withFirstFile, second.activeProjectId, "b.ts");
    expect(new Set(withSecondFile.projects.map((project) => project.id)).size).toBe(withSecondFile.projects.length);
    const files = withSecondFile.projects.flatMap((project) => project.files.map((file) => file.id));
    expect(new Set(files).size).toBe(files.length);
  });

  it("renames files with validation and preserves unrelated projects", () => {
    const initial = createInitialSnapshot();
    const next = createProject(initial, "Demo");
    const file = next.projects[1].files[0];
    const renamed = renameFile(next, file.id, " app.ts ");
    expect(renamed.projects[1].files[0]).toMatchObject({ id: file.id, name: "app.ts", content: file.content, language: file.language });
    expect(renamed.projects[0]).toBe(next.projects[0]);
    expect(() => renameFile(next, file.id, "bad/name.ts")).toThrow("invalid");
    expect(() => renameFile(next, file.id, "index.html")).toThrow("already exists");
  });

  it("deletes a file and repairs the active-file pointer deterministically", () => {
    const initial = createInitialSnapshot();
    const project = initial.projects[0];
    const deleted = deleteFile({ ...initial, activeFileId: project.files[1].id }, project.id, project.files[1].id);
    expect(deleted.projects[0].files.map((file) => file.id)).toEqual(["file-main", "file-readme"]);
    expect(deleted.activeFileId).toBe("file-readme");
    expect(() => deleteFile({ ...initial, projects: [{ ...project, files: [project.files[0]] }] }, project.id, project.files[0].id)).toThrow("at least one");
  });
});
