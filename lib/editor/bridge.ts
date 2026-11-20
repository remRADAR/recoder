export type EditorBridgeMessage =
  | { type: "ready" }
  | { type: "change"; value: string }
  | { type: "error"; code: "content_too_large" | "invalid_payload" };

export const MAX_EDITOR_CONTENT_BYTES = 512_000;

export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function parseEditorBridgeMessage(raw: unknown): EditorBridgeMessage | null {
  if (typeof raw !== "string" || utf8ByteLength(raw) > MAX_EDITOR_CONTENT_BYTES + 256) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !("type" in parsed)) return null;
    const message = parsed as { type?: unknown; value?: unknown; code?: unknown };
    if (message.type === "ready") return { type: "ready" };
    if (message.type === "error" && (message.code === "content_too_large" || message.code === "invalid_payload")) return { type: "error", code: message.code };
    if (message.type === "change" && typeof message.value === "string" && utf8ByteLength(message.value) <= MAX_EDITOR_CONTENT_BYTES) return { type: "change", value: message.value };
  } catch {
    return null;
  }
  return null;
}

export function encodeEditorSetMessage(value: string): string {
  return JSON.stringify({ type: "set", value });
}
