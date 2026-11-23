# RC-M05-01 Evidence Checklist

- [x] Application starts successfully on the local Metro/API runtime; physical native startup is not tested.
- [x] User can create a project in the implemented workspace UI.
- [x] User can create and edit a source file in the implemented workspace UI.
- [ ] Changes survive an actual application restart; persistence is implemented and covered by storage design, but restart was not manually verified.
- [ ] File import/export works on a validated physical platform; adapters are implemented, but physical file-flow verification was not performed.
- [ ] Editor keyboard, clipboard, selection, scrolling, and accessibility are usable on a physical device; not tested.
- [x] A bounded simulated-disposable execution session can be established by an authenticated owner or explicitly gated loopback development mode.
- [x] Simulated output streams to the mobile interface through polling.
- [x] Session cancellation works and is owner-scoped.
- [x] Execution is bounded, output-limited, expiry-limited, concurrency-capped, and explicitly labeled simulated; it is not production isolation.
- [x] No credentials are exposed to client source; authenticated API requests use session credentials.
- [x] Automated checks pass, including editor bridge, HTTP security, workspace, CORS, and execution tests.
- [x] Startup/runtime smoke evidence, security limitations, known defects, and M1 recommendations are documented.

## Audit remediation status

- [x] AUD-M01: Execution routes admit no more than 8 KB before route handling; global parsers are capped at 1 MB.
- [x] AUD-I01: Public-repository GitHub Actions workflow added with frozen install, required checks, build, and generated-bundle diff verification. Each closure commit must retain its own successful run evidence.
- [x] AUD-M04: Snapshot/import limits, failed-save preservation, retry semantics, and user-facing persistence errors are implemented and tested.
- [x] AUD-M03: Production refuses local fallback; development fallback is explicit, same-host loopback only, warned at startup, and counted on activation.
- [x] AUD-M02: Raw socket-IP and authenticated-owner rate limits are separate from session concurrency; authentication writes are throttled.
- [x] AUD-L01: Editor and execution output limits use UTF-8 byte accounting with multibyte tests.
- [x] AUD-L02: Native-side editor size rejection occurs before injection and surfaces a typed visible error.
- [x] AUD-L05: Project and file identifiers use runtime random UUIDs with a fallback and rapid-creation tests.
- [x] AUD-L06: Export temporary files are cleaned up and unavailable sharing surfaces an explicit error.
- [x] AUD-I03: Expiry, concurrency, output-cap, malformed UUID, oversized metadata, and rate-limit tests are included.
- [x] AUD-R01: IP/owner rate-limit memory is bounded to 10,000 keys, prunes inactive entries, and never evicts active keys to admit new cardinality.
- [x] AUD-R02: Save attempts are sequence-aware; stale failures cannot replace a newer successful save or clear newer error state.
- [x] AUD-R03: Reported import size is checked before reading, with a second UTF-8 check after reading and missing metadata handled conservatively.
- [x] AUD-R04: Authentication throttle reservations occur before database awaits, concurrent first reservations collapse to one write, and failed writes release the reservation.
- [x] AUD-R07: Native workspace adapters configure Expo Crypto `randomUUID()`; platform-neutral and Web Crypto/random fallbacks remain available.

## Accepted M1 deferrals

- [ ] AUD-L03: Full-document replacement, cursor/selection preservation, and incremental editor updates.
- [ ] AUD-L04: WebView readiness fallback and stronger initialization-failure handling.

## Outstanding validation

Physical iPhone 13 and physical Android validation remain unperformed. The simulated execution proof must not be described as secure production isolation. A real isolated execution provider, device evidence, restart testing, native import/export testing, AUD-L03, and AUD-L04 remain M1 work.


# RC-M1 Mobile IDE Shell Outcomes

- [x] **Mobile-first workbench shell:** The existing Recoder workspace is presented as a full-height mobile IDE with a top project context bar, editor-first center surface, bottom action rail, and responsive behavior for phone portrait, phone landscape, tablet, and desktop web.
- [x] **Responsive editor and file explorer:** The active file remains editable through the existing CodeMirror/native bridge or browser fallback; the explorer supports project selection, file selection, new file, import, and export without breaking workspace persistence.
- [x] **Command palette:** A full-screen searchable palette exposes the shell actions through touch-friendly rows and a keyboard-friendly search field, without inventing unsupported runtime capabilities.
- [x] **Capability boundaries:** Browser-safe editing/persistence remains usable on web, while native-only execution, cancellation, loopback preview, and embedded preview are labeled as development-client/native capabilities.
- [x] **Existing behavior preserved:** Current workspace save/retry behavior, project/file models, device execution output, cancellation, and local preview callbacks remain connected to the redesigned shell.


# RC-M1.1 Mobile Editing Foundation Outcomes

- [ ] **Truthful save lifecycle:** The shell shows `Editing`, `Saving`, `Saved locally`, and `Save failed` states; a newer edit cannot be cleared by an older save completion or failure; Retry operates on the latest failed snapshot.
- [ ] **Editor bridge hardening:** Native editor updates remain byte-bounded, carry revisions, suppress duplicate echo changes, preserve or clamp selection during parent-driven replacement, and expose readiness/injection errors through visible editor status.
- [ ] **Mobile file operations:** Users can rename and delete files from the explorer and command palette; names are validated; duplicate names are rejected; deleting the last file is blocked; active-file state is repaired deterministically.
- [ ] **Workspace recovery:** Reload restores the latest valid locally saved project, file, active project, and active file; failed saves retain recoverable in-memory edits without introducing cloud sync.
- [ ] **Mobile editing actions:** The editor exposes Go to line, Select all, Duplicate line, and Toggle output through a touch-friendly context surface with web/native availability labels.
- [ ] **Focused regression coverage:** Workspace mutations, save lifecycle races, editor bridge revisions/limits, restart restoration, and command availability are covered by focused tests; existing checks remain green.


# RC-M1.2 Browser Runtime Parity Outcomes

- [ ] **Browser Run:** On web, Run executes the active JavaScript file in a disposable Worker with a five-second execution limit, 64-KB output limit, stdout/stderr capture, and visible completion or failure status.
- [ ] **Browser Preview:** On web, Preview renders the active project in an isolated sandboxed iframe and injects the project `main.js` into `index.html` without requiring the native development client.
- [ ] **Local fallback truthfulness:** When GitHub sync is unavailable or unauthenticated, the workspace remains usable through local persistence and the shell does not present the failed sync probe as a save failure.
- [ ] **Native behavior preserved:** Native execution, cancellation, loopback preview, and governed agent approval flows remain routed through their existing native/runtime boundaries.
