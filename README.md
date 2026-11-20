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

The execution endpoint requires an authenticated owner. For local development only, unauthenticated execution can be enabled with `RECORDER_ALLOW_LOCAL_EXECUTION=true`, `NODE_ENV=development`, and a loopback request; remote unauthenticated requests are rejected. Sessions are owner-scoped, in-memory, time-bounded to five seconds, output-limited, concurrency-capped, and expired after thirty seconds. The endpoint accepts only project/file metadata and does not accept or run client-provided shell commands. It is labeled `simulated-disposable`; this is a lifecycle proof, not production sandbox isolation.

## Evidence status

Automated checks cover the editor bridge, hostile content handling, authenticated execution routes, owner isolation, validation, workspace state, CORS, and execution lifecycle. A local runtime smoke test verified API health and Metro response; authenticated execution smoke testing requires a configured session or the explicit loopback development flag above. Physical iPhone 13 and Android-device validation was not performed, so this branch makes no device-compatibility claim. Monaco was not forced into the mobile prototype because its official documentation excludes mobile browsers and mobile web frameworks; it remains a web/desktop comparison decision for M1.

The implementation plan and acceptance checklist are in `plan.md` and `TODO.md`.

## Audit remediation

Execution request admission is route-local and capped at 8 KB before the global 1 MB parsers. The global parser is no longer 50 MB. Execution requests use bounded raw-socket-IP and authenticated-owner rate limits; forwarded headers and `Origin` are not used as identity. The development fallback is refused in production, requires same-host loopback traffic, emits a startup warning, and logs a count for each accepted activation. Authentication `lastSignedIn` writes are throttled to once per minute per user.

Workspace snapshots are validated and capped at 2 MB before persistence, imported text is capped at 1 MB, and failed saves are surfaced with a retry action while the last known good AsyncStorage value remains untouched. Export temporary files are cleaned up in a `finally` block. Editor and execution limits are measured in UTF-8 bytes, and the editor bridge reports typed rejection errors.

`.github/workflows/ci.yml` runs frozen-lockfile installation, bundle generation, typecheck, lint, tests, API build, and generated-bundle cleanliness on pull requests and relevant pushes. CI has not been claimed green until GitHub executes the workflow; the local equivalent commands are the evidence reported for this commit.
