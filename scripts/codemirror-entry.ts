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

let syncing = false;

function post(message: { type: "ready" } | { type: "change"; value: string }) {
  window.ReactNativeWebView?.postMessage(JSON.stringify(message));
}

window.recoderMount = () => {
  if (window.recoderEditor) {
    post({ type: "ready" });
    return;
  }
  const parent = document.getElementById("editor");
  if (!parent) return;
  const state = EditorState.create({
    doc: "",
    extensions: [oneDark, javascript(), keymap.of([indentWithTab]), EditorView.lineWrapping, EditorView.updateListener.of((update) => {
      if (update.docChanged && !syncing) post({ type: "change", value: update.state.doc.toString() });
    })],
  });
  window.recoderEditor = new EditorView({ state, parent });
  post({ type: "ready" });
};

window.recoderSetMessage = (raw: string) => {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return; }
  if (!parsed || typeof parsed !== "object") return;
  const message = parsed as { type?: unknown; value?: unknown };
  if (message.type !== "set" || typeof message.value !== "string" || message.value.length > 512_000) return;
  const editor = window.recoderEditor;
  if (!editor || editor.state.doc.toString() === message.value) return;
  syncing = true;
  editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: message.value } });
  syncing = false;
};
