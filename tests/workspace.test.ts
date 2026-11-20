import { describe, expect, it } from "vitest";
import { createFile, createInitialSnapshot, createProject, updateFile } from "../lib/workspace/core";

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
});
