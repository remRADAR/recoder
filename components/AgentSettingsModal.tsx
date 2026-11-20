import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { AGENT_PROVIDER_LABELS, type AgentProfile, type AgentProviderKind, type ProviderConfig, loadAgentSettings, removeAgent, removeProvider, saveAgent, saveProvider, validateAgentSettingsInput } from "@/lib/agents/config";

const colors = { canvas: "#080D18", panel: "#101827", raised: "#172235", line: "#2A3A50", ink: "#F5F7FA", muted: "#9BAAC0", subtle: "#6D7D93", accent: "#38BDF8", accentSoft: "#10364B", good: "#86EFAC", warn: "#FCD34D", danger: "#FCA5A5" };
const providerKinds = Object.keys(AGENT_PROVIDER_LABELS) as AgentProviderKind[];
type Props = { visible: boolean; onClose: () => void };
type ProviderDraft = { id?: string; label: string; kind: AgentProviderKind; model: string; baseUrl: string; enabled: boolean; apiKey: string };
type AgentDraft = { id?: string; name: string; providerId: string; model: string; systemPrompt: string; enabled: boolean };

const emptyProvider = (): ProviderDraft => ({ label: "", kind: "openai", model: "gpt-4o-mini", baseUrl: "", enabled: true, apiKey: "" });
const emptyAgent = (): AgentDraft => ({ name: "", providerId: "", model: "", systemPrompt: "You are a careful coding agent. Explain changes before making them and keep edits scoped to the active repository.", enabled: true });

export function AgentSettingsModal({ visible, onClose }: Props) {
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [agents, setAgents] = useState<AgentProfile[]>([]);
  const [providerDraft, setProviderDraft] = useState<ProviderDraft>(emptyProvider);
  const [agentDraft, setAgentDraft] = useState<AgentDraft>(emptyAgent);
  const [section, setSection] = useState<"providers" | "agents">("providers");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [secureStorageAvailable, setSecureStorageAvailable] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const selectedProvider = useMemo(() => providers.find((provider) => provider.id === providerDraft.id), [providers, providerDraft.id]);

  useEffect(() => {
    if (!visible) return;
    let mounted = true;
    loadAgentSettings().then((settings) => {
      if (!mounted) return;
      setProviders(settings.providers);
      setAgents(settings.agents);
      setSecureStorageAvailable(settings.secureStorageAvailable);
      setLoading(false);
    }).catch((error) => { if (mounted) { setLoading(false); setMessage(error instanceof Error ? error.message : "Could not load AI settings."); } });
    return () => { mounted = false; };
  }, [visible]);

  const editProvider = (provider: ProviderConfig) => {
    setSection("providers");
    setMessage(null);
    setProviderDraft({ id: provider.id, label: provider.label, kind: provider.kind, model: provider.model, baseUrl: provider.baseUrl, enabled: provider.enabled, apiKey: "" });
  };
  const editAgent = (agent: AgentProfile) => {
    setSection("agents");
    setMessage(null);
    setAgentDraft(agent);
  };
  const saveProviderDraft = async () => {
    const error = validateAgentSettingsInput(providerDraft);
    if (error) return setMessage(error);
    if (!providerDraft.apiKey.trim() && !selectedProvider?.apiKeyConfigured) return setMessage("Add an API key before saving this provider.");
    setSaving(true); setMessage(null);
    try {
      const saved = await saveProvider(providerDraft);
      setProviders((current) => current.some((item) => item.id === saved.id) ? current.map((item) => item.id === saved.id ? saved : item) : [...current, saved]);
      setProviderDraft({ ...emptyProvider(), id: saved.id, label: saved.label, kind: saved.kind, model: saved.model, baseUrl: saved.baseUrl, enabled: saved.enabled });
      setMessage("Provider saved securely on this device.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Provider could not be saved."); } finally { setSaving(false); }
  };
  const saveAgentDraft = async () => {
    const error = validateAgentSettingsInput({ label: agentDraft.name, model: agentDraft.model, systemPrompt: agentDraft.systemPrompt });
    if (error) return setMessage(error);
    if (!agentDraft.providerId) return setMessage("Select a provider for this agent.");
    setSaving(true); setMessage(null);
    try {
      const saved = await saveAgent(agentDraft);
      setAgents((current) => current.some((item) => item.id === saved.id) ? current.map((item) => item.id === saved.id ? saved : item) : [...current, saved]);
      setAgentDraft({ ...emptyAgent(), providerId: saved.providerId });
      setMessage("Agent profile saved.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Agent could not be saved."); } finally { setSaving(false); }
  };
  const deleteProvider = async (id: string) => { setSaving(true); try { await removeProvider(id); setProviders((current) => current.filter((item) => item.id !== id)); setAgents((current) => current.filter((item) => item.providerId !== id)); if (providerDraft.id === id) setProviderDraft(emptyProvider()); setMessage("Provider removed from this device."); } catch (error) { setMessage(error instanceof Error ? error.message : "Provider could not be removed."); } finally { setSaving(false); } };
  const deleteAgent = async (id: string) => { setSaving(true); try { await removeAgent(id); setAgents((current) => current.filter((item) => item.id !== id)); if (agentDraft.id === id) setAgentDraft(emptyAgent()); setMessage("Agent profile removed."); } catch (error) { setMessage(error instanceof Error ? error.message : "Agent could not be removed."); } finally { setSaving(false); } };

  return <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <View style={{ paddingHorizontal: 18, paddingTop: 16, paddingBottom: 12, borderBottomColor: colors.line, borderBottomWidth: 1, backgroundColor: colors.panel }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}><View style={{ flex: 1 }}><Text style={{ color: colors.accent, fontSize: 11, fontWeight: "900", letterSpacing: 1.2 }}>AI CONTROL PLANE</Text><Text style={{ color: colors.ink, fontSize: 22, fontWeight: "900", marginTop: 4 }}>Agents & API keys</Text><Text style={{ color: colors.muted, fontSize: 12, lineHeight: 17, marginTop: 5 }}>Configure providers and agent behavior without sending secrets through the workspace API.</Text></View><Pressable accessibilityLabel="Close AI settings" onPress={onClose} style={{ padding: 8 }}><Text style={{ color: colors.muted, fontSize: 26 }}>×</Text></Pressable></View>
        <View style={{ marginTop: 12, padding: 10, borderRadius: 10, borderWidth: 1, borderColor: secureStorageAvailable ? "#24543A" : "#694B16", backgroundColor: secureStorageAvailable ? "#10271C" : "#2B2110" }}><Text style={{ color: secureStorageAvailable ? colors.good : colors.warn, fontSize: 12, fontWeight: "800" }}>{secureStorageAvailable ? "SecureStore active" : Platform.OS === "web" ? "Native client required for secure key storage" : "SecureStore unavailable"}</Text><Text style={{ color: colors.muted, fontSize: 11, marginTop: 3 }}>{secureStorageAvailable ? "Provider keys stay in the device keychain/keystore and are never shown in full." : "This preview can show the configuration surface, but it will not persist API keys in browser storage."}</Text></View>
        <View style={{ flexDirection: "row", gap: 8, marginTop: 14 }}><Tab label={`Providers ${providers.length}`} active={section === "providers"} onPress={() => setSection("providers")} /><Tab label={`Agents ${agents.length}`} active={section === "agents"} onPress={() => setSection("agents")} /></View>
      </View>
      {loading ? <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}><ActivityIndicator color={colors.accent} /><Text style={{ color: colors.muted, marginTop: 10 }}>Loading secure settings…</Text></View> : <ScrollView contentContainerStyle={{ padding: 18, gap: 14 }} keyboardShouldPersistTaps="handled">
        {!secureStorageAvailable && <View style={{ padding: 12, borderRadius: 10, backgroundColor: colors.panel, borderColor: colors.line, borderWidth: 1 }}><Text style={{ color: colors.ink, fontWeight: "800" }}>Preview mode</Text><Text style={{ color: colors.muted, fontSize: 12, lineHeight: 17, marginTop: 4 }}>Install the native development client to save a key. No plaintext fallback is used.</Text></View>}
        {section === "providers" ? <>
          {providers.map((provider) => <View key={provider.id} style={{ padding: 13, borderRadius: 12, backgroundColor: colors.panel, borderColor: provider.id === providerDraft.id ? colors.accent : colors.line, borderWidth: 1 }}><View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}><View style={{ flex: 1 }}><Text style={{ color: colors.ink, fontWeight: "800" }}>{provider.label}</Text><Text style={{ color: colors.muted, fontSize: 11, marginTop: 3 }}>{AGENT_PROVIDER_LABELS[provider.kind]} · {provider.model}</Text></View><Text style={{ color: provider.apiKeyConfigured ? colors.good : colors.warn, fontSize: 11, fontWeight: "800" }}>{provider.apiKeyConfigured ? provider.apiKeyPreview : "KEY NEEDED"}</Text></View><View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}><SmallButton label="Edit" onPress={() => editProvider(provider)} /><SmallButton label="Remove" danger onPress={() => void deleteProvider(provider.id)} /></View></View>)}
          <Text style={styles.label}>PROVIDER SETUP</Text><Field label="Display name" value={providerDraft.label} placeholder="Personal OpenAI" onChangeText={(value) => setProviderDraft((draft) => ({ ...draft, label: value }))} /><Text style={styles.label}>PROVIDER</Text><View style={{ flexDirection: "row", flexWrap: "wrap", gap: 7 }}>{providerKinds.map((kind) => <Choice key={kind} label={AGENT_PROVIDER_LABELS[kind]} active={providerDraft.kind === kind} onPress={() => setProviderDraft((draft) => ({ ...draft, kind }))} />)}</View><Field label="Model" value={providerDraft.model} placeholder="gpt-4o-mini" onChangeText={(value) => setProviderDraft((draft) => ({ ...draft, model: value }))} /><Field label="API key" value={providerDraft.apiKey} placeholder={selectedProvider?.apiKeyConfigured ? "Leave blank to keep current key" : "Paste key; it will be masked"} secure onChangeText={(value) => setProviderDraft((draft) => ({ ...draft, apiKey: value }))} /><Field label="Base URL (optional)" value={providerDraft.baseUrl} placeholder="https://api.openai.com/v1" onChangeText={(value) => setProviderDraft((draft) => ({ ...draft, baseUrl: value }))} /><View style={{ flexDirection: "row", gap: 8 }}><SmallButton label={providerDraft.id ? "Update provider" : "Save provider"} active disabled={saving || !secureStorageAvailable} onPress={() => void saveProviderDraft()} /><SmallButton label="Clear" onPress={() => setProviderDraft(emptyProvider())} /></View>
        </> : <>
          {agents.map((agent) => <View key={agent.id} style={{ padding: 13, borderRadius: 12, backgroundColor: colors.panel, borderColor: agent.id === agentDraft.id ? colors.accent : colors.line, borderWidth: 1 }}><Text style={{ color: colors.ink, fontWeight: "800" }}>{agent.name}</Text><Text style={{ color: colors.muted, fontSize: 11, marginTop: 3 }}>{providers.find((provider) => provider.id === agent.providerId)?.label ?? "Provider unavailable"} · {agent.model}</Text><View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}><SmallButton label="Edit" onPress={() => editAgent(agent)} /><SmallButton label="Remove" danger onPress={() => void deleteAgent(agent.id)} /></View></View>)}
          <Text style={styles.label}>AGENT PROFILE</Text><Field label="Agent name" value={agentDraft.name} placeholder="Code reviewer" onChangeText={(value) => setAgentDraft((draft) => ({ ...draft, name: value }))} /><Text style={styles.label}>PROVIDER</Text><View style={{ gap: 7 }}>{providers.length ? providers.map((provider) => <Choice key={provider.id} label={`${provider.label} · ${provider.model}`} active={agentDraft.providerId === provider.id} onPress={() => setAgentDraft((draft) => ({ ...draft, providerId: provider.id, model: provider.model }))} />) : <Text style={{ color: colors.muted, fontSize: 12 }}>Save a provider first.</Text>}</View><Field label="Agent model override" value={agentDraft.model} placeholder="Use provider default" onChangeText={(value) => setAgentDraft((draft) => ({ ...draft, model: value }))} multiline={false} /><Field label="System prompt" value={agentDraft.systemPrompt} placeholder="Define the agent's role and boundaries" multiline onChangeText={(value) => setAgentDraft((draft) => ({ ...draft, systemPrompt: value }))} /><View style={{ flexDirection: "row", gap: 8 }}><SmallButton label={agentDraft.id ? "Update agent" : "Save agent"} active disabled={saving || !secureStorageAvailable} onPress={() => void saveAgentDraft()} /><SmallButton label="Clear" onPress={() => setAgentDraft(emptyAgent())} /></View>
        </>}
        {message && <View style={{ padding: 12, borderRadius: 10, backgroundColor: message.includes("saved") || message.includes("removed") ? "#10271C" : "#2B2110", borderWidth: 1, borderColor: message.includes("saved") || message.includes("removed") ? "#24543A" : "#694B16" }}><Text style={{ color: message.includes("saved") || message.includes("removed") ? colors.good : colors.warn, fontSize: 12 }}>{message}</Text></View>}
        <Text style={{ color: colors.subtle, fontSize: 11, lineHeight: 16, paddingBottom: 24 }}>Keys are stored only in Expo SecureStore on the device. This UI does not transmit provider secrets to GitHub, the workspace API, or the browser preview.</Text>
      </ScrollView>}
    </View>
  </Modal>;
}

function Tab({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) { return <Pressable onPress={onPress} style={{ flex: 1, paddingVertical: 10, borderRadius: 9, alignItems: "center", backgroundColor: active ? colors.accentSoft : colors.raised, borderColor: active ? colors.accent : colors.line, borderWidth: 1 }}><Text style={{ color: active ? colors.accent : colors.muted, fontWeight: "800", fontSize: 12 }}>{label}</Text></Pressable>; }
function Choice({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) { return <Pressable onPress={onPress} style={{ paddingHorizontal: 10, paddingVertical: 9, borderRadius: 8, backgroundColor: active ? colors.accentSoft : colors.raised, borderColor: active ? colors.accent : colors.line, borderWidth: 1 }}><Text style={{ color: active ? colors.accent : colors.muted, fontSize: 11, fontWeight: "800" }}>{label}</Text></Pressable>; }
function SmallButton({ label, onPress, active = false, danger = false, disabled = false }: { label: string; onPress: () => void; active?: boolean; danger?: boolean; disabled?: boolean }) { return <Pressable disabled={disabled} onPress={onPress} style={{ opacity: disabled ? 0.45 : 1, paddingHorizontal: 11, paddingVertical: 8, borderRadius: 8, backgroundColor: active ? colors.accentSoft : colors.raised, borderColor: danger ? "#7F1D1D" : active ? colors.accent : colors.line, borderWidth: 1 }}><Text style={{ color: danger ? colors.danger : active ? colors.accent : colors.ink, fontSize: 11, fontWeight: "800" }}>{label}</Text></Pressable>; }
function Field({ label, value, placeholder, onChangeText, secure = false, multiline = false }: { label: string; value: string; placeholder: string; onChangeText: (value: string) => void; secure?: boolean; multiline?: boolean }) { return <View style={{ gap: 6 }}><Text style={styles.label}>{label}</Text><TextInput value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={colors.subtle} secureTextEntry={secure} multiline={multiline} autoCapitalize="none" autoCorrect={false} spellCheck={false} style={{ minHeight: multiline ? 110 : 44, color: colors.ink, backgroundColor: colors.panel, borderColor: colors.line, borderWidth: 1, borderRadius: 9, paddingHorizontal: 12, paddingVertical: 10, fontSize: 13, textAlignVertical: multiline ? "top" : "center" }} /></View>; }
const styles = { label: { color: colors.subtle, fontSize: 10, fontWeight: "900" as const, letterSpacing: 1, marginTop: 2 } };
