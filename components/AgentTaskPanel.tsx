import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { loadAgentSettings, type AgentProfile } from "@/lib/agents/config";
import { runAgentTask, type AgentRuntimeEvent } from "@/lib/agents/runtime";
import type { Project, SourceFile, WorkspaceSnapshot } from "@/shared/recoder";

const colors = { canvas: "#080D18", panel: "#101827", raised: "#172235", line: "#2A3A50", ink: "#F5F7FA", muted: "#9BAAC0", subtle: "#6D7D93", accent: "#38BDF8", accentSoft: "#10364B", good: "#86EFAC", warn: "#FCD34D", danger: "#FCA5A5" };

type Props = { project: Project; file: SourceFile; workspace: WorkspaceSnapshot; onWorkspaceChange: (workspace: WorkspaceSnapshot) => void; onRunFile: (file: SourceFile) => Promise<string>; onOpenSettings: () => void; onClose?: () => void; compact?: boolean };

export function AgentTaskPanel({ project, file, workspace, onWorkspaceChange, onRunFile, onOpenSettings, onClose, compact = false }: Props) {
  const [agents, setAgents] = useState<AgentProfile[]>([]);
  const [agentId, setAgentId] = useState("");
  const [task, setTask] = useState("");
  const [events, setEvents] = useState<AgentRuntimeEvent[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    loadAgentSettings().then((settings) => {
      if (!mounted) return;
      const enabled = settings.agents.filter((agent) => agent.enabled);
      setAgents(enabled);
      setAgentId((current) => current || enabled[0]?.id || "");
    }).catch(() => undefined);
    return () => { mounted = false; };
  }, [running]);

  const run = async () => {
    const agent = agents.find((item) => item.id === agentId);
    if (!agent) return setError("Configure an enabled agent and provider first.");
    if (!task.trim()) return setError("Describe what you want the agent to do.");
    setRunning(true); setError(null); setEvents([]);
    try {
      const result = await runAgentTask({ agent, project, workspace, task, runFile: onRunFile, onEvent: (event) => setEvents((current) => [...current, event]) });
      onWorkspaceChange(result.workspace);
      setTask("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Agent task failed.");
    } finally { setRunning(false); }
  };

  return <View style={{ flex: 1, minWidth: compact ? 300 : undefined, backgroundColor: colors.canvas }}>
    <View style={{ padding: 14, borderBottomColor: colors.line, borderBottomWidth: 1, backgroundColor: colors.panel }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}><View><Text style={{ color: colors.accent, fontSize: 10, fontWeight: "900", letterSpacing: 1.1 }}>AI WORKSPACE</Text><Text style={{ color: colors.ink, fontWeight: "900", fontSize: 18, marginTop: 3 }}>Agent dock</Text></View>{onClose && <Pressable accessibilityLabel="Close AI dock" onPress={onClose} style={{ padding: 6 }}><Text style={{ color: colors.muted, fontSize: 22 }}>×</Text></Pressable>}</View>
      <Text style={{ color: colors.muted, fontSize: 11, lineHeight: 16, marginTop: 6 }}>Read, edit, and run the active project through explicit workspace tools.</Text>
      <View style={{ flexDirection: "row", gap: 7, marginTop: 12, flexWrap: "wrap" }}>{agents.map((agent) => <Pressable key={agent.id} onPress={() => setAgentId(agent.id)} style={{ paddingHorizontal: 9, paddingVertical: 7, borderRadius: 8, borderWidth: 1, borderColor: agentId === agent.id ? colors.accent : colors.line, backgroundColor: agentId === agent.id ? colors.accentSoft : colors.raised }}><Text style={{ color: agentId === agent.id ? colors.accent : colors.muted, fontSize: 11, fontWeight: "800" }}>{agent.name}</Text></Pressable>)}{agents.length === 0 && <Text style={{ color: colors.warn, fontSize: 11 }}>No enabled agents</Text>}</View>
    </View>
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 14, gap: 10 }}>
      <View style={{ padding: 10, borderRadius: 9, backgroundColor: colors.panel, borderColor: colors.line, borderWidth: 1 }}><Text style={{ color: colors.subtle, fontSize: 10, fontWeight: "900", letterSpacing: 1 }}>ACTIVE CONTEXT</Text><Text style={{ color: colors.ink, fontSize: 12, marginTop: 5 }}>{project.name} / {file.name}</Text><Text style={{ color: colors.subtle, fontSize: 11, marginTop: 3 }}>Workspace read/write is scoped to this project.</Text></View>
      {events.map((event) => <View key={event.id} style={{ padding: 9, borderRadius: 8, backgroundColor: event.kind === "error" ? "#2B1518" : colors.panel, borderLeftColor: event.kind === "tool" ? colors.accent : event.kind === "error" ? colors.danger : colors.line, borderLeftWidth: 2 }}><Text style={{ color: event.kind === "error" ? colors.danger : event.kind === "tool" ? colors.accent : colors.muted, fontSize: 11, lineHeight: 16 }}>{event.text}</Text></View>)}
      {error && <View style={{ padding: 10, borderRadius: 8, backgroundColor: "#2B2110", borderColor: "#694B16", borderWidth: 1 }}><Text style={{ color: colors.warn, fontSize: 11, lineHeight: 16 }}>{error}</Text></View>}
      <TextInput multiline value={task} onChangeText={setTask} placeholder="Ask the agent to inspect or change this workspace…" placeholderTextColor={colors.subtle} editable={!running} style={{ minHeight: 116, color: colors.ink, backgroundColor: colors.panel, borderColor: colors.line, borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 13, textAlignVertical: "top" }} />
      <Pressable disabled={running} onPress={() => void run()} style={{ minHeight: 44, alignItems: "center", justifyContent: "center", borderRadius: 9, backgroundColor: colors.accentSoft, borderColor: colors.accent, borderWidth: 1, opacity: running ? 0.5 : 1 }}>{running ? <ActivityIndicator color={colors.accent} /> : <Text style={{ color: colors.accent, fontWeight: "900", fontSize: 12 }}>Run workspace task</Text>}</Pressable>
      <Pressable onPress={onOpenSettings} style={{ minHeight: 40, alignItems: "center", justifyContent: "center", borderRadius: 9, backgroundColor: colors.raised, borderColor: colors.line, borderWidth: 1 }}><Text style={{ color: colors.muted, fontWeight: "800", fontSize: 11 }}>Manage agents & providers</Text></Pressable>
      <Text style={{ color: colors.subtle, fontSize: 10, lineHeight: 15, paddingBottom: 18 }}>Agent tools are bounded to the active workspace. API keys stay in native SecureStore and are used only for the selected provider request.</Text>
    </ScrollView>
  </View>;
}
