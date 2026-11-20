import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Platform, Text, TextInput, View } from "react-native";
import WebView, { type WebViewMessageEvent } from "react-native-webview";
import { codeMirrorBundle } from "@/lib/editor/codemirror-bundle";
import { encodeEditorSetMessage, MAX_EDITOR_CONTENT_BYTES, parseEditorBridgeMessage, utf8ByteLength } from "@/lib/editor/bridge";

export type EditorStatus = "loading" | "ready" | "replacing" | "error";
export type EditorError = "content_too_large" | "bridge_not_ready" | "invalid_message" | "injection_failed";
type Props = { value: string; onChange: (value: string) => void; onStatus?: (status: EditorStatus, error?: EditorError) => void };
const EDITOR_HTML = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"/><style>html,body,#editor{margin:0;width:100%;height:100%;background:#282c34;color:#abb2bf} .cm-editor{height:100%;font-size:15px}.cm-scroller{overflow:auto;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}</style></head><body><div id="editor"></div><script>${codeMirrorBundle}</script></body></html>`;

export function CodeMirrorEditor({ value, onChange, onStatus }: Props) {
  const webViewRef = useRef<WebView>(null);
  const readyRef = useRef(false);
  const revisionRef = useRef(0);
  const lastSentValueRef = useRef<string | null>(null);
  const lastSentRevisionRef = useRef(0);
  const [status, setStatus] = useState<EditorStatus>(Platform.OS === "web" ? "ready" : "loading");
  const [error, setError] = useState<EditorError | undefined>();
  const html = useMemo(() => EDITOR_HTML, []);
  const report = (next: EditorStatus, nextError?: EditorError) => { setStatus(next); setError(nextError); onStatus?.(next, nextError); };
  const sendValue = (next: string) => {
    if (!readyRef.current) { report("loading", "bridge_not_ready"); return; }
    if (lastSentValueRef.current === next) return;
    if (utf8ByteLength(next) > MAX_EDITOR_CONTENT_BYTES) { report("error", "content_too_large"); return; }
    const revision = ++revisionRef.current;
    const selection = { from: 0, to: 0 };
    report("replacing");
    try {
      webViewRef.current?.injectJavaScript(`window.recoderSetMessage(${JSON.stringify(encodeEditorSetMessage(next, revision, selection))}); true;`);
      lastSentValueRef.current = next;
      lastSentRevisionRef.current = revision;
    } catch { report("error", "injection_failed"); }
  };
  useEffect(() => {
    if (Platform.OS === "web" || !readyRef.current) return;
    const timer = setTimeout(() => sendValue(value), 0);
    return () => clearTimeout(timer);
    // sendValue intentionally closes over the current controlled value and stable refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  if (Platform.OS === "web") return <View style={{ flex: 1, minHeight: 320 }}><TextInput accessibilityLabel="Source editor" value={value} onChangeText={onChange} multiline autoCapitalize="none" autoCorrect={false} spellCheck={false} textAlignVertical="top" style={{ flex: 1, padding: 16, color: "#d7dae0", backgroundColor: "#282c34", fontFamily: "monospace", fontSize: 15 }} /></View>;
  const handleLoadEnd = () => { readyRef.current = false; report("loading"); try { webViewRef.current?.injectJavaScript(`window.recoderMount(); true;`); } catch { report("error", "injection_failed"); } };
  const handleMessage = (event: WebViewMessageEvent) => {
    const message = parseEditorBridgeMessage(event.nativeEvent.data);
    if (!message) { report("error", "invalid_message"); return; }
    if (message.revision < revisionRef.current) return;
    revisionRef.current = message.revision;
    if (message.type === "ready") { readyRef.current = true; lastSentValueRef.current = null; report("ready"); sendValue(value); }
    else if (message.type === "error") { report("error", message.code === "content_too_large" ? "content_too_large" : "invalid_message"); Alert.alert("Editor update rejected", message.code === "content_too_large" ? "This file exceeds the 512 KB editor limit." : "The editor rejected an invalid bridge payload."); }
    else if (message.type === "change" && message.revision >= lastSentRevisionRef.current && message.value !== lastSentValueRef.current) { report("ready"); onChange(message.value); }
  };
  const retry = () => { readyRef.current = false; report("loading"); try { webViewRef.current?.reload(); } catch { report("error", "injection_failed"); } };
  return <View style={{ flex: 1, minHeight: 320, overflow: "hidden", borderRadius: 12 }}><WebView ref={webViewRef} originWhitelist={["about:blank"]} source={{ html }} onLoadEnd={handleLoadEnd} onMessage={handleMessage} javaScriptEnabled domStorageEnabled={false} allowFileAccess={false} allowUniversalAccessFromFileURLs={false} setSupportMultipleWindows={false} scrollEnabled keyboardDisplayRequiresUserAction={false} /><View pointerEvents="box-none" style={{ position: "absolute", left: 8, right: 8, bottom: 8, minHeight: 30, justifyContent: "center", alignItems: "center", backgroundColor: status === "error" ? "#451A03" : "rgba(16,24,39,0.88)", borderRadius: 8 }}><Text style={{ color: status === "error" ? "#FCD34D" : "#BAE6FD", fontSize: 11 }}>{status === "loading" ? "Editor is loading" : status === "replacing" ? "Updating document…" : status === "error" ? `Editor could not be initialized${error ? ` (${error})` : ""}` : "Editor ready"}{status === "error" && <Text onPress={retry}>  Retry</Text>}</Text></View></View>;
}
