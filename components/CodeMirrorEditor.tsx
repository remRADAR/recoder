import { useEffect, useMemo, useRef } from "react";
import { Platform, TextInput, View } from "react-native";
import WebView, { type WebViewMessageEvent } from "react-native-webview";
import { codeMirrorBundle } from "@/lib/editor/codemirror-bundle";
import { encodeEditorSetMessage, parseEditorBridgeMessage } from "@/lib/editor/bridge";

type Props = { value: string; onChange: (value: string) => void };

const EDITOR_HTML = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"/><style>html,body,#editor{margin:0;width:100%;height:100%;background:#282c34;color:#abb2bf} .cm-editor{height:100%;font-size:15px}.cm-scroller{overflow:auto;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}</style></head><body><div id="editor"></div><script>${codeMirrorBundle}</script></body></html>`;

export function CodeMirrorEditor({ value, onChange }: Props) {
  const webViewRef = useRef<WebView>(null);
  const readyRef = useRef(false);
  const lastSentValueRef = useRef<string | null>(null);
  const html = useMemo(() => EDITOR_HTML, []);

  const sendValue = (next: string) => {
    if (!readyRef.current || lastSentValueRef.current === next) return;
    lastSentValueRef.current = next;
    webViewRef.current?.injectJavaScript(`window.recoderSetMessage(${JSON.stringify(encodeEditorSetMessage(next))}); true;`);
  };

  useEffect(() => {
    if (Platform.OS !== "web") sendValue(value);
  }, [value]);

  if (Platform.OS === "web") {
    return <TextInput value={value} onChangeText={onChange} multiline autoCapitalize="none" autoCorrect={false} spellCheck={false} textAlignVertical="top" style={{ flex: 1, minHeight: 320, padding: 16, color: "#d7dae0", backgroundColor: "#282c34", fontFamily: "monospace", fontSize: 15 }} />;
  }

  const handleLoadEnd = () => {
    readyRef.current = false;
    webViewRef.current?.injectJavaScript(`window.recoderMount(); true;`);
    setTimeout(() => {
      readyRef.current = true;
      lastSentValueRef.current = null;
      sendValue(value);
    }, 0);
  };
  const handleMessage = (event: WebViewMessageEvent) => {
    const message = parseEditorBridgeMessage(event.nativeEvent.data);
    if (!message) return;
    if (message.type === "ready") {
      readyRef.current = true;
      lastSentValueRef.current = null;
      sendValue(value);
    } else if (message.type === "change" && message.value !== lastSentValueRef.current) {
      onChange(message.value);
    }
  };

  return <View style={{ flex: 1, minHeight: 320, overflow: "hidden", borderRadius: 12 }}><WebView ref={webViewRef} originWhitelist={["about:blank"]} source={{ html }} onLoadEnd={handleLoadEnd} onMessage={handleMessage} javaScriptEnabled domStorageEnabled={false} allowFileAccess={false} allowUniversalAccessFromFileURLs={false} setSupportMultipleWindows={false} scrollEnabled keyboardDisplayRequiresUserAction={false} /></View>;
}
