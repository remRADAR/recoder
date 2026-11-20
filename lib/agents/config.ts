import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

export type AgentProviderKind = "openai" | "anthropic" | "gemini" | "openai-compatible";

export type ProviderConfig = {
  id: string;
  label: string;
  kind: AgentProviderKind;
  model: string;
  baseUrl: string;
  enabled: boolean;
  apiKeyConfigured: boolean;
  apiKeyPreview: string;
};

export type AgentProfile = {
  id: string;
  name: string;
  providerId: string;
  model: string;
  systemPrompt: string;
  enabled: boolean;
};

export type AgentSettings = {
  providers: ProviderConfig[];
  agents: AgentProfile[];
  secureStorageAvailable: boolean;
};

type StoredProvider = Omit<ProviderConfig, "apiKeyConfigured" | "apiKeyPreview"> & { apiKey: string };
type StoredSettings = { version: 1; providers: StoredProvider[]; agents: AgentProfile[] };
export type AgentRuntimeConfig = { kind: AgentProviderKind; model: string; baseUrl: string; apiKey: string };

const STORAGE_KEY = "recoder.ai.settings.v1";
const MAX_SYSTEM_PROMPT_LENGTH = 4_000;

function emptySettings(secureStorageAvailable: boolean): AgentSettings {
  return { providers: [], agents: [], secureStorageAvailable };
}

function maskApiKey(value: string): string {
  if (!value) return "";
  if (value.length <= 8) return "••••••••";
  return `${value.slice(0, 4)}••••${value.slice(-4)}`;
}

function publicProvider(provider: StoredProvider): ProviderConfig {
  return {
    id: provider.id,
    label: provider.label,
    kind: provider.kind,
    model: provider.model,
    baseUrl: provider.baseUrl,
    enabled: provider.enabled,
    apiKeyConfigured: Boolean(provider.apiKey),
    apiKeyPreview: maskApiKey(provider.apiKey),
  };
}

function normalizeStored(value: unknown): StoredSettings {
  if (!value || typeof value !== "object") throw new Error("Invalid AI settings");
  const candidate = value as Partial<StoredSettings>;
  if (candidate.version !== 1 || !Array.isArray(candidate.providers) || !Array.isArray(candidate.agents)) throw new Error("Invalid AI settings");
  return {
    version: 1,
    providers: candidate.providers.filter((item): item is StoredProvider => Boolean(item && typeof item === "object" && typeof item.id === "string" && typeof item.apiKey === "string")),
    agents: candidate.agents.filter((item): item is AgentProfile => Boolean(item && typeof item === "object" && typeof item.id === "string" && typeof item.name === "string" && typeof item.providerId === "string")),
  };
}

async function secureStorageAvailable(): Promise<boolean> {
  if (Platform.OS === "web") return false;
  try {
    return await SecureStore.isAvailableAsync();
  } catch {
    return false;
  }
}

async function readStored(): Promise<StoredSettings | null> {
  const raw = await SecureStore.getItemAsync(STORAGE_KEY);
  if (!raw) return null;
  try {
    return normalizeStored(JSON.parse(raw));
  } catch {
    return null;
  }
}

async function requireStorage(): Promise<void> {
  if (!(await secureStorageAvailable())) throw new Error("Secure API-key storage is available only in the native development client.");
}

async function writeStored(value: StoredSettings): Promise<void> {
  await requireStorage();
  await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(value));
}

export async function loadAgentSettings(): Promise<AgentSettings> {
  const available = await secureStorageAvailable();
  if (!available) return emptySettings(false);
  const stored = await readStored();
  if (!stored) return emptySettings(true);
  return { providers: stored.providers.map(publicProvider), agents: stored.agents, secureStorageAvailable: true };
}

export async function getAgentRuntimeConfig(agentId: string): Promise<AgentRuntimeConfig | null> {
  if (!(await secureStorageAvailable())) return null;
  const stored = await readStored();
  const agent = stored?.agents.find((item) => item.id === agentId);
  const provider = agent ? stored?.providers.find((item) => item.id === agent.providerId) : undefined;
  if (!agent || !provider?.apiKey || !provider.enabled || !agent.enabled) return null;
  return { kind: provider.kind, model: agent.model.trim() || provider.model, baseUrl: provider.baseUrl, apiKey: provider.apiKey };
}

export async function saveProvider(input: { id?: string; label: string; kind: AgentProviderKind; model: string; baseUrl: string; enabled: boolean; apiKey: string }): Promise<ProviderConfig> {
  await requireStorage();
  const stored = (await readStored()) ?? { version: 1 as const, providers: [], agents: [] };
  const existing = input.id ? stored.providers.find((provider) => provider.id === input.id) : undefined;
  const provider: StoredProvider = {
    id: input.id ?? `provider-${Date.now()}`,
    label: input.label.trim() || "Untitled provider",
    kind: input.kind,
    model: input.model.trim() || "default",
    baseUrl: input.baseUrl.trim(),
    enabled: input.enabled,
    apiKey: input.apiKey.trim() ? input.apiKey.trim() : (existing?.apiKey ?? ""),
  };
  const providers = existing ? stored.providers.map((item) => item.id === provider.id ? provider : item) : [...stored.providers, provider];
  await writeStored({ ...stored, providers });
  return publicProvider(provider);
}

export async function removeProvider(id: string): Promise<void> {
  await requireStorage();
  const stored = (await readStored()) ?? { version: 1 as const, providers: [], agents: [] };
  await writeStored({ ...stored, providers: stored.providers.filter((provider) => provider.id !== id), agents: stored.agents.filter((agent) => agent.providerId !== id) });
}

export async function saveAgent(input: { id?: string; name: string; providerId: string; model: string; systemPrompt: string; enabled: boolean }): Promise<AgentProfile> {
  await requireStorage();
  const stored = (await readStored()) ?? { version: 1 as const, providers: [], agents: [] };
  const agent: AgentProfile = {
    id: input.id ?? `agent-${Date.now()}`,
    name: input.name.trim() || "New agent",
    providerId: input.providerId,
    model: input.model.trim() || "default",
    systemPrompt: input.systemPrompt.slice(0, MAX_SYSTEM_PROMPT_LENGTH),
    enabled: input.enabled,
  };
  const agents = input.id && stored.agents.some((item) => item.id === input.id) ? stored.agents.map((item) => item.id === agent.id ? agent : item) : [...stored.agents, agent];
  await writeStored({ ...stored, agents });
  return agent;
}

export async function removeAgent(id: string): Promise<void> {
  await requireStorage();
  const stored = (await readStored()) ?? { version: 1 as const, providers: [], agents: [] };
  await writeStored({ ...stored, agents: stored.agents.filter((agent) => agent.id !== id) });
}

export function validateAgentSettingsInput(input: { label: string; model: string; systemPrompt?: string }): string | null {
  if (!input.label.trim()) return "Give the provider or agent a name.";
  if (!input.model.trim()) return "Choose a model before saving.";
  if (input.systemPrompt && input.systemPrompt.length > MAX_SYSTEM_PROMPT_LENGTH) return `System prompts are limited to ${MAX_SYSTEM_PROMPT_LENGTH} characters.`;
  return null;
}

export const AGENT_PROVIDER_LABELS: Record<AgentProviderKind, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Google Gemini",
  "openai-compatible": "OpenAI-compatible",
};
