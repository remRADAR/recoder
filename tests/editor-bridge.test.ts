import { describe, expect, it } from "vitest";
import { encodeEditorSetMessage, parseEditorBridgeMessage } from "../lib/editor/bridge";

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
});
