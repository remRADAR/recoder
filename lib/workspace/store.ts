import AsyncStorage from "@react-native-async-storage/async-storage";
import * as DocumentPicker from "expo-document-picker";
import * as ExpoCrypto from "expo-crypto";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { apiCall } from "@/lib/_core/api";
import { type SourceFile, type WorkspaceSnapshot } from "@/shared/recoder";
export { createFile, createInitialSnapshot, createProject, deleteFile, renameFile, repairActiveFile, updateFile, validateFileName, validateWorkspaceSnapshot, MAX_WORKSPACE_SNAPSHOT_BYTES, utf8ByteLength } from "./core";
import { configureWorkspaceUuidProvider, createFile, createInitialSnapshot, createProject, updateFile, validateWorkspaceSnapshot } from "./core";
import { MAX_IMPORT_BYTES, persistWorkspaceSnapshot, readImportedTextAsset } from "./persistence";

configureWorkspaceUuidProvider(() => ExpoCrypto.randomUUID?.());
const STORAGE_KEY = "recoder.workspace.v1";
let githubMode = false;
let githubSha: string | null = null;
export type WorkspacePersistenceMode = "github" | "local";
export function getWorkspacePersistenceMode(): WorkspacePersistenceMode { return githubMode ? "github" : "local"; }
export { MAX_IMPORT_BYTES } from "./persistence";

type GithubSyncConfig = { enabled: boolean; repository: string | null; branch: string | null; path: string | null };
type GithubWorkspaceResponse = { snapshot: WorkspaceSnapshot | null; sha: string | null };
async function detectGithubSync(): Promise<boolean> {
  try {
    const config = await apiCall<GithubSyncConfig>("/api/github-sync/config");
    githubMode = config.enabled;
  } catch {
    // Preview and offline sessions should remain usable when auth or GitHub sync is unavailable.
    githubMode = false;
  }
  return githubMode;
}

export async function loadWorkspace(): Promise<WorkspaceSnapshot> {
  if (await detectGithubSync()) {
    const remote = await apiCall<GithubWorkspaceResponse>("/api/github-sync/workspace");
    githubSha = remote.sha;
    if (!remote.snapshot) return createInitialSnapshot();
    validateWorkspaceSnapshot(remote.snapshot);
    return remote.snapshot;
  }
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return createInitialSnapshot();
  try {
    const parsed = JSON.parse(raw) as WorkspaceSnapshot;
    validateWorkspaceSnapshot(parsed);
    return parsed;
  } catch {
    return createInitialSnapshot();
  }
}

export async function saveWorkspace(snapshot: WorkspaceSnapshot): Promise<void> {
  if (!githubMode) await detectGithubSync();
  if (githubMode) {
    const result = await apiCall<{ sha: string }>("/api/github-sync/workspace", { method: "PUT", body: JSON.stringify({ snapshot, sha: githubSha }) });
    githubSha = result.sha;
    return;
  }
  await persistWorkspaceSnapshot(snapshot, (serialized) => AsyncStorage.setItem(STORAGE_KEY, serialized));
}

export async function importTextFile(): Promise<{ name: string; content: string } | null> {
  const result = await DocumentPicker.getDocumentAsync({ type: "text/*", copyToCacheDirectory: true });
  if (result.canceled || !result.assets?.[0]) return null;
  const asset = result.assets[0];
  return readImportedTextAsset(asset, (uri) => FileSystem.readAsStringAsync(uri));
}

export async function exportTextFile(file: SourceFile): Promise<void> {
  const directory = FileSystem.cacheDirectory ?? FileSystem.documentDirectory;
  if (!directory) throw new Error("File export is unavailable on this platform");
  const uri = `${directory}recoder-${file.name.replace(/[^a-zA-Z0-9._-]/g, "-")}`;
  try {
    await FileSystem.writeAsStringAsync(uri, file.content);
    if (!(await Sharing.isAvailableAsync())) throw new Error("Sharing is unavailable on this platform");
    await Sharing.shareAsync(uri, { mimeType: "text/plain", dialogTitle: `Export ${file.name}` });
  } finally {
    await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined);
  }
}
