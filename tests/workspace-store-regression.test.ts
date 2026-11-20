import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInitialSnapshot } from "../lib/workspace/core";

const storage = {
  getItem: vi.fn(),
  setItem: vi.fn(),
};
const apiCall = vi.fn();

vi.mock("@react-native-async-storage/async-storage", () => ({ default: storage }));
vi.mock("@/lib/_core/api", () => ({ apiCall }));
vi.mock("expo-crypto", () => ({ randomUUID: () => "generated-id" }));
vi.mock("expo-document-picker", () => ({ getDocumentAsync: vi.fn() }));
vi.mock("expo-file-system/legacy", () => ({
  readAsStringAsync: vi.fn(),
  cacheDirectory: "file:///cache/",
  documentDirectory: "file:///documents/",
  writeAsStringAsync: vi.fn(),
  deleteAsync: vi.fn(),
}));
vi.mock("expo-sharing", () => ({ isAvailableAsync: vi.fn(), shareAsync: vi.fn() }));

const loadStore = async () => import("../lib/workspace/store");

describe("workspace storage migration regression", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storage.getItem.mockResolvedValue(null);
    storage.setItem.mockResolvedValue(undefined);
  });

  it("reads and writes existing AsyncStorage data when GitHub sync is disabled", async () => {
    const snapshot = createInitialSnapshot();
    storage.getItem.mockResolvedValue(JSON.stringify(snapshot));
    apiCall.mockResolvedValue({ enabled: false, repository: null, branch: null, path: null });
    const store = await loadStore();

    await expect(store.loadWorkspace()).resolves.toEqual(snapshot);
    await store.saveWorkspace(snapshot);

    expect(storage.getItem).toHaveBeenCalledWith("recoder.workspace.v1");
    expect(storage.setItem).toHaveBeenCalledWith("recoder.workspace.v1", expect.any(String));
    expect(apiCall).toHaveBeenCalledWith("/api/github-sync/config");
    expect(apiCall).toHaveBeenCalledTimes(2);
  });

  it("loads and saves through GitHub without reading or writing AsyncStorage", async () => {
    const snapshot = createInitialSnapshot();
    apiCall
      .mockResolvedValueOnce({ enabled: true, repository: "remRADAR/recoder", branch: "main", path: ".recoder/workspace.json" })
      .mockResolvedValueOnce({ snapshot, sha: "sha-old" })
      .mockResolvedValueOnce({ sha: "sha-new" });
    const store = await loadStore();

    await expect(store.loadWorkspace()).resolves.toEqual(snapshot);
    await store.saveWorkspace(snapshot);

    expect(storage.getItem).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(apiCall).toHaveBeenNthCalledWith(2, "/api/github-sync/workspace");
    expect(apiCall).toHaveBeenNthCalledWith(3, "/api/github-sync/workspace", expect.objectContaining({ method: "PUT", body: expect.stringContaining('"sha":"sha-old"') }));
  });
});
