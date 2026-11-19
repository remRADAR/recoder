# Recoder M0.5 Implementation Plan

## Scope

This branch is a feasibility prototype, not the production application. It validates a mobile-first workspace using the initialized Expo/React Native/TypeScript shell, CodeMirror 6 in a WebView on native surfaces, a clearly bounded web fallback, app-private persistence, explicit file import/export, and a disposable remote-execution proof with streamed output and cancellation.

## Architecture

- `shared/recoder.ts` owns platform-neutral project, document, and execution contracts.
- `lib/workspace/` owns AsyncStorage persistence and explicit document import/export adapters.
- `components/CodeMirrorEditor.tsx` owns editor surface selection. Native uses a local CodeMirror 6 WebView bundle; web uses a controlled TextInput fallback while retaining the same editor contract.
- `lib/execution/provider.ts` owns the client execution-provider interface and polling client.
- `server/execution.ts` owns a fixed-command, bounded, in-memory disposable proof. It does not accept arbitrary shell input and is not production isolation.
- The home route presents project/file navigation, editor interaction, persistence controls, and execution status/output in one mobile-first flow.

## Safety boundaries

No credentials, arbitrary shell commands, privileged sockets, production database writes, public unauthenticated workspace, or paid infrastructure are used. The remote proof is explicitly labeled simulated/disposable and must not be promoted to production without a real isolated executor and security review.

## Verification

Run `pnpm check`, `pnpm lint`, `pnpm test`, `pnpm build:editor`, and `pnpm build`. Start `pnpm dev` only for preview verification. Physical iPhone 13 and Android device evidence remains unavailable unless the app is run on those devices; emulator/web results must not be described as device compatibility.
