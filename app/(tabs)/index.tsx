import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import WebView from "react-native-webview";
import { ScreenContainer } from "@/components/screen-container";
import { CodeMirrorEditor } from "@/components/CodeMirrorEditor";
import { createNativeProvider, startPreview, stopPreview } from "@/lib/runtime/native";
import { createFile, createInitialSnapshot, createProject, exportTextFile, importTextFile, loadWorkspace, saveWorkspace, updateFile } from "@/lib/workspace/store";
import { createSaveCoordinator } from "@/lib/workspace/persistence";
import type { ExecutionSession, LocalServer, WorkspaceSnapshot } from "@/shared/recoder";

const colors = { ink: "#f5f7fa", muted: "#a8b2c1", panel: "#111827", panel2: "#1c2635", line: "#2f3b4d", accent: "#7dd3fc", good: "#86efac", warn: "#fcd34d" };
const runtimeSelection = createNativeProvider();
type ButtonProps = { label: string; onPress: () => void; active?: boolean; disabled?: boolean };

export default function HomeScreen() {
  const [workspace, setWorkspace] = useState<WorkspaceSnapshot>(() => createInitialSnapshot());
  const [loaded, setLoaded] = useState(false);
  const [session, setSession] = useState<ExecutionSession | null>(null);
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState("");
  const [server, setServer] = useState<LocalServer | null>(null);
  const [persistenceError, setPersistenceError] = useState<string | null>(null);
  const saveCoordinator = useRef(createSaveCoordinator(saveWorkspace, (state) => setPersistenceError(state.error?.message ?? null)));

  useEffect(() => { loadWorkspace().then((value) => { setWorkspace(value); setLoaded(true); }); }, []);
  useEffect(() => { if (loaded) void saveCoordinator.current.save(workspace).catch(() => undefined); }, [workspace, loaded]);
  useEffect(() => () => { if (server) void stopPreview(server.id); }, [server]);

  const project = workspace.projects.find((item) => item.id === workspace.activeProjectId) ?? workspace.projects[0];
  const file = project.files.find((item) => item.id === workspace.activeFileId) ?? project.files[0];
  const update = useCallback((next: WorkspaceSnapshot) => setWorkspace(next), []);

  const run = async () => {
    setBusy(true);
    try { setSession(await runtimeSelection.provider.start({ project, file })); }
    catch (error) { Alert.alert("Device runtime unavailable", error instanceof Error ? error.message : "Build a development client with Expo prebuild."); }
    finally { setBusy(false); }
  };
  const cancel = async () => { if (!session) return; await runtimeSelection.provider.cancel(session.id).catch(() => undefined); setSession((current) => current ? { ...current, status: "cancelled", finishedAt: Date.now() } : current); };
  const openPreview = async () => { try { setServer(await startPreview(project)); } catch (error) { Alert.alert("Local preview unavailable", error instanceof Error ? error.message : "Build a development client with Expo prebuild."); } };
  const closePreview = async () => { if (!server) return; await stopPreview(server.id); setServer(null); };
  const addProject = () => { update(createProject(workspace, newName)); setNewName(""); };
  const addFile = () => update(createFile(workspace, project.id, `file-${project.files.length + 1}.ts`));
  const importFile = async () => { try { const imported = await importTextFile(); if (!imported) return; const withFile = createFile(workspace, project.id, imported.name); update(updateFile(withFile, withFile.activeFileId, imported.content)); } catch (error) { Alert.alert("Import failed", error instanceof Error ? error.message : "The file could not be imported"); } };
  const exportFile = async () => { try { await exportTextFile(file); } catch (error) { Alert.alert("Export failed", error instanceof Error ? error.message : "The file could not be exported"); } };
  const retrySave = async () => { await saveCoordinator.current.retry().catch(() => undefined); };
  const output = useMemo(() => session?.events.map((item) => `[${item.stream}] ${item.text}`).join("\n") ?? "No execution started.", [session]);

  if (!loaded) return <ScreenContainer className="items-center justify-center"><ActivityIndicator color={colors.accent} /></ScreenContainer>;
  return <ScreenContainer style={{ backgroundColor: "#0b1020" }}>
    <ScrollView contentContainerStyle={{ padding: 18, gap: 14 }} keyboardShouldPersistTaps="handled">
      <View style={{ gap: 4 }}><Text style={{ color: colors.accent, fontSize: 12, fontWeight: "700", letterSpacing: 2 }}>RECODER M0.6 / POC-1</Text><Text style={{ color: colors.ink, fontSize: 30, fontWeight: "800" }}>The device is the computer</Text><Text style={{ color: colors.muted, fontSize: 14 }}>Local JavaScript execution, local files, and a loopback-only preview server.</Text></View>
      <View style={{ flexDirection: "row", gap: 8 }}><TextInput value={newName} onChangeText={setNewName} placeholder="New project name" placeholderTextColor={colors.muted} style={{ flex: 1, color: colors.ink, backgroundColor: colors.panel, borderColor: colors.line, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 }} /><Button label="Create" onPress={addProject} /></View>
      <View style={{ flexDirection: "row", gap: 8 }}><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>{workspace.projects.map((item) => <Button key={item.id} label={item.name} active={item.id === project.id} onPress={() => update({ ...workspace, activeProjectId: item.id, activeFileId: item.files[0].id })} />)}</ScrollView><Button label="+ File" onPress={addFile} /></View>
      <View style={{ backgroundColor: colors.panel, borderColor: colors.line, borderWidth: 1, borderRadius: 14, overflow: "hidden" }}><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 2, padding: 8 }}>{project.files.map((item) => <Pressable key={item.id} onPress={() => update({ ...workspace, activeFileId: item.id })} style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: item.id === file.id ? colors.panel2 : "transparent" }}><Text style={{ color: item.id === file.id ? colors.ink : colors.muted, fontWeight: "700" }}>{item.name}</Text></Pressable>)}</ScrollView><View style={{ height: 360 }}><CodeMirrorEditor value={file.content} onChange={(content) => update(updateFile(workspace, file.id, content))} /></View></View>
      {persistenceError && <View style={{ backgroundColor: "#451a03", borderColor: colors.warn, borderWidth: 1, borderRadius: 10, padding: 12, gap: 8 }}><Text style={{ color: colors.warn }}>Workspace save failed: {persistenceError}. Your latest unsaved changes are retained.</Text><Button label="Retry latest save" onPress={() => void retrySave()} /></View>}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}><Button label="Import file" onPress={() => void importFile()} /><Button label="Export file" onPress={() => void exportFile()} /><Button label={busy ? "Running locally…" : "Run on device"} active onPress={() => void run()} disabled={busy} />{session?.status === "running" && <Button label="Stop" onPress={() => void cancel()} />}<Button label={server ? "Stop preview" : "Start local preview"} onPress={() => void (server ? closePreview() : openPreview())} /></View>
      <View style={{ backgroundColor: colors.panel, borderColor: colors.line, borderWidth: 1, borderRadius: 14, padding: 14, gap: 8 }}><View style={{ flexDirection: "row", justifyContent: "space-between" }}><Text style={{ color: colors.ink, fontWeight: "800" }}>Device execution</Text><Text style={{ color: session?.status === "completed" ? colors.good : colors.warn, fontWeight: "700" }}>{session?.status ?? "idle"}</Text></View><Text style={{ color: colors.muted, fontSize: 12 }}>Dedicated non-persistent WebView context. Timeout: 5 seconds. Output limit: 64 KB. This is application sandboxing, not hostile-code OS isolation.</Text><Text selectable style={{ color: colors.ink, fontFamily: "monospace", fontSize: 12, lineHeight: 19 }}>{output}</Text></View>
      {server && Platform.OS !== "web" && <View style={{ height: 360, backgroundColor: colors.panel, borderRadius: 14, overflow: "hidden" }}><Text style={{ color: colors.muted, padding: 10 }}>Loopback preview: {server.url}</Text><WebView source={{ uri: server.url }} originWhitelist={["http://127.0.0.1"]} javaScriptEnabled /></View>}
    </ScrollView>
  </ScreenContainer>;
}

function Button({ label, onPress, active = false, disabled = false }: ButtonProps) { return <Pressable disabled={disabled} onPress={onPress} style={{ backgroundColor: active ? "#164e63" : "#1c2635", borderColor: active ? "#38bdf8" : "#2f3b4d", borderWidth: 1, borderRadius: 9, paddingHorizontal: 12, paddingVertical: 10, opacity: disabled ? 0.45 : 1 }}><Text style={{ color: active ? "#e0f2fe" : "#d7dee8", fontWeight: "700", fontSize: 12 }}>{label}</Text></Pressable>; }
