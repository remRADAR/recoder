# Development Handoff

## Current State
Recoder is on the `remediation/android15-embedded-js-bundle` branch, continuing the mobile IDE shell and native-runtime build line. The repository builds from a connected GitHub branch and local persistence is explicitly local; GitHub sync is not implemented in the app.

## Recently Completed
- Added pure, deterministic `renameFile`, `deleteFile`, `repairActiveFile`, and `validateFileName` workspace helpers.
- Added duplicate-name, invalid-name, last-file, and active-file repair regressions.
- Added explicit save coordinator phases and subscriptions while preserving stale-save protection and retry semantics.
- Added revision-aware editor bridge messages, bounded parent replacement, selection clamping, and visible native editor status/retry feedback.
- Wired the route save chip to show `SAVING`, `SAVED LOCALLY`, `SAVE FAILED`, `EDITING`, or `READY` semantics.
- Autosaved verified checkpoints to GitHub on `remediation/android15-embedded-js-bundle`.

## Known Limitations
- Physical iPhone and Android validation has not been performed in this sandbox.
- Native WebView selection is preserved using the last known/clamped selection; a full native selection telemetry API is not present.
- GitHub repository sync, extensions, MCP registry, hostile-code isolation, and cloud persistence remain separate future slices.
- Browser editing remains a controlled `TextInput` fallback rather than CodeMirror parity.

## Verification
- `pnpm install --frozen-lockfile`: passed.
- `pnpm build:editor`: passed; generated bundle is committed.
- `pnpm check`: passed.
- `pnpm lint`: passed in baseline run.
- `pnpm test`: baseline 56 active tests passed, 1 skipped; focused post-change suite 14 tests passed.
- `pnpm build`: passed in baseline run.

## Files/Components Changed
- `lib/workspace/core.ts`
- `lib/workspace/persistence.ts`
- `lib/workspace/store.ts`
- `lib/editor/bridge.ts`
- `scripts/codemirror-entry.ts`
- `components/CodeMirrorEditor.tsx`
- `app/(tabs)/index.tsx`
- `lib/editor/codemirror-bundle.ts` (generated)
- `tests/workspace.test.ts`
- `tests/workspace-persistence.test.ts`
- `tests/editor-bridge.test.ts`

## Recommended Next Steps
1. Run the full lint/test/build sequence after the current checkpoint.
2. Open the isolated browser preview at narrow and wide widths for visual regression.
3. Validate the native editor and file actions on physical iPhone/Android clients.
4. Plan M1.2 as an explicit GitHub repository bridge with authentication, pull/push states, conflict handling, and offline boundaries.
