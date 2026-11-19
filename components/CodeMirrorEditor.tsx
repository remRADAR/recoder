import { useEffect, useMemo, useRef } from "react";
import { Platform, TextInput, View } from "react-native";
import WebView, { type WebViewMessageEvent } from "react-native-webview";
import { codeMirrorBundle } from "@/lib/editor/codemirror-bundle";

type Props = { value: string; onChange: (value: string) => void };

export function CodeMirrorEditor({ value, onChange }: Props) {
  const webViewRef = useRef<WebView>(null);
  const html = useMemo(() => `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"/><style>html,body,#editor{margin:0;width:100%;height:100%;background:#282c34;color:#abb2bf} .cm-editor{height:100%;font-size:15px}.cm-scroller{overflow:auto;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}</style></head><body><div id="editor"></div><script>${codeMirrorBundle}</script><script>window.recoderMount(${JSON.stringify(value)});</script></body></html>`, [value]);

  useEffect(() => {
    if (Platform.OS !== "web") webViewRef.current?.injectJavaScript(`window.recoderSetValue(${JSON.stringify(value)}); true;`);
  }, [value]);

  if (Platform.OS === "web") {
    return <TextInput value={value} onChangeText={onChange} multiline autoCapitalize="none" autoCorrect={false} spellCheck={false} textAlignVertical="top" style={{ flex: 1, minHeight: 320, padding: 16, color: "#d7dae0", backgroundColor: "#282c34", fontFamily: "monospace", fontSize: 15 }} />;
  }

  const handleMessage = (event: WebViewMessageEvent) => onChange(event.nativeEvent.data);
  return <View style={{ flex: 1, minHeight: 320, overflow: "hidden", borderRadius: 12 }}><WebView ref={webViewRef} originWhitelist={["*"]} source={{ html }} onMessage={handleMessage} javaScriptEnabled scrollEnabled keyboardDisplayRequiresUserAction={false} /></View>;
}
