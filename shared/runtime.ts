import type { ExecutionEvent, ExecutionStream } from "./recoder";

export const EXECUTION_TIMEOUT_MS = 5_000;
export const MAX_OUTPUT_BYTES = 64_000;
export const MAX_ACTIVE_EXECUTIONS = 2;
export const MAX_HTTP_REQUEST_BYTES = 16_384;
export const MAX_PREVIEW_CONNECTIONS = 8;

export function utf8ByteLength(value: string): number { return new TextEncoder().encode(value).byteLength; }

export function truncateUtf8(value: string, maxBytes: number): string {
  if (utf8ByteLength(value) <= maxBytes) return value;
  let result = "";
  for (const character of value) { if (utf8ByteLength(result + character) > maxBytes) break; result += character; }
  return result;
}

export class OutputBuffer {
  private readonly events: ExecutionEvent[] = [];
  private bytes = 0;
  private didTruncate = false;
  append(stream: ExecutionStream, text: string, at = Date.now()): ExecutionEvent[] {
    if (this.didTruncate || this.bytes >= MAX_OUTPUT_BYTES) return [];
    const remaining = MAX_OUTPUT_BYTES - this.bytes;
    const clipped = truncateUtf8(text, remaining);
    this.bytes += utf8ByteLength(clipped);
    const result: ExecutionEvent[] = [];
    if (clipped) { const event = { id: this.events.length + 1, at, stream, text: clipped }; this.events.push(event); result.push(event); }
    if (clipped.length < text.length) {
      this.didTruncate = true;
      const notice = { id: this.events.length + 1, at, stream: "system" as const, text: "Output truncated at 64 KB.\n" };
      this.events.push(notice); result.push(notice);
    }
    return result;
  }
  snapshot(): ExecutionEvent[] { return [...this.events]; }
  get truncated(): boolean { return this.didTruncate; }
}

export function isSafeProjectPath(path: string): boolean {
  let decoded = path;
  try { decoded = decodeURIComponent(path); } catch { return false; }
  return decoded.length > 0 && !decoded.startsWith("/") && !decoded.includes("..") && !decoded.includes("\\") && !decoded.includes("%");
}

export function isAllowedPreviewUrl(candidate: string, expected: string): boolean {
  try {
    const actual = new URL(candidate); const base = new URL(expected);
    return actual.protocol === "http:" && actual.hostname === "127.0.0.1" && actual.port === base.port && actual.hostname === base.hostname && actual.searchParams.has("token");
  } catch { return false; }
}

export function escapeJavaScriptSource(source: string): string {
  return JSON.stringify(source).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029").replace(/<\/script/gi, "<\\/script");
}

export function isNativeTimeoutError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "RUNTIME_TIMEOUT");
}
