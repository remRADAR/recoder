

# Recoder Mobile IDE Shell — M1 Slice

## Outcome
Redesign the existing Recoder workspace as a mobile-first IDE shell inspired by VS Code/Code Spaces workflow patterns without pretending that browser surfaces have native-device capabilities. The first slice keeps the current project/file models, persistence, editor bridge, device execution, and loopback preview APIs while making the editor the primary full-height surface.

## Design

### Style options considered
- **Midnight Workbench** — VS Code-derived dark chrome with cyan focus accents and compact, high-signal controls. **0.06**
- **Paper Terminal** — warm light canvas with ink panels and a terminal-like command strip. **0.04**
- **Neon Utility** — near-black surfaces with saturated status colors and more expressive motion. **0.08**

### Chosen direction: Midnight Workbench
- **Design movement:** mobile-native command center: dense workbench chrome, generous touch targets, and an editor that owns the screen instead of being one card in a dashboard.
- **Core principles:** editor first; one-handed reachability; progressive disclosure; explicit capability boundaries.
- **Color philosophy:** deep navy surfaces reduce glare and make code the visual focus; cool cyan marks active context; green, amber, and red are reserved for runtime and persistence status.
- **Layout paradigm:** stacked workbench bands rather than desktop columns: top context bar, optional explorer surface, editor tabs + editor, collapsible output panel, bottom action rail.
- **Signature elements:** cyan active-file underline, compact project breadcrumb, and a bottom command rail with labeled actions instead of icon-only controls.
- **Interaction philosophy:** every important action has a visible touch path; the command palette mirrors the same actions for keyboard users and power users; sheets close without losing editor context.
- **Animation:** use platform-native modal/sheet transitions only; no decorative looping motion. Active states should change immediately and never delay editing.
- **Typography system:** system sans for chrome and status; platform monospace for filenames, code, and output. Headings are short and sentence case; labels are compact and verb-led.
- **Brand essence:** Recoder is a pocket workbench for making and running small software projects anywhere. Personality: focused, capable, candid.
- **Brand voice:** say “Run on device” and “Browser editing” rather than implying universal runtime parity. Example lines: “Open a file and keep the context.” “This capability is available in the native build.”
- **Wordmark & mark:** the UI uses a small cyan `R/` workbench mark in the top bar, not a separate image asset in this slice.
- **Signature brand color:** Recoder Cyan `#38BDF8`, used only for focus and active context.

## Interaction model

- **Top bar:** menu opens the explorer surface; `R/` mark and project name show context; a save-state chip reflects persistence; the command button opens the full-screen palette.
- **Explorer:** on phones it is a modal sheet from the left with projects, files, import/export, and new-file controls. On wider web surfaces it becomes a persistent narrow sidebar. It never replaces the active editor state.
- **Editor:** the active file tab row sits directly above a full-height CodeMirror/TextInput surface. File switching is explicit and does not depend on scrolling.
- **Output panel:** a compact, collapsible panel is opened by the bottom rail or execution status. It contains the existing bounded execution output and preview controls, with native-only labels where appropriate.
- **Bottom action rail:** Run, Preview, Save, and More are reachable at the bottom edge on phone-sized layouts. Save triggers the existing persistence coordinator; Run and Preview call the existing runtime adapters and show a clear web/native capability note.
- **Command palette:** full-screen searchable modal, keyboard-friendly through the text input, touch-friendly through large rows. Commands include opening explorer, creating files/projects, saving, importing/exporting, running, previewing, toggling output, and showing capability notes.
- **Responsive behavior:** phone portrait uses sheet explorer + bottom rail; phone landscape keeps the rail but gives the editor more horizontal room; tablet and desktop web promote the explorer to a sidebar and keep the rail as a compact command strip; no desktop-only interaction is required.

## Capability boundary

- **Web-safe now:** workspace persistence in browser storage, browser text editing, project/file management, import/export where the browser adapter allows it, command palette, and the shell itself.
- **Native-only or development-client dependent:** CodeMirror WebView surface, device JavaScript execution, cancellation, loopback preview server, and embedded loopback WebView. The UI labels these actions rather than hiding them or claiming browser support.
- **Future, not implemented here:** GitHub sync, extensions, MCP registry, phone-hosted arbitrary development servers, cloud-device persistence, and production-grade hostile-code isolation. This slice creates the shell locations for those capabilities without adding speculative APIs.

## Implementation structure

- `app/(tabs)/index.tsx`: shell composition, responsive layout state, command definitions, and existing workspace/runtime orchestration.
- `components/CodeMirrorEditor.tsx`: unchanged editor contract; shell owns sizing and surrounding chrome.
- `lib/workspace/*`: unchanged persistence/import/export adapters.
- `lib/runtime/*`: unchanged native execution and loopback preview adapters.
- `shared/recoder.ts`: unchanged project/file/runtime contracts.

## Safety and rollback

The change is presentation-focused and preserves the existing callbacks and data flow. Rollback is a single route-level revert. No credentials, production data, deployment configuration, or runtime security boundaries are changed.

## Verification

Run `pnpm check`, `pnpm lint`, `pnpm test`, `pnpm build:editor`, and `pnpm build` (Expo web export). Inspect the diff for accidental changes and verify the shell at phone and wider web dimensions if a browser preview is available. Physical native keyboard, import/export, and loopback behavior remain not tested in this sandbox.


# Proposed Next Slice — M1.1 Mobile Editing Foundation

## Why this slice comes next

The shell now provides the major surfaces, but the editor is still the product's weakest point: the browser uses a controlled text fallback, the native bridge still has the accepted full-document replacement and cursor-preservation deferrals, and persistence has not been manually validated across a restart. GitHub, extensions, and MCPs will be more valuable after editing, file navigation, and recovery feel dependable on a phone. This slice therefore improves the core editing loop before adding external integrations.

## Scope

M1.1 should deliver a trustworthy mobile editing loop across phone portrait, phone landscape, tablet, and web:

1. **Dirty-state and save semantics.** Track whether the active file or workspace has unsaved changes, show `Editing`, `Saving`, `Saved locally`, and `Save failed` states in the top bar, and make the Save command meaningful rather than merely repeating the latest coordinator call. Preserve the current retry behavior and never discard the newest in-memory edit when persistence fails.

2. **Editor bridge hardening.** Close the accepted AUD-L03 gap for the supported editing path: preserve cursor/selection where possible, reject oversized content before replacement, avoid avoidable full-document replacement on unrelated workspace updates, and surface native bridge readiness failures as visible editor state instead of only alerts. The implementation must keep the existing `CodeMirrorEditor` value/onChange contract or document a narrowly scoped adapter change.

3. **Phone file operations.** Add rename and delete with confirmation for files, prevent deleting the last file in a project, keep the active-file pointer valid after mutations, and expose these actions from both the explorer row and command palette. File names must remain validated by the existing workspace rules; no arbitrary path model is introduced.

4. **Workspace recovery.** Add a lightweight recent-workspace/recovery indicator based on the existing local snapshot, verify that a reload restores the active project, active file, and latest saved content, and keep failed saves recoverable. Do not introduce cloud sync or a second persistence backend in this slice.

5. **Mobile editing affordances.** Add an editor context action surface for Go to line, select all, duplicate line, and toggle output. On web, support keyboard invocation where the browser allows it; on native, keep touch targets at least 44 points and avoid claiming desktop shortcuts that are not wired.

6. **Validation surface.** Add focused tests for dirty-state transitions, active-file repair after rename/delete, restart restoration, oversized editor updates, and failed-save recovery. Verify the shell in browser preview at a narrow phone-like CSS width and the existing wider layout; physical device evidence remains a separate gate.

## Interaction design

The top bar becomes a truthful state indicator: the project context remains left-aligned, while the save chip changes from a static `SAVED LOCALLY` label to a stateful status. Tapping the status opens the recovery/save details rather than navigating away. The file explorer uses a trailing More action on each file row; the same action list is available from the command palette so touch and keyboard flows stay equivalent.

Rename uses an inline field in the explorer on phones and a compact modal on wider web. Delete is a destructive action that requires confirmation and explains when the last-file rule blocks it. After a mutation, the shell keeps the user in the same project and selects the nearest surviving file deterministically.

The editor context surface should be small and local to the active file. It must not turn the shell into a desktop command dump; actions should be limited to operations that are useful on a phone and can be implemented consistently across the web fallback and native editor bridge.

## Implementation structure

- `shared/recoder.ts`: extend workspace/file operations only if the current models cannot represent dirty or recovery metadata; prefer derived state over persisted UI state.
- `lib/workspace/core.ts` and `lib/workspace/store.ts`: add validated rename/delete helpers, active-file repair, and restart/recovery test seams while preserving snapshot versioning.
- `lib/workspace/persistence.ts`: expose save lifecycle state to the shell without duplicating persistence ownership.
- `components/CodeMirrorEditor.tsx`: harden bridge readiness, replacement, selection, and error signaling behind the current editor contract.
- `app/(tabs)/index.tsx`: consume save lifecycle state, add file-row actions, context actions, and responsive recovery UI; keep runtime execution and preview callbacks unchanged.
- `tests/`: add focused workspace, persistence, and editor-bridge regression coverage before changing integration scope.

## Explicit non-goals

This slice does not implement GitHub authentication or repository sync, an extension runtime, MCP discovery/execution, arbitrary phone-hosted development servers, cloud-device persistence, collaborative editing, or hostile-code isolation. Those require separate capability and security decisions after the editing foundation is reliable.

## Follow-on sequence after M1.1

- **M1.2 Repository bridge:** GitHub sign-in/connection, repository selection, clone/pull/push states, conflict-safe save boundaries, and explicit offline behavior.
- **M1.3 Capability registry:** an adapter model for extensions and MCPs, with permission scopes and browser/native availability metadata before installing or executing anything.
- **M1.4 Hosted runtime:** a separately isolated phone/cloud execution service and development-server lifecycle, with resource limits, authentication, logs, and a native-versus-web capability matrix.

## Approval and delivery gate

This is a proposed scope, not an implementation checkpoint. Approval should confirm that the next slice is the editing foundation rather than GitHub integration. Once approved, update `TODO.md` with the concrete M1.1 outcome clauses, implement on a new commit from `08d3ef0`, run the existing checks plus focused regressions, and deploy only to the isolated preview branch.


## M1.1 Technical specification

### State ownership and data flow

The persisted `WorkspaceSnapshot` remains the source of truth for projects, files, active project, and active file. Dirty state is derived in memory and is not persisted as a second truth: compare the current workspace/file content against the last successfully serialized snapshot or a per-file saved-content map held by the screen/workspace controller. UI-only state such as explorer visibility, palette query, rename target, confirmation dialogs, editor selection, and output-panel visibility remains local to the shell.

The screen should stop treating every editor keystroke as an opaque replacement of the entire workspace. The intended flow is `editor change -> updateFile(snapshot, fileId, content) -> mark dirty -> enqueue/coalesce save -> persist serialized snapshot -> acknowledge only the matching save sequence`. A save completion for sequence N must not clear dirty/error state created by sequence N+1. The existing `createSaveCoordinator` sequence guard remains the concurrency boundary; its state callback should become the single source for `Saving`, `Saved locally`, and `Save failed` presentation.

### Proposed contracts

Keep `SourceFile`, `Project`, and `WorkspaceSnapshot` version 1 compatible. Add pure helpers in `lib/workspace/core.ts` rather than putting mutation logic in the route:

```ts
export function renameFile(snapshot: WorkspaceSnapshot, fileId: string, name: string): WorkspaceSnapshot;
export function deleteFile(snapshot: WorkspaceSnapshot, projectId: string, fileId: string): WorkspaceSnapshot;
export function repairActiveFile(snapshot: WorkspaceSnapshot): WorkspaceSnapshot;
export function validateFileName(name: string): string;
```

`renameFile` must trim, reject empty names, reject path separators/control characters, preserve the file id/content/language, and derive language only when the product explicitly chooses to support extension changes. Duplicate names within one project should be rejected deterministically. `deleteFile` must reject deletion when the target project has one file, remove only the requested file, and repair `activeFileId` to the nearest surviving file in stable array order. Every helper must return a new snapshot and leave unrelated projects referentially unchanged where practical.

Extend the persistence presentation contract without moving storage ownership into React:

```ts
type SavePhase = "idle" | "dirty" | "saving" | "saved" | "failed";
type SaveCoordinatorState = {
  latestSequence: number;
  pendingSnapshot: WorkspaceSnapshot | null;
  error: Error | null;
  phase: SavePhase;
};
```

`phase` may be derived from the existing fields for compatibility. The coordinator must expose `getState()` and `subscribe()` or continue using its callback with a documented state transition table. `retry()` retries only the latest failed snapshot. A successful older save must never overwrite a newer pending snapshot or clear a newer error.

### Editor bridge protocol

Preserve the public `CodeMirrorEditor` props as `{ value: string; onChange(value: string): void }` for this slice. Internally, add an optional non-breaking status callback:

```ts
type EditorStatus = "loading" | "ready" | "replacing" | "error";
type EditorError = "content_too_large" | "bridge_not_ready" | "invalid_message" | "injection_failed";
```

Native bridge messages should carry a request/document revision so an old `ready`, `change`, or error event cannot overwrite a newer file selection. `sendValue` must remain byte-bounded by `MAX_EDITOR_CONTENT_BYTES`; it should update the last-sent revision only after a valid injection request is accepted. On a value change caused by the parent selecting another file, the bridge may replace the document; on a value change caused by the editor itself, the route must not immediately echo the same content back and reset selection.

Selection preservation should be implemented in the bundle protocol, not guessed in the route. Before a parent-driven replacement, request `{from,to}` when available; after the replacement, restore a clamped selection. If the WebView is not ready, render a visible editor status strip with `Editor is loading` or `Editor could not be initialized` and a retry action. Alerts may remain as secondary native feedback but cannot be the only error surface.

The web fallback should expose the same status callback and use a `TextInput` ref only for explicit context actions such as select-all or go-to-line. Do not claim CodeMirror parity on web until the browser editor surface actually supports the behavior.

### Save state transitions

- `idle -> dirty`: editor emits content different from the last acknowledged snapshot.
- `dirty -> saving`: coordinator accepts a snapshot and starts a write.
- `saving -> saved`: the matching sequence completes successfully and no newer dirty snapshot exists.
- `saving -> saving`: a newer edit supersedes the in-flight write; the next sequence remains pending.
- `saving -> failed`: the matching write fails; the failed snapshot remains retryable.
- `failed -> saving`: user taps Save or Retry and the pending snapshot is retried.
- `failed -> dirty`: user edits after failure; the new in-memory content remains authoritative.

The shell must label local persistence accurately. `Saved locally` means the current snapshot reached the configured local adapter, not GitHub or cloud storage.

## UI component architecture

The route should become a composition root rather than the implementation site for every interaction. The target tree is:

```text
HomeScreen
├── WorkbenchTopBar
│   ├── ExplorerButton
│   ├── ProjectBreadcrumb
│   ├── SaveStatusChip
│   └── CommandPaletteButton
├── WorkbenchBody
│   ├── ExplorerSurface
│   │   ├── ProjectList
│   │   ├── FileList
│   │   │   └── FileRow
│   │   │       └── FileActionsSheet
│   │   └── WorkspaceActions
│   └── EditorSurface
│       ├── FileTabs
│       ├── EditorStatusStrip
│       ├── CodeMirrorEditor
│       └── EditorContextSheet
├── OutputPanel
├── SaveRecoverySheet
├── CommandPalette
└── BottomActionRail
```

`WorkbenchTopBar` receives only project context and save state plus event callbacks. `SaveStatusChip` is pressable and opens `SaveRecoverySheet`; it does not call storage directly. `ExplorerSurface` owns layout differences only: persistent narrow sidebar at the wide breakpoint and modal sheet on phone widths. `ProjectList` and `FileList` receive data and callbacks, while `FileRow` owns presentation of the active state and More affordance. Rename/delete mutations are dispatched by the screen/controller through pure workspace helpers.

`EditorSurface` owns editor-adjacent state: active file, bridge status, context-sheet visibility, and editor action callbacks. `CodeMirrorEditor` remains a controlled surface with a narrow bridge adapter. `EditorContextSheet` must work with both the native WebView editor and browser TextInput through capability-aware callbacks; unsupported actions render disabled explanatory text rather than silently failing.

`CommandPalette` consumes a typed command registry instead of closures that directly access persistence refs during render:

```ts
type WorkbenchCommand = {
  id: string;
  label: string;
  hint: string;
  availability: "web" | "native" | "all";
  run: () => void;
};
```

The registry should be constructed from the controller event handlers and filtered by query plus platform availability. It must include the same file operations shown in the explorer so touch and keyboard users have equivalent capability. `BottomActionRail` remains limited to high-frequency actions: Run, Preview, Save, Output, and More.

### Responsive component behavior

At widths below 800 CSS pixels, `ExplorerSurface` is a left-side modal sheet with a scrim, minimum 44-point row targets, and a close action. At 800 pixels and above, it is a fixed sidebar with a bounded width and no modal scrim. The editor always keeps the largest remaining flex region. The bottom rail stays visible on phones and becomes a compact strip on wider layouts; it must not push the editor below a usable minimum height.

Rename uses an inline `TextInput` in a phone file row and a compact dialog on wider layouts. Delete confirmation uses the platform modal pattern and includes the file name plus the last-file constraint when relevant. Save recovery is a bottom sheet on phones and a centered dialog on wider web. All sheets support Escape/back dismissal where the platform provides it, but destructive confirmation must not dismiss by accidental outside tap.

### Accessibility and interaction requirements

All icon-like controls need an accessible label and a visible text fallback where feasible. Focus order on web is top bar, explorer, tabs, editor, output, and bottom rail. File rows expose their current selection state; save status exposes its phase as text; errors are announced through an inline live region on web and visible status text on native. Touch targets are at least 44 by 44 points. Color is never the only indication of dirty, failed, active, or native-only state.

### Error and capability boundaries

Workspace validation errors stay in the workspace adapter and are converted to concise user-facing messages by the controller. Editor bridge errors stay in the editor component and are surfaced through `EditorStatusStrip`. Runtime errors continue through the existing execution/preview paths and are not reclassified as editor or persistence errors. Browser-only limitations must be represented as `availability` metadata in the command registry; no command should imply that web can start a native loopback server.

### Performance and safety constraints

Coalesce save requests without dropping the latest snapshot. Do not serialize more than once per accepted save sequence. Keep the 2 MB workspace snapshot and 512 KB editor-content limits unchanged unless a separate capacity decision is approved. Avoid storing editor content in a second global cache. File rename/delete must be pure and deterministic so it can be tested without AsyncStorage. No GitHub token, extension package, MCP credential, or runtime secret belongs in this slice or in browser bundles.

### Focused test contracts

Add tests at the smallest owner:

- `workspace.test.ts`: rename validation, duplicate-name rejection, last-file deletion rejection, active-file repair, and unchanged-project preservation.
- `workspace-persistence.test.ts`: dirty/saving/saved/failed transitions, retry of the latest snapshot, and stale completion/error protection.
- `editor-bridge.test.ts`: revision-aware replacement, byte-limit rejection before injection, selection clamping, readiness/error messages, and duplicate-change suppression.
- A route/controller test where practical: command availability, file-action dispatch, and web/native labels.

The acceptance bar is not merely that the app compiles: a test must demonstrate that a newer edit remains visible and recoverable after an older save fails, and that a file mutation cannot leave `activeFileId` pointing to a deleted file.


# Proposed Next Slice — M1.2 Browser Runtime Parity

## Outcome
Make the web preview a useful mobile IDE surface instead of a shell-only fallback: JavaScript runs inside a bounded disposable browser Worker, the active project renders in an isolated in-browser preview, and unauthenticated/offline sessions remain usable through local persistence without misreporting a save failure. Native execution, loopback preview, GitHub sync, and governed agent approvals remain separate capability paths.

## Implementation structure

- `lib/runtime/web.ts`: browser Worker execution, bounded output/time limits, cancellation/session lookup, and blob-backed project preview.
- `app/(tabs)/index.tsx`: select the web provider on web, expose Run/Preview, and render the browser preview in the terminal panel.
- `lib/workspace/store.ts`: keep local storage as a deliberate fallback when the GitHub sync probe is unavailable.

## Safety boundary

Browser execution uses a disposable Worker with a five-second limit and 64-KB output cap. The project preview is rendered in a sandboxed iframe. This is not hostile-code OS isolation and does not add npm/package installation, public hosting, or cloud execution.
