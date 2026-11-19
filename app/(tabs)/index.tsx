import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { CodeMirrorEditor } from "@/components/CodeMirrorEditor";
import { disposableRemoteProvider } from "@/lib/execution/provider";
import { createFile, createInitialSnapshot, createProject, exportTextFile, importTextFile, loadWorkspace, saveWorkspace, updateFile } from "@/lib/workspace/store";
import type { ExecutionSession, WorkspaceSnapshot } from "@/shared/recoder";

const colors = { ink: "#f5f7fa", muted: "#a8b2c1", panel: "#111827", panel2: "#1c2635", line: "#2f3b4d", accent: "#7dd3fc", good: "#86efac", warn: "#fcd34d" };

type ButtonProps = { label: string; onPress: () => void; active?: boolean; disabled?: boolean };

export default function HomeScreen() {
  const [workspace, setWorkspace] = useState<WorkspaceSnapshot>(() => createInitialSnapshot());
  const [loaded, setLoaded] = useState(false);
  const [session, setSession] = useState<ExecutionSession | null>(null);
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState("");
  const [polling, setPolling] = useState(false);

  useEffect(() => { loadWorkspace().then((value) => { setWorkspace(value); setLoaded(true); }); }, []);
  useEffect(() => { if (loaded) void saveWorkspace(workspace); }, [workspace, loaded]);

  const project = workspace.projects.find((item) => item.id === workspace.activeProjectId) ?? workspace.projects[0];
  const file = project.files.find((item) => item.id === workspace.activeFileId) ?? project.files[0];
  const update = useCallback((next: WorkspaceSnapshot) => setWorkspace(next), []);

  const run = async () => {
    setBusy(true);
    try { const started = await disposableRemoteProvider.start({ project, file }); setSession(started); setPolling(true); } catch (error) { Alert.alert("Execution unavailable", error instanceof Error ? error.message : "Unknown error"); } finally { setBusy(false); }
  };
  useEffect(() => {
    if (!polling || !session || session.status !== "running") return;
    const timer = setInterval(async () => { try { const next = await disposableRemoteProvider.get(session.id); setSession(next); if (next.status !== "running") { setPolling(false); clearInterval(timer); } } catch { setPolling(false); } }, 500);
    return () => clearInterval(timer);
  }, [polling, session]);

  const addProject = () => { update(createProject(workspace, newName)); setNewName(""); };
  const addFile = () => update(createFile(workspace, project.id, `file-${project.files.length + 1}.ts`));
  const importFile = async () => { const imported = await importTextFile(); if (!imported) return; const withFile = createFile(workspace, project.id, imported.name); update(updateFile(withFile, withFile.activeFileId, imported.content)); };
  const output = useMemo(() => session?.events.map((item) => `[${item.stream}] ${item.text}`).join("\n") ?? "No execution started.", [session]);

  if (!loaded) return <ScreenContainer className="items-center justify-center"><ActivityIndicator color={colors.accent} /></ScreenContainer>;
  return <ScreenContainer style={{ backgroundColor: "#0b1020" }}>
    <ScrollView contentContainerStyle={{ padding: 18, gap: 14 }} keyboardShouldPersistTaps="handled">
      <View style={{ gap: 4 }}><Text style={{ color: colors.accent, fontSize: 12, fontWeight: "700", letterSpacing: 2 }}>RECODER M0.5</Text><Text style={{ color: colors.ink, fontSize: 30, fontWeight: "800" }}>Mobile IDE feasibility</Text><Text style={{ color: colors.muted, fontSize: 14 }}>A bounded prototype for editing, persistence, and remote execution.</Text></View>
      <View style={{ flexDirection: "row", gap: 8 }}><TextInput value={newName} onChangeText={setNewName} placeholder="New project name" placeholderTextColor={colors.muted} style={{ flex: 1, color: colors.ink, backgroundColor: colors.panel, borderColor: colors.line, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 }} /><Button label="Create" onPress={addProject} /></View>
      <View style={{ flexDirection: "row", gap: 8 }}><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>{workspace.projects.map((item) => <Button key={item.id} label={item.name} active={item.id === project.id} onPress={() => update({ ...workspace, activeProjectId: item.id, activeFileId: item.files[0].id })} />)}</ScrollView><Button label="+ File" onPress={addFile} /></View>
      <View style={{ backgroundColor: colors.panel, borderColor: colors.line, borderWidth: 1, borderRadius: 14, overflow: "hidden" }}><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 2, padding: 8 }}>{project.files.map((item) => <Pressable key={item.id} onPress={() => update({ ...workspace, activeFileId: item.id })} style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: item.id === file.id ? colors.panel2 : "transparent" }}><Text style={{ color: item.id === file.id ? colors.ink : colors.muted, fontWeight: "700" }}>{item.name}</Text></Pressable>)}</ScrollView><View style={{ height: 360 }}><CodeMirrorEditor value={file.content} onChange={(content) => update(updateFile(workspace, file.id, content))} /></View></View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}><Button label="Import file" onPress={importFile} /><Button label="Export file" onPress={() => void exportTextFile(file)} /><Button label={busy ? "Starting…" : "Run simulated proof"} active onPress={() => void run()} disabled={busy || session?.status === "running"} />{session?.status === "running" && <Button label="Cancel" onPress={() => void (async () => { await disposableRemoteProvider.cancel(session.id); setSession(await disposableRemoteProvider.get(session.id)); setPolling(false); })()} />}</View>
      <View style={{ backgroundColor: colors.panel, borderColor: colors.line, borderWidth: 1, borderRadius: 14, padding: 14, gap: 8 }}><View style={{ flexDirection: "row", justifyContent: "space-between" }}><Text style={{ color: colors.ink, fontWeight: "800" }}>Execution session</Text><Text style={{ color: session?.status === "completed" ? colors.good : colors.warn, fontWeight: "700" }}>{session?.status ?? "idle"}</Text></View><Text style={{ color: colors.muted, fontSize: 12 }}>The proof accepts metadata only; it does not execute client-provided shell commands. Limit: 5 seconds. Isolation: simulated-disposable.</Text><Text selectable style={{ color: colors.ink, fontFamily: "monospace", fontSize: 12, lineHeight: 19 }}>{output}</Text></View>
    </ScrollView>
  </ScreenContainer>;
}

function Button({ label, onPress, active = false, disabled = false }: ButtonProps) { return <Pressable disabled={disabled} onPress={onPress} style={{ backgroundColor: active ? "#164e63" : "#1c2635", borderColor: active ? "#38bdf8" : "#2f3b4d", borderWidth: 1, borderRadius: 9, paddingHorizontal: 12, paddingVertical: 10, opacity: disabled ? 0.45 : 1 }}><Text style={{ color: active ? "#e0f2fe" : "#d7dee8", fontWeight: "700", fontSize: 12 }}>{label}</Text></Pressable>; }
