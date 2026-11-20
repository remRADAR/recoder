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
const bytes = (value: string) => new TextEncoder().encode(value).byteLength;
function post(message: { type: "ready" } | { type: "change"; value: string } | { type: "error"; code: "content_too_large" | "invalid_payload" }) {
  window.ReactNativeWebView?.postMessage(JSON.stringify(message));
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
  const message = parsed as { type?: unknown; value?: unknown };
  if (message.type !== "set" || typeof message.value !== "string") { post({ type: "error", code: "invalid_payload" }); return; }
  if (bytes(message.value) > MAX_EDITOR_CONTENT_BYTES) { post({ type: "error", code: "content_too_large" }); return; }
  const editor = window.recoderEditor;
  if (!editor || editor.state.doc.toString() === message.value) return;
  syncing = true;
  editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: message.value } });
  syncing = false;
};
