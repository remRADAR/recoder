# Development Handoff

## Current State
Recoder is on the `remediation/android15-embedded-js-bundle` branch. The mobile IDE shell, native runtime build path, authenticated GitHub-backed workspace persistence, secure agent configuration, and compact desktop-style AI dock are implemented. When the server has GitHub sync variables, workspace loads and saves go directly through the GitHub Contents API. When those variables are incomplete, the app deliberately uses AsyncStorage as an explicit local fallback.

## Recently Completed

The workspace layer now has deterministic rename/delete helpers, active-file repair, explicit save phases, retry-safe persistence, and revision-aware editor bridge status. The API now exposes authenticated `/api/github-sync/config`, `/api/github-sync/workspace` GET, and `/api/github-sync/workspace` PUT routes. GitHub credentials remain server-only; the configured repository, branch, and workspace path are returned without secrets. Saves use the loaded blob SHA, re-read the remote SHA before writing, and return `409` on conflicts instead of overwriting remote changes. A missing workspace document is created as a normal GitHub commit. The workbench save chip reports `SAVED TO GITHUB` when that mode is active.

The verified implementation has been autosaved to GitHub on `remediation/android15-embedded-js-bundle`.

The current workbench has an Explorer/editor/terminal composition on wide screens and a mobile AI dock that can be opened from the top bar or command palette. The dock runs a bounded OpenAI-compatible tool loop with `list_files`, `read_file`, `write_file`, `append_file`, and `run_file` tools. Provider credentials are resolved inside the runtime module from Expo SecureStore; raw keys are not placed in workspace state, prompts, or UI state.

## Configuration and Deployment

GitHub sync is configured on the authenticated API server, not in the Expo/browser bundle and not in the static web preview deployment. Set these server-side variables in the environment that runs `server/_core/index.ts`:

| Variable | Required | Value |
|---|---:|---|
| `RECODER_GITHUB_TOKEN` | Yes | A server-side fine-grained GitHub token with `Contents: Read and write` on the target repository. `GITHUB_TOKEN` is accepted as a fallback for compatible hosted runners. |
| `RECODER_GITHUB_REPOSITORY` | Yes | Repository in `owner/name` form, for example `remRADAR/recoder`. |
| `RECODER_GITHUB_BRANCH` | No | Target branch; defaults to `main`. |
| `RECODER_GITHUB_WORKSPACE_PATH` | No | Workspace JSON path; defaults to `.recoder/workspace.json`. |
| `OWNER_OPEN_ID` | Recommended | Manus `openId` allowed to read and write the configured repository. If empty, any authenticated app user can use the shared configured repository. |

Provision the variables as server secrets/environment settings and restart the API service. Do not add them to `.env` files committed to Git, Expo public variables, `app.config.ts`, browser build settings, or GitHub Actions logs. The existing `recoder-preview.yml` workflow deploys only static Expo assets; it does not provision or run the API server, so the GitHub variables must also be configured in the separate API hosting environment.

After deployment, authenticate through Manus OAuth, confirm `GET /api/github-sync/config` reports `enabled: true` without exposing a token, edit and save a workspace, verify the `SAVED TO GITHUB` status, and confirm `.recoder/workspace.json` appears in the configured branch. Make a deliberate remote edit and confirm a stale client receives a conflict rather than overwriting it. A token with insufficient contents permission, a missing repository, a protected branch requiring reviews, or an API server that cannot reach `api.github.com` will prevent saves.

## Known Limitations

Physical iPhone and Android validation has not been performed in this sandbox. GitHub OAuth account selection is not implemented inside Recoder; the server uses its configured GitHub credential and repository. Multi-user shared-repository collaboration is intentionally restricted when `OWNER_OPEN_ID` is configured and remains a future product decision otherwise. GitHub sync conflict recovery currently preserves the in-memory snapshot and exposes the existing retry/error state; an interactive pull/diff merge UI is a later slice. Browser editing remains a controlled `TextInput` fallback rather than CodeMirror parity. Agent tool execution currently requires an OpenAI-compatible provider endpoint; Anthropic/Gemini profiles can still be configured but need provider adapters before tool loops can use them. The agent can edit only the in-memory active workspace and persist through the existing save coordinator; it does not receive raw GitHub tokens or unrestricted OS shell access. The existing native runtime remains bounded JavaScript/WebView execution rather than a full Codespaces container, package manager, or remote Linux shell.

## Verification

`pnpm install --frozen-lockfile`, `pnpm build:editor`, `pnpm check`, `pnpm lint`, `pnpm test`, `pnpm build`, and `git diff --check` pass. The full suite reports 62 active tests passed and 1 skipped, including three GitHub sync HTTP regressions covering authentication, configuration redaction, initial document creation, and stale-SHA conflict rejection.

## Files/Components Changed

The GitHub sync implementation is in `server/github-sync.ts`, `server/_core/env.ts`, `server/_core/index.ts`, `lib/workspace/store.ts`, `app/(tabs)/index.tsx`, `tests/github-sync.test.ts`, and `README.md`. Earlier editor, workspace, persistence, and generated bundle changes remain part of the same branch.

## Recommended Next Steps

Provision the server variables above, run the app through Manus OAuth, and complete the GitHub save/conflict checklist before calling deployment verified. A future M1.2 iteration can add repository selection, GitHub OAuth, pull/diff/merge UI, multi-user repository ownership, Anthropic/Gemini tool adapters, explicit per-task approval prompts, and a true device-side shell/container if the product requires Codespaces-level execution.
