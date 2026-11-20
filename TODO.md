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
- [x] AUD-I01: Public-repository GitHub Actions workflow added with frozen install, required checks, build, and generated-bundle diff verification. Awaiting an actual GitHub run.
- [x] AUD-M04: Snapshot/import limits, failed-save preservation, retry semantics, and user-facing persistence errors are implemented and tested.
- [x] AUD-M03: Production refuses local fallback; development fallback is explicit, same-host loopback only, warned at startup, and counted on activation.
- [x] AUD-M02: Raw socket-IP and authenticated-owner rate limits are separate from session concurrency; authentication writes are throttled.
- [x] AUD-L01: Editor and execution output limits use UTF-8 byte accounting with multibyte tests.
- [x] AUD-L02: Native-side editor size rejection occurs before injection and surfaces a typed visible error.
- [x] AUD-L05: Project and file identifiers use runtime random UUIDs with a fallback and rapid-creation tests.
- [x] AUD-L06: Export temporary files are cleaned up and unavailable sharing surfaces an explicit error.
- [x] AUD-I03: Expiry, concurrency, output-cap, malformed UUID, oversized metadata, and rate-limit tests are included.

## Outstanding validation

Physical iPhone 13 and physical Android validation remain unperformed. CI has not yet produced a GitHub run URL for this commit. The simulated execution proof must not be described as secure production isolation. A real isolated execution provider, device evidence, restart testing, and native import/export testing are M1 work.
