import { indentWithTab } from "@codemirror/commands";
import { javascript } from "@codemirror/lang-javascript";
import { EditorState } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView, keymap } from "@codemirror/view";

declare global {
  interface Window {
    ReactNativeWebView?: { postMessage: (message: string) => void };
    recoderMount?: (value: string) => void;
    recoderSetValue?: (value: string) => void;
    recoderEditor?: EditorView;
  }
}

window.recoderMount = (value: string) => {
  const parent = document.getElementById("editor");
  if (!parent) return;
  const state = EditorState.create({
    doc: value,
    extensions: [oneDark, javascript(), keymap.of([indentWithTab]), EditorView.lineWrapping, EditorView.updateListener.of((update) => {
      if (update.docChanged) window.ReactNativeWebView?.postMessage(update.state.doc.toString());
    })],
  });
  window.recoderEditor = new EditorView({ state, parent });
};
window.recoderSetValue = (value: string) => {
  const editor = window.recoderEditor;
  if (!editor || editor.state.doc.toString() === value) return;
  editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } });
};
