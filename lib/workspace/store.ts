import AsyncStorage from "@react-native-async-storage/async-storage";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { DEFAULT_PROJECT, type Project, type SourceFile, type WorkspaceSnapshot } from "@/shared/recoder";
export { createFile, createInitialSnapshot, createProject, updateFile } from "./core";
import { createInitialSnapshot, createProject, createFile, updateFile } from "./core";

const STORAGE_KEY = "recoder.workspace.v1";

export async function loadWorkspace(): Promise<WorkspaceSnapshot> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return createInitialSnapshot();
  try {
    const parsed = JSON.parse(raw) as WorkspaceSnapshot;
    if (parsed.version !== 1 || !Array.isArray(parsed.projects) || parsed.projects.length === 0) return createInitialSnapshot();
    return parsed;
  } catch {
    return createInitialSnapshot();
  }
}

export async function saveWorkspace(snapshot: WorkspaceSnapshot): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
}

export async function importTextFile(): Promise<{ name: string; content: string } | null> {
  const result = await DocumentPicker.getDocumentAsync({ type: "text/*", copyToCacheDirectory: true });
  if (result.canceled || !result.assets?.[0]) return null;
  const asset = result.assets[0];
  const content = await FileSystem.readAsStringAsync(asset.uri);
  return { name: asset.name || "imported.txt", content };
}

export async function exportTextFile(file: SourceFile): Promise<boolean> {
  const uri = `${FileSystem.cacheDirectory ?? FileSystem.documentDirectory}recoder-${file.name.replace(/[^a-zA-Z0-9._-]/g, "-")}`;
  await FileSystem.writeAsStringAsync(uri, file.content);
  if (!(await Sharing.isAvailableAsync())) return false;
  await Sharing.shareAsync(uri, { mimeType: "text/plain", dialogTitle: `Export ${file.name}` });
  return true;
}
