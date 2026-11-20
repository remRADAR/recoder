

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
