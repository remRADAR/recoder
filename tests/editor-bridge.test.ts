import { describe, expect, it } from "vitest";
import { encodeEditorSetMessage, MAX_EDITOR_CONTENT_BYTES, parseEditorBridgeMessage, utf8ByteLength } from "../lib/editor/bridge";

describe("editor WebView bridge", () => {
  it("accepts only typed change and ready messages", () => {
    expect(parseEditorBridgeMessage(JSON.stringify({ type: "ready" }))).toEqual({ type: "ready" });
    expect(parseEditorBridgeMessage(JSON.stringify({ type: "change", value: "</script><b>\"\n\\\\☃" }))).toEqual({ type: "change", value: "</script><b>\"\n\\\\☃" });
    expect(parseEditorBridgeMessage(JSON.stringify({ type: "set", value: "execute()" }))).toBeNull();
    expect(parseEditorBridgeMessage(JSON.stringify({ type: "change", value: 42 }))).toBeNull();
    expect(parseEditorBridgeMessage("not-json")).toBeNull();
  });

  it("transfers content as data rather than executable HTML", () => {
    const payload = encodeEditorSetMessage("</script><script>alert(1)</script>\nlong source\n");
    expect(JSON.parse(payload)).toEqual({ type: "set", value: "</script><script>alert(1)</script>\nlong source\n" });
  });

  it("measures Unicode content in UTF-8 bytes", () => {
    expect(utf8ByteLength("☃")).toBeGreaterThan(1);
    expect(parseEditorBridgeMessage(JSON.stringify({ type: "change", value: "☃".repeat(Math.ceil(MAX_EDITOR_CONTENT_BYTES / 2)) }))).toBeNull();
  });
});
