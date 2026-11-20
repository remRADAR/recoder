import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Modal, Platform, Pressable, ScrollView, Text, TextInput, useWindowDimensions, View } from "react-native";
import WebView from "react-native-webview";
import { ScreenContainer } from "@/components/screen-container";
import { CodeMirrorEditor } from "@/components/CodeMirrorEditor";
import { AgentSettingsModal } from "@/components/AgentSettingsModal";
import { createNativeProvider, startPreview, stopPreview } from "@/lib/runtime/native";
import { isAllowedPreviewUrl } from "@/shared/runtime";
import { createFile, createInitialSnapshot, createProject, exportTextFile, getWorkspacePersistenceMode, importTextFile, loadWorkspace, saveWorkspace, updateFile } from "@/lib/workspace/store";
import { createSaveCoordinator, type SaveCoordinatorState } from "@/lib/workspace/persistence";
import type { ExecutionSession, LocalServer, Project, SourceFile, WorkspaceSnapshot } from "@/shared/recoder";

const colors = { canvas: "#080D18", panel: "#101827", panelRaised: "#172235", line: "#2A3A50", ink: "#F5F7FA", muted: "#9BAAC0", subtle: "#6D7D93", accent: "#38BDF8", accentSoft: "#10364B", good: "#86EFAC", warn: "#FCD34D" };
const runtimeSelection = createNativeProvider();
type ButtonProps = { label: string; onPress: () => void; active?: boolean; disabled?: boolean; compact?: boolean };
type Command = { id: string; label: string; hint: string };

export default function HomeScreen() {
  const { width } = useWindowDimensions();
  const isWide = width >= 800;
  const [workspace, setWorkspace] = useState<WorkspaceSnapshot>(() => createInitialSnapshot());
  const [loaded, setLoaded] = useState(false);
  const [session, setSession] = useState<ExecutionSession | null>(null);
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState("");
  const [server, setServer] = useState<LocalServer | null>(null);
  const [persistenceError, setPersistenceError] = useState<string | null>(null);
  const [outputTruncated, setOutputTruncated] = useState(false);
  const [liveEvents, setLiveEvents] = useState<ExecutionSession["events"]>([]);
  const [explorerOpen, setExplorerOpen] = useState(false);
  const [agentSettingsOpen, setAgentSettingsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [outputOpen, setOutputOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [persistenceMode, setPersistenceMode] = useState<"github" | "local">("local");
  const [saveState, setSaveState] = useState<SaveCoordinatorState>({ latestSequence: 0, pendingSnapshot: null, error: null, phase: "idle" });
  const saveCoordinator = useRef(createSaveCoordinator(saveWorkspace, (state) => { setPersistenceError(state.error?.message ?? null); setSaveState(state); }));

  useEffect(() => {
    let mounted = true;
    loadWorkspace().then((value) => { if (mounted) { setWorkspace(value); setPersistenceMode(getWorkspacePersistenceMode()); setLoaded(true); } }).catch((error) => { if (mounted) { setPersistenceError(error instanceof Error ? error.message : "Workspace initialization failed."); setLoaded(true); } });
    return () => { mounted = false; };
  }, []);
  useEffect(() => { if (loaded) void saveCoordinator.current.save(workspace).catch(() => undefined); }, [workspace, loaded]);
  useEffect(() => () => { if (server) void stopPreview(server.id); }, [server]);
  useEffect(() => { const unsubscribe = runtimeSelection.provider.subscribe?.((event) => { setLiveEvents((current) => [...current, { id: event.id, at: event.at, stream: event.stream, text: event.text }]); setOutputTruncated((current) => current || Boolean(event.outputTruncated)); }); return () => unsubscribe?.(); }, []);

  const project = workspace.projects.find((item) => item.id === workspace.activeProjectId) ?? workspace.projects[0];
  const file = project.files.find((item) => item.id === workspace.activeFileId) ?? project.files[0];
  const update = useCallback((next: WorkspaceSnapshot) => setWorkspace(next), []);
  const webOnly = Platform.OS === "web";
  const selectProject = (next: Project) => { update({ ...workspace, activeProjectId: next.id, activeFileId: next.files[0].id }); if (!isWide) setExplorerOpen(false); };
  const selectFile = (next: SourceFile) => { update({ ...workspace, activeFileId: next.id }); if (!isWide) setExplorerOpen(false); };
  const run = async () => { setBusy(true); setOutputOpen(true); try { setOutputTruncated(false); setLiveEvents([]); setSession(await runtimeSelection.provider.start({ project, file })); } catch (error) { Alert.alert("Device runtime unavailable", error instanceof Error ? error.message : "Build a development client with Expo prebuild."); } finally { setBusy(false); } };
  const cancel = async () => { if (!session) return; await runtimeSelection.provider.cancel(session.id).catch(() => undefined); setSession((current) => current ? { ...current, status: "cancelled", finishedAt: Date.now() } : current); };
  const openPreview = async () => { try { setServer(await startPreview(project)); setOutputOpen(true); } catch (error) { Alert.alert("Local preview unavailable", error instanceof Error ? error.message : "Build a development client with Expo prebuild."); } };
  const closePreview = async () => { if (!server) return; await stopPreview(server.id); setServer(null); };
  const addProject = () => { update(createProject(workspace, newName)); setNewName(""); };
  const addFile = () => update(createFile(workspace, project.id, `file-${project.files.length + 1}.js`));
  const importFile = async () => { try { const imported = await importTextFile(); if (!imported) return; const withFile = createFile(workspace, project.id, imported.name); update(updateFile(withFile, withFile.activeFileId, imported.content)); } catch (error) { Alert.alert("Import failed", error instanceof Error ? error.message : "The file could not be imported"); } };
  const exportFile = async () => { try { await exportTextFile(file); } catch (error) { Alert.alert("Export failed", error instanceof Error ? error.message : "The file could not be exported"); } };
  const saveNow = async () => { await saveCoordinator.current.save(workspace).catch(() => undefined); };
  const retrySave = async () => { await saveCoordinator.current.retry().catch(() => undefined); };
  const output = useMemo(() => (liveEvents.length ? liveEvents : session?.events ?? []).map((item) => `[${item.stream}] ${item.text}`).join("\n") || "No execution started.", [liveEvents, session]);
  const runCommand = (id: string) => {
    if (id === "explorer" || id === "new-project") { setExplorerOpen(true); setPaletteOpen(false); return; }
    if (id === "new-file") { addFile(); setPaletteOpen(false); return; }
    if (id === "save") { void saveNow(); setPaletteOpen(false); return; }
    if (id === "import") { void importFile(); setPaletteOpen(false); return; }
    if (id === "export") { void exportFile(); setPaletteOpen(false); return; }
    if (id === "run") { void run(); setPaletteOpen(false); return; }
    if (id === "preview") { void (server ? closePreview() : openPreview()); setPaletteOpen(false); return; }
    if (id === "output") { setOutputOpen((value) => !value); setPaletteOpen(false); return; }
    if (id === "agents") { setAgentSettingsOpen(true); setPaletteOpen(false); return; }
    Alert.alert("Runtime boundaries", "Browser editing and local persistence are available on web. Device execution, cancellation, and loopback preview require a native development client.");
    setPaletteOpen(false);
  };
  const commands: Command[] = [
    { id: "explorer", label: "Open explorer", hint: "Projects and files" },
    { id: "new-file", label: "Create new file", hint: "Add a file to this project" },
    { id: "new-project", label: "Create project", hint: "Use the project field in Explorer" },
    { id: "save", label: "Save workspace", hint: persistenceError ? "Retry the failed save" : "Persist locally" },
    { id: "import", label: "Import file", hint: webOnly ? "Browser file picker" : "Device file picker" },
    { id: "export", label: "Export active file", hint: "Share a text copy" },
    { id: "run", label: "Run on device", hint: webOnly ? "Native development client required" : "Bounded local execution" },
    { id: "preview", label: server ? "Stop local preview" : "Start local preview", hint: webOnly ? "Native loopback preview required" : "Open the local server" },
    { id: "output", label: outputOpen ? "Hide output panel" : "Show output panel", hint: "Execution and preview status" },
    { id: "agents", label: "Open AI agents & API keys", hint: "Secure provider and agent configuration" },
  ];
  const filteredCommands = commands.filter((command) => `${command.label} ${command.hint}`.toLowerCase().includes(paletteQuery.toLowerCase()));

  if (!loaded) return <ScreenContainer className="items-center justify-center" style={{ backgroundColor: colors.canvas }}><ActivityIndicator color={colors.accent} /></ScreenContainer>;
  return <ScreenContainer edges={["top", "left", "right", "bottom"]} style={{ backgroundColor: colors.canvas }}><View style={{ flex: 1, backgroundColor: colors.canvas }}><TopBar project={project} persistenceMode={persistenceMode} savePhase={saveState.phase} persistenceError={persistenceError} onOpenExplorer={() => setExplorerOpen(true)} onOpenAgents={() => setAgentSettingsOpen(true)} onOpenPalette={() => { setPaletteQuery(""); setPaletteOpen(true); }} /><View style={{ flex: 1, flexDirection: isWide ? "row" : "column" }}>{isWide && <Explorer project={project} workspace={workspace} newName={newName} onNewName={setNewName} onCreateProject={addProject} onSelectProject={selectProject} onSelectFile={selectFile} onAddFile={addFile} onImport={importFile} onExport={exportFile} />}<View style={{ flex: 1, minWidth: 0 }}><FileTabs files={project.files} activeId={file.id} onSelect={selectFile} /><View style={{ flex: 1, minHeight: 260, backgroundColor: "#282C34" }}><CodeMirrorEditor value={file.content} onChange={(content) => update(updateFile(workspace, file.id, content))} /></View>{outputOpen && <OutputPanel session={session} output={output} outputTruncated={outputTruncated} server={server} busy={busy} webOnly={webOnly} onRun={() => void run()} onCancel={() => void cancel()} onTogglePreview={() => void (server ? closePreview() : openPreview())} />}{persistenceError && <View style={{ backgroundColor: "#451A03", borderTopColor: colors.warn, borderTopWidth: 1, padding: 10, flexDirection: "row", alignItems: "center", gap: 10 }}><Text style={{ color: colors.warn, flex: 1, fontSize: 12 }}>Save failed; latest edits are retained.</Text><Button label="Retry" compact onPress={() => void retrySave()} /></View>}<BottomRail busy={busy} session={session} server={server} onRun={() => void run()} onSave={() => void saveNow()} onPreview={() => void (server ? closePreview() : openPreview())} onMore={() => { setPaletteQuery(""); setPaletteOpen(true); }} onToggleOutput={() => setOutputOpen((value) => !value)} /></View></View></View>
    {!isWide && <Modal visible={explorerOpen} animationType="slide" transparent onRequestClose={() => setExplorerOpen(false)}><View style={{ flex: 1, backgroundColor: "rgba(2,6,23,0.72)" }}><View style={{ width: Math.min(width * 0.9, 390), flex: 1, backgroundColor: colors.panel, borderRightColor: colors.line, borderRightWidth: 1 }}><Explorer project={project} workspace={workspace} newName={newName} onNewName={setNewName} onCreateProject={addProject} onSelectProject={selectProject} onSelectFile={selectFile} onAddFile={addFile} onImport={importFile} onExport={exportFile} onClose={() => setExplorerOpen(false)} /></View></View></Modal>}
    <Modal visible={paletteOpen} animationType="fade" transparent onRequestClose={() => setPaletteOpen(false)}><View style={{ flex: 1, backgroundColor: "rgba(2,6,23,0.86)", padding: 18, justifyContent: "center" }}><View style={{ maxHeight: "88%", backgroundColor: colors.panel, borderColor: colors.line, borderWidth: 1, borderRadius: 18, overflow: "hidden" }}><View style={{ padding: 16, borderBottomColor: colors.line, borderBottomWidth: 1, gap: 8 }}><View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}><Text style={{ color: colors.ink, fontSize: 18, fontWeight: "800" }}>Command palette</Text><Pressable onPress={() => setPaletteOpen(false)}><Text style={{ color: colors.muted, fontSize: 22 }}>×</Text></Pressable></View><TextInput autoFocus value={paletteQuery} onChangeText={setPaletteQuery} placeholder="Search actions" placeholderTextColor={colors.subtle} style={{ color: colors.ink, backgroundColor: colors.canvas, borderColor: colors.line, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, fontSize: 16 }} /></View><ScrollView keyboardShouldPersistTaps="handled">{filteredCommands.map((command) => <Pressable key={command.id} onPress={() => runCommand(command.id)} style={{ minHeight: 64, paddingHorizontal: 16, paddingVertical: 12, borderBottomColor: colors.line, borderBottomWidth: 1, justifyContent: "center" }}><Text style={{ color: colors.ink, fontSize: 15, fontWeight: "700" }}>{command.label}</Text><Text style={{ color: colors.muted, marginTop: 3, fontSize: 12 }}>{command.hint}</Text></Pressable>)}{filteredCommands.length === 0 && <Text style={{ color: colors.muted, padding: 20 }}>No matching commands.</Text>}</ScrollView></View></View></Modal><AgentSettingsModal visible={agentSettingsOpen} onClose={() => setAgentSettingsOpen(false)} /></ScreenContainer>;
}

function TopBar({ project, persistenceMode, savePhase, persistenceError, onOpenExplorer, onOpenAgents, onOpenPalette }: { project: Project; persistenceMode: "github" | "local"; savePhase: SaveCoordinatorState["phase"]; persistenceError: string | null; onOpenExplorer: () => void; onOpenAgents: () => void; onOpenPalette: () => void }) {
  const label = persistenceError ? "SAVE FAILED" : savePhase === "saving" ? "SAVING" : savePhase === "saved" ? (persistenceMode === "github" ? "SAVED TO GITHUB" : "SAVED LOCALLY") : savePhase === "dirty" ? "EDITING" : "READY";
  return <View style={{ minHeight: 62, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.panel, borderBottomColor: colors.line, borderBottomWidth: 1 }}><Pressable accessibilityLabel="Open file explorer" onPress={onOpenExplorer} style={{ width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: 10, backgroundColor: colors.panelRaised }}><Text style={{ color: colors.ink, fontSize: 22 }}>☰</Text></Pressable><View style={{ flex: 1, minWidth: 0 }}><View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}><Text style={{ color: colors.accent, fontWeight: "900", fontSize: 14 }}>R/</Text><Text numberOfLines={1} style={{ color: colors.ink, fontWeight: "800", fontSize: 15 }}>{project.name}</Text></View><Text style={{ color: colors.subtle, fontSize: 11, marginTop: 2 }}>mobile workbench / {project.files.length} files</Text></View><View accessibilityLiveRegion="polite" style={{ paddingHorizontal: 8, paddingVertical: 5, borderRadius: 999, backgroundColor: persistenceError ? "#451A03" : "#123225" }}><Text style={{ color: persistenceError ? colors.warn : colors.good, fontSize: 10, fontWeight: "800" }}>{label}</Text></View><Pressable accessibilityLabel="Open AI settings" onPress={onOpenAgents} style={{ width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: 10, backgroundColor: colors.accentSoft }}><Text style={{ color: colors.accent, fontWeight: "900" }}>AI</Text></Pressable><Pressable accessibilityLabel="Open command palette" onPress={onOpenPalette} style={{ minWidth: 52, height: 40, paddingHorizontal: 10, alignItems: "center", justifyContent: "center", borderRadius: 10, backgroundColor: colors.accentSoft }}><Text style={{ color: colors.accent, fontWeight: "900" }}>⌘ K</Text></Pressable></View>;
}

function Explorer({ project, workspace, newName, onNewName, onCreateProject, onSelectProject, onSelectFile, onAddFile, onImport, onExport, onClose }: { project: Project; workspace: WorkspaceSnapshot; newName: string; onNewName: (value: string) => void; onCreateProject: () => void; onSelectProject: (project: Project) => void; onSelectFile: (file: SourceFile) => void; onAddFile: () => void; onImport: () => void; onExport: () => void; onClose?: () => void }) {
  return <View style={{ flex: 1, padding: 14, gap: 16, backgroundColor: colors.panel }}><View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}><View><Text style={{ color: colors.ink, fontWeight: "900", fontSize: 17 }}>Explorer</Text><Text style={{ color: colors.subtle, fontSize: 11, marginTop: 2 }}>Keep context, move quickly</Text></View>{onClose && <Pressable onPress={onClose}><Text style={{ color: colors.muted, fontSize: 24 }}>×</Text></Pressable>}</View><View style={{ gap: 8 }}><Text style={{ color: colors.subtle, fontSize: 10, fontWeight: "800", letterSpacing: 1 }}>PROJECTS</Text>{workspace.projects.map((item) => <Pressable key={item.id} onPress={() => onSelectProject(item)} style={{ padding: 10, borderRadius: 9, backgroundColor: item.id === project.id ? colors.accentSoft : "transparent", borderColor: item.id === project.id ? colors.accent : "transparent", borderWidth: 1 }}><Text style={{ color: item.id === project.id ? colors.ink : colors.muted, fontWeight: "700" }}>{item.name}</Text></Pressable>)}<View style={{ flexDirection: "row", gap: 6 }}><TextInput value={newName} onChangeText={onNewName} placeholder="New project" placeholderTextColor={colors.subtle} style={{ flex: 1, color: colors.ink, backgroundColor: colors.canvas, borderColor: colors.line, borderWidth: 1, borderRadius: 8, paddingHorizontal: 9, paddingVertical: 8, fontSize: 12 }} /><Button label="Add" onPress={onCreateProject} compact disabled={!newName.trim()} /></View></View><View style={{ height: 1, backgroundColor: colors.line }} /><View style={{ flex: 1, gap: 8 }}><View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}><Text style={{ color: colors.subtle, fontSize: 10, fontWeight: "800", letterSpacing: 1 }}>FILES</Text><Pressable onPress={onAddFile}><Text style={{ color: colors.accent, fontWeight: "900", fontSize: 18 }}>＋</Text></Pressable></View><ScrollView contentContainerStyle={{ gap: 4 }}>{project.files.map((item) => <Pressable key={item.id} onPress={() => onSelectFile(item)} style={{ paddingHorizontal: 10, paddingVertical: 11, borderRadius: 8, backgroundColor: item.id === workspace.activeFileId ? colors.panelRaised : "transparent", borderLeftColor: item.id === workspace.activeFileId ? colors.accent : "transparent", borderLeftWidth: 3 }}><Text style={{ color: item.id === workspace.activeFileId ? colors.ink : colors.muted, fontFamily: "monospace", fontSize: 13 }}>{item.name}</Text></Pressable>)}</ScrollView></View><View style={{ gap: 8 }}><View style={{ flexDirection: "row", gap: 8 }}><Button label="Import" onPress={onImport} compact /><Button label="Export" onPress={onExport} compact /></View><Text style={{ color: colors.subtle, fontSize: 11, lineHeight: 16 }}>When configured, every workspace save is committed to the server-selected GitHub repository with conflict protection. Local storage is only used when GitHub sync is disabled.</Text></View></View>;
}

function FileTabs({ files, activeId, onSelect }: { files: SourceFile[]; activeId: string; onSelect: (file: SourceFile) => void }) {
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, backgroundColor: colors.panel }} contentContainerStyle={{ paddingHorizontal: 8, gap: 2, borderBottomColor: colors.line, borderBottomWidth: 1 }}>{files.map((item) => <Pressable key={item.id} onPress={() => onSelect(item)} style={{ minHeight: 42, paddingHorizontal: 13, justifyContent: "center", borderBottomColor: item.id === activeId ? colors.accent : "transparent", borderBottomWidth: 2 }}><Text style={{ color: item.id === activeId ? colors.ink : colors.muted, fontFamily: "monospace", fontSize: 12 }}>{item.name}</Text></Pressable>)}</ScrollView>;
}

function OutputPanel({ session, output, outputTruncated, server, busy, webOnly, onRun, onCancel, onTogglePreview }: { session: ExecutionSession | null; output: string; outputTruncated: boolean; server: LocalServer | null; busy: boolean; webOnly: boolean; onRun: () => void; onCancel: () => void; onTogglePreview: () => void }) {
  return <View style={{ maxHeight: 230, minHeight: 130, backgroundColor: "#0B1220", borderTopColor: colors.line, borderTopWidth: 1, padding: 12, gap: 8 }}><View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}><View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}><Text style={{ color: colors.ink, fontWeight: "800" }}>Output</Text><Text style={{ color: session?.status === "completed" ? colors.good : colors.warn, fontSize: 11, fontWeight: "800" }}>{session?.status ?? "idle"}</Text></View><View style={{ flexDirection: "row", gap: 6 }}><Button label={busy ? "Running…" : "Run"} active onPress={onRun} disabled={busy} compact />{session?.status === "running" && <Button label="Stop" onPress={onCancel} compact />}<Button label={server ? "Stop preview" : "Preview"} onPress={onTogglePreview} compact /></View></View><Text style={{ color: colors.subtle, fontSize: 11 }}>{webOnly ? "Browser editing is active. Runtime and loopback preview require a native development client." : "Bounded device execution; not hostile-code OS isolation."}</Text>{outputTruncated && <Text style={{ color: colors.warn, fontSize: 11, fontWeight: "700" }}>Output truncated at 64 KB.</Text>}<ScrollView><Text selectable style={{ color: colors.ink, fontFamily: "monospace", fontSize: 11, lineHeight: 17 }}>{output}</Text></ScrollView>{server && Platform.OS !== "web" && <View style={{ height: 220, backgroundColor: colors.panel, borderRadius: 10, overflow: "hidden" }}><Text style={{ color: colors.muted, padding: 8, fontSize: 11 }}>Loopback preview: {server.url}</Text><WebView source={{ uri: server.url }} originWhitelist={["http://127.0.0.1/*"]} javaScriptEnabled onShouldStartLoadWithRequest={(request) => isAllowedPreviewUrl(request.url, server.url)} /></View>}</View>;
}

function BottomRail({ busy, session, server, onRun, onSave, onPreview, onMore, onToggleOutput }: { busy: boolean; session: ExecutionSession | null; server: LocalServer | null; onRun: () => void; onSave: () => void; onPreview: () => void; onMore: () => void; onToggleOutput: () => void }) {
  return <View style={{ minHeight: 66, paddingHorizontal: 8, paddingVertical: 8, flexDirection: "row", alignItems: "center", justifyContent: "space-around", gap: 5, backgroundColor: colors.panel, borderTopColor: colors.line, borderTopWidth: 1 }}><RailButton label={busy ? "Running" : "Run"} active onPress={onRun} /><RailButton label={server ? "Stop" : "Preview"} onPress={onPreview} /><RailButton label="Save" onPress={onSave} /><RailButton label={session ? "Output" : "More"} onPress={session ? onToggleOutput : onMore} /></View>;
}

function RailButton({ label, onPress, active = false }: { label: string; onPress: () => void; active?: boolean }) {
  return <Pressable onPress={onPress} style={{ flex: 1, minHeight: 46, alignItems: "center", justifyContent: "center", borderRadius: 9, backgroundColor: active ? colors.accentSoft : "transparent" }}><Text style={{ color: active ? colors.accent : colors.muted, fontSize: 12, fontWeight: "800" }}>{label}</Text></Pressable>;
}

function Button({ label, onPress, active = false, disabled = false, compact = false }: ButtonProps) {
  return <Pressable disabled={disabled} onPress={onPress} style={{ backgroundColor: active ? colors.accentSoft : colors.panelRaised, borderColor: active ? colors.accent : colors.line, borderWidth: 1, borderRadius: 8, paddingHorizontal: compact ? 9 : 12, paddingVertical: compact ? 7 : 10, opacity: disabled ? 0.45 : 1 }}><Text style={{ color: active ? "#E0F2FE" : colors.ink, fontWeight: "800", fontSize: compact ? 11 : 12 }}>{label}</Text></Pressable>;
}
