# Development Handoff

## Current State
Recoder is on the `remediation/android15-embedded-js-bundle` branch. The mobile IDE shell, native runtime build path, and authenticated GitHub-backed workspace persistence are implemented. When the server has GitHub sync variables, workspace loads and saves go directly through the GitHub Contents API. When those variables are incomplete, the app deliberately uses AsyncStorage as a local fallback.

## Recently Completed

The workspace layer now has deterministic rename/delete helpers, active-file repair, explicit save phases, retry-safe persistence, and revision-aware editor bridge status. The API now exposes authenticated `/api/github-sync/config`, `/api/github-sync/workspace` GET, and `/api/github-sync/workspace` PUT routes. GitHub credentials remain server-only; the configured repository, branch, and workspace path are returned without secrets. Saves use the loaded blob SHA, re-read the remote SHA before writing, and return `409` on conflicts instead of overwriting remote changes. A missing workspace document is created as a normal GitHub commit. The workbench save chip reports `SAVED TO GITHUB` when that mode is active.

The verified implementation has been autosaved to GitHub on `remediation/android15-embedded-js-bundle`.

## Configuration

Set `RECODER_GITHUB_TOKEN`, `RECODER_GITHUB_REPOSITORY`, `RECODER_GITHUB_BRANCH`, and optionally `RECODER_GITHUB_WORKSPACE_PATH`. If `OWNER_OPEN_ID` is set, GitHub sync is restricted to that authenticated Manus user. No GitHub token belongs in Expo or browser bundles.

## Known Limitations

Physical iPhone and Android validation has not been performed in this sandbox. GitHub OAuth account selection is not implemented inside Recoder; the server uses its configured GitHub credential and repository. Multi-user shared-repository collaboration is intentionally restricted when `OWNER_OPEN_ID` is configured and remains a future product decision otherwise. GitHub sync conflict recovery currently preserves the in-memory snapshot and exposes the existing retry/error state; an interactive pull/diff merge UI is a later slice. Browser editing remains a controlled `TextInput` fallback rather than CodeMirror parity.

## Verification

`pnpm install --frozen-lockfile`, `pnpm build:editor`, `pnpm check`, `pnpm lint`, `pnpm test`, `pnpm build`, and `git diff --check` pass. The full suite reports 62 active tests passed and 1 skipped, including three GitHub sync HTTP regressions covering authentication, configuration redaction, initial document creation, and stale-SHA conflict rejection.

## Files/Components Changed

The GitHub sync implementation is in `server/github-sync.ts`, `server/_core/env.ts`, `server/_core/index.ts`, `lib/workspace/store.ts`, `app/(tabs)/index.tsx`, `tests/github-sync.test.ts`, and `README.md`. Earlier editor, workspace, persistence, and generated bundle changes remain part of the same branch.

## Recommended Next Steps

Configure the four server variables in the deployment environment, run the app through the Manus OAuth login, and verify that the workbench reports `SAVED TO GITHUB` and that `.recoder/workspace.json` appears in the configured repository. Then exercise a deliberate remote edit to confirm the app surfaces a conflict without overwriting it. A future M1.2 iteration can add repository selection, GitHub OAuth, pull/diff/merge UI, and multi-user repository ownership.
