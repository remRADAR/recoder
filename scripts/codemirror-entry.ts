import { indentWithTab } from "@codemirror/commands";
import { javascript } from "@codemirror/lang-javascript";
import { EditorState } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView, keymap } from "@codemirror/view";

declare global {
  interface Window {
    ReactNativeWebView?: { postMessage: (message: string) => void };
    recoderMount?: () => void;
  recoderSetMessage?: (raw: string) => void;
    recoderEditor?: EditorView;
  }
}

const MAX_EDITOR_CONTENT_BYTES = 512_000;
let syncing = false;
let revision = 0;
const bytes = (value: string) => new TextEncoder().encode(value).byteLength;
function post(message: { type: "ready" } | { type: "change"; value: string } | { type: "error"; code: "content_too_large" | "invalid_payload" }, messageRevision = revision) {
  window.ReactNativeWebView?.postMessage(JSON.stringify({ ...message, revision: messageRevision }));
}

window.recoderMount = () => {
  if (window.recoderEditor) { post({ type: "ready" }); return; }
  const parent = document.getElementById("editor");
  if (!parent) return;
  const state = EditorState.create({
    doc: "",
    extensions: [oneDark, javascript(), keymap.of([indentWithTab]), EditorView.lineWrapping, EditorView.updateListener.of((update) => {
      if (update.docChanged && !syncing) {
        const value = update.state.doc.toString();
        if (bytes(value) <= MAX_EDITOR_CONTENT_BYTES) post({ type: "change", value });
        else post({ type: "error", code: "content_too_large" });
      }
    })],
  });
  window.recoderEditor = new EditorView({ state, parent });
  post({ type: "ready" });
};

window.recoderSetMessage = (raw: string) => {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { post({ type: "error", code: "invalid_payload" }); return; }
  if (!parsed || typeof parsed !== "object") { post({ type: "error", code: "invalid_payload" }); return; }
  const message = parsed as { type?: unknown; value?: unknown; revision?: unknown; selection?: { from?: unknown; to?: unknown } };
  if (message.type !== "set" || typeof message.value !== "string") { post({ type: "error", code: "invalid_payload" }); return; }
  if (!Number.isInteger(message.revision) || (message.revision as number) < revision) return;
  if (bytes(message.value) > MAX_EDITOR_CONTENT_BYTES) { post({ type: "error", code: "content_too_large" }); return; }
  const editor = window.recoderEditor;
  if (!editor) { post({ type: "error", code: "invalid_payload" }, message.revision as number); return; }
  revision = message.revision as number;
  if (editor.state.doc.toString() === message.value) return;
  const selection = editor.state.selection.main;
  const requestedFrom = typeof message.selection?.from === "number" ? message.selection.from : selection.from;
  const requestedTo = typeof message.selection?.to === "number" ? message.selection.to : selection.to;
  syncing = true;
  editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: message.value }, selection: { anchor: Math.min(Math.max(0, requestedFrom), message.value.length), head: Math.min(Math.max(0, requestedTo), message.value.length) } });
  syncing = false;
};
