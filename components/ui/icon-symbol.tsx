// Fallback for using MaterialIcons on Android and web.

import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { SymbolWeight, SymbolViewProps } from "expo-symbols";
import { ComponentProps, useSyncExternalStore } from "react";
import { OpaqueColorValue, type StyleProp, type TextStyle } from "react-native";

type IconMapping = Partial<Record<Extract<SymbolViewProps["name"], string>, ComponentProps<typeof MaterialIcons>["name"]>>;
type IconSymbolName = keyof typeof MAPPING;

/**
 * Add your SF Symbols to Material Icons mappings here.
 * - see Material Icons in the [Icons Directory](https://icons.expo.fyi).
 * - see SF Symbols in the [SF Symbols](https://developer.apple.com/sf-symbols/) app.
 */
const MAPPING = {
  "house.fill": "home",
  "paperplane.fill": "send",
  "chevron.left.forwardslash.chevron.right": "code",
  "chevron.right": "chevron-right",
} satisfies IconMapping;

// A store that never changes: we only care about which snapshot React asks for.
const subscribeToNothing = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

/**
 * An icon component that uses native SF Symbols on iOS, and Material Icons on Android and web.
 * This ensures a consistent look across platforms, and optimal resource usage.
 * Icon `name`s are based on SF Symbols and require manual mapping to Material Icons.
 */
export function IconSymbol({
  name,
  size = 24,
  color,
  style,
}: {
  name: IconSymbolName;
  size?: number;
  color: string | OpaqueColorValue;
  style?: StyleProp<TextStyle>;
  weight?: SymbolWeight;
}) {
  // The icon font is loaded asynchronously on web. Rendering the glyph during the
  // first pass produced markup the server had not emitted (an empty node server-side
  // versus a glyph-bearing <span> on the client), which React reported as #418
  // (hydration mismatch). Render nothing until mounted so both passes agree, then
  // swap the real glyph in.
  //
  // `useSyncExternalStore` is the hydration-safe way to ask "are we on the client
  // yet?": the server snapshot is `false` and the client snapshot is `true`, so the
  // hydration render matches the server exactly and React re-renders with the real
  // glyph once hydration completes. A `useState` + `useEffect` pair did the same job
  // but tripped `react-hooks/set-state-in-effect` (cascading render on mount).
  const mounted = useSyncExternalStore(
    subscribeToNothing,
    getClientSnapshot,
    getServerSnapshot,
  );

  if (!mounted) return null;

  return <MaterialIcons color={color} size={size} name={MAPPING[name]} style={style} />;
}
