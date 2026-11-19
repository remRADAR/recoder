# Recoder M0.5

Recoder is a mobile-first coding feasibility prototype built on Expo/React Native and TypeScript. This branch validates app-private workspace persistence, source editing, explicit file import/export, a CodeMirror 6 editor surface for native WebView integration, and a bounded disposable execution proof with streamed output and cancellation.

## Run locally

```bash
pnpm install
pnpm build:editor
pnpm check
pnpm lint
pnpm test
pnpm build
pnpm dev
```

The API listens on port `3000` and Expo Metro/Web listens on port `8081`. The prototype uses the generated `lib/editor/codemirror-bundle.ts`; regenerate it with `pnpm build:editor` after changing `scripts/codemirror-entry.ts`.

## Safety boundary

The execution endpoint accepts only project and file metadata. It does not accept or run client-provided shell commands. Sessions are in-memory, time-bounded to five seconds, and labeled `simulated-disposable`; this is a feasibility proof, not production sandbox isolation. No client credentials, privileged container socket, production database, or public unauthenticated workspace is used.

## Evidence status

Automated checks pass: TypeScript check, Expo lint, 27 active Vitest tests, and the API bundle build. A local runtime smoke test verified API health, streamed completion output, and cancellation. Metro returned a successful web response. Physical iPhone 13 and Android-device validation was not performed in this sandbox, so this branch makes no device-compatibility claim. Monaco was not forced into the mobile prototype because its official documentation excludes mobile browsers and mobile web frameworks; it remains a web/desktop comparison decision for M1.

The implementation plan and acceptance checklist are in `plan.md` and `TODO.md`.
