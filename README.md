# Recoder M0.6 PoC-1

Recoder is a mobile-first coding environment whose first device-native proof runs user JavaScript on the phone, serves the active project over loopback, and renders that preview in a separate WebView. When GitHub sync is configured, the authenticated workspace is persisted directly to a server-selected GitHub repository; otherwise the app uses AsyncStorage as an explicit local fallback.

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

The execution WebView has no access to the trusted Recoder UI WebView, uses a non-persistent data store, and is disposed after completion, cancellation, or timeout. Executed JavaScript can currently access network APIs; network-off-by-default is a future security improvement, not an existing capability. This is application sandboxing and context separation, not hostile-code OS isolation. There is no package manager, npm/pip installation, Node.js compatibility layer, LAN binding, public server, cloud execution, or background development server.

## GitHub workspace sync

The server owns the GitHub credential; no token is bundled into the Expo client. Configure `RECODER_GITHUB_TOKEN`, `RECODER_GITHUB_REPOSITORY` (`owner/name`), `RECODER_GITHUB_BRANCH`, and optionally `RECODER_GITHUB_WORKSPACE_PATH` (default `.recoder/workspace.json`). If `OWNER_OPEN_ID` is set, only that authenticated Manus user can read or write the configured repository. The app discovers the configuration at startup and changes its save status to `SAVED TO GITHUB` when active.

Every workspace save is an authenticated `PUT` to the GitHub Contents API. The client sends the last loaded blob SHA, and the server re-reads the remote SHA before writing. A mismatch returns `409` instead of overwriting someone else's changes; the app preserves the in-memory snapshot and shows the existing retry/error state. A missing workspace file is created with a normal Git commit. GitHub sync is not enabled when the server configuration is incomplete, in which case local AsyncStorage is used deliberately rather than silently mixing the two persistence backends.

## Verification status

Automated verification on the sandbox passed:

- `pnpm check`
- `pnpm test` — 56 passed, 1 existing skipped
- `pnpm lint`
- `pnpm build`
- `pnpm build:editor`

`npx expo prebuild --no-install` completed and Expo autolinking discovered `@recoder/runtime` for both platforms. The required Android command, `cd android && ./gradlew :app:assembleDebug`, resolved the SDK 57 toolchain (`compileSdk 36`, `targetSdk 36`, Kotlin `2.1.20`) but could not start compilation because this sandbox has no Android SDK or `ANDROID_HOME`. Xcode, CocoaPods, and iOS simulator tooling are not installed here. Therefore native compilation is **NOT VERIFIED**, and physical iPhone 13 / Android validation is **NOT VERIFIED**.

## Safety boundary

Project files are sent only to the native runtime module. Each preview server has a cryptographically random token, requires that token on every request, accepts only relative project paths, rejects absolute/encoded traversal and Windows-style separators, and binds to 127.0.0.1. Request parsing and connections are bounded, and shutdown closes the listener. Execution has a bounded timeout, a two-session concurrency cap, ordered live stdout/stderr delivery, and explicit output truncation; cancellation destroys the WebView context. The implementation does not claim OS-level isolation from hostile code.

## Remediation closure state

F-01 through F-10 remain addressed in source. This round closes F-11 through F-18: iOS evaluation no longer uses `MainActor.assumeIsolated` and gates continuation completion exactly once; iOS enforces two active execution contexts and eight active preview connections; both platforms normalize completed/failed/timed-out/cancelled results; timeout classification uses a structured code; Android wraps source with JSON-safe escaping; terminal session retention is bounded; and shared TypeScript limits cover execution, output, request, and preview-connection budgets. Platform-independent regression coverage now reports 56 passing tests. Native compilation and simulator/device execution remain **NOT VERIFIED** because the required Apple and Android toolchains are unavailable in this environment. The authoritative audit text was not present as a repository file or PR review artifact; the remediation order was used as the finding-to-source mapping.

## Next step

Generate an Expo development client with `npx expo prebuild`, run the app on an iPhone 13 and a modern Android emulator/device, and record the acceptance checklist with one of `VERIFIED ON DEVICE`, `VERIFIED IN SIMULATOR/EMULATOR`, or `NOT YET VERIFIED` for every native criterion. Resolve any Swift/Kotlin compile or WebView behavior issues before expanding scope.
