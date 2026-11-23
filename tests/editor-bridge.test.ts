import { describe, expect, it } from "vitest";
import { encodeEditorSetMessage, MAX_EDITOR_CONTENT_BYTES, parseEditorBridgeMessage, utf8ByteLength } from "../lib/editor/bridge";

describe("editor WebView bridge", () => {
  it("accepts only typed change and ready messages", () => {
    expect(parseEditorBridgeMessage(JSON.stringify({ type: "ready", revision: 3 }))).toEqual({ type: "ready", revision: 3 });
    expect(parseEditorBridgeMessage(JSON.stringify({ type: "change", value: "</script><b>\"\n\\\\☃", revision: 3 }))).toEqual({ type: "change", value: "</script><b>\"\n\\\\☃", revision: 3 });
    expect(parseEditorBridgeMessage(JSON.stringify({ type: "set", value: "execute()" }))).toBeNull();
    expect(parseEditorBridgeMessage(JSON.stringify({ type: "change", value: 42 }))).toBeNull();
    expect(parseEditorBridgeMessage("not-json")).toBeNull();
  });

  it("transfers content as data rather than executable HTML", () => {
    const payload = encodeEditorSetMessage("</script><script>alert(1)</script>\nlong source\n", 4, { from: 2, to: 5 });
    expect(JSON.parse(payload)).toEqual({ type: "set", value: "</script><script>alert(1)</script>\nlong source\n", revision: 4, selection: { from: 2, to: 5 } });
  });

  it("measures Unicode content in UTF-8 bytes", () => {
    expect(utf8ByteLength("☃")).toBeGreaterThan(1);
    expect(parseEditorBridgeMessage(JSON.stringify({ type: "change", value: "☃".repeat(Math.ceil(MAX_EDITOR_CONTENT_BYTES / 2)) }))).toBeNull();
    expect(parseEditorBridgeMessage(JSON.stringify({ type: "ready", revision: -1 }))).toBeNull();
  });

  it("round-trips revisions and bounded selections", () => {
    const payload = encodeEditorSetMessage("const value = 1;", 4, { from: 2, to: 8 });
    expect(JSON.parse(payload)).toEqual({ type: "set", value: "const value = 1;", revision: 4, selection: { from: 2, to: 8 } });
    expect(parseEditorBridgeMessage(JSON.stringify({ type: "change", value: "next", revision: 4, selection: { from: 1, to: 3 } }))).toEqual({ type: "change", value: "next", revision: 4, selection: { from: 1, to: 3 } });
    expect(parseEditorBridgeMessage(JSON.stringify({ type: "change", value: "next", revision: -1 }))).toBeNull();
    expect(parseEditorBridgeMessage(JSON.stringify({ type: "change", value: "next", selection: { from: 3, to: 1 } }))).toBeNull();
  });

  it("accepts visible bridge failure codes", () => {
    expect(parseEditorBridgeMessage(JSON.stringify({ type: "error", code: "bridge_not_ready", revision: 2 }))).toEqual({ type: "error", code: "bridge_not_ready", revision: 2 });
    expect(parseEditorBridgeMessage(JSON.stringify({ type: "error", code: "injection_failed" }))).toEqual({ type: "error", code: "injection_failed", revision: 0 });
  });
});
