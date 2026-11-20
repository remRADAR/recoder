# Recoder M0.6 PoC-1

Recoder is a mobile-first coding environment whose first device-native proof runs user JavaScript on the phone, serves the active project over loopback, and renders that preview in a separate WebView. The application-private workspace continues to use AsyncStorage and survives application restarts.

## Run locally

```bash
pnpm install
pnpm build:editor
pnpm check
pnpm lint
pnpm test
pnpm build
```

The app remains an Expo/React Native project. The device-native runtime requires a development client generated with Expo prebuild; Expo Go and web intentionally report the capability as unavailable rather than silently selecting the old remote simulator.

## Device-native architecture

- `shared/recoder.ts` defines the platform-neutral execution and local-server contracts.
- `lib/runtime/native.ts` selects the `RecoderRuntime` Expo native module and enforces the 5-second / 64-KB limits.
- `modules/recoder-runtime/ios/RecoderRuntimeModule.swift` creates a non-persistent `WKWebView` execution context and a 127.0.0.1 `NWListener` server.
- `modules/recoder-runtime/android/.../RecoderRuntimeModule.kt` uses an application-owned WebView for JavaScript and a loopback `ServerSocket` for preview hosting. It does not execute arbitrary downloaded ELF files.
- The app screen passes the selected project file content to the native runtime and passes the actual project files to the local server. The preview is a separate WebView loaded from the returned loopback URL.

The execution WebView has no access to the trusted Recoder UI WebView, uses a non-persistent data store, and is disposed after completion, cancellation, or timeout. This is application sandboxing and context separation, not hostile-code OS isolation. There is no package manager, npm/pip installation, Node.js compatibility layer, LAN binding, public server, cloud execution, or background development server.

## Verification status

Automated verification on the sandbox passed:

- `pnpm check`
- `pnpm test` — 52 passed, 1 existing skipped
- `pnpm lint`
- `pnpm build`
- `pnpm build:editor`

The repository baseline was verified before implementation: `m0.5/prototype` and PR #1 head both resolved to `38522b31f42fb50523045bec711cdeec0fa7a3b1`. No physical iPhone 13 or physical Android device was available in this environment, so physical-device validation is **NOT YET VERIFIED**. Native Swift/Kotlin compilation and real localhost preview validation require an Expo development-client build on the target hardware or a simulator/emulator.

## Safety boundary

Project files are sent only to the native runtime module. The loopback server accepts only relative project paths and rejects absolute paths, parent traversal, and Windows-style separators. It binds to 127.0.0.1 and is shut down explicitly by the preview control. Execution has a bounded timeout and byte-limited output; cancellation destroys the WebView context. The implementation does not claim OS-level isolation from hostile code.

## Next step

Generate an Expo development client with `npx expo prebuild`, run the app on an iPhone 13 and a modern Android emulator/device, and record the acceptance checklist with one of `VERIFIED ON DEVICE`, `VERIFIED IN SIMULATOR/EMULATOR`, or `NOT YET VERIFIED` for every native criterion. Resolve any Swift/Kotlin compile or WebView behavior issues before expanding scope.
