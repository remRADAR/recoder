export type EditorSelection = { from: number; to: number };

export type EditorBridgeMessage =
  | { type: "ready"; revision: number }
  | { type: "change"; value: string; revision: number; selection?: EditorSelection }
  | { type: "error"; code: "content_too_large" | "invalid_payload" | "bridge_not_ready" | "injection_failed"; revision: number };

export const MAX_EDITOR_CONTENT_BYTES = 512_000;

export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function parseEditorBridgeMessage(raw: unknown): EditorBridgeMessage | null {
  if (typeof raw !== "string" || utf8ByteLength(raw) > MAX_EDITOR_CONTENT_BYTES + 256) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !("type" in parsed)) return null;
    const message = parsed as { type?: unknown; value?: unknown; code?: unknown; revision?: unknown; selection?: unknown };
    const revision = message.revision === undefined ? 0 : message.revision;
    if (!Number.isInteger(revision) || (revision as number) < 0) return null;
    if (message.type === "ready") return { type: "ready", revision: revision as number };
    if (message.type === "error" && (message.code === "content_too_large" || message.code === "invalid_payload" || message.code === "bridge_not_ready" || message.code === "injection_failed")) return { type: "error", code: message.code, revision: revision as number };
    const selection = message.selection === undefined ? undefined : parseSelection(message.selection);
    if (message.selection !== undefined && !selection) return null;
    if (message.type === "change" && typeof message.value === "string" && utf8ByteLength(message.value) <= MAX_EDITOR_CONTENT_BYTES) return { type: "change", value: message.value, revision: revision as number, ...(selection ? { selection } : {}) };
  } catch {
    return null;
  }
  return null;
}

function parseSelection(value: unknown): EditorSelection | null {
  if (!value || typeof value !== "object") return null;
  const selection = value as { from?: unknown; to?: unknown };
  return typeof selection.from === "number" && Number.isInteger(selection.from) && selection.from >= 0 && typeof selection.to === "number" && Number.isInteger(selection.to) && selection.to >= selection.from ? { from: selection.from, to: selection.to } : null;
}

export function encodeEditorSetMessage(value: string, revision = 0, selection?: EditorSelection): string {
  return JSON.stringify({ type: "set", value, revision, selection });
}
