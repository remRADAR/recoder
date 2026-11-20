import { beforeEach, describe, expect, it, vi } from "vitest";
import { Platform } from "react-native";

const secureValues = new Map<string, string>();
vi.mock("expo-secure-store", () => ({
  isAvailableAsync: vi.fn(async () => true),
  getItemAsync: vi.fn(async (key: string) => secureValues.get(key) ?? null),
  setItemAsync: vi.fn(async (key: string, value: string) => { secureValues.set(key, value); }),
}));
vi.mock("react-native", () => ({ Platform: { OS: "android" } }));

const loadConfig = async () => import("../lib/agents/config");

describe("secure AI agent configuration", () => {
  beforeEach(() => secureValues.clear());

  it("stores provider credentials securely and only exposes a masked preview", async () => {
    const config = await loadConfig();
    const provider = await config.saveProvider({ label: "OpenAI", kind: "openai", model: "gpt-4o-mini", baseUrl: "", enabled: true, apiKey: "sk-test-123456789" });
    expect(provider.apiKeyConfigured).toBe(true);
    expect(provider.apiKeyPreview).toBe("sk-t••••6789");
    expect(provider).not.toHaveProperty("apiKey");
    expect([...secureValues.values()][0]).toContain("sk-test-123456789");

    const loaded = await config.loadAgentSettings();
    expect(loaded.secureStorageAvailable).toBe(true);
    expect(loaded.providers[0]).toMatchObject({ label: "OpenAI", apiKeyConfigured: true, apiKeyPreview: "sk-t••••6789" });
    expect(JSON.stringify(loaded)).not.toContain("sk-test-123456789");
  });

  it("preserves an existing key when editing provider metadata without a new key", async () => {
    const config = await loadConfig();
    const first = await config.saveProvider({ label: "OpenAI", kind: "openai", model: "gpt-4o-mini", baseUrl: "", enabled: true, apiKey: "sk-original-1234" });
    await config.saveProvider({ id: first.id, label: "OpenAI personal", kind: "openai", model: "gpt-4.1-mini", baseUrl: "", enabled: true, apiKey: "" });
    const loaded = await config.loadAgentSettings();
    expect(loaded.providers[0]).toMatchObject({ label: "OpenAI personal", model: "gpt-4.1-mini", apiKeyPreview: "sk-o••••1234" });
  });

  it("links agent profiles to providers and removes dependent profiles with a provider", async () => {
    const config = await loadConfig();
    const provider = await config.saveProvider({ label: "Gemini", kind: "gemini", model: "gemini-2.5-flash", baseUrl: "", enabled: true, apiKey: "AIza-test-key" });
    await config.saveAgent({ name: "Reviewer", providerId: provider.id, model: "gemini-2.5-flash", systemPrompt: "Review only.", enabled: true });
    expect((await config.loadAgentSettings()).agents).toHaveLength(1);
    await config.removeProvider(provider.id);
    const loaded = await config.loadAgentSettings();
    expect(loaded.providers).toHaveLength(0);
    expect(loaded.agents).toHaveLength(0);
  });

  it("refuses to use browser storage when running on web", async () => {
    const config = await loadConfig();
    const platform = Platform as typeof Platform & { OS: string };
    const original = platform.OS;
    platform.OS = "web";
    try {
      expect((await config.loadAgentSettings()).secureStorageAvailable).toBe(false);
      await expect(config.saveProvider({ label: "Web", kind: "openai", model: "gpt-4o-mini", baseUrl: "", enabled: true, apiKey: "should-not-save" })).rejects.toThrow("native development client");
      expect(secureValues.size).toBe(0);
    } finally {
      platform.OS = original;
    }
  });
});
