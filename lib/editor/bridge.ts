export type EditorBridgeMessage =
  | { type: "ready" }
  | { type: "change"; value: string };

const MAX_MESSAGE_BYTES = 512_000;

export function parseEditorBridgeMessage(raw: unknown): EditorBridgeMessage | null {
  if (typeof raw !== "string" || raw.length > MAX_MESSAGE_BYTES) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !("type" in parsed)) return null;
    const message = parsed as { type?: unknown; value?: unknown };
    if (message.type === "ready") return { type: "ready" };
    if (message.type === "change" && typeof message.value === "string" && message.value.length <= MAX_MESSAGE_BYTES) return { type: "change", value: message.value };
  } catch {
    return null;
  }
  return null;
}

export function encodeEditorSetMessage(value: string): string {
  return JSON.stringify({ type: "set", value });
}
