

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
